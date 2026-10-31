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
 *      (src/modules/organisation/employee.import.js), with three options: keep what the
 *      app already has, the work email `roles.json` gives a post the sheet leaves
 *      empty, and the sheet's claim on its own staff numbers. A number the sheet gives
 *      one of its people, held here by somebody the sheet does not name, is taken back:
 *      the holder moves to the next free number (the bootstrap administrator is created
 *      before any of this and is given 00001, which the sheet says is the CEO's).
 *   4. Maps the columns the importer recognises, and drops a column the whole sheet gets
 *      wrong (MyCity's own sheet holds a day and month with no year under DOB, and the
 *      same placeholder under Phone), with the reason in the log.
 *   5. Previews, which is the commit rolled back, then commits the valid rows. A row that
 *      fails is logged and kept in Imports history for People to correct; it never stops
 *      the deploy.
 *   6. Gives each person a login in the invited state with the roles `roles.json` holds
 *      for their post, and the CEO flag where it says so. **No email is sent**: Send
 *      Invite does that, when People are ready.
 *   7. Gives a post the sheet does not hold the line manager `roles.json` names for it
 *      (the build account reports to the CTO), only while that person has none.
 *   8. Moves the staff-number counter past every number the sheet brought, so the next
 *      person added on screen is not given one that is taken.
 *   9. Records a birthday the sheet gives as a day and month with no year (the DOB the
 *      importer drops in step 4) for each person with no date of birth and no birthday
 *      yet, so the celebrations can post it. This runs on every deploy, loaded sheet or not.
 *  10. Gives MyCity's names to its functions, posts and seats (`nomenclature.json`,
 *      scripts/db/staff-nomenclature.js), once per version of that file, before the sheet is
 *      imported, so the sheet finds each department under its new name, and after, for the
 *      codes, heads and lines of what the sheet created. After that the departments are
 *      People's, on People · Departments, and a deploy never renames one or sets a head.
 *  11. Gives every department head Head of Department while they head, unless a role of
 *      theirs already sets a function's goals (docs/guides/organogram.md §6.1). This runs on
 *      every deploy, loaded sheet or not.
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
const NOMENCLATURE = path.join(STAFF_DIR, "nomenclature.json");
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

/**
 * What a post is given: its own entry, by its exact title (case and punctuation aside), else
 * the default. Never by the words a title shares with a post: "Deputy Chief Technology
 * Officer" is not the Chief Technology Officer and must not be made an administrator.
 */
function rolesForTitle(roles, jobTitle) {
  const managerText = require(path.join(ROOT, "src/modules/organisation/manager-text.js"));
  const wanted = managerText.fold(jobTitle);
  const exact = Object.entries(roles.by_job_title).find(([title]) => managerText.fold(title) === wanted);
  return exact ? exact[1] : roles.default;
}

/** Every work email `roles.json` holds for a post whose sheet cell is empty. */
function emailsByJobTitle(roles) {
  const out = {};
  for (const [title, entry] of Object.entries(roles.by_job_title))
    if (entry.work_email) out[title] = String(entry.work_email).trim().toLowerCase();
  return out;
}

/**
 * Every work email this roster names: the sheet's own cells, and the ones `roles.json`
 * gives a post the sheet leaves blank. The importer uses them to tell a person the
 * roster brought from somebody else who happens to hold one of its staff numbers, so a
 * loose read is the safe one: anything that looks like an address counts, and a holder
 * wrongly counted as ours keeps their number instead of being moved.
 *
 * @param {{sheets: Array<{rows: Array<Array<*>>}>}} book
 * @returns {string[]}
 */
