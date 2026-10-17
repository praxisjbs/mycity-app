#!/usr/bin/env node
"use strict";
/**
 * Load MyCity's real staff from `seeds/staff/` (docs/guides/foundation.md §6.1).
 *
 *   node scripts/db/load-staff.js            the deploy step, after the migrations
 *   node scripts/db/load-staff.js --dry-run  preview only: nothing is committed
 *
 * **Nobody runs this by hand.** `scripts/deploy/deploy-gate` runs it on every deploy, on
 * staging AND production, as the system: the one exception to "production is never
 * seeded" (TB, 16/10/2026), because MyCity's own staff are not demonstration data.
 *
 * What it does, in order:
 *
 *   1. Nothing at all, unless `seeds/staff/staff-list.xlsx` is in the build.
 *   2. Nothing again if a committed batch already carries this sheet's checksum: the
 *      roster is loaded, and a deploy that changes no file changes no record.
 *   3. Uploads the sheet to the import engine as the employees importer
 *      (src/modules/organisation/employee.import.js), with two options: keep what the
 *      app already has, and the work email `roles.json` gives a post the sheet leaves
 *      empty.
 *   4. Maps the columns the importer recognises, and drops a column the whole sheet gets
 *      wrong (MyCity's own sheet holds a day and month with no year under DOB, and the
 *      same placeholder under Phone), with the reason in the log.
 *   5. Previews, which is the commit rolled back, then commits the valid rows. A row that
 *      fails is logged and kept in Imports history for People to correct; it never stops
 *      the deploy.
 *   6. Gives each person a login in the invited state with the roles `roles.json` holds
 *      for their post, and the CEO flag where it says so. **No email is sent**: Send
 *      Invite does that, when People are ready.
 *   7. Moves the staff-number counter past every number the sheet brought, so the next
 *      person added on screen is not given one that is taken.
 *
 * It is safe to run again: every step looks before it writes, and an edit made on screen
 * is never written over.
 */
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");
const STAFF_DIR = path.join(ROOT, "seeds", "staff");
const SHEET = path.join(STAFF_DIR, "staff-list.xlsx");
const ROLES = path.join(STAFF_DIR, "roles.json");
const IMPORTER = "employees";

/**
 * The loader is the system, not a person: it holds no grants and belongs to no employee,
 * and the import engine asks the caller whether they may run an importer, so it answers
 * as an unrestricted caller. Audit rows carry no user id and the name System
 * (docs/guides/foundation.md §8).
 */
const SYSTEM = Object.freeze({
  user_id: null,
  name: "System",
  source: "deploy:staff-roster",
  is_ceo: true,
});

/** Every module's importers, so the registry knows the employees importer. */
function loadImporters(dir = path.join(ROOT, "src", "modules")) {
  for (const m of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!m.isDirectory()) continue;
    for (const f of fs.readdirSync(path.join(dir, m.name)).sort()) {
      if (!f.endsWith(".import.js")) continue;
      const file = path.join(dir, m.name, f);
      if (fs.readFileSync(file, "utf8").trim()) require(file);
    }
  }
}

/** The posts `roles.json` names, and what each one is given. */
function readRoles(file = ROLES) {
  if (!fs.existsSync(file)) return { default: { roles: ["employee"] }, by_job_title: {} };
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  return {
    default: parsed.default || { roles: ["employee"] },
    by_job_title: parsed.by_job_title || {},
  };
}

/** What a post is given: its own entry, by exact title then by the words it uses. */
function rolesForTitle(roles, jobTitle) {
  const managerText = require(path.join(ROOT, "src/modules/organisation/manager-text.js"));
  const entries = Object.entries(roles.by_job_title);
  const wanted = managerText.fold(jobTitle);
  const exact = entries.find(([title]) => managerText.fold(title) === wanted);
  if (exact) return exact[1];
  const byWords = entries.filter(([title]) => managerText.matchesTitle(title, jobTitle));
  if (byWords.length === 1) return byWords[0][1];
  return roles.default;
}

/** Every work email `roles.json` holds for a post whose sheet cell is empty. */
function emailsByJobTitle(roles) {
  const out = {};
  for (const [title, entry] of Object.entries(roles.by_job_title))
    if (entry.work_email) out[title] = String(entry.work_email).trim().toLowerCase();
  return out;
}

/**
 * The columns to map, and the ones to leave out. A column whose every filled cell fails
 * to read as its field is not imported: the sheet gets that column wrong, and importing
 * it would fail every row instead.
 *
 * @returns {{fields: Record<number, string|null>, dropped: Array<{header: string, field: string, reason: string}>}}
 */
