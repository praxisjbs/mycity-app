"use strict";
/**
 * Home · Reports, the SQL: saved reports, their schedules and the files they produce
 * (docs/guides/home.md §4, §5, §6 Reports). Never emits (BACKEND_GUIDE §2).
 *
 *   saved_report      a report: its source (report_key), filters (definition), owner, sharing
 *   report_schedule   one per report: a recurrence rule, its start day, time, formats and the
 *                     logins it goes to; active false is Paused
 *   home_report_run   one file: one report, one recipient, one format, one number
 *
 * WHO SEES A REPORT is one condition, seenWhere(): the CEO every report; anyone else their own,
 * and those they receive or that are shared, while they may open the report's source. The
 * service works out which sources the reader may open; this file turns it into SQL. A run is
 * seen by its recipient and by the report's owner (runSeenWhere); the CEO sees every run.
 *
 * The Overview Export keeps a report of source `overview` for each person who exports. It is
 * theirs alone and never listed: every read of reports here leaves it out.
 */
const { pageQuery, orderBy, completeQuery, TOTAL_COL } = require("../../shared/http/paged");

const one = async (db, sql, params) => (await db.query(sql, params)).rows[0] || null;

/** The source of the Overview Export's own reports, never listed with the others. */
const OVERVIEW = "overview";

/* ------------------------------------------------------------------ *
 * Who sees what
 * ------------------------------------------------------------------ */

/**
 * The reports a reader may see, as a condition on `r` (saved_report) and `s` (its schedule,
 * left joined), appending its values to `params`.
 * @param {{all: boolean, user_id: string, sources: string[]}} seen
 *   all: the CEO; sources: the source keys the reader may open
 * @param {Array} params
 */
function seenWhere(seen, params) {
  params.push(OVERVIEW);
  const overview = `r.report_key <> $${params.length}`;
  if (seen.all) return overview;
  params.push(seen.user_id);
  const me = `$${params.length}::uuid`;
  params.push(seen.sources);
  const open = `$${params.length}::text[]`;
  return `(${overview} AND (r.owner_user_id = ${me}
          OR ((r.shared OR ${me} = ANY(s.recipient_user_ids)) AND r.report_key = ANY(${open}))))`;
}

/**
 * The runs a reader may see, as a condition on `x` (home_report_run) and `r` (its report).
 * @param {{all: boolean, user_id: string}} seen
 * @param {Array} params
 */
function runSeenWhere(seen, params) {
  if (seen.all) return "true";
  params.push(seen.user_id);
  return `(x.recipient_user_id = $${params.length}::uuid OR r.owner_user_id = $${params.length}::uuid)`;
}

/* ------------------------------------------------------------------ *
 * Reports
 * ------------------------------------------------------------------ */

/** The logins a schedule goes to, in the order chosen, each with their name and address. */
const AUDIENCE = `(SELECT COALESCE(json_agg(json_build_object(
           'user_id', u.user_id, 'display_name', btrim(e.first_name || ' ' || e.last_name), 'email', u.email::text)
           ORDER BY x.ord), '[]'::json)
      FROM unnest(s.recipient_user_ids) WITH ORDINALITY AS x(user_id, ord)
      JOIN app_user u ON u.user_id = x.user_id
      JOIN employee e ON e.employee_id = u.employee_id)`;

const REPORT_SELECT = `SELECT r.saved_report_id, r.name, r.report_key, r.definition, r.shared, r.owner_user_id,
       btrim(oe.first_name || ' ' || oe.last_name) AS owner_name, r.archived_at, r.created_at, r.updated_at,
       s.report_schedule_id, s.recurrence, s.starts_on, to_char(s.run_time, 'HH24:MI') AS run_time, s.formats,
       s.recipient_user_ids, s.active, s.last_run_at, s.next_run_at, ${AUDIENCE} AS audience`;

const REPORT_FROM = `FROM saved_report r
  JOIN app_user ou ON ou.user_id = r.owner_user_id
  JOIN employee oe ON oe.employee_id = ou.employee_id
  LEFT JOIN report_schedule s ON s.saved_report_id = r.saved_report_id`;

