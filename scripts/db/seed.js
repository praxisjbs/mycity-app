#!/usr/bin/env node
"use strict";
/**
 * Fill a database with data that is not real (A5, SYSTEM_ARCHITECTURE §5).
 *
 *   npm run db:seed -- --build     synthetic data (seeds/build): local and CI databases
 *   npm run db:seed -- --staging   demonstration data (seeds/staging): staging, or a local
 *                                  database to rehearse it
 *
 * Production is never seeded. The script refuses unless three independent things all
 * say the target is not production, so a wrong .env alone cannot do it:
 *
 *   1. APP_ENV            never production; --build never on staging either
 *   2. the database name  never mycity_prod; --build never mycity_stg; on staging, mycity_stg
 *   3. system_marker      the row written once when the database was created
 *                         (0002_system.sql) must exist and must not say production
 *                         (--build: must not say staging either)
 *
 * A seed file is seeds/<build|staging>/NN_name.js:
 *
 *   module.exports = async function seed({ pool, actor, log }) {
 *     // through the services, like any other caller (README §6.1): numbering, audit and
 *     // events apply. Idempotent: look before creating, so a second run adds nothing.
 *   };
 *
 * Files run in name order, each once per invocation. The actor is the seed itself
 * (`user_id: null`, source "script:seed"), so every audit row says where it came from.
 */
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..", "seeds");
const MODES = Object.freeze({ build: "build", staging: "staging" });
const ACTOR = Object.freeze({ user_id: null, source: "script:seed" });

/**
 * The three checks. Pure, so tests can call it with any combination.
 * @param {{mode: "build"|"staging", appEnv: string, dbName: string, marker: string|null|undefined}} t
 *   marker: system_marker.environment; null when the row is missing, undefined when the table is
 * @returns {string[]} problems; empty means the target may be seeded
 */
function refusals({ mode, appEnv, dbName, marker }) {
  const out = [];
  if (!MODES[mode]) out.push("choose --build or --staging");
  if (appEnv === "production")
    out.push("APP_ENV is production: production is never seeded");
  if (mode === "build" && appEnv === "staging")
    out.push(
      "APP_ENV is staging: staging gets --staging data, not synthetic build data",
    );
  if (dbName === "mycity_prod")
    out.push("the database is mycity_prod: production is never seeded");
  if (mode === "build" && dbName === "mycity_stg")
    out.push("the database is mycity_stg: use --staging there");
  if (appEnv === "staging" && dbName !== "mycity_stg")
    out.push(`APP_ENV is staging but the database is ${dbName}`);
  if (marker === undefined)
    out.push(
      "there is no system_marker table: run the migrations first (0002_system.sql creates it)",
    );
  else if (marker === null)
    out.push(
      "system_marker has no row: the database does not say which environment it is",
    );
  else if (marker === "production")
    out.push("system_marker says production: production is never seeded");
  else if (mode === "build" && marker === "staging")
    out.push("system_marker says staging: use --staging there");
  return out;
}

/** system_marker.environment, null for no row, undefined for no table. */
async function readMarker(db) {
  try {
    const { rows } = await db.query(
      "SELECT environment FROM system_marker LIMIT 1",
    );
    return rows[0] ? rows[0].environment : null;
  } catch (err) {
    if (err.code === "42P01") return undefined;
    throw err;
  }
}

/** Seed files for a mode, in name order. */
function seedFiles(mode, root = ROOT) {
  const dir = path.join(root, mode);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".js") && !f.endsWith(".test.js"))
    .sort()
    .map((f) => path.join(dir, f));
}

/**
 * Check the target, then run the mode's seed files.
 * @param {{mode: string, db: import("pg").Pool, appEnv: string, dbName: string, root?: string, log?: Function}} opts
 * @returns {Promise<{ran: string[]}>}
 */
async function seed({ mode, db, appEnv, dbName, root = ROOT, log = () => {} }) {
  const problems = refusals({
    mode,
    appEnv,
    dbName,
    marker: await readMarker(db),
  });
  if (problems.length) {
    const err = new Error(
      `Refusing to seed:\n${problems.map((p) => `  - ${p}`).join("\n")}`,
    );
    err.code = "SEED_REFUSED";
    err.problems = problems;
    throw err;
  }
  const ran = [];
  const requestContext = require("../../src/config/request-context");
  for (const file of seedFiles(mode, root)) {
    const fn = require(file);
    if (typeof fn !== "function")
      throw new Error(
        `${path.relative(root, file)} must export async function seed({ pool, actor, log })`,
      );
    await requestContext.run(
      { requestId: `seed-${mode}`, surface: "script" },
      () => fn({ pool: db, actor: ACTOR, log }),
    );
    ran.push(path.basename(file));
    log(`seeded ${mode}/${path.basename(file)}`);
  }
  return { ran };
}

async function main(argv) {
  const known = new Set(["--build", "--staging", "--help"]);
  for (const a of argv)
    if (!known.has(a)) throw new Error(`Unknown option ${a}`);
  if (argv.includes("--help")) {
    console.log("Usage: node scripts/db/seed.js --build | --staging");
    return 0;
  }
  const modes = argv.filter((a) => a === "--build" || a === "--staging");
  if (modes.length !== 1)
    throw new Error(
      "Choose one: --build (synthetic, local and CI) or --staging (demonstration data)",
    );
  const mode = modes[0].slice(2);

  process.env.MYCITY_PROCESS = process.env.MYCITY_PROCESS || "mycity-seed";
  const { config } = require("../../src/config/env");
  const { pool, closeDb } = require("../../src/config/db");
  const log = (m) => console.log(`[seed] ${m}`);
  try {
    const r = await seed({
      mode,
      db: pool,
      appEnv: config.APP_ENV,
      dbName: config.DB_NAME,
      log,
    });
    log(
      r.ran.length
        ? `${r.ran.length} seed file(s) run`
        : `nothing to seed in seeds/${mode}`,
    );
    return 0;
  } finally {
    await closeDb();
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error(`[seed] ${err.message}`);
      process.exit(1);
    },
  );
}

module.exports = { refusals, readMarker, seedFiles, seed, main, ACTOR };