function mappingFor(engine, importer, grid, headerRow, mapping) {
  const fields = {};
  const dropped = [];
  const byKey = new Map(importer.fields.map((f) => [f.key, f]));
  for (const column of (mapping && mapping.columns) || []) {
    if (!column.field || !byKey.has(column.field)) continue;
    const field = byKey.get(column.field);
    let filled = 0;
    let bad = 0;
    for (let i = headerRow + 1; i < grid.length; i += 1) {
      const cell = (grid[i] || [])[column.index];
      if (cell === null || cell === undefined || cell === "") continue;
      filled += 1;
      if (engine.coerce(field, cell).error) bad += 1;
    }
    if (filled > 0 && bad === filled) {
      dropped.push({
        header: column.header,
        field: field.key,
        reason: `every one of the ${filled} filled cells fails to read as ${field.label}`,
      });
      fields[column.index] = null;
      continue;
    }
    fields[column.index] = field.key;
  }
  return { fields, dropped };
}

/** A committed batch that already loaded this very file, or null. */
async function alreadyLoaded(db, checksum) {
  const { rows } = await db.query(
    `SELECT import_batch_id, number, committed_at
       FROM import_batch
      WHERE importer_key = $1 AND status = 'committed' AND options->>'source_sha256' = $2
      ORDER BY committed_at DESC
      LIMIT 1`,
    [IMPORTER, checksum],
  );
  return rows[0] || null;
}

/**
 * Give everyone on the register a login with the roles their post is granted. A person
 * who already has one is left alone, roles included: roles apply when the login is
 * created, so a change made on screen stands (docs/guides/foundation.md §11).
 *
 * @returns {Promise<{created: number, kept: number, failed: number}>}
 */
async function applyRoles({ pool, atomically, log, roles }) {
  const identity = require(path.join(ROOT, "src/modules/identity/identity.service.js"));
  const access = require(path.join(ROOT, "src/modules/access/access.service.js"));
  const out = { created: 0, kept: 0, failed: 0 };
  const { rows } = await pool.query(
    `SELECT e.employee_id, e.job_title, e.work_email::text AS work_email,
            btrim(e.first_name || ' ' || e.last_name) AS display_name, u.user_id
       FROM employee e
       LEFT JOIN app_user u ON u.employee_id = e.employee_id
      WHERE e.status = 'active'
      ORDER BY e.created_at, e.employee_id`,
  );
  for (const person of rows) {
    if (person.user_id) {
      out.kept += 1;
      continue;
    }
    const entry = rolesForTitle(roles, person.job_title);
    const client = await pool.connect();
    try {
      await atomically(client, async () => {
        const user = await identity.createUserForEmployee(
          client,
          {
            employee_id: person.employee_id,
            email: person.work_email,
            is_ceo: entry.is_ceo === true,
          },
          SYSTEM,
        );
        await access.setRoles(client, user.user_id, entry.roles || ["employee"], SYSTEM);
      });
      out.created += 1;
      log(`login invited for ${person.display_name}: ${(entry.roles || []).join(", ")}${entry.is_ceo ? ", CEO" : ""}`);
    } catch (err) {
      out.failed += 1;
      log(`WARNING: no login for ${person.display_name} (${person.job_title}): ${err.message}`);
    } finally {
      client.release();
    }
  }
  return out;
}

/**
 * Load the roster.
 * @param {{db: import("pg").Pool, log?: Function, dryRun?: boolean, sheet?: string, rolesFile?: string}} opts
 * @returns {Promise<{status: string, stats?: object, logins?: object, batch?: string, dropped?: Array}>}
 */