/** Each status a report card shows, as a condition on its schedule. */
const STATUS = Object.freeze({
  scheduled: "s.active IS TRUE",
  paused: "s.active IS FALSE",
  on_demand: "s.report_schedule_id IS NULL",
});

/** The SQL for each field HomeReportQuery sorts by. The first is the default order. */
const REPORT_SORTS = { name: "lower(r.name)", created_at: "r.created_at" };

/**
 * One page of the reports a reader may see: live ones unless `archived` asks for the archived.
 * @param {{query: Function}} db
 * @param {object} seen  see seenWhere()
 * @param {object} query  a validated HomeReportQuery
 */
function reportPage(db, seen, query) {
  const params = [
    query.q || null,
    query.report_key || null,
    query.archived === "true",
    query.mine === "true" ? seen.user_id : null,
  ];
  const seenSql = seenWhere(seen, params);
  return pageQuery(
    db,
    `${REPORT_SELECT}, ${TOTAL_COL}
       ${REPORT_FROM}
      WHERE ${seenSql}
        AND ($1::text IS NULL OR search_fold(r.name) LIKE '%' || search_fold($1) || '%')
        AND ($2::text IS NULL OR r.report_key = $2)
        AND (CASE WHEN $3::boolean THEN r.archived_at IS NOT NULL ELSE r.archived_at IS NULL END)
        AND ($4::uuid IS NULL OR r.owner_user_id = $4::uuid OR $4::uuid = ANY(s.recipient_user_ids))
        ${query.status ? `AND ${STATUS[query.status]}` : ""}
      ORDER BY ${orderBy(query, REPORT_SORTS, "r.saved_report_id")}`,
    params,
    query,
  );
}

/**
 * One report the reader may see, archived or not, or null.
 *
 * Locked, the report is held for the rest of the transaction, and the report is always the
 * first row a write takes: then its schedule, then the `report_run` counter, as a slot firing
 * takes them too (scheduleToFire). The lock is FOR NO KEY UPDATE: no change here writes the
 * report's id, so a run inserted against it meanwhile does not wait; a rename takes the
 * stronger lock as it writes.
 * @param {{query: Function}} db
 * @param {object} seen  see seenWhere()
 * @param {string} id
 * @param {{lock?: boolean}} [opts]  lock: hold the report for the rest of the transaction
 */
function reportById(db, seen, id, { lock = false } = {}) {
  const params = [id];
  const seenSql = seenWhere(seen, params);
  return one(
    db,
    `${REPORT_SELECT} ${REPORT_FROM} WHERE r.saved_report_id = $1 AND ${seenSql}${lock ? " FOR NO KEY UPDATE OF r" : ""}`,
    params,
  );
}

/**
 * The person's own Overview Export report, or null.
 * @param {{query: Function}} db
 * @param {string} ownerUserId
 */
function overviewReportOf(db, ownerUserId) {
  return one(
    db,
    `${REPORT_SELECT} ${REPORT_FROM} WHERE r.owner_user_id = $1 AND r.report_key = $2 ORDER BY r.created_at LIMIT 1`,
    [ownerUserId, OVERVIEW],
  );
}

/**
 * Scheduled, Paused and Recipients over the live reports a reader may see.
 * @param {{query: Function}} db
 * @param {object} seen  see seenWhere()
 * @returns {Promise<{scheduled: number, paused: number, recipients: number}>}
 */
function counts(db, seen) {
  const params = [];
  const seenSql = seenWhere(seen, params);
  return one(
    db,
    `WITH seen AS (
       SELECT s.active, s.recipient_user_ids
         FROM saved_report r
         LEFT JOIN report_schedule s ON s.saved_report_id = r.saved_report_id
        WHERE r.archived_at IS NULL AND ${seenSql}
     )
     SELECT count(*) FILTER (WHERE seen.active IS TRUE)::int AS scheduled,
            count(*) FILTER (WHERE seen.active IS FALSE)::int AS paused,
            (SELECT count(DISTINCT u.user_id)::int
               FROM seen AS a, unnest(a.recipient_user_ids) AS u(user_id)
              WHERE a.active IS TRUE) AS recipients
       FROM seen`,
    params,
  );
}

