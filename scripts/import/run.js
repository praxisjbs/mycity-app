#!/usr/bin/env node
"use strict";
/**
 * The import engine from the command line (BACKEND_STRUCTURE §9.3, BACKEND_GUIDE §7): the
 * first staff load on staging, and on production the same load run by an authorised
 * person. Same engine, same steps and same checks as the Imports screen: the file goes
 * to the vault, every row is written through the owning module's service, the person
 * named by --as must hold the importer's permission, and every audit row names them and
 * the batch. Production is never seeded; this is data entry with a name on it.
 *
 *   node scripts/import/run.js list
 *   node scripts/import/run.js template employees --out=employees-template.xlsx
 *   node scripts/import/run.js upload   employees staff.xlsx --as=hr@mycityapp.io
 *   node scripts/import/run.js map      <batch> --as=... --column=3:work_email --column=7:   (7 ignored)
 *   node scripts/import/run.js preview  <batch> --as=... [--create=department:Marketing,Sales]
 *   node scripts/import/run.js errors   <batch> --as=... [--out=report.xlsx]
 *   node scripts/import/run.js commit   <batch> --as=... [--valid-only] [--create=...] [--yes]
 *   node scripts/import/run.js revert   <batch> --as=... [--yes]
 *   node scripts/import/run.js status   <batch>
 *   node scripts/import/run.js history  [--page=2]
 *
 * <batch> is the batch number (IMP-0007) or its id. A batch moves upload → map (only to
 * correct the automatic mapping) → preview (the whole commit, rolled back) → commit.
 * --create names the "will be created" values a preview listed that you accept, per
 * field. On staging and production, commit and revert ask you to type the environment
 * name, or take --yes when there is no terminal.
 *
 * It does not start Redis: permissions are read straight from Postgres. Events go to
 * the outbox; the worker delivers them as for any other write.
 */
const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");
const { randomUUID } = require("node:crypto");

const MODULES_DIR = path.resolve(__dirname, "..", "..", "src", "modules");
const COMMANDS = new Set([
  "list",
  "template",
  "upload",
  "map",
  "preview",
  "errors",
  "commit",
  "revert",
  "status",
  "history",
  "help",
]);
const NEEDS_ACTOR = new Set([
  "upload",
  "map",
  "preview",
  "errors",
  "commit",
  "revert",
]);
const OPTIONS = new Set([
  "as",
  "out",
  "column",
  "create",
  "valid-only",
  "yes",
  "page",
  "sheet",
  "header-row",
  "save-profile",
]);

/* ------------------------------------------------------------------ *
 * Arguments
 * ------------------------------------------------------------------ */

/**
 * @param {string[]} argv
 * @returns {{command: string, positional: string[], options: Record<string, string|true|string[]>}}
 */
function parseArgs(argv) {
  const positional = [];
  const options = {};
  for (const raw of argv) {
    const m = /^--([a-z-]+)(?:=(.*))?$/.exec(raw);
    if (!m) {
      positional.push(raw);
      continue;
    }
    if (!OPTIONS.has(m[1])) throw new Error(`Unknown option --${m[1]}`);
    const value = m[2] === undefined ? true : m[2];
    if (m[1] === "column" || m[1] === "create")
      options[m[1]] = [...(options[m[1]] || []), value];
    else options[m[1]] = value;
  }
  const command = positional.shift() || "help";
  if (!COMMANDS.has(command)) throw new Error(`Unknown command "${command}"`);
  if (
    NEEDS_ACTOR.has(command) &&
    (typeof options.as !== "string" || !options.as)
  )
    throw new Error(
      `${command} runs as a person: give --as=<their work email>`,
    );
  return { command, positional, options };
}

/** --create=department:Marketing,Sales (repeatable) → { department: ["Marketing", "Sales"] } */
function createMissingOf(values) {
  const out = {};
  for (const v of [].concat(values || [])) {
    const m = /^([a-z][a-z0-9_]*):(.+)$/.exec(String(v));
    if (!m)
      throw new Error(`--create=${v}: write it as field:Value One,Value Two`);
    out[m[1]] = [
      ...(out[m[1]] || []),
      ...m[2]
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    ];
  }
  return out;
}

