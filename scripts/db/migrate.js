#!/usr/bin/env node
"use strict";
/**
 * Apply schema migrations and reference seeds to this environment's database
 * (README §6.3, BACKEND_GUIDE §6).
 *
 *   npm run db:migrate                    apply every pending file, in order
 *   node scripts/db/migrate.js --status   what is applied, pending, or changed since
 *   node scripts/db/migrate.js --down     undo the last applied file (local and test databases only)
 *
 * On staging and production migrations run only inside deploy-gate, after the
 * pre-deploy dump (SYSTEM_ARCHITECTURE §9), which passes --deploy-gate. Run by hand
 * there, this script refuses.
 *
 * Schema files live in migrations/ and reference-data files in seeds/reference/. Both use their
 * milestone's number block (four digits through M9, five from M10) and the same two sections:
 *
 *   -- UP
 *   CREATE TABLE IF NOT EXISTS ...;
 *   -- DOWN
 *   DROP TABLE IF EXISTS ...;
 *
 * A file whose change cannot be undone says so in its DOWN section, with the reason:
 *
 *   -- DOWN
 *   -- IRREVERSIBLE: the old free-text column cannot be rebuilt from the split fields
 *
 * --down refuses such a file: the way back is the pre-deploy dump.
 *
 * How a run behaves, and why:
 *
 *  - The ledger is schema_migration (name, sha256, applied_at), created here if missing
 *    so the very first file can be recorded. 0002_system.sql declares the same table.
 *  - Each file's UP and its ledger row commit in one transaction: a crash between the
 *    two can never leave a change applied but unrecorded, to be applied twice.
 *  - The hash of every applied file (line endings normalised, so a Windows and a Linux
 *    checkout agree) is compared with the file on disk before anything runs. A merged
 *    migration that was edited is refused: change it with a new file.
 *  - One run at a time: a session advisory lock, so two deploys cannot interleave.
 *  - No statement timeout for the migration session (an index build may take minutes);
 *    the pool's 30 seconds still applies to the app.
 *  - The database says which environment it is (`system_marker`, read by the seed): the first
 *    run writes APP_ENV there, after the migrations that create the table. A server whose
 *    database already says another environment (a wrong .env, or another environment's dump
 *    restored into it) is refused before anything applies; off the servers it is only reported.
 */
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const ROOT = path.resolve(__dirname, "..", "..");
const DIR = path.join(ROOT, "migrations");
const REFERENCE_SEED_DIR = path.join(ROOT, "seeds", "reference");
const FILE_RE = /^(\d{4,5})_[a-z0-9_]+\.sql$/;
const IRREVERSIBLE_RE = /^--\s*IRREVERSIBLE:[ \t]*(.*)$/m;
const LOCK_KEY = "mycity:migrate";

/* ------------------------------------------------------------------ *
 * Files
 * ------------------------------------------------------------------ */

/** Hash of a file's text with line endings normalised. */
function hashText(text) {
  return crypto
    .createHash("sha256")
    .update(String(text).replace(/\r\n/g, "\n"), "utf8")
    .digest("hex");
}

/** The leading number of a migration or reference-seed name ("1099_seed_core" → 1099). */
function numberOf(name) {
  const m = /^(\d+)_/.exec(String(name));
  return m ? Number(m[1]) : Number.NaN;
}

/** Order schema and reference-data steps by milestone number. */
const byNumber = (a, b) => numberOf(a) - numberOf(b) || a.localeCompare(b);

/** The reason a DOWN section gives for being irreversible, or null. */
function irreversibleReason(downText) {
  const m = IRREVERSIBLE_RE.exec(String(downText || ""));
  return m ? m[1].trim() : null;
}

/**
 * Split a migration into its sections.
 * @param {string} text
 * @param {string} name  for messages
 * @returns {{up: string, down: string}}
 */