/**
 * Whether the owner already has a report of this name, case aside. Their Overview Export's
 * report is not listed, so it never holds a name against them.
 * @param {{query: Function}} db
 * @param {string} ownerUserId
 * @param {string} name
 * @param {{except?: string|null}} [opts]  the report being renamed
 */
async function nameTaken(db, ownerUserId, name, { except = null } = {}) {
  const row = await one(
    db,
    `SELECT EXISTS (
       SELECT 1 FROM saved_report
        WHERE owner_user_id = $1 AND lower(name) = lower($2) AND report_key <> $3
          AND ($4::uuid IS NULL OR saved_report_id <> $4::uuid)) AS taken`,
    [ownerUserId, name, OVERVIEW, except],
  );
  return row.taken;
}

/**
 * The names an owner's reports already hold that a new name could collide with: `base`
 * itself and `base <n>`, lower case.
 * @param {{query: Function}} db
 * @param {string} ownerUserId
 * @param {string} base
 * @returns {Promise<string[]>}
 */
async function namesLike(db, ownerUserId, base) {
  // pagination:complete the names one owner holds that start with one base, a handful
  const { rows } = await completeQuery(
    db,
    `SELECT lower(name) AS name FROM saved_report
      WHERE owner_user_id = $1 AND (lower(name) = lower($2) OR starts_with(lower(name), lower($2) || ' '))
      ORDER BY 1`,
    [ownerUserId, base],
    { label: "report names", ceiling: 1000 },
  );
  return rows.map((r) => r.name);
}

/**
 * A new report.
 * @param {{query: Function}} db
 * @param {{owner_user_id: string, name: string, report_key: string, definition: object, shared: boolean}} report
 * @returns {Promise<string>} its id
 */
async function insertReport(db, report) {
  const row = await one(
    db,
    `INSERT INTO saved_report (owner_user_id, name, report_key, definition, shared)
     VALUES ($1, $2, $3, $4::jsonb, $5)
     RETURNING saved_report_id`,
    [report.owner_user_id, report.name, report.report_key, JSON.stringify(report.definition), report.shared],
  );
  return row.saved_report_id;
}

/** The columns a report's change may set, and their casts. */
const REPORT_COLUMNS = Object.freeze({ name: "", definition: "::jsonb", shared: "::boolean" });

/**
 * Change a report's fields, and mark it changed: with none, only that (its schedule changed).
 * @param {{query: Function}} db
 * @param {string} id
 * @param {Partial<{name: string, definition: object, shared: boolean}>} changes  only what changes
 */
async function updateReport(db, id, changes) {
  const params = [id];
  const sets = Object.entries(changes).map(([column, value]) => {
    if (!Object.prototype.hasOwnProperty.call(REPORT_COLUMNS, column))
      throw new Error(`reports.repo.updateReport: "${column}" is not a report field`);
    params.push(column === "definition" ? JSON.stringify(value) : value);
    return `${column} = $${params.length}${REPORT_COLUMNS[column]}`;
  });
  await db.query(`UPDATE saved_report SET ${[...sets, "updated_at = now()"].join(", ")} WHERE saved_report_id = $1`, params);
}

/**
 * Hold one owner's reports for the rest of the transaction: two saves claiming a name take
 * turns, and two Overview Exports at once make one report between them.
 * @param {{query: Function}} db  inside a transaction
 * @param {string} ownerUserId
 */
async function lockOwner(db, ownerUserId) {
  await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`home-reports:${ownerUserId}`]);
}

/** Archive a report. */
async function archiveReport(db, id) {
  await db.query("UPDATE saved_report SET archived_at = now(), updated_at = now() WHERE saved_report_id = $1", [id]);
}

/* ------------------------------------------------------------------ *
 * Schedules
 * ------------------------------------------------------------------ */

