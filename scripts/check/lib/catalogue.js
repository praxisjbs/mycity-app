"use strict";
/**
 * The schema as the migrations build it, read from the files alone: every table and its
 * columns, the views, the tables a migration renamed away or dropped, and every place a
 * table is created. Gate 6 (check/schema-drift.js, check/contract-columns.js) compares
 * the code and the contract against it, on every PR, with no database.
 *
 * Built by replaying the UP section of each file in migrations/ and seeds/reference/, in
 * the order scripts/db/migrate.js applies them (by number, the two folders interleaved).
 * DOWN sections are never read: they describe the way back, not the schema.
 *
 * It is not a SQL parser. What it cannot follow with certainty it marks OPAQUE, and an
 * opaque table never produces a finding: a false alarm costs an engineer an argument
 * with a red build, so every doubt resolves to silence.
 *
 *   CREATE TABLE t (...)                 columns from the list; table constraints skipped
 *   CREATE TABLE t (LIKE x) / AS SELECT  opaque: the shape comes from elsewhere
 *   CREATE VIEW v                        known by name, opaque (no column list computed)
 *   ALTER TABLE t ADD / DROP / RENAME COLUMN   applied in order, inside DO blocks too
 *   ALTER TABLE t RENAME TO u            t is gone, u is opaque
 *   DROP TABLE t                         t is gone (until a later file creates it again)
 *   ALTER TABLE %I ADD / DROP COLUMN     dynamic: every table becomes opaque
 */
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const { byNumber, parseMigration } = require(path.join(ROOT, "scripts", "db", "migrate"));

const SOURCES = [path.join("migrations"), path.join("seeds", "reference")];
const NAME = "[a-z_][a-z0-9_]*";
const TABLE_CONSTRAINT = /^\s*(?:CONSTRAINT\b|PRIMARY\s+KEY\b|FOREIGN\s+KEY\b|UNIQUE\b|CHECK\b|EXCLUDE\b|LIKE\b)/i;

/** The schema files in apply order: [{ file, up }]. */
function migrationFiles(root = ROOT) {
  const out = [];
  for (const dir of SOURCES) {
    const abs = path.join(root, dir);
    if (!fs.existsSync(abs)) continue;
    for (const name of fs.readdirSync(abs).filter((f) => f.endsWith(".sql"))) {
      const rel = path.posix.join(dir.split(path.sep).join("/"), name);
      let up;
      try {
        ({ up } = parseMigration(fs.readFileSync(path.join(abs, name), "utf8"), rel));
      } catch {
        continue; // gate 4 reports a file migrate.js cannot split; this gate stays quiet
      }
      out.push({ name, file: rel, up });
    }
  }
  return out.sort((a, b) => byNumber(a.name, b.name));
}

/** Comments blanked (same length), so a word in a comment is not read as DDL. */
function stripSql(sql) {
  return String(sql)
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/--[^\n]*/g, (m) => " ".repeat(m.length));
}

/** Split on commas at depth 0, outside quotes: `numeric(18,2)` and `CHECK (x IN ('a','b'))` stay whole. */
function splitTopLevel(body) {
  const out = [];
  let depth = 0;
  let buf = "";
  let quote = null;
  for (const ch of body) {
    if (quote) {
      buf += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      buf += ch;
      continue;
    }
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (ch === "," && depth === 0) {
      out.push(buf);
      buf = "";
      continue;
    }
    buf += ch;
  }
  if (buf.trim()) out.push(buf);
  return out;
}