function parseMigration(text, name) {
  const lines = String(text).replace(/\r\n/g, "\n").split("\n");
  const upAt = lines.findIndex((l) => /^--\s*UP\s*$/.test(l));
  const downAt = lines.findIndex((l) => /^--\s*DOWN\s*$/.test(l));
  if (upAt === -1 || downAt === -1)
    throw new Error(`${name}: needs a "-- UP" line and a "-- DOWN" line`);
  if (downAt < upAt) throw new Error(`${name}: "-- UP" comes before "-- DOWN"`);
  const up = lines
    .slice(upAt + 1, downAt)
    .join("\n")
    .trim();
  const undo = lines
    .slice(downAt + 1)
    .join("\n")
    .trim();
  if (!up) throw new Error(`${name}: the UP section is empty`);
  return { up, down: undo };
}

/**
 * Every schema migration and reference seed, in one order. Passing `dir` retains the single-folder
 * behaviour used by isolated tests and tools.
 * @param {string} [dir]
 * @returns {Array<{name: string, file: string, sha256: string, up: string, down: string}>}
 */
function listMigrations(dir) {
  const sources = dir
    ? [{ dir, label: path.basename(dir) }]
    : [
        { dir: DIR, label: "migrations" },
        { dir: REFERENCE_SEED_DIR, label: "seeds/reference" },
      ];
  const out = [];
  const seen = new Map();
  for (const source of sources) {
    if (!fs.existsSync(source.dir)) continue;
    for (const f of fs
      .readdirSync(source.dir)
      .filter((x) => x.endsWith(".sql"))
      .sort(byNumber)) {
      const relative = `${source.label}/${f}`;
      const m = FILE_RE.exec(f);
      if (!m) throw new Error(`${relative}: name it NNNN_lower_snake.sql`);
      if (seen.has(m[1]))
        throw new Error(
          `${relative}: number ${m[1]} is already used by ${seen.get(m[1])}`,
        );
      seen.set(m[1], relative);
      const text = fs.readFileSync(path.join(source.dir, f), "utf8");
      out.push({
        name: f.replace(/\.sql$/, ""),
        file: dir ? f : relative,
        sha256: hashText(text),
        ...parseMigration(text, relative),
      });
    }
  }
  return out.sort((a, b) => byNumber(a.name, b.name));
}

/* ------------------------------------------------------------------ *
 * Ledger
 * ------------------------------------------------------------------ */

async function ensureLedger(client) {
  await client.query(
    `CREATE TABLE IF NOT EXISTS schema_migration (
       name text PRIMARY KEY,
       sha256 text NOT NULL,
       applied_at timestamptz NOT NULL DEFAULT now()
     )`,
  );
}

async function applied(client) {
  const { rows } = await client.query(
    "SELECT name, sha256, applied_at FROM schema_migration ORDER BY name",
  );
  return rows;
}

/**
 * What is applied, pending, changed since it was applied, or applied but gone from disk.
 * @param {import("pg").ClientBase} client
 * @param {string} [dir]
 */
async function status(client, dir) {
  await ensureLedger(client);
  const files = listMigrations(dir);
  const done = new Map((await applied(client)).map((r) => [r.name, r]));
  const head = [...done.keys()].sort(byNumber).pop() || null;
  return {
    head,
    applied: files.filter((f) => done.has(f.name)).map((f) => f.name),
    pending: files.filter((f) => !done.has(f.name)).map((f) => f.name),
    changed: files
      .filter((f) => done.has(f.name) && done.get(f.name).sha256 !== f.sha256)
      .map((f) => f.name),
    missing: [...done.keys()].filter((n) => !files.some((f) => f.name === n)),
  };
}

async function withLock(client, fn) {
  await client.query("SELECT pg_advisory_lock(hashtext($1))", [LOCK_KEY]);
  try {
    return await fn();
  } finally {
    await client
      .query("SELECT pg_advisory_unlock(hashtext($1))", [LOCK_KEY])
      .catch(() => {});
  }
}

async function inTransaction(client, fn) {
  await client.query("BEGIN");
  try {
    const out = await fn();
    await client.query("COMMIT");
    return out;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  }
}

/**
 * Apply every pending migration.
 * @param {import("pg").ClientBase} client  a dedicated connection (not a pool)
 * @param {{dir?: string, log?: (msg: string) => void, until?: number}} [opts]
 *   until  apply pending files numbered up to this one only (the reversibility gate's
 *          one-file-at-a-time round trip)
 * @returns {Promise<{applied: string[], head: string|null}>}
 */