/**
 * Write a report's schedule whole, creating it when it has none.
 * @param {{query: Function}} db
 * @param {string} reportId
 * @param {{recurrence: object, starts_on: string, run_time: string, formats: string[],
 *          recipient_user_ids: string[], recipients: string[], active: boolean, next_run_at: Date|null}} s
 */
async function saveSchedule(db, reportId, s) {
  await db.query(
    `INSERT INTO report_schedule (saved_report_id, recurrence, starts_on, run_time, formats, recipient_user_ids,
                                  recipients, active, next_run_at)
     VALUES ($1, $2::jsonb, $3::date, $4::time, $5::text[], $6::uuid[], $7::citext[], $8, $9)
     ON CONFLICT (saved_report_id) DO UPDATE
       SET recurrence = EXCLUDED.recurrence, starts_on = EXCLUDED.starts_on, run_time = EXCLUDED.run_time,
           formats = EXCLUDED.formats, recipient_user_ids = EXCLUDED.recipient_user_ids,
           recipients = EXCLUDED.recipients, active = EXCLUDED.active, next_run_at = EXCLUDED.next_run_at,
           updated_at = now()`,
    [
      reportId,
      JSON.stringify(s.recurrence),
      s.starts_on,
      s.run_time,
      s.formats,
      s.recipient_user_ids,
      s.recipients,
      s.active,
      s.next_run_at,
    ],
  );
}

/** Remove a report's schedule: it runs on demand. Its runs keep their slot. */
async function deleteSchedule(db, reportId) {
  await db.query("DELETE FROM report_schedule WHERE saved_report_id = $1", [reportId]);
}

/**
 * Pause or resume a report's schedule: paused has no next slot.
 * @param {{query: Function}} db
 * @param {string} reportId
 * @param {{active: boolean, next_run_at: Date|null}} state
 */
async function setScheduleState(db, reportId, { active, next_run_at: next }) {
  await db.query(
    "UPDATE report_schedule SET active = $2, next_run_at = $3, updated_at = now() WHERE saved_report_id = $1",
    [reportId, active, next],
  );
}

/**
 * The schedules whose slot has come, the earliest first: one tick's batch.
 * @param {{query: Function}} db
 * @param {{now: Date, batch: number}} opts
 * @returns {Promise<Array<{report_schedule_id: string, next_run_at: Date}>>}
 */
async function dueSchedules(db, { now, batch }) {
  const { rows } = await db.query(
    `SELECT s.report_schedule_id, s.next_run_at
       FROM report_schedule s
       JOIN saved_report r ON r.saved_report_id = s.saved_report_id
      WHERE s.active AND s.next_run_at <= $1 AND r.archived_at IS NULL
      ORDER BY s.next_run_at, s.report_schedule_id
      LIMIT $2 -- pagination:batch the schedules one tick queues; the rest are queued at the next`,
    [now, batch],
  );
  return rows;
}

/**
 * A schedule and its report as the job that fires a slot needs them, held for the rest of
 * the transaction so two jobs for one schedule queue behind each other; null when it is gone.
 *
 * The report is taken first, in a statement of its own (the order of the locks inside one
 * statement is not fixed), then the schedule: the order every change to a report takes them
 * in (reportById), so a slot firing while its owner saves, pauses, archives or runs it waits
 * for them, or they for it, and then reads what the other wrote.
 * @param {{query: Function}} db  inside a transaction
 * @param {string} scheduleId
 */
async function scheduleToFire(db, scheduleId) {
  await db.query(
    `SELECT 1 FROM saved_report r
       JOIN report_schedule s ON s.saved_report_id = r.saved_report_id
      WHERE s.report_schedule_id = $1
      FOR NO KEY UPDATE OF r`,
    [scheduleId],
  );
  return one(
    db,
    `SELECT s.report_schedule_id, s.saved_report_id, s.recurrence, s.starts_on, to_char(s.run_time, 'HH24:MI') AS run_time,
            s.formats, s.recipient_user_ids, s.active, s.next_run_at, r.archived_at, r.report_key
       FROM report_schedule s
       JOIN saved_report r ON r.saved_report_id = s.saved_report_id
      WHERE s.report_schedule_id = $1
      FOR UPDATE OF s`,
    [scheduleId],
  );
}

