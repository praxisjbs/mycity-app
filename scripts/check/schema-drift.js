#!/usr/bin/env node
"use strict";
/**
 * Gate 6: the code names only tables and columns the migrations create (MILESTONES §3,
 * BACKEND_STRUCTURE §10).
 *
 * Postgres reports a missing column only when the query runs, and only the first one,
 * so a query with two bad names costs two deploys. Everything needed to catch them is in
 * migrations/. This reads every SQL string in src/ and scripts/, and the schema as
 * check/lib/catalogue.js builds it from the migrations, and fails on:
 *
 *  1. `alias.column` where the alias's table has no such column;
 *  2. an INSERT INTO t (a, b, ...) column list naming a column t does not have;
 *  3. an UPDATE t SET a = ..., b = ... naming a column t does not have;
 *  4. a statement that reads or writes a table no migration creates, or one a migration
 *     dropped or renamed away;
 *  5. a table created in two files with different columns. Both say IF NOT EXISTS, so
 *     the earlier wins and the later file's extra columns exist on no database.
 *
 * What it skips rather than guesses: a table it cannot follow (catalogue.js OPAQUE), views,
 * CTE names, subqueries and functions in FROM, and anything behind a template ${...}. A
 * false alarm costs an engineer an argument with a red build, so every doubt is silence.
 * Unqualified columns in SELECT and WHERE are not checked; the integration suite runs
 * those against the real schema.
 *
 * Usage: node scripts/check/schema-drift.js     exit 0 ok, 1 on a problem
 */
const fs = require("node:fs");
const path = require("node:path");
const { buildCatalogue, splitTopLevel, readParens } = require("./lib/catalogue");

const ROOT = path.resolve(__dirname, "..", "..");
const SCAN = ["src", "scripts"];
/** The gates' own sources hold SQL-shaped examples and fixtures, not queries. */
const SKIP = [path.join("scripts", "check") + path.sep];

const SQL_WORDS = new Set(
  (
    "select from where join inner left right full outer cross lateral on using and or not in as is null " +
    "case when then else end group order by having limit offset union all distinct insert into values " +
    "update set delete returning with recursive coalesce count sum avg min max exists between like ilike " +
    "asc desc nulls first last over partition conflict do nothing excluded true false cast filter array " +
    "any some interval extract current_date now only unnest generate_series jsonb_to_recordset " +
    "jsonb_array_elements json_array_elements lateral"
  ).split(" "),
);

/** Postgres's own catalogues, read by health checks and the restore drill. */
const SYSTEM = /^(?:pg_|information_schema$)/;

/* ------------------------------------------------------------------ *
 * SQL strings in the JavaScript
 * ------------------------------------------------------------------ */

/**
 * Template literals and quoted strings that look like SQL, wherever they are: a query
 * built as `const SQL = ...` and passed in later is checked like one written inline.
 * `${...}` becomes INTERP, so interpolated text is never read as SQL.
 */