/** The balanced (...) block whose "(" is at `open`. */
function readParens(s, open) {
  let depth = 0;
  let quote = null;
  for (let i = open; i < s.length; i += 1) {
    const ch = s[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (ch === "(") depth += 1;
    else if (ch === ")") {
      depth -= 1;
      if (depth === 0) return { body: s.slice(open + 1, i), end: i };
    }
  }
  return null;
}

/** Column names a CREATE TABLE body declares. */
function columnsOf(body) {
  const cols = [];
  for (const raw of splitTopLevel(body)) {
    if (TABLE_CONSTRAINT.test(raw)) continue;
    const m = raw.trim().match(/^"?([a-z_][a-z0-9_]*)"?\s+\S/i);
    if (m) cols.push(m[1].toLowerCase());
  }
  return cols;
}

/** Drop a schema qualifier: public.employee → employee. */
const bare = (name) => String(name).toLowerCase().replace(/^public\./, "");

/**
 * @param {{root?: string}} [opts]
 * @returns {{
 *   tables: Map<string, Set<string>>,
 *   views: Set<string>,
 *   opaque: Set<string>,
 *   gone: Map<string, string>,
 *   definitions: Map<string, Array<{file: string, columns: string[]}>>,
 *   files: number,
 * }}
 */
function buildCatalogue({ root = ROOT } = {}) {
  const tables = new Map();
  const views = new Set();
  const opaque = new Set();
  const gone = new Map();
  const definitions = new Map();
  const ensure = (t) => {
    gone.delete(t);
    if (!tables.has(t)) tables.set(t, new Set());
    return tables.get(t);
  };

  const files = migrationFiles(root);
  for (const { file, up } of files) {
    const sql = stripSql(up);
    let m;

    const createRe = new RegExp(
      `CREATE\\s+(?:UNLOGGED\\s+|TEMP\\s+|TEMPORARY\\s+)?TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?((?:public\\.)?${NAME})\\s*\\(`,
      "gi",
    );
    while ((m = createRe.exec(sql))) {
      const name = bare(m[1]);
      const block = readParens(sql, createRe.lastIndex - 1);
      if (!block) {
        ensure(name);
        opaque.add(name);
        continue;
      }
      const columns = columnsOf(block.body);
      // A second CREATE of a table that exists does nothing (IF NOT EXISTS) or fails; either
      // way its columns are not added. schema-drift.js reports the difference.
      const existed = tables.has(name);
      const cols = ensure(name);
      if (!existed) for (const c of columns) cols.add(c);
      if (!definitions.has(name)) definitions.set(name, []);
      definitions.get(name).push({ file, columns });
      if (/\bLIKE\s+[a-z_]/i.test(block.body)) opaque.add(name);
    }

    const ctasRe = new RegExp(
      `CREATE\\s+(?:UNLOGGED\\s+|TEMP\\s+|TEMPORARY\\s+)?TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?((?:public\\.)?${NAME})\\s+AS\\b`,
      "gi",
    );
    while ((m = ctasRe.exec(sql))) {
      ensure(bare(m[1]));
      opaque.add(bare(m[1]));
    }

    const viewRe = new RegExp(
      `CREATE\\s+(?:OR\\s+REPLACE\\s+)?(?:MATERIALIZED\\s+)?VIEW\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?((?:public\\.)?${NAME})`,
      "gi",
    );
    while ((m = viewRe.exec(sql))) {
      const name = bare(m[1]);
      gone.delete(name);
      views.add(name);
    }
    const dropViewRe = new RegExp(`DROP\\s+(?:MATERIALIZED\\s+)?VIEW\\s+(?:IF\\s+EXISTS\\s+)?((?:public\\.)?${NAME})`, "gi");
    while ((m = dropViewRe.exec(sql))) views.delete(bare(m[1]));

    const alterRe = new RegExp(
      `ALTER\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?(?:ONLY\\s+)?((?:public\\.)?${NAME})([\\s\\S]*?);`,
      "gi",
    );
    while ((m = alterRe.exec(sql))) {
      const name = bare(m[1]);
      const body = m[2];
      const cols = ensure(name);
      let a;
      const addRe = /ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([a-z_][a-z0-9_]*)"?/gi;
      while ((a = addRe.exec(body))) cols.add(a[1].toLowerCase());
      const dropRe = /DROP\s+COLUMN\s+(?:IF\s+EXISTS\s+)?"?([a-z_][a-z0-9_]*)"?/gi;
      while ((a = dropRe.exec(body))) cols.delete(a[1].toLowerCase());
      const renRe = /RENAME\s+COLUMN\s+"?([a-z_][a-z0-9_]*)"?\s+TO\s+"?([a-z_][a-z0-9_]*)"?/gi;
      while ((a = renRe.exec(body))) {
        cols.delete(a[1].toLowerCase());
        cols.add(a[2].toLowerCase());
      }
      const renTo = body.match(/RENAME\s+TO\s+"?([a-z_][a-z0-9_]*)"?/i);
      if (renTo && !/RENAME\s+COLUMN/i.test(body)) {
        const to = renTo[1].toLowerCase();
        tables.delete(name);
        gone.set(name, `renamed to ${to} by ${file}`);
        ensure(to);
        opaque.add(to);
      }
    }

    const dropTableRe = new RegExp(`DROP\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?((?:public\\.)?${NAME})`, "gi");
    while ((m = dropTableRe.exec(sql))) {
      const name = bare(m[1]);
      tables.delete(name);
      gone.set(name, `dropped by ${file}`);
    }

    // Dynamic DDL that names its table with %I could add or drop a column anywhere.
    // Trigger, index and constraint DDL cannot, so it is left alone.
    for (const stmt of up.match(/(?:ALTER|CREATE)\s+TABLE[^;']*?%I[^;']*/gi) || []) {
      if (/ADD\s+COLUMN|DROP\s+COLUMN|RENAME\s+COLUMN/i.test(stmt))
        for (const t of tables.keys()) opaque.add(t);
    }
  }

  for (const [t, cols] of tables) if (cols.size === 0) opaque.add(t);
  return { tables, views, opaque, gone, definitions, files: files.length };
}

module.exports = { buildCatalogue, migrationFiles, splitTopLevel, readParens, stripSql, columnsOf };