/**
 * A schedule has fired a slot: when, and the slot after it.
 * @param {{query: Function}} db
 * @param {string} scheduleId
 * @param {{last_run_at: Date, next_run_at: Date|null}} slots
 */
async function advanceSchedule(db, scheduleId, { last_run_at: last, next_run_at: next }) {
  await db.query(
    "UPDATE report_schedule SET last_run_at = $2, next_run_at = $3, updated_at = now() WHERE report_schedule_id = $1",
    [scheduleId, last, next],
  );
}

/* ------------------------------------------------------------------ *
 * People
 * ------------------------------------------------------------------ */

/**
 * The logins asked for that exist, in the order asked, each with their name and state.
 * @param {{query: Function}} db
 * @param {string[]} userIds
 * @returns {Promise<Array<{user_id: string, email: string, status: string, first_name: string, last_name: string, display_name: string}>>}
 */
async function people(db, userIds) {
  // pagination:complete the people one schedule goes to, at most a page of them
  const { rows } = await completeQuery(
    db,
    `SELECT u.user_id, u.email::text AS email, u.status, e.first_name, e.last_name,
            btrim(e.first_name || ' ' || e.last_name) AS display_name
       FROM unnest($1::uuid[]) WITH ORDINALITY AS x(user_id, ord)
       JOIN app_user u ON u.user_id = x.user_id
       JOIN employee e ON e.employee_id = u.employee_id
      ORDER BY x.ord`,
    [userIds],
    { label: "report recipients", ceiling: 200 },
  );
  return rows;
}

/**
 * What a report's filters name, as a person reads them: the department and the leave type,
 * each null when the filter names none or one that does not exist.
 * @param {{query: Function}} db
 * @param {{department_id?: string, leave_type_id?: string}} filters
 */
function filterNames(db, filters) {
  return one(
    db,
    `SELECT (SELECT d.name FROM department d WHERE d.department_id = $1::uuid) AS department,
            (SELECT t.name FROM leave_type t WHERE t.leave_type_id = $2::uuid) AS leave_type`,
    [filters.department_id || null, filters.leave_type_id || null],
  );
}

/* ------------------------------------------------------------------ *
 * Runs
 * ------------------------------------------------------------------ */

const RUN_SELECT = `SELECT x.home_report_run_id, x.number::text AS number, x.saved_report_id, r.name AS report_name,
       r.report_key, x.report_schedule_id, x.scheduled_for, x.recipient_user_id,
       btrim(re.first_name || ' ' || re.last_name) AS recipient_name, x.requested_by, x.format, x.status,
       x.document_id, x.emailed_at, x.run_at, x.finished_at`;

const RUN_FROM = `FROM home_report_run x
  JOIN saved_report r ON r.saved_report_id = x.saved_report_id
  JOIN app_user ru ON ru.user_id = x.recipient_user_id
  JOIN employee re ON re.employee_id = ru.employee_id`;

/**
 * One page of the runs a reader may see, newest first unless sorted otherwise. `q` finds a
 * run by its number or its report's name (⌘K).
 * @param {{query: Function}} db
 * @param {object} seen  see runSeenWhere()
 * @param {object} query  a validated HomeReportRunQuery, with `q`
 * @param {{received?: boolean}} [opts]  received: only the runs made for the reader themselves
 */
