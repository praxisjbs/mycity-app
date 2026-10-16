#!/usr/bin/env node
"use strict";
/**
 * Gate 5: migrations are safe to run twice, and a merged one is never edited
 * (README §6.3, BACKEND_STRUCTURE §10).
 *
 * Why twice: a file that fails part way leaves its ledger row unwritten and runs again,
 * whole, after the fix; a database restored from a dump replays what came after it; CI
 * applies UP, DOWN, UP. Each must find the database in whatever state the last attempt
 * left it and finish the job.
 *
 * Fails the build on, in UP or DOWN, outside a dollar-quoted body:
 *   CREATE TABLE / INDEX / SCHEMA / EXTENSION   without IF NOT EXISTS
 *   ADD COLUMN                                  without IF NOT EXISTS
 *   DROP <object>                               without IF EXISTS
 *   CREATE FUNCTION / PROCEDURE / VIEW / TRIGGER without OR REPLACE
 *   ADD CONSTRAINT, CREATE TYPE                 outside a DO $$ ... $$ block that checks
 *                                               the catalogue first
 *   INSERT INTO                                 without ON CONFLICT in the same statement
 *                                               (a temp table the file creates with
 *                                               ON COMMIT DROP is exempt: it is new each run)
 *   CREATE INDEX CONCURRENTLY                   cannot run inside the transaction every
 *                                               migration runs in
 * and on a migration that existed before this change and was edited, renamed or deleted:
 * the ledger keys on the name and records the hash, so a fresh database and an existing
 * one would quietly differ (migrate.js refuses the edited file on any database that has it).
 *
 * Anything inside a dollar-quoted body is left alone: a DO block IS the guard, and a
 * function body runs when it is called, not when the migration runs.
 *
 * Usage: node scripts/check/migration-idempotency.js     exit 0 clean, 1 on a problem
 */
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");

/**
 * SQL with comments and single-quoted string bodies blanked (same length, same lines),
 * plus the ranges of every dollar-quoted body ($$...$$, $fn$...$fn$).
 * @param {string} sql
 * @returns {{clean: string, bodies: Array<[number, number]>}}
 */
function sqlMask(sql) {
  const src = String(sql).replace(/\r\n/g, "\n");
  const out = src.split("");
  const bodies = [];
  const blank = (a, b) => {
    for (let k = a; k < b; k += 1) if (out[k] !== "\n") out[k] = " ";
  };
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];
    if (c === "-" && next === "-") {
      let end = src.indexOf("\n", i);
      if (end === -1) end = src.length;
      blank(i, end);
      i = end;
      continue;
    }
    if (c === "/" && next === "*") {
      let end = src.indexOf("*/", i + 2);
      end = end === -1 ? src.length : end + 2;
      blank(i, end);
      i = end;
      continue;
    }
    if (c === "'") {
      let k = i + 1;
      while (k < src.length) {
        if (src[k] === "'" && src[k + 1] === "'") k += 2;
        else if (src[k] === "'") break;
        else k += 1;
      }
      blank(i + 1, k);
      i = k + 1;
      continue;
    }
    if (c === "$") {
      const tag = /^\$[A-Za-z_]*\$/.exec(src.slice(i, i + 64));
      if (tag && !/[\w$]/.test(src[i - 1] || "")) {
        const end = src.indexOf(tag[0], i + tag[0].length);
        const stop = end === -1 ? src.length : end + tag[0].length;
        bodies.push([i, stop]);
        i = stop;
        continue;
      }
    }
    i += 1;
  }
  return { clean: out.join(""), bodies };
}

const inside = (i, ranges) => ranges.some(([a, b]) => i >= a && i < b);
const lineOf = (text, index) => text.slice(0, index).split("\n").length;

/** The statement a match belongs to: from the previous `;` to the next one. */
function statementAt(sql, index) {
  const start = sql.lastIndexOf(";", index) + 1;
  const end = sql.indexOf(";", index);
  return sql.slice(start, end === -1 ? sql.length : end);
}