function extractSql(code) {
  const out = [];
  const push = (text, index) => {
    if (!/\b(?:FROM|JOIN|UPDATE|INSERT\s+INTO|DELETE\s+FROM)\b/i.test(text)) return;
    if (!/\b(?:SELECT|INSERT|UPDATE|DELETE|WITH)\b/i.test(text)) return;
    out.push({ text, index });
  };
  let m;
  const tpl = /`((?:[^`\\]|\\.)*)`/gs;
  while ((m = tpl.exec(code))) push(m[1].replace(/\$\{[^}]*\}/g, " INTERP "), m.index);
  // "..." + "..." chunks glued back; re-extracted with a literal matcher, never split on
  // "+", because SQL has its own pluses (`last_value + 1`).
  const concat = /(["'])(?:(?!\1)[^\\\n]|\\.)*\1(?:\s*\+\s*(["'])(?:(?!\2)[^\\\n]|\\.)*\2)*/g;
  const literal = /(["'])((?:(?!\1)[^\\]|\\.)*)\1/g;
  while ((m = concat.exec(code))) {
    const parts = m[0].match(literal) || [];
    push(parts.map((p) => p.slice(1, -1)).join(""), m.index);
  }
  return out;
}

/** Statement text with quoted SQL strings blanked, so 'a.b' in a literal is not a column. */
function blankLiterals(sql) {
  return sql.replace(/'(?:[^']|'')*'/g, (s) => `'${" ".repeat(Math.max(0, s.length - 2))}'`);
}

/** alias → table for one statement, and the names never to judge (CTEs, subqueries, functions). */
function resolveAliases(sql) {
  const aliases = new Map();
  const opaque = new Set();
  let m;
  const cte = /(?:\bWITH|,)\s+(?:RECURSIVE\s+)?([a-z_][a-z0-9_]*)\s+AS\s*(?:MATERIALIZED\s+|NOT\s+MATERIALIZED\s+)?\(/gi;
  while ((m = cte.exec(sql))) opaque.add(m[1].toLowerCase());
  const sub = /\b(?:FROM|JOIN)\s*\(\s*(?:SELECT|VALUES|WITH)[\s\S]*?\)\s*(?:AS\s+)?([a-z_][a-z0-9_]*)/gi;
  while ((m = sub.exec(sql))) opaque.add(m[1].toLowerCase());
  const fn = /\b(?:FROM|JOIN|,)\s+(?:LATERAL\s+)?[a-z_][a-z0-9_.]*\s*\([\s\S]*?\)\s*(?:WITH\s+ORDINALITY\s+)?(?:AS\s+)?([a-z_][a-z0-9_]*)/gi;
  while ((m = fn.exec(sql))) opaque.add(m[1].toLowerCase());

  const src = /\b(?:FROM|JOIN)\s+(?:ONLY\s+)?((?:public\.)?[a-z_][a-z0-9_]*|INTERP)(?:\s+(?:AS\s+)?([a-z_][a-z0-9_]*))?/gi;
  while ((m = src.exec(sql))) {
    const table = m[1].toLowerCase().replace(/^public\./, "");
    const alias = (m[2] || "").toLowerCase();
    if (table === "interp") {
      if (alias) opaque.add(alias);
      continue;
    }
    if (SQL_WORDS.has(table)) continue;
    const key = alias && !SQL_WORDS.has(alias) ? alias : table;
    if (aliases.has(key) && aliases.get(key) !== table) opaque.add(key);
    aliases.set(key, table);
  }
  const upd = /\bUPDATE\s+(?:ONLY\s+)?((?:public\.)?[a-z_][a-z0-9_]*)(?:\s+(?:AS\s+)?([a-z_][a-z0-9_]*))?\s+SET\b/gi;
  while ((m = upd.exec(sql))) {
    const table = m[1].toLowerCase().replace(/^public\./, "");
    const alias = (m[2] || "").toLowerCase();
    aliases.set(alias && !SQL_WORDS.has(alias) ? alias : table, table);
  }
  const ins = /\bINSERT\s+INTO\s+((?:public\.)?[a-z_][a-z0-9_]*)(?:\s+AS\s+([a-z_][a-z0-9_]*))?/gi;
  while ((m = ins.exec(sql))) {
    const table = m[1].toLowerCase().replace(/^public\./, "");
    aliases.set(table, table);
    if (m[2]) aliases.set(m[2].toLowerCase(), table);
  }
  const del = /\bDELETE\s+FROM\s+(?:ONLY\s+)?((?:public\.)?[a-z_][a-z0-9_]*)(?:\s+(?:AS\s+)?([a-z_][a-z0-9_]*))?/gi;
  while ((m = del.exec(sql))) {
    const table = m[1].toLowerCase().replace(/^public\./, "");
    const alias = (m[2] || "").toLowerCase();
    aliases.set(alias && !SQL_WORDS.has(alias) ? alias : table, table);
  }
  return { aliases, opaque };
}

/** Can this table be judged? Known, not opaque, not a view. */
function judged(cat, table) {
  return cat.tables.has(table) && !cat.opaque.has(table) && !cat.views.has(table);
}

function missing(cat, table, col, ref, rule) {
  return { rule, ref, table, column: col, near: suggest(col, cat.tables.get(table)) };
}

/** Rules 1 to 4 for one SQL string. */
function checkStatement(raw, cat) {
  const sql = blankLiterals(raw);
  const findings = [];
  const seen = new Set();
  const add = (f) => {
    const k = `${f.rule}|${f.ref}`;
    if (!seen.has(k)) {
      seen.add(k);
      findings.push(f);
    }
  };
  const { aliases, opaque } = resolveAliases(sql);
  let m;

  // 4. Tables that do not exist.
  // `FOR UPDATE OF t` and `FOR UPDATE SKIP LOCKED` are row locks, not an UPDATE.
  const target = /\b(?:FROM|JOIN|(?<!FOR\s)UPDATE(?:\s+ONLY)?|INSERT\s+INTO|DELETE\s+FROM|TRUNCATE(?:\s+TABLE)?)\s+(?:ONLY\s+)?((?:public\.)?[a-z_][a-z0-9_]*)\b(?!\s*\()/gi;
  while ((m = target.exec(sql))) {
    const table = m[1].toLowerCase().replace(/^public\./, "");
    if (SQL_WORDS.has(table) || opaque.has(table) || table === "interp") continue;
    if (SYSTEM.test(table)) continue;
    if (cat.tables.has(table) || cat.views.has(table)) continue;
    if (cat.gone.has(table)) add({ rule: "table", ref: table, table, gone: cat.gone.get(table) });
    else add({ rule: "table", ref: table, table, gone: null });
  }

  // 1. alias.column
  const qualified = /\b([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)\b(?!\s*\()/gi;
  while ((m = qualified.exec(sql))) {
    const alias = m[1].toLowerCase();
    const col = m[2].toLowerCase();
    if (alias === "public" || opaque.has(alias) || !aliases.has(alias)) continue;
    if (alias === "excluded") continue;
    const table = aliases.get(alias);
    if (!judged(cat, table) || cat.tables.get(table).has(col)) continue;
    add(missing(cat, table, col, `${alias}.${col}`, "column"));
  }

  // 2. INSERT INTO t (a, b, ...)
  const insert = /\bINSERT\s+INTO\s+((?:public\.)?[a-z_][a-z0-9_]*)\s*\(/gi;
  while ((m = insert.exec(sql))) {
    const table = m[1].toLowerCase().replace(/^public\./, "");
    if (!judged(cat, table)) continue;
    const block = readParens(sql, insert.lastIndex - 1);
    if (!block || /INTERP/.test(block.body)) continue;
    for (const part of splitTopLevel(block.body)) {
      const col = part.trim().replace(/^"|"$/g, "").toLowerCase();
      if (!/^[a-z_][a-z0-9_]*$/.test(col)) continue;
      if (!cat.tables.get(table).has(col)) add(missing(cat, table, col, `INSERT INTO ${table} (${col})`, "insert"));
    }
  }

  // 3. UPDATE t SET a = ..., b = ...
  const update = /\b(?<!FOR\s)UPDATE\s+(?:ONLY\s+)?((?:public\.)?[a-z_][a-z0-9_]*)(?:\s+(?:AS\s+)?[a-z_][a-z0-9_]*)?\s+SET\b/gi;
  while ((m = update.exec(sql))) {
    const table = m[1].toLowerCase().replace(/^public\./, "");
    if (!judged(cat, table)) continue;
    const rest = sql.slice(update.lastIndex);
    const end = rest.search(/\b(?:WHERE|RETURNING|FROM)\b|;|$/i);
    for (const part of splitTopLevel(rest.slice(0, end))) {
      const lhs = /^\s*"?([a-z_][a-z0-9_]*)"?\s*=/i.exec(part);
      if (!lhs) continue;
      const col = lhs[1].toLowerCase();
      if (!cat.tables.get(table).has(col)) add(missing(cat, table, col, `UPDATE ${table} SET ${col}`, "update"));
    }
  }
  return findings;
}

/** 5. A table created twice with different columns. */
function checkRedefinitions(cat) {
  const out = [];
  for (const [table, defs] of cat.definitions) {
    if (defs.length < 2) continue;
    const [first, ...rest] = defs;
    for (const other of rest) {
      const a = new Set(first.columns);
      const b = new Set(other.columns);
      const live = cat.tables.get(table) || new Set();
      // A later ADD COLUMN is how drift is properly fixed; a column that ended up live is not lost.
      const lost = other.columns.filter((c) => !a.has(c) && !live.has(c));
      const extra = first.columns.filter((c) => !b.has(c));
      if (lost.length || extra.length) out.push({ table, first: first.file, other: other.file, lost, extra });
    }
  }
  return out;
}

/** The nearest real column names, so the message says what to write instead. */
function suggest(col, cols) {
  const all = [...(cols || [])];
  const near = all.filter((c) => c.startsWith(`${col}_`) || c.endsWith(`_${col}`) || col.startsWith(c));
  if (near.length) return near.slice(0, 3);
  return all
    .map((c) => [c, distance(col, c)])
    .filter(([, d]) => d <= 2)
    .sort((x, y) => x[1] - y[1])
    .slice(0, 3)
    .map(([c]) => c);
}

function distance(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j += 1) dp[0][j] = j;
  for (let i = 1; i <= a.length; i += 1)
    for (let j = 1; j <= b.length; j += 1)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === ".git") continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (e.name.endsWith(".js") && !e.name.endsWith(".test.js")) out.push(full);
  }
  return out;
}

/**
 * @param {{root?: string}} [opts]
 * @returns {{problems: string[], tables: number, statements: number}}
 */
function check({ root = ROOT } = {}) {
  const cat = buildCatalogue({ root });
  const problems = [];
  let statements = 0;
  for (const dir of SCAN) {
    for (const file of walk(path.join(root, dir))) {
      const rel = path.relative(root, file);
      if (SKIP.some((s) => rel.startsWith(s))) continue;
      const code = fs.readFileSync(file, "utf8");
      if (!/\b(?:SELECT|INSERT|UPDATE|DELETE)\b/.test(code)) continue;
      for (const { text, index } of extractSql(code)) {
        statements += 1;
        const line = code.slice(0, index).split("\n").length;
        for (const f of checkStatement(text, cat)) {
          const at = `${rel.split(path.sep).join("/")}:${line}`;
          if (f.rule === "table")
            problems.push(
              f.gone
                ? `${at}  ${f.table}: this table no longer exists (${f.gone})`
                : `${at}  ${f.table}: no migration creates this table`,
            );
          else
            problems.push(
              `${at}  ${f.ref}: ${f.table} has no column "${f.column}"${f.near.length ? `; did you mean ${f.near.join(", ")}` : ""}`,
            );
        }
      }
    }
  }
  for (const r of checkRedefinitions(cat)) {
    const parts = [];
    if (r.lost.length) parts.push(`declared only in ${r.other}, so never created: ${r.lost.join(", ")}`);
    if (r.extra.length) parts.push(`only in ${r.first}: ${r.extra.join(", ")}`);
    problems.push(`${r.table} is created in ${r.first} and again in ${r.other} with different columns; ${parts.join("; ")}`);
  }
  return { problems, tables: cat.tables.size, statements };
}

if (require.main === module) {
  const { problems, tables, statements } = check();
  if (problems.length) {
    console.error(`schema-drift: ${problems.length} problem(s)\n`);
    for (const p of problems) console.error(`  ${p}`);
    console.error(
      "\nThe schema is what migrations/ builds. A column added outside a migration is not a column:" +
        "\nadd it in a new migration (docs/MIGRATIONS.md), or fix the query.",
    );
    process.exit(1);
  }
  console.log(`schema-drift: ok (${tables} tables from the migrations, ${statements} SQL strings checked)`);
}

module.exports = { check, checkStatement, checkRedefinitions, extractSql, resolveAliases };