function runPage(db, seen, query, { received = false } = {}) {
  const params = [
    query.saved_report_id || null,
    query.status || null,
    query.format || null,
    query.q || null,
    received ? seen.user_id : null,
  ];
  const seenSql = runSeenWhere(seen, params);
  const sort = query.sort || { field: "run_at", dir: "desc" };
  return pageQuery(
    db,
    `${RUN_SELECT}, ${TOTAL_COL}
       ${RUN_FROM}
      WHERE ${seenSql}
        AND ($1::uuid IS NULL OR x.saved_report_id = $1::uuid)
        AND ($2::text IS NULL OR x.status = $2)
        AND ($3::text IS NULL OR x.format = $3)
        AND ($4::text IS NULL OR search_fold(x.number::text || ' ' || r.name) LIKE '%' || search_fold($4) || '%')
        AND ($5::uuid IS NULL OR x.recipient_user_id = $5::uuid)
      ORDER BY ${orderBy({ sort }, { run_at: "x.run_at" }, "x.home_report_run_id")}`,
    params,
    query,
  );
}

/**
 * One run, as the contract shapes it, or null.
 * @param {{query: Function}} db
 * @param {string} id
 * @param {{seen?: object|null}} [opts]  seen: only a run this reader may see (runSeenWhere)
 */
function runById(db, id, { seen = null } = {}) {
  const params = [id];
  const seenSql = seen ? runSeenWhere(seen, params) : "true";
  return one(db, `${RUN_SELECT} ${RUN_FROM} WHERE x.home_report_run_id = $1 AND ${seenSql}`, params);
}

/**
 * How many files of the runs a reader may see were generated since an instant.
 * @param {{query: Function}} db
 * @param {object} seen  see runSeenWhere()
 * @param {Date} since
 */
async function filesSince(db, seen, since) {
  const params = [since];
  const seenSql = runSeenWhere(seen, params);
  const row = await one(
    db,
    `SELECT count(*)::int AS n
       FROM home_report_run x
       JOIN saved_report r ON r.saved_report_id = x.saved_report_id
      WHERE x.status = 'done' AND x.run_at >= $1 AND ${seenSql}`,
    params,
  );
  return row.n;
}

/**
 * The run on demand this person asked for that is still waiting, for this report and format,
 * or null: pressing Run Now again while it waits is the same run. Only a run they asked for: a
 * scheduled run keeps its slot when its schedule is removed, and is never answered here.
 * @param {{query: Function}} db
 * @param {{saved_report_id: string, recipient_user_id: string, format: string}} run
 */
async function pendingOnDemand(db, { saved_report_id: reportId, recipient_user_id: recipient, format }) {
  const row = await one(
    db,
    `SELECT home_report_run_id FROM home_report_run
      WHERE saved_report_id = $1 AND recipient_user_id = $2 AND format = $3
        AND requested_by = $2 AND scheduled_for IS NULL AND status = 'pending'
      ORDER BY run_at DESC
      LIMIT 1`,
    [reportId, recipient, format],
  );
  return row ? row.home_report_run_id : null;
}

/**
 * A new run, waiting for its file. A scheduled run is one per slot, recipient and format:
 * one that slot already holds is not added again, and null comes back.
 * @param {{query: Function}} db
 * @param {{number: string, saved_report_id: string, report_schedule_id: string|null, scheduled_for: Date|null,
 *          recipient_user_id: string, requested_by: string|null, format: string}} run
 * @returns {Promise<string|null>} its id
 */
async function insertRun(db, run) {
  // run_at is the moment of each insert, so runs made together still read newest first.
  const row = await one(
    db,
    `INSERT INTO home_report_run (number, saved_report_id, report_schedule_id, scheduled_for, recipient_user_id,
                                  requested_by, format, run_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, clock_timestamp())
     ON CONFLICT (report_schedule_id, scheduled_for, recipient_user_id, format)
       WHERE report_schedule_id IS NOT NULL DO NOTHING
     RETURNING home_report_run_id`,
    [
      run.number,
      run.saved_report_id,
      run.report_schedule_id,
      run.scheduled_for,
      run.recipient_user_id,
      run.requested_by,
      run.format,
    ],
  );
  return row ? row.home_report_run_id : null;
}

/**
 * The (recipient, format) pairs a schedule's slot already has a run for.
 * @param {{query: Function}} db
 * @param {string} scheduleId
 * @param {Date} slot
 * @returns {Promise<Set<string>>}  "<user id>:<format>"
 */