const RULES = [
  {
    id: "create-table",
    find: /\bCREATE\s+(?:UNLOGGED\s+)?TABLE\s+(?!IF\s+NOT\s+EXISTS)/gi,
    fix: "CREATE TABLE IF NOT EXISTS",
  },
  {
    id: "create-index",
    find: /\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+(?!IF\s+NOT\s+EXISTS|CONCURRENTLY)/gi,
    fix: "CREATE INDEX IF NOT EXISTS / CREATE UNIQUE INDEX IF NOT EXISTS",
  },
  {
    id: "index-concurrently",
    find: /\b(?:CREATE|DROP)\s+(?:UNIQUE\s+)?INDEX\s+CONCURRENTLY\b/gi,
    fix: "plain CREATE INDEX IF NOT EXISTS; CONCURRENTLY cannot run in the migration's transaction",
    always: true,
  },
  {
    id: "add-column",
    find: /\bADD\s+COLUMN\s+(?!IF\s+NOT\s+EXISTS)/gi,
    fix: "ADD COLUMN IF NOT EXISTS",
  },
  {
    id: "drop",
    find: /\bDROP\s+(?:TABLE|INDEX|VIEW|MATERIALIZED\s+VIEW|TRIGGER|FUNCTION|PROCEDURE|TYPE|COLUMN|CONSTRAINT|SCHEMA|SEQUENCE|POLICY|EXTENSION|DOMAIN)\s+(?!IF\s+EXISTS|CONCURRENTLY)/gi,
    fix: "DROP <object> IF EXISTS",
  },
  {
    id: "create-schema",
    find: /\bCREATE\s+SCHEMA\s+(?!IF\s+NOT\s+EXISTS)/gi,
    fix: "CREATE SCHEMA IF NOT EXISTS",
  },
  {
    id: "create-extension",
    find: /\bCREATE\s+EXTENSION\s+(?!IF\s+NOT\s+EXISTS)/gi,
    fix: "CREATE EXTENSION IF NOT EXISTS",
  },
  {
    id: "create-sequence",
    find: /\bCREATE\s+SEQUENCE\s+(?!IF\s+NOT\s+EXISTS)/gi,
    fix: "CREATE SEQUENCE IF NOT EXISTS",
  },
  {
    id: "create-function",
    find: /\bCREATE\s+(?!OR\s+REPLACE\s+)(?:FUNCTION|PROCEDURE)\b/gi,
    fix: "CREATE OR REPLACE FUNCTION / PROCEDURE",
  },
  {
    id: "create-view",
    find: /\bCREATE\s+(?!OR\s+REPLACE\s+)(?:MATERIALIZED\s+)?VIEW\b/gi,
    fix: "CREATE OR REPLACE VIEW (a materialized view: DROP MATERIALIZED VIEW IF EXISTS first)",
  },
  {
    id: "create-trigger",
    find: /\bCREATE\s+(?!OR\s+REPLACE\s+)(?:CONSTRAINT\s+)?TRIGGER\b/gi,
    fix: "CREATE OR REPLACE TRIGGER (or DROP TRIGGER IF EXISTS first)",
  },
  {
    id: "add-constraint",
    find: /\bADD\s+CONSTRAINT\b/gi,
    fix: "wrap in DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '...') THEN ... END IF; END $$;",
  },
  {
    id: "create-type",
    find: /\bCREATE\s+(?:TYPE|DOMAIN)\b/gi,
    fix: "wrap in DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = '...') THEN ... END IF; END $$;",
  },
  {
    id: "insert-without-conflict",
    find: /\bINSERT\s+INTO\b/gi,
    fix: "add ON CONFLICT DO NOTHING (or ON CONFLICT (...) DO UPDATE SET ...)",
    statementNeeds: /\bON\s+CONFLICT\b/i,
  },
];

/** Temp tables this file creates for itself and drops on commit: new and empty each run. */
function selfScopedTempTables(sql) {
  const names = new Set();
  const re =
    /CREATE\s+(?:TEMP|TEMPORARY)\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z0-9_]*)([\s\S]*?);/gi;
  let m;
  while ((m = re.exec(sql)) !== null) {
    if (/\bON\s+COMMIT\s+DROP\b/i.test(m[2])) names.add(m[1].toLowerCase());
  }
  return names;
}

/**
 * Every statement in a migration that is not safe to run twice.
 * @param {string} sql  the whole file
 * @returns {Array<{rule: string, line: number, fix: string}>}
 */
function violations(sql) {
  const { clean, bodies } = sqlMask(sql);
  const temps = selfScopedTempTables(clean);
  const out = [];
  for (const rule of RULES) {
    rule.find.lastIndex = 0;
    let m;
    while ((m = rule.find.exec(clean)) !== null) {
      if (!rule.always && inside(m.index, bodies)) continue;
      if (
        rule.statementNeeds &&
        rule.statementNeeds.test(statementAt(clean, m.index))
      )
        continue;
      if (rule.id === "insert-without-conflict") {
        const target = /\bINSERT\s+INTO\s+([a-z_][a-z0-9_]*)/i.exec(
          clean.slice(m.index),
        );
        if (target && temps.has(target[1].toLowerCase())) continue;
      }
      out.push({ rule: rule.id, line: lineOf(clean, m.index), fix: rule.fix });
    }
  }
  return out.sort((a, b) => a.line - b.line);
}

function changedMigrations() {
  try {
    const { changedFiles } = require("./lib/changes");
    return changedFiles().filter((c) =>
      /^(?:migrations|seeds\/reference)\/[^/]+\.sql$/.test(c.path),
    );
  } catch {
    return [];
  }
}

/**
 * @param {{root?: string, changes?: Array<{path: string, status: string}>}} [opts]
 * @returns {{problems: string[], notes: string[], count: number}}
 */
function check({ root = ROOT, changes } = {}) {
  const problems = [];
  const files = [
    [path.join(root, "migrations"), "migrations"],
    [path.join(root, "seeds", "reference"), "seeds/reference"],
  ].flatMap(([dir, label]) =>
    fs.existsSync(dir)
      ? fs
          .readdirSync(dir)
          .filter((f) => f.endsWith(".sql"))
          .map((f) => ({ dir, label, file: f }))
      : [],
  );
  for (const { dir, label, file } of files) {
    for (const v of violations(fs.readFileSync(path.join(dir, file), "utf8")))
      problems.push(
        `${label}/${file}:${v.line} [${v.rule}] not safe to run twice; use ${v.fix}`,
      );
  }
  const verb = { M: "edited", D: "deleted", R: "renamed" };
  for (const c of changes === undefined ? changedMigrations() : changes) {
    if (
      !verb[c.status] ||
      !/^(?:migrations|seeds\/reference)\/[^/]+\.sql$/.test(c.path)
    )
      continue;
    problems.push(
      `${c.path}: a merged migration was ${verb[c.status]}. The ledger keys on its name and hash, so databases that have it and fresh ones would differ. Put the change in a new file`,
    );
  }
  return { problems, notes: [], count: files.length };
}

if (require.main === module) {
  const { problems, count } = check();
  if (problems.length === 0) {
    console.log(
      `migration-idempotency: ok (${count} file${count === 1 ? "" : "s"} safe to run twice, none merged edited)`,
    );
    process.exit(0);
  }
  console.error(
    "migration-idempotency: every migration runs safely twice and a merged one is never edited (README §6.3)\n",
  );
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

module.exports = { check, violations, sqlMask, statementAt, RULES };
