#!/usr/bin/env node
"use strict";
/**
 * Gate 4: every migration can be undone, or says why not (README §6.3,
 * BACKEND_STRUCTURE §10).
 *
 * Static, on every run. Fails the build on:
 *  1. a file migrate.js cannot split into "-- UP" and "-- DOWN";
 *  2. a DOWN section with no statements that does not declare
 *       -- IRREVERSIBLE: <what cannot be rebuilt, and why>
 *     (an empty reason does not count; migrate.js --down refuses a declared file);
 *  3. a table, view, type, function, sequence, schema, extension, trigger or column the UP
 *     creates that its DOWN never names;
 *  4. a destructive statement in UP (DROP TABLE/COLUMN/SCHEMA, TRUNCATE, DELETE FROM,
 *     RENAME, ALTER COLUMN ... TYPE, SET NOT NULL) with no
 *       -- DESTRUCTIVE: <what is lost, and why that is acceptable>
 *     on the line, the line above, or in the file header before "-- UP". Destructive
 *     steps ship one release after the code that stops using the column (README §6.3).
 *
 * With a database (RUN_DB_TESTS=1 and DATABASE_URL, as for the integration tests, or
 * --apply), also the real round trip on a throwaway database: each file's UP, then every
 * DOWN in reverse, each compared with the catalogue as it was before that file's UP
 * (anything left behind or removed is a problem), then UP again. The throwaway database
 * is dropped afterwards; the role needs CREATEDB.
 *
 * Usage: node scripts/check/migration-reversibility.js [--apply]   exit 0 clean, 1 on a problem
 */
const fs = require("node:fs");
const path = require("node:path");
const { sqlMask } = require("./migration-idempotency");
const {
  FILE_RE,
  numberOf,
  byNumber,
  irreversibleReason,
  parseMigration,
} = require("../db/migrate");

const ROOT = path.resolve(__dirname, "..", "..");

const DESTRUCTIVE = [
  [/\bDROP\s+TABLE\b/i, "DROP TABLE"],
  [/\bDROP\s+COLUMN\b/i, "DROP COLUMN"],
  [/\bDROP\s+SCHEMA\b/i, "DROP SCHEMA"],
  [/\bTRUNCATE\b/i, "TRUNCATE"],
  [/\bDELETE\s+FROM\b/i, "DELETE FROM"],
  [/\bRENAME\s+(?:COLUMN\b|TO\b|\w+\s+TO\b)/i, "RENAME"],
  [
    /\bALTER\s+COLUMN\s+\w+\s+(?:SET\s+DATA\s+)?TYPE\b/i,
    "ALTER COLUMN ... TYPE",
  ],
  [/\bSET\s+NOT\s+NULL\b/i, "SET NOT NULL"],
];
const DESTRUCTIVE_MARK = /^\s*--\s*DESTRUCTIVE:[ \t]*\S/i;