async function migrate(client, { dir, log = () => {}, until } = {}) {
  await client.query("SET statement_timeout = 0");
  return withLock(client, async () => {
    const s = await status(client, dir);
    if (s.changed.length) {
      throw new Error(
        `These migrations changed after they were applied: ${s.changed.join(", ")}. ` +
          "A merged migration is never edited; put the change in a new file.",
      );
    }
    if (s.missing.length)
      log(`warning: applied but not on disk: ${s.missing.join(", ")}`);
    const files = listMigrations(dir).filter(
      (f) =>
        s.pending.includes(f.name) &&
        (until === undefined || numberOf(f.name) <= until),
    );
    const out = [];
    for (const f of files) {
      if (s.head && numberOf(f.name) < numberOf(s.head))
        log(
          `warning: ${f.name} is numbered below the head (${s.head}); applying it anyway`,
        );
      try {
        await inTransaction(client, async () => {
          await client.query(f.up);
          await client.query(
            "INSERT INTO schema_migration (name, sha256) VALUES ($1, $2)",
            [f.name, f.sha256],
          );
        });
      } catch (err) {
        throw new Error(
          `${f.file} failed, nothing of it was applied: ${err.message}`,
          { cause: err },
        );
      }
      out.push(f.name);
      log(`applied ${f.name}`);
    }
    const after = await status(client, dir);
    return { applied: out, head: after.head };
  });
}

/**
 * Undo the last applied migration: its DOWN section and its ledger row, together.
 * @param {import("pg").ClientBase} client
 * @param {{dir?: string}} [opts]
 * @returns {Promise<string|null>} the name undone
 */
async function down(client, { dir } = {}) {
  await client.query("SET statement_timeout = 0");
  return withLock(client, async () => {
    await ensureLedger(client);
    const rows = (await applied(client)).sort((a, b) =>
      byNumber(a.name, b.name),
    );
    const last = rows[rows.length - 1];
    if (!last) return null;
    const f = listMigrations(dir).find((x) => x.name === last.name);
    if (!f)
      throw new Error(
        `${last.name} is applied but its file is gone; cannot undo it`,
      );
    if (f.sha256 !== last.sha256)
      throw new Error(
        `${last.name} changed after it was applied; undo it by hand`,
      );
    if (!f.down) throw new Error(`${f.file} has an empty DOWN section`);
    const reason = irreversibleReason(f.down);
    if (reason !== null)
      throw new Error(
        `${f.file} is declared irreversible (${reason || "no reason given"}); restore from the dump instead`,
      );
    // 0002's DOWN drops the ledger table itself. The row goes first, so the DELETE cannot
    // fail after it, and the ledger is rebuilt with the rows still applied (0001), so the
    // next --down still knows them. All of it commits together.
    const remaining = rows.filter((r) => r.name !== f.name);
    await inTransaction(client, async () => {
      await client.query("DELETE FROM schema_migration WHERE name = $1", [
        f.name,
      ]);
      await client.query(f.down);
      await ensureLedger(client);
      for (const r of remaining) {
        await client.query(
          `INSERT INTO schema_migration (name, sha256, applied_at) VALUES ($1, $2, $3)
           ON CONFLICT (name) DO NOTHING`,
          [r.name, r.sha256, r.applied_at],
        );
      }
    });
    return f.name;
  });
}

/* ------------------------------------------------------------------ *
 * Which environment this database is
 * ------------------------------------------------------------------ */

/**
 * What a run does about the database's marker (`marker` as seed.readMarker reads it: undefined
 * before the table exists, null with no row): "mark" it after the migrations, "keep" one that
 * already says APP_ENV, "refuse" another environment's on a server, or "report" it elsewhere.
 * @param {{appEnv: string, marker: string|null|undefined}} t
 * @returns {{action: "mark"|"keep"|"refuse"|"report", message?: string}}
 */