function sheetWorkEmails(book, roles) {
  const out = new Set(Object.values(emailsByJobTitle(roles)));
  for (const sheet of book.sheets || [])
    for (const row of sheet.rows || [])
      for (const cell of row || []) {
        const text = String(cell ?? "").trim();
        if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) out.add(text.toLowerCase());
      }
  return [...out];
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
 * Give each person the roster brought a login with the roles their post is granted. A person
 * who already has one is left alone, roles included: roles apply when the login is created,
 * so a change made on screen stands (docs/guides/foundation.md §11). Somebody People added on
 * screen is theirs to invite or not: the roster never gives them a login.
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
        AND EXISTS (SELECT 1 FROM import_row r JOIN import_batch b ON b.import_batch_id = r.import_batch_id
                     WHERE b.importer_key = 'employees' AND b.status = 'committed' AND b.options ? 'source_sha256'
                       AND r.action = 'create' AND r.target_id = e.employee_id::text)
      ORDER BY e.created_at, e.employee_id`,
  );
  for (const person of rows) {
    if (person.user_id) {
      out.kept += 1;
      continue;
    }
    const entry = rolesForTitle(roles, person.job_title);
    const granted = entry.roles || roles.default.roles || ["employee"];
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
        await access.setRoles(client, user.user_id, granted, SYSTEM);
      });
      out.created += 1;
      log(`login invited for ${person.display_name}: ${granted.join(", ")}${entry.is_ceo ? ", CEO" : ""}`);
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
 * Give a post the sheet does not hold the line manager `roles.json` names for it (the
 * build account, made before any roster, reports to the CTO). The words are read as the
 * sheet's Line Manager column is (manager-text.js). Only an active person with no line at
 * all is given one, and never the CEO, so a manager set on screen stays.
 *
 * @returns {Promise<{set: number, unresolved: number}>}
 */
async function applyLines({ pool, atomically, log, roles }) {
  const managerText = require(path.join(ROOT, "src/modules/organisation/manager-text.js"));
  const organisation = require(path.join(ROOT, "src/modules/organisation/organisation.service.js"));
  const out = { set: 0, unresolved: 0 };
  if (!Object.values(roles.by_job_title).some((entry) => entry.line_manager)) return out;
  const { rows } = await pool.query(
    `SELECT e.employee_id, e.job_title, btrim(e.first_name || ' ' || e.last_name) AS display_name
       FROM employee e
       LEFT JOIN app_user u ON u.employee_id = e.employee_id
      WHERE e.status = 'active' AND e.line_manager_id IS NULL AND e.line_manager_seat_id IS NULL
        AND COALESCE(u.is_ceo, false) = false
      ORDER BY e.created_at, e.employee_id`,
  );
  for (const person of rows) {
    const entry = rolesForTitle(roles, person.job_title);
    if (!entry.line_manager) continue;
    /* One line that cannot be set (a loop, a seat gone) is logged; it never stops the steps after it. */
    await withTx(pool, atomically, async (client) => {
      const target = await organisation.resolveManager(
        client,
        managerText.parse(entry.line_manager).primary,
        { exclude: person.employee_id },
      );
      if (!target) {
        out.unresolved += 1;
        log(`WARNING: no line manager for ${person.display_name} (${person.job_title}): "${entry.line_manager}" matches nobody`);
        return;
      }
      await organisation.setReportingLine(
        client,
        person.employee_id,
        {
          ...(target.employee_id
            ? { line_manager_id: target.employee_id }
            : { line_manager_seat_id: target.org_seat_id }),
          reason: `Staff roster: ${person.job_title} reports to ${entry.line_manager}`,
        },
        SYSTEM,
      );
      out.set += 1;
      log(`${person.display_name} (${person.job_title}) now reports to the ${entry.line_manager}`);
    }).catch((err) => {
      out.unresolved += 1;
      log(`WARNING: no line manager for ${person.display_name} (${person.job_title}): ${err.message}`);
    });
  }
  return out;
}

/** A cell holding a day and month with no year ("03/07", "3-7"), day first; null otherwise. */
function dayMonth(cell) {
  if (cell === null || cell === undefined || cell instanceof Date) return null;
  const m = /^(\d{1,2})\s*[/.\-\s]\s*(\d{1,2})$/.exec(String(cell).trim());
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const last = month === 2 ? 29 : [4, 6, 9, 11].includes(month) ? 30 : 31;
  return month >= 1 && month <= 12 && day >= 1 && day <= last ? { day, month } : null;
}

/**
 * Birthdays the sheet gives as a day and month with no year, which the importer cannot
 * read as a date of birth. Each is matched to its person by work email only, the cell's own or
 * the one roles.json gives the post when the cell is empty (a staff number may have moved to
 * somebody else since), and written only for a person with no date of
 * birth and no birthday yet, so nothing entered on screen is written over. Runs on every
 * deploy, as the sheet may have been loaded before this step existed. Logs counts only: a
 * birthday is personal.
 *
 * @returns {Promise<{set: number, unmatched: number}>}
 */
async function applyBirthdays({ pool, atomically, book, roles = { by_job_title: {} } }) {
  const organisation = require(path.join(ROOT, "src/modules/organisation/organisation.service.js"));
  const out = { set: 0, unmatched: 0 };
  const grid = (book && book.sheets && book.sheets[0] && book.sheets[0].rows) || [];
  const fold = (v) => String(v ?? "").trim().toLowerCase().replace(/[^a-z]/g, "");
  const headerRow = grid.findIndex((r) => (r || []).some((c) => ["dob", "dateofbirth", "birthday"].includes(fold(c))));
  if (headerRow < 0) return out;
  const header = grid[headerRow].map(fold);
  const col = (...names) => header.findIndex((h) => names.includes(h));
  const dob = col("dob", "dateofbirth", "birthday");
  const email = col("email", "workemail");
  const post = col("designation", "jobtitle", "position");
  const byPost = emailsByJobTitle(roles);
  for (const row of grid.slice(headerRow + 1)) {
    const when = dayMonth((row || [])[dob]);
    if (!when) continue;
    const own = email >= 0 ? String(row[email] ?? "").trim().toLowerCase() : "";
    const mail = own || (post >= 0 ? byPost[String(row[post] ?? "").trim()] || "" : "");
    const { rows } = await pool.query(
      `SELECT employee_id, date_of_birth, birth_day FROM employee
        WHERE $1 <> '' AND lower(work_email::text) = $1
        LIMIT 1`,
      [mail],
    );
    const person = rows[0];
    if (!person) {
      out.unmatched += 1;
      continue;
    }
    if (person.date_of_birth || person.birth_day !== null) continue;
    await withTx(pool, atomically, (client) => organisation.setBirthday(client, person.employee_id, when, SYSTEM));
    out.set += 1;
  }
  return out;
}

/**
 * Load the roster.
 * @param {{db: import("pg").Pool, log?: Function, dryRun?: boolean, sheet?: string, rolesFile?: string}} opts
 * @returns {Promise<{status: string, stats?: object, logins?: object, batch?: string, dropped?: Array}>}
 */
/** The department names a sheet uses, from its Team column. */
function sheetTeams(book) {
  const out = new Set();
  for (const s of book.sheets || []) {
    const rows = s.rows || [];
    const at = rows.findIndex((r) => (r || []).some((c) => /^\s*team\s*$/i.test(String(c ?? ""))));
    if (at === -1) continue;
    const col = rows[at].findIndex((c) => /^\s*team\s*$/i.test(String(c ?? "")));
    for (const r of rows.slice(at + 1)) {
      const v = String((r || [])[col] ?? "").trim();
      if (v) out.add(v);
    }
  }
  return [...out];
}

/** The checksum of nomenclature.json, or null when the build has none. */
function namesChecksum(file) {
  return fs.existsSync(file) ? crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex") : null;
}

/**
 * Step 10: the nomenclature, in its own transactions; a problem is logged, never fatal.
 *
 * The renames of posts, seats, moves and lines are applied once per version of nomenclature.json
 * (`once`), so a title or a line People change on screen afterwards stays. The departments, their
 * codes and heads are given only to a database that has never had MyCity's names (`first`): after
 * that they are People's, on People · Departments (docs/guides/organogram.md §6.1).
 */
async function applyNames({ db, atomically, log, file, book }) {
  const { applyNomenclature } = require("./staff-nomenclature");
  const organisation = require(path.join(ROOT, "src/modules/organisation/organisation.service.js"));
  const sha = namesChecksum(file);
  try {
    const once = sha ? await organisation.namesApplied(db, sha) : false;
    const first = !(await organisation.namesApplied(db));
    const r = await applyNomenclature({ pool: db, atomically, log, actor: SYSTEM, file, teams: sheetTeams(book), once, first });
    const changed = Object.values(r).reduce((a, b) => a + b, 0);
    if (changed) log(`names: ${JSON.stringify(r)}`);
    return r;
  } catch (err) {
    log(`WARNING: names not applied: ${err.message}`);
    return null;
  }
}

/** Note that this version of the names was applied, after the run's last names step. */
async function namesDone({ db, atomically, file, names }) {
  const sha = namesChecksum(file);
  if (!sha || !names) return;
  const organisation = require(path.join(ROOT, "src/modules/organisation/organisation.service.js"));
  if (await organisation.namesApplied(db, sha)) return;
  await withTx(db, atomically, (client) => organisation.recordNamesApplied(client, sha, names, SYSTEM));
}

/**
 * Give every department head their role, after the logins (docs/guides/organogram.md §6.1):
 * Head of Department while they head, unless a role of theirs already sets a function's goals.
 */
async function applyHeadRoles({ db, atomically, log }) {
  const organisation = require(path.join(ROOT, "src/modules/organisation/organisation.service.js"));
  const r = await withTx(db, atomically, (client) => organisation.syncHeadRoles(client, SYSTEM));
  if (r.given.length || r.taken.length) log(`heads: Head of Department given to ${r.given.length}, taken back from ${r.taken.length}`);
  return r;
}

/**
 * The names the roster may not make again: a department of nomenclature.json whose code another
 * department holds already, under a name People gave it on People · Departments.
 */
async function renamedOnScreen(db, file, names) {
  const { readNomenclature, fold } = require("./staff-nomenclature");
  const plan = readNomenclature(file);
  const out = new Set();
  for (const name of names) {
    const d = ((plan && plan.departments) || []).find((x) => [x.name, ...(x.was || [])].some((n) => fold(n) === fold(name)));
    if (!d || !d.code) continue;
    const { rows } = await db.query("SELECT 1 FROM department WHERE code = $1::citext LIMIT 1", [d.code]);
    if (rows.length) out.add(name);
  }
  return out;
}

/**
 * The departments the roster may create without a person ticking them: the ones
 * nomenclature.json names, under their name or a former one. Any other department the sheet
 * names and the system lacks is a problem on its rows, so a typo never becomes a department.
 * Null, every one, for a build with no nomenclature.json (it has no list to hold a sheet to).
 */
function knownDepartments(file) {
  const { readNomenclature, fold } = require("./staff-nomenclature");
  const plan = readNomenclature(file);
  if (!plan) return null;
  const out = new Set();
  for (const d of (plan && plan.departments) || []) for (const n of [d.name, ...(d.was || [])]) out.add(fold(n));
  return out;
}

/** The Staff ID cells of the mapped Staff Number column. */
function staffNumbersOf(grid, headerRow, fields) {
  const at = Object.entries(fields).find(([, key]) => key === "staff_number");
  if (!at) return [];
  const col = Number(at[0]);
  return grid
    .slice(headerRow + 1)
    .map((r) => String((r || [])[col] ?? "").trim())
    .filter(Boolean);
}

async function loadStaff({ db, log = () => {}, dryRun = false, sheet = SHEET, rolesFile = ROLES, nomenclatureFile = NOMENCLATURE }) {
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
  if (loaded && dryRun) {
    log(`this sheet is already loaded (batch ${loaded.number}); a dry run has nothing to preview`);
    return { status: "already_loaded", batch: loaded.import_batch_id };
  }
  if (loaded) {
    log(`this sheet is already loaded (batch ${loaded.number}); checking names, logins and lines only`);
    const loadedBook = await readSheets({ buffer, filename: path.basename(sheet) });
    const names = await applyNames({ db, atomically, log, file: nomenclatureFile, book: loadedBook });
    await namesDone({ db, atomically, file: nomenclatureFile, names });
    const logins = await applyRoles({ pool: db, atomically, log, roles });
    await applyHeadRoles({ db, atomically, log });
    const lines = await applyLines({ pool: db, atomically, log, roles });
    const birthdays = await applyBirthdays({ pool: db, atomically, book: loadedBook, roles });
    log(`birthdays by day and month: ${birthdays.set} recorded, ${birthdays.unmatched} matched nobody`);
    await withTx(db, atomically, (client) => organisation.advanceStaffNumbers(client));
    return { status: "already_loaded", batch: loaded.import_batch_id, names, logins, lines, birthdays };
  }

  /* The sheet is read here as well as by the engine, for the emails and teams it names. */
  const book = await readSheets({ buffer, filename: path.basename(sheet) });

  /* 0. MyCity's names first, so the sheet finds each department under its new name. */
  if (!dryRun) await applyNames({ db, atomically, log, file: nomenclatureFile, book });

  /* 1. The file goes to the engine, with the roster's own options. */
  const batch = await withTx(db, atomically, (client) =>
    engine.createBatch(client, {
      importer_key: IMPORTER,
      file: { buffer, originalname: path.basename(sheet), mimetype: XLSX_MIME, size: buffer.length },
      actor: SYSTEM,
      options: {
        keep_existing: true,
        work_email_by_job_title: emailsByJobTitle(roles),
        reclaim_staff_numbers: true,
        roster_work_emails: sheetWorkEmails(book, roles),
        skip_unreadable_optional: true,
        source: "staff roster, loaded by the deploy",
        source_sha256: checksum,
      },
    }),
  );
  log(`batch ${batch.number} from ${path.basename(sheet)}, sheet "${batch.sheet}"`);

  /* 2. The columns to read, and the ones the sheet gets wrong. */
  const grid = (book.sheets.find((s) => s.name === batch.sheet) || book.sheets[0]).rows;
  const headerRow = batch.header_row === null ? mapping.detectHeaderRow(grid, importer.fields) : batch.header_row;
  if (headerRow === null) throw new Error("the sheet has no row of column names this importer knows");
  const { fields, dropped } = mappingFor(engine, importer, grid, headerRow, batch.mapping);
  for (const d of dropped) log(`column "${d.header}" not imported: ${d.reason}`);
  await withTx(db, atomically, (client) =>
    engine.setMapping(client, batch.import_batch_id, { sheet: batch.sheet, header_row: headerRow, fields }, SYSTEM),
  );

  /* The counter goes above every number the sheet claims first, so a row with no Staff ID,
     or a holder moved off a number, is given one above them all. */
  if (!dryRun) await withTx(db, atomically, (client) => organisation.reserveStaffNumbers(client, staffNumbersOf(grid, headerRow, fields)));

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

  const { fold } = require("./staff-nomenclature");
  const known = knownDepartments(nomenclatureFile);
  const renamed = await renamedOnScreen(db, nomenclatureFile, missing.department || []);
  const creatable = (missing.department || []).filter((name) => (!known || known.has(fold(name))) && !renamed.has(name));
  for (const name of (missing.department || []).filter((n) => !creatable.includes(n)))
    log(
      renamed.has(name)
        ? `WARNING: department "${name}" was renamed on People · Departments; its rows are left for People`
        : `WARNING: department "${name}" is not one of MyCity's (nomenclature.json); its rows are left for People`,
    );
  const committed = await engine.commit(batch.import_batch_id, {
    actor: SYSTEM,
    db,
    valid_only: true,
    create_missing: { ...missing, department: creatable },
  });
  log(
    `committed: ${committed.stats.create} created, ${committed.stats.update} updated, ` +
      `${committed.stats.unchanged} unchanged, ${committed.stats.error} left for People to correct`,
  );
  await logProblems(db, batch.import_batch_id, log);

  /* 4. Logins and roles, the lines of posts outside the sheet, then the counter past the
        numbers the sheet brought. */
  const names = await applyNames({ db, atomically, log, file: nomenclatureFile, book });
  await namesDone({ db, atomically, file: nomenclatureFile, names });
  const logins = await applyRoles({ pool: db, atomically, log, roles });
  await applyHeadRoles({ db, atomically, log });
  const lines = await applyLines({ pool: db, atomically, log, roles });
  const birthdays = await applyBirthdays({ pool: db, atomically, book, roles });
  log(`birthdays by day and month: ${birthdays.set} recorded, ${birthdays.unmatched} matched nobody`);
  const highest = await withTx(db, atomically, (client) => organisation.advanceStaffNumbers(client));
  log(`staff numbers continue after ${highest}`);
  log(`logins: ${logins.created} invited, ${logins.kept} already had one, ${logins.failed} failed`);
  return { status: "loaded", batch: batch.import_batch_id, stats: committed.stats, names, logins, lines, birthdays, dropped };
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
  NOMENCLATURE,
  IMPORTER,
  sheetTeams,
  knownDepartments,
  staffNumbersOf,
  loadImporters,
  readRoles,
  rolesForTitle,
  emailsByJobTitle,
  sheetWorkEmails,
  mappingFor,
  alreadyLoaded,
  applyRoles,
  dayMonth,
  applyBirthdays,
  applyLines,
  loadStaff,
  logProblems,
  main,
};