/** Objects an UP creates, by kind, each with the name its DOWN must mention. */
const CREATES = [
  [
    /\bCREATE\s+(?:UNLOGGED\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([\w."]+)/gi,
    "table",
  ],
  [
    /\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:MATERIALIZED\s+)?VIEW\s+(?:IF\s+NOT\s+EXISTS\s+)?([\w."]+)/gi,
    "view",
  ],
  [
    /\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|PROCEDURE)\s+([\w."]+)/gi,
    "function",
  ],
  [
    /\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:CONSTRAINT\s+)?TRIGGER\s+([\w"]+)/gi,
    "trigger",
  ],
  [/\bCREATE\s+SEQUENCE\s+(?:IF\s+NOT\s+EXISTS\s+)?([\w."]+)/gi, "sequence"],
  [/\bCREATE\s+SCHEMA\s+(?:IF\s+NOT\s+EXISTS\s+)?([\w"]+)/gi, "schema"],
  [/\bCREATE\s+EXTENSION\s+(?:IF\s+NOT\s+EXISTS\s+)?([\w"-]+)/gi, "extension"],
  [/\bCREATE\s+(?:TYPE|DOMAIN)\s+([\w."]+)/gi, "type"],
  [/\bADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?([\w"]+)/gi, "column"],
];

const bareName = (n) => n.replace(/"/g, "").split(".").pop().toLowerCase();
const lineIndex = (lines, re) => lines.findIndex((l) => re.test(l));

/**
 * The static judgement on one migration file.
 * @param {string} text
 * @param {string} name  for messages ("0040_organisation.sql")
 * @returns {string[]} problems
 */
function review(text, name) {
  const where = `migrations/${name}`;
  try {
    parseMigration(text, where);
  } catch (err) {
    return [err.message];
  }
  const problems = [];
  const raw = String(text).replace(/\r\n/g, "\n");
  const lines = raw.split("\n");
  const upAt = lineIndex(lines, /^--\s*UP\s*$/);
  const downAt = lineIndex(lines, /^--\s*DOWN\s*$/);
  const { clean, bodies } = sqlMask(raw);
  const cleanLines = clean.split("\n");
  // Dollar-quoted bodies (functions, DO blocks) run later or guard themselves: blank them.
  const flat = clean.split("");
  for (const [a, b] of bodies)
    for (let k = a; k < b; k += 1) if (flat[k] !== "\n") flat[k] = " ";
  const outer = flat.join("").split("\n");
  const upCode = cleanLines.slice(upAt + 1, downAt).join("\n");
  const downText = lines.slice(downAt + 1).join("\n");
  const downCode = cleanLines.slice(downAt + 1).join("\n");

  const reason = irreversibleReason(downText);
  if (reason === "")
    problems.push(
      `${where}: "-- IRREVERSIBLE:" needs the reason (what cannot be rebuilt, and why)`,
    );
  if (reason === null && !downCode.trim())
    problems.push(
      `${where}: the DOWN section has no statements. Write the undo, or declare "-- IRREVERSIBLE: <reason>"`,
    );

  if (reason === null && downCode.trim()) {
    const mentioned = new Set(
      (downCode.toLowerCase().match(/[a-z_][a-z0-9_$-]*/g) || []).map(String),
    );
    for (const [re, kind] of CREATES) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(upCode)) !== null) {
        const n = bareName(m[1]);
        if (n && !mentioned.has(n))
          problems.push(
            `${where}: UP creates ${kind} ${n}, and DOWN never names it`,
          );
      }
    }
  }

  const header = lines.slice(0, upAt).some((l) => DESTRUCTIVE_MARK.test(l));
  for (let i = upAt + 1; i < downAt; i += 1) {
    for (const [re, label] of DESTRUCTIVE) {
      if (!re.test(outer[i] || "")) continue;
      const marked =
        header ||
        DESTRUCTIVE_MARK.test(lines[i]) ||
        DESTRUCTIVE_MARK.test(lines[i - 1] || "") ||
        /--\s*DESTRUCTIVE:[ \t]*\S/i.test(lines[i]);
      if (!marked)
        problems.push(
          `${where}:${i + 1} ${label} with no "-- DESTRUCTIVE: <what is lost, and why>" on the line, the line above, or in the header`,
        );
    }
  }
  return problems;
}

/** Every catalogue object a migration could create, as sorted "kind name" strings. */
const SNAPSHOT_SQL = `
WITH sys AS (SELECT oid FROM pg_namespace
              WHERE nspname IN ('pg_catalog', 'information_schema', 'pg_toast')
                 OR nspname LIKE 'pg_temp%' OR nspname LIKE 'pg_toast_temp%'),
     ext AS (SELECT objid FROM pg_depend WHERE deptype = 'e')
SELECT obj FROM (
  SELECT CASE c.relkind WHEN 'v' THEN 'view' WHEN 'm' THEN 'view' WHEN 'S' THEN 'sequence'
                        WHEN 'i' THEN 'index' WHEN 'I' THEN 'index' ELSE 'table' END
         || ' ' || n.nspname || '.' || c.relname AS obj
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE c.relnamespace NOT IN (SELECT oid FROM sys) AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'i', 'I')
     AND c.relname NOT IN ('schema_migration', 'schema_migration_pkey')
     AND c.oid NOT IN (SELECT objid FROM ext)
  UNION ALL
  SELECT 'column ' || n.nspname || '.' || c.relname || '.' || a.attname
    FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE c.relnamespace NOT IN (SELECT oid FROM sys) AND c.relkind IN ('r', 'p')
     AND a.attnum > 0 AND NOT a.attisdropped AND c.relname <> 'schema_migration'
     AND c.oid NOT IN (SELECT objid FROM ext)
  UNION ALL
  SELECT 'function ' || n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE p.pronamespace NOT IN (SELECT oid FROM sys) AND p.oid NOT IN (SELECT objid FROM ext)
  UNION ALL
  SELECT 'type ' || n.nspname || '.' || t.typname
    FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
   WHERE t.typnamespace NOT IN (SELECT oid FROM sys) AND t.typtype IN ('e', 'd')
     AND t.oid NOT IN (SELECT objid FROM ext)
  UNION ALL
  SELECT 'trigger ' || c.relname || '.' || tg.tgname
    FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid
   WHERE NOT tg.tgisinternal AND c.relnamespace NOT IN (SELECT oid FROM sys)
  UNION ALL
  SELECT 'constraint ' || c.relname || '.' || co.conname
    FROM pg_constraint co JOIN pg_class c ON c.oid = co.conrelid
   WHERE c.relnamespace NOT IN (SELECT oid FROM sys) AND c.relname <> 'schema_migration'
  UNION ALL
  SELECT 'extension ' || extname FROM pg_extension WHERE extname <> 'plpgsql'
  UNION ALL
  SELECT 'schema ' || nspname FROM pg_namespace
   WHERE oid NOT IN (SELECT oid FROM sys) AND nspname <> 'public'
) s ORDER BY obj`;

async function snapshot(client) {
  return (await client.query(SNAPSHOT_SQL)).rows.map((r) => r.obj);
}

const diff = (a, b) => a.filter((x) => !b.includes(x));

/**
 * UP one file at a time, every DOWN in reverse (each checked against the catalogue as
 * it was before that file's UP), then UP again; on a throwaway database.
 * @param {{databaseUrl: string, dir?: string, log?: (m: string) => void}} opts
 * @returns {Promise<{problems: string[], notes: string[]}>}
 */
async function roundTrip({
  databaseUrl,
  dir = path.join(ROOT, "migrations"),
  log = () => {},
}) {
  const { Client } = require("pg");
  const migrator = require("../db/migrate");
  const files = migrator.listMigrations(dir);
  if (!files.length)
    return { problems: [], notes: ["round trip: no migrations to apply yet"] };
  const problems = [];
  const notes = [];
  const scratch = `mycity_revcheck_${process.pid}_${Date.now().toString(36)}`;
  const admin = new Client({ connectionString: databaseUrl });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE ${scratch}`);
    const url = new URL(databaseUrl);
    url.pathname = `/${scratch}`;
    const c = new Client({ connectionString: url.toString() });
    await c.connect();
    try {
      const before = new Map();
      for (const f of files) {
        before.set(f.name, await snapshot(c));
        await migrator.migrate(c, { dir, until: numberOf(f.name) });
        log(`up ${f.name}`);
      }
      for (const f of [...files].reverse()) {
        let undone;
        try {
          undone = await migrator.down(c, { dir });
        } catch (err) {
          if (irreversibleReason(f.down) !== null) {
            notes.push(
              `round trip stops at ${f.name}, declared irreversible; files before it were not undone`,
            );
            break;
          }
          problems.push(`migrations/${f.file}: DOWN failed: ${err.message}`);
          break;
        }
        log(`down ${undone}`);
        const now = await snapshot(c);
        const was = before.get(f.name);
        for (const o of diff(now, was))
          problems.push(
            `migrations/${f.file}: after DOWN, ${o} is still there`,
          );
        for (const o of diff(was, now))
          problems.push(
            `migrations/${f.file}: DOWN removed ${o}, which existed before its UP`,
          );
      }
      if (!problems.length) {
        await migrator.migrate(c, { dir });
        log("up again");
      }
    } catch (err) {
      problems.push(`round trip failed: ${err.message}`);
    } finally {
      await c.end().catch(() => {});
    }
  } finally {
    await admin
      .query(`DROP DATABASE IF EXISTS ${scratch} WITH (FORCE)`)
      .catch(() => {});
    await admin.end().catch(() => {});
  }
  return { problems, notes };
}

/**
 * @param {{root?: string}} [opts]
 * @returns {{problems: string[], notes: string[], count: number}}
 */
function check({ root = ROOT } = {}) {
  const dir = path.join(root, "migrations");
  const files = fs.existsSync(dir)
    ? fs
        .readdirSync(dir)
        .filter((f) => FILE_RE.test(f))
        .sort(byNumber)
    : [];
  const problems = [];
  for (const f of files)
    problems.push(...review(fs.readFileSync(path.join(dir, f), "utf8"), f));
  return { problems, notes: [], count: files.length };
}

async function main(argv) {
  const { problems, notes, count } = check();
  const wantDb =
    argv.includes("--apply") ||
    (process.env.RUN_DB_TESTS === "1" && Boolean(process.env.DATABASE_URL));
  if (wantDb && !problems.length) {
    if (!process.env.DATABASE_URL) {
      problems.push("--apply needs DATABASE_URL");
    } else {
      const r = await roundTrip({ databaseUrl: process.env.DATABASE_URL });
      problems.push(...r.problems);
      notes.push(...r.notes);
      if (!r.problems.length && count)
        notes.push("round trip UP, DOWN, UP passed");
    }
  } else if (!wantDb) {
    notes.push(
      "static checks only; RUN_DB_TESTS=1 with DATABASE_URL adds the UP, DOWN, UP round trip",
    );
  }
  for (const n of notes) console.log(`  note: ${n}`);
  if (!problems.length) {
    console.log(
      `migration-reversibility: ok (${count} file${count === 1 ? "" : "s"}, each undoable or declared irreversible)`,
    );
    return 0;
  }
  console.error(
    "migration-reversibility: every migration has a DOWN, or says why it cannot (README §6.3)\n",
  );
  for (const p of problems) console.error(`  - ${p}`);
  return 1;
}

if (require.main === module) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error(`migration-reversibility failed: ${err.message}`);
      process.exit(1);
    },
  );
}

module.exports = { check, review, roundTrip, snapshot, DESTRUCTIVE };