async function slotTaken(db, scheduleId, slot) {
  // pagination:complete the runs of one slot: a recipient and format each, at most fifty
  const { rows } = await completeQuery(
    db,
    `SELECT recipient_user_id, format FROM home_report_run
      WHERE report_schedule_id = $1 AND scheduled_for = $2
      ORDER BY recipient_user_id, format`,
    [scheduleId, slot],
    { label: "runs of a slot", ceiling: 500 },
  );
  return new Set(rows.map((r) => `${r.recipient_user_id}:${r.format}`));
}

/**
 * A run with its report, as generating its file needs it, or null.
 * @param {{query: Function}} db
 * @param {string} id
 * @param {{lock?: boolean}} [opts]  lock: hold the run for the rest of the transaction
 */
function runToGenerate(db, id, { lock = false } = {}) {
  return one(
    db,
    `SELECT x.home_report_run_id, x.number::text AS number, x.saved_report_id, x.report_schedule_id, x.scheduled_for,
            x.recipient_user_id, x.requested_by, x.format, x.status, x.document_id, x.run_at,
            r.name AS report_name, r.report_key, r.definition, r.owner_user_id
       FROM home_report_run x
       JOIN saved_report r ON r.saved_report_id = x.saved_report_id
      WHERE x.home_report_run_id = $1${lock ? " FOR UPDATE OF x" : ""}`,
    [id],
  );
}

/** The run a generated document belongs to, or null. */
async function runOfDocument(db, documentId) {
  const row = await one(db, "SELECT home_report_run_id FROM home_report_run WHERE document_id = $1", [documentId]);
  return row ? row.home_report_run_id : null;
}

/**
 * Record the file a waiting run's file is being made as.
 * @returns {Promise<boolean>} false when the run is no longer waiting or already has one
 */
async function setRunDocument(db, id, documentId) {
  const { rowCount } = await db.query(
    `UPDATE home_report_run SET document_id = $2
      WHERE home_report_run_id = $1 AND status = 'pending' AND document_id IS NULL`,
    [id, documentId],
  );
  return rowCount === 1;
}

/**
 * Settle a waiting run: done, failed or skipped, with why when it is not done, and whether
 * its file was handed to the mailer.
 * @param {{query: Function}} db
 * @param {string} id
 * @param {{status: "done"|"failed"|"skipped", error?: string|null, emailed?: boolean}} outcome
 * @returns {Promise<{status: string, document_id: string|null}|null>} null when the run was not waiting
 */
function settleRun(db, id, { status, error = null, emailed = false }) {
  return one(
    db,
    `UPDATE home_report_run
        SET status = $2, error = $3, emailed_at = CASE WHEN $4::boolean THEN now() ELSE NULL END, finished_at = now()
      WHERE home_report_run_id = $1 AND status = 'pending'
      RETURNING status, document_id`,
    [id, status, error, emailed],
  );
}

/**
 * Who may open a run's file besides the CEO: its recipient and its report's owner.
 * @returns {Promise<{recipient_user_id: string, owner_user_id: string}|null>}
 */
function runReaders(db, runId) {
  return one(
    db,
    `SELECT x.recipient_user_id, r.owner_user_id
       FROM home_report_run x
       JOIN saved_report r ON r.saved_report_id = x.saved_report_id
      WHERE x.home_report_run_id = $1::uuid`,
    [runId],
  );
}

module.exports = {
  OVERVIEW,
  seenWhere,
  runSeenWhere,
  reportPage,
  reportById,
  overviewReportOf,
  counts,
  nameTaken,
  namesLike,
  insertReport,
  updateReport,
  lockOwner,
  archiveReport,
  saveSchedule,
  deleteSchedule,
  setScheduleState,
  dueSchedules,
  scheduleToFire,
  advanceSchedule,
  people,
  filterNames,
  runPage,
  runById,
  filesSince,
  pendingOnDemand,
  insertRun,
  slotTaken,
  runToGenerate,
  runOfDocument,
  setRunDocument,
  settleRun,
  runReaders,
};