async function loadStaff({ db, log = () => {}, dryRun = false, sheet = SHEET, rolesFile = ROLES }) {
  if (!fs.existsSync(sheet)) {
    log(`no staff sheet in this build (${path.relative(ROOT, sheet)}); nothing to load`);
    return { status: "no_sheet" };
  }
  const { atomically } = require(path.join(ROOT, "src/shared/db/tx.js"));
  const engine = require(path.join(ROOT, "src/shared/import/engine.js"));
  const mapping = require(path.join(ROOT, "src/shared/import/mapping.js"));
  const registry = require(path.join(ROOT, "src/shared/import/registry.js"));
  const { readSheets } = require(path.join(ROOT, "src/shared/spreadsheet/parse.js"));
  const organisation = require(path.join(ROOT, "src/modules/organisation/organisation.service.js"));
  loadImporters();

  const importer = registry.get(IMPORTER);
  if (!importer) throw new Error(`the ${IMPORTER} importer is not registered`);
  const roles = readRoles(rolesFile);
  const buffer = fs.readFileSync(sheet);
  const checksum = crypto.createHash("sha256").update(buffer).digest("hex");

  const loaded = await alreadyLoaded(db, checksum);
  if (loaded && !dryRun) {
    log(`this sheet is already loaded (batch ${loaded.number}); checking logins only`);
    const logins = await applyRoles({ pool: db, atomically, log, roles });
    await withTx(db, atomically, (client) => organisation.advanceStaffNumbers(client));
    return { status: "already_loaded", batch: loaded.import_batch_id, logins };
  }

  /* 1. The file goes to the engine, with the roster's own options. */
  const batch = await withTx(db, atomically, (client) =>
    engine.createBatch(client, {
      importer_key: IMPORTER,
      file: { buffer, originalname: path.basename(sheet), mimetype: XLSX_MIME, size: buffer.length },
      actor: SYSTEM,
      options: {
        keep_existing: true,
        work_email_by_job_title: emailsByJobTitle(roles),
        source: "staff roster, loaded by the deploy",
        source_sha256: checksum,
      },
    }),
  );
  log(`batch ${batch.number} from ${path.basename(sheet)}, sheet "${batch.sheet}"`);

  /* 2. The columns to read, and the ones the sheet gets wrong. */
  const book = await readSheets({ buffer, filename: path.basename(sheet) });
  const grid = (book.sheets.find((s) => s.name === batch.sheet) || book.sheets[0]).rows;
  const headerRow = batch.header_row === null ? mapping.detectHeaderRow(grid, importer.fields) : batch.header_row;
  if (headerRow === null) throw new Error("the sheet has no row of column names this importer knows");
  const { fields, dropped } = mappingFor(engine, importer, grid, headerRow, batch.mapping);
  for (const d of dropped) log(`column "${d.header}" not imported: ${d.reason}`);
  await withTx(db, atomically, (client) =>
    engine.setMapping(client, batch.import_batch_id, { sheet: batch.sheet, header_row: headerRow, fields }, SYSTEM),
  );

  /* 3. Preview, which is the commit rolled back, then commit the rows that are good. */
  const previewed = await engine.preview(batch.import_batch_id, { actor: SYSTEM, db });
  const missing = previewed.stats.missing || {};
  log(
    `preview: ${previewed.stats.rows} rows, ${previewed.stats.create} to create, ` +
      `${previewed.stats.update} to update, ${previewed.stats.unchanged} unchanged, ` +
      `${previewed.stats.error} with problems`,
  );
  for (const [field, values] of Object.entries(missing))
    if (values.length) log(`new ${field}: ${values.join(", ")}`);
  await logProblems(db, batch.import_batch_id, log);
  if (dryRun) {
    log("dry run: nothing committed");
    return { status: "previewed", batch: batch.import_batch_id, stats: previewed.stats, dropped };
  }

  const committed = await engine.commit(batch.import_batch_id, {
    actor: SYSTEM,
    db,
    valid_only: true,
    create_missing: missing,
  });
  log(
    `committed: ${committed.stats.create} created, ${committed.stats.update} updated, ` +
      `${committed.stats.unchanged} unchanged, ${committed.stats.error} left for People to correct`,
  );
  await logProblems(db, batch.import_batch_id, log);

  /* 4. Logins and roles, then the counter past the numbers the sheet brought. */
  const logins = await applyRoles({ pool: db, atomically, log, roles });
  const highest = await withTx(db, atomically, (client) => organisation.advanceStaffNumbers(client));
  log(`staff numbers continue after ${highest}`);
  log(`logins: ${logins.created} invited, ${logins.kept} already had one, ${logins.failed} failed`);
  return { status: "loaded", batch: batch.import_batch_id, stats: committed.stats, logins, dropped };
}

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Run one piece of work in its own transaction. */
async function withTx(db, atomically, fn) {
  const client = await db.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

/**
 * Every row the sheet got wrong, in the deploy log: the ones that could not be written
 * at all, and the ones written with something missing (a line manager the sheet names
 * and the system does not have). People correct them on screen or in the next sheet.
 */
async function logProblems(db, batchId, log) {
  const { rows } = await db.query(
    `SELECT row_number, status, problems FROM import_row
      WHERE import_batch_id = $1 AND status IN ('error', 'duplicate', 'warning')
      ORDER BY row_number`,
    [batchId],
  );
  for (const row of rows) {
    const said = (row.problems || []).map((p) => p.message).join("; ");
    log(`row ${row.row_number} ${row.status}: ${said}`);
  }
  return rows.length;
}

async function main(argv) {
  const known = new Set(["--dry-run", "--help"]);
  for (const a of argv) if (!known.has(a)) throw new Error(`Unknown option ${a}`);
  if (argv.includes("--help")) {
    console.log("Usage: node scripts/db/load-staff.js [--dry-run]");
    return 0;
  }
  process.env.MYCITY_PROCESS = process.env.MYCITY_PROCESS || "mycity-staff-roster";
  const { pool, closeDb } = require(path.join(ROOT, "src/config/db.js"));
  const requestContext = require(path.join(ROOT, "src/config/request-context.js"));
  const log = (m) => console.log(`[staff] ${m}`);
  try {
    const result = await requestContext.run({ requestId: "staff-roster", surface: "script" }, () =>
      loadStaff({ db: pool, log, dryRun: argv.includes("--dry-run") }),
    );
    log(result.status);
    return 0;
  } finally {
    await closeDb();
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error(`[staff] ${err.message}`);
      process.exit(1);
    },
  );
}

module.exports = {
  SYSTEM,
  SHEET,
  ROLES,
  IMPORTER,
  loadImporters,
  readRoles,
  rolesForTitle,
  emailsByJobTitle,
  mappingFor,
  alreadyLoaded,
  applyRoles,
  loadStaff,
  logProblems,
  main,
};