/** --column=3:work_email --column=7: → { 3: "work_email", 7: null } */
function columnsOf(values) {
  const out = {};
  for (const v of [].concat(values || [])) {
    const m = /^(\d+):([a-z][a-z0-9_]*)?$/.exec(String(v));
    if (!m)
      throw new Error(
        `--column=${v}: write it as <column number>:<field key>, or <number>: to ignore it`,
      );
    out[Number(m[1])] = m[2] || null;
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Importers, the person, the batch
 * ------------------------------------------------------------------ */

/**
 * Register every module's importers (src/modules/<m>/*.import.js). Files the repository
 * map created and nobody has written yet are skipped.
 * @returns {string[]} the files loaded
 */
function loadImporters(dir = MODULES_DIR) {
  const out = [];
  let modules;
  try {
    modules = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const m of modules
    .filter((e) => e.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name))) {
    const folder = path.join(dir, m.name);
    for (const f of fs.readdirSync(folder).sort()) {
      if (!f.endsWith(".import.js")) continue;
      const file = path.join(folder, f);
      if (!fs.readFileSync(file, "utf8").trim()) continue;
      require(file);
      out.push(file);
    }
  }
  return out;
}

/**
 * The active user with this work email, in the shape the engine takes (req.user).
 * @param {{query: Function}} client
 */
async function actorByEmail(client, email) {
  const grants = require("../../src/shared/rbac/grants-cache");
  const { rows } = await client.query(
    "SELECT user_id FROM app_user WHERE lower(email) = lower($1)",
    [String(email).trim()],
  );
  const user = rows[0]
    ? await grants.getAuthUser(client, rows[0].user_id)
    : null;
  if (!user || user.status !== "active")
    throw new Error(`${email} is not an active user`);
  return {
    user_id: user.user_id,
    employee_id: user.employee_id,
    email: user.email,
    display_name: user.display_name,
    role_ids: user.role_ids || [],
    is_ceo: user.is_ceo === true,
  };
}

/** A batch id from its number (IMP-0007) or its id. */
async function batchIdOf(client, ref) {
  if (!ref) throw new Error("Give the batch number (IMP-0007) or its id");
  const { rows } = await client.query(
    "SELECT import_batch_id FROM import_batch WHERE number = $1 OR import_batch_id::text = $1",
    [String(ref)],
  );
  if (!rows[0]) throw new Error(`There is no import ${ref}`);
  return rows[0].import_batch_id;
}

/* ------------------------------------------------------------------ *
 * Output
 * ------------------------------------------------------------------ */

function describeStats(stats = {}) {
  const parts = [
    "create",
    "update",
    "unchanged",
    "error",
    "duplicate",
    "skipped",
  ]
    .filter((k) => stats[k])
    .map((k) => `${stats[k]} ${k}`);
  return parts.length ? parts.join(", ") : `${stats.rows || 0} rows`;
}

function describeMapping(batch, imp, log) {
  const cols = (batch.mapping && batch.mapping.columns) || [];
  if (!cols.length) {
    log("  no header row found: give --header-row=<n> with map");
    return;
  }
  const label = new Map(imp.fields.map((f) => [f.key, f.label]));
  for (const c of cols)
    log(
      `  ${String(c.index).padStart(3)}  ${(c.header || "").padEnd(28)} → ${c.field ? `${label.get(c.field) || c.field} (${c.field})` : "ignored"}`,
    );
}

function writeFileOut(out, fallback, buffer, log) {
  const file = path.resolve(
    process.cwd(),
    typeof out === "string" ? out : fallback,
  );
  fs.writeFileSync(file, buffer);
  log(`  wrote ${file}`);
}

async function confirmEnv(env, options, ask) {
  if (env !== "staging" && env !== "production") return true;
  if (options.yes === true) return true;
  if (!ask)
    throw new Error(
      `On ${env}, run this in a terminal to confirm, or pass --yes`,
    );
  return (await ask(`Type "${env}" to continue: `)) === env;
}

function terminalAsk() {
  if (!process.stdin.isTTY) return null;
  return (q) =>
    new Promise((resolve) => {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      rl.question(q, (a) => {
        rl.close();
        resolve(a.trim());
      });
    });
}

/* ------------------------------------------------------------------ *
 * Commands
 * ------------------------------------------------------------------ */

/**
 * Run one command. Importers must already be registered (loadImporters, or a test's
 * defineImporter).
 * @param {{command: string, positional: string[], options: object}} args
 * @param {{db?: import("pg").Pool, env?: string, log?: (s: string) => void, ask?: Function|null}} [deps]
 * @returns {Promise<number>} exit code
 */
async function execute(args, deps = {}) {
  const db = deps.db || require("../../src/config/db").pool;
  const env = deps.env || require("../../src/config/env").config.APP_ENV;
  const log = deps.log || ((s) => console.log(s));
  const ask = deps.ask === undefined ? terminalAsk() : deps.ask;
  const registry = require("../../src/shared/import/registry");
  const engine = require("../../src/shared/import/engine");
  const report = require("../../src/shared/import/report");
  const { atomically } = require("../../src/shared/db/tx");
  const requestContext = require("../../src/config/request-context");
  const { command, positional, options } = args;

  if (command === "help") {
    log(
      "Usage: node scripts/import/run.js <list|template|upload|map|preview|errors|commit|revert|status|history> ... (see the file header)",
    );
    return 0;
  }
  if (command === "list") {
    const all = registry.all();
    if (!all.length) log("No importers are registered yet.");
    for (const imp of all)
      log(
        `  ${imp.key.padEnd(20)} ${imp.label.padEnd(24)} needs ${imp.permission.join(".")}`,
      );
    return 0;
  }
  if (command === "template") {
    const imp = engine.importerOf(positional[0]);
    const t = await report.template(imp);
    writeFileOut(options.out, t.filename, t.buffer, log);
    return 0;
  }

  const client = await db.connect();
  try {
    if (command === "history") {
      const page = await engine.history(client, { page: options.page });
      for (const b of page.data || page.rows || [])
        log(
          `  ${b.number}  ${b.importer_key.padEnd(16)} ${b.status.padEnd(10)} ${b.file_name}  ${describeStats(b.stats)}`,
        );
      return 0;
    }
    if (command === "status") {
      const b = await engine.loadBatch(
        client,
        await batchIdOf(client, positional[0]),
      );
      log(`${b.number}  ${b.importer_key}  ${b.status}  ${b.file_name}`);
      log(`  ${describeStats(b.stats)}`);
      return 0;
    }

    const actor = await actorByEmail(client, options.as);
    const ctx = {
      requestId: randomUUID(),
      userId: actor.user_id,
      surface: "script",
    };
    const inContext = (fn) => requestContext.run(ctx, fn);

    if (command === "upload") {
      const [key, fileArg] = positional;
      if (!key || !fileArg)
        throw new Error("upload <importer> <file.xlsx|csv>");
      const file = path.resolve(process.cwd(), fileArg);
      const buffer = fs.readFileSync(file);
      const batch = await inContext(() =>
        atomically(client, () =>
          engine.createBatch(client, {
            importer_key: key,
            file: {
              buffer,
              originalname: path.basename(file),
              size: buffer.length,
            },
            actor,
          }),
        ),
      );
      log(
        `${batch.number} uploaded (${batch.status}), sheet "${batch.sheet}", ${batch.stats.rows} rows`,
      );
      describeMapping(batch, engine.importerOf(key), log);
      log(
        `Next: preview ${batch.number}${batch.status === "uploaded" ? " (after map)" : ""}`,
      );
      return 0;
    }

    const id = await batchIdOf(client, positional[0]);

    if (command === "map") {
      const current = await engine.loadBatch(client, id);
      const fields = Object.fromEntries(
        ((current.mapping && current.mapping.columns) || []).map((c) => [
          c.index,
          c.field,
        ]),
      );
      Object.assign(fields, columnsOf(options.column));
      const batch = await inContext(() =>
        atomically(client, () =>
          engine.setMapping(
            client,
            id,
            {
              sheet:
                typeof options.sheet === "string" ? options.sheet : undefined,
              header_row:
                options["header-row"] === undefined
                  ? undefined
                  : Number(options["header-row"]),
              fields,
              save_profile: options["save-profile"] !== undefined,
              profile_name:
                typeof options["save-profile"] === "string"
                  ? options["save-profile"]
                  : undefined,
            },
            actor,
          ),
        ),
      );
      log(`${batch.number} mapped`);
      describeMapping(batch, engine.importerOf(batch.importer_key), log);
      return 0;
    }

    if (command === "errors") {
      const r = await report.errorFile(client, id, actor);
      writeFileOut(options.out, r.filename, r.buffer, log);
      return 0;
    }

    const runOpts = {
      actor,
      db,
      valid_only: options["valid-only"] === true,
      create_missing: createMissingOf(options.create),
    };

    if (command === "preview") {
      const r = await inContext(() => engine.preview(id, runOpts));
      log(`${r.batch.number} previewed: ${describeStats(r.stats)}`);
      for (const [field, values] of Object.entries(r.stats.missing || {}))
        log(
          `  will be created if you accept them, ${field}: ${[].concat(values).join(", ")}`,
        );
      if (r.stats.error || r.stats.duplicate)
        log(
          `  problems: errors ${r.batch.number} --out=<file> writes them next to your rows`,
        );
      return r.stats.error || r.stats.duplicate ? 2 : 0;
    }

    if (command === "commit" || command === "revert") {
      const b = await engine.loadBatch(client, id);
      log(
        `${command} ${b.number} (${b.importer_key}, ${b.file_name}) as ${actor.email} on ${env}`,
      );
      if (!(await confirmEnv(env, options, ask))) {
        log("Cancelled. Nothing was written.");
        return 1;
      }
      if (command === "commit") {
        const r = await inContext(() => engine.commit(id, runOpts));
        log(`${r.batch.number} committed: ${describeStats(r.stats)}`);
        return 0;
      }
      const { revert } = require("../../src/shared/import/revert");
      const r = await inContext(() => revert(id, { actor, db }));
      log(
        `${b.number} reverted: ${r.archived} created records archived, ${r.restored} updated records restored`,
      );
      return 0;
    }
    throw new Error(`Unhandled command ${command}`);
  } finally {
    client.release();
  }
}

async function main(argv) {
  process.env.MYCITY_PROCESS = process.env.MYCITY_PROCESS || "mycity-import";
  const args = parseArgs(argv);
  if (args.command !== "help") loadImporters();
  try {
    return await execute(args);
  } finally {
    if (args.command !== "help")
      await require("../../src/config/db").pool.end();
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error(
        `import failed: ${err.code ? `${err.code}: ` : ""}${err.message}`,
      );
      process.exit(1);
    },
  );
}

module.exports = {
  parseArgs,
  createMissingOf,
  columnsOf,
  loadImporters,
  actorByEmail,
  batchIdOf,
  execute,
  main,
};