function markerPlan({ appEnv, marker }) {
  if (marker === undefined || marker === null) return { action: "mark" };
  if (marker === appEnv) return { action: "keep" };
  const server = appEnv === "staging" || appEnv === "production";
  return {
    action: server ? "refuse" : "report",
    message: `this database says it is ${marker}, but APP_ENV is ${appEnv}: its .env names the wrong database, or it was restored from another environment's dump`,
  };
}

/** Writes the marker unless the database has one; true when it wrote it. */
async function markEnvironment(db, appEnv) {
  const { rowCount } = await db.query(
    "INSERT INTO system_marker (environment) SELECT $1 WHERE NOT EXISTS (SELECT 1 FROM system_marker)",
    [appEnv],
  );
  return rowCount === 1;
}

/* ------------------------------------------------------------------ *
 * Command line
 * ------------------------------------------------------------------ */

function parseArgs(argv) {
  const known = new Set(["--status", "--down", "--deploy-gate", "--help"]);
  for (const a of argv)
    if (!known.has(a)) throw new Error(`Unknown option ${a}`);
  if (argv.includes("--status") && argv.includes("--down"))
    throw new Error("--status and --down cannot be used together");
  return {
    status: argv.includes("--status"),
    down: argv.includes("--down"),
    deployGate: argv.includes("--deploy-gate"),
    help: argv.includes("--help"),
  };
}

async function main(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(
      "Usage: node scripts/db/migrate.js [--status | --down] [--deploy-gate]",
    );
    return 0;
  }
  process.env.MYCITY_PROCESS = process.env.MYCITY_PROCESS || "mycity-migrate";
  const { config, isServer } = require("../../src/config/env");
  if (isServer && !args.status && !args.deployGate) {
    throw new Error(
      `On ${config.APP_ENV}, migrations run inside deploy-gate after the pre-deploy dump. Use --status to look.`,
    );
  }
  if (isServer && args.down)
    throw new Error(
      `--down is for local and test databases. On ${config.APP_ENV}, restore from the pre-deploy dump.`,
    );

  const { Client } = require("pg");
  const client = new Client({
    host: config.DB_HOST,
    port: config.DB_PORT,
    database: config.DB_NAME,
    user: config.DB_USER,
    password: config.DB_PASSWORD || undefined,
    ssl: config.DB_SSL ? { rejectUnauthorized: true } : false,
    application_name: `mycity-migrate-${config.APP_ENV}`,
  });
  await client.connect();
  try {
    const log = (m) => console.log(`[migrate] ${m}`);
    if (args.status) {
      const s = await status(client);
      log(`database ${config.DB_NAME}, head ${s.head || "(none)"}`);
      log(
        `applied ${s.applied.length}, pending ${s.pending.length}${s.pending.length ? `: ${s.pending.join(", ")}` : ""}`,
      );
      if (s.changed.length)
        log(`CHANGED since applied: ${s.changed.join(", ")}`);
      if (s.missing.length)
        log(`applied but not on disk: ${s.missing.join(", ")}`);
      return s.changed.length ? 1 : 0;
    }
    if (args.down) {
      const undone = await down(client);
      log(undone ? `undid ${undone}` : "nothing to undo");
      return 0;
    }
    const { readMarker } = require("./seed");
    const plan = markerPlan({
      appEnv: config.APP_ENV,
      marker: await readMarker(client),
    });
    if (plan.action === "refuse")
      throw new Error(`refusing to migrate: ${plan.message}`);
    if (plan.action === "report") log(`warning: ${plan.message}`);
    const r = await migrate(client, { log });
    log(
      r.applied.length
        ? `${r.applied.length} applied; head ${r.head}`
        : `nothing to apply; head ${r.head || "(none)"}`,
    );
    if (
      plan.action === "mark" &&
      (await markEnvironment(client, config.APP_ENV))
    )
      log(`this database is marked ${config.APP_ENV}`);
    return 0;
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error(`[migrate] ${err.message}`);
      process.exit(1);
    },
  );
}

module.exports = {
  DIR,
  REFERENCE_SEED_DIR,
  FILE_RE,
  numberOf,
  byNumber,
  irreversibleReason,
  hashText,
  parseMigration,
  listMigrations,
  ensureLedger,
  status,
  migrate,
  down,
  markerPlan,
  markEnvironment,
  parseArgs,
  main,
};
