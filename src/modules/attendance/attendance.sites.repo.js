"use strict";
/**
 * Temporary sites and check-ins: the SQL (docs/guides/attendance.md §4, §6.11, §6.12). Writes only
 * attendance_temporary_site, its _location and _member rows, and attendance_check_in; reads
 * employee, the approval (workflow_instance, workflow_decision) and the exceptions a site's
 * approval covers. Never emits (BACKEND_GUIDE §2). Kept apart from attendance.repo.js, which the
 * clock's own SQL keeps.
 *
 * A Temporary Home's address is personal data: its line and point leave here as home_address,
 * home_latitude and home_longitude, and only when the caller says they may (`place`); a venue's
 * are address, latitude and longitude for every reader.
 */
const { pageQuery, orderBy, completeQuery, TOTAL_COL } = require("../../shared/http/paged");
const { scopeClause } = require("../../shared/rbac/scope");
const { personJson } = require("../../shared/db/person");
const approvers = require("../../shared/workflow/approvers");

const one = async (db, sql, params) => (await db.query(sql, params)).rows[0] || null;

/** Push a value and answer its placeholder. */
const bind = (params, value) => `$${params.push(value)}`;

const HOME = "'temporary_home'";

/** A `time` column as the contract's HH:MM, or null. */
const HHMM = (col) => `to_char(${col}, 'HH24:MI')`;

/**
 * Is `dateExpr` a day of an approved temporary site with its own hours that the employee in
 * `employeeCol` is still on (§6.11): every such day is worked, whatever the organisation's week says.
 */
const SITE_HOURS_DAY = (employeeCol, dateExpr) => `EXISTS (
  SELECT 1 FROM attendance_temporary_site sh
    JOIN attendance_temporary_site_member mh ON mh.temporary_site_id = sh.temporary_site_id
   WHERE mh.employee_id = ${employeeCol} AND mh.removed_at IS NULL AND sh.status = 'approved'
     AND sh.hours = 'site' AND sh.starts_on <= ${dateExpr} AND sh.ends_on >= ${dateExpr})`;

/** A site's addresses as JSON, in order; a Temporary Home's line and point only when `place` (a placeholder). */
const LOCATIONS = (alias, place) => `COALESCE((
  SELECT json_agg(json_build_object(
           'temporary_site_location_id', l.temporary_site_location_id, 'position', l.position, 'name', l.name,
           'address', CASE WHEN ${alias}.purpose <> ${HOME} THEN l.address END,
           'latitude', CASE WHEN ${alias}.purpose <> ${HOME} THEN l.latitude::float8 END,
           'longitude', CASE WHEN ${alias}.purpose <> ${HOME} THEN l.longitude::float8 END,
           'home_address', CASE WHEN ${alias}.purpose = ${HOME} AND ${place}::boolean THEN l.address END,
           'home_latitude', CASE WHEN ${alias}.purpose = ${HOME} AND ${place}::boolean THEN l.latitude::float8 END,
           'home_longitude', CASE WHEN ${alias}.purpose = ${HOME} AND ${place}::boolean THEN l.longitude::float8 END,
           'radius_m', l.radius_m, 'timezone', l.timezone) ORDER BY l.position)
    FROM attendance_temporary_site_location l WHERE l.temporary_site_id = ${alias}.temporary_site_id), '[]'::json)`;

/** Where a site stands on the date `today` (a placeholder), as the contract's TemporarySiteState. */
const STATE = (today) => `CASE WHEN s.status = 'submitted' THEN 'submitted'
  WHEN s.status <> 'approved' THEN s.status
  WHEN s.starts_on > ${today}::date THEN 'upcoming'
  WHEN s.ends_on < ${today}::date THEN 'done' ELSE 'in_progress' END`;

/** The order a list opens in: waiting, in progress, upcoming (soonest first), then the rest, newest first. */
const CURRENT = (today) => `CASE ${STATE(today)} WHEN 'submitted' THEN 0 WHEN 'in_progress' THEN 1 WHEN 'upcoming' THEN 2 ELSE 3 END,
  CASE WHEN ${STATE(today)} IN ('submitted', 'in_progress', 'upcoming') THEN s.starts_on END, s.starts_on DESC`;

const nameOf = (alias) => `btrim(${alias}.first_name || ' ' || ${alias}.last_name)`;

/* ------------------------------------------------------------------ *
 * The clock
 * ------------------------------------------------------------------ */

/** The address columns the clock judges with: never a reader's view. */
const CLOCK_LOCATIONS = `COALESCE((
  SELECT json_agg(json_build_object(
           'temporary_site_location_id', l.temporary_site_location_id, 'position', l.position, 'name', l.name,
           'address', l.address, 'latitude', l.latitude::float8, 'longitude', l.longitude::float8,
           'radius_m', l.radius_m, 'timezone', l.timezone) ORDER BY l.position)
    FROM attendance_temporary_site_location l WHERE l.temporary_site_id = s.temporary_site_id), '[]'::json)`;

/**
 * The approved site a person is still on for a work date, with its addresses (one a day, §6.11),
 * or null. A site still waiting changes nothing on the clock.
 */
function siteOn(db, employeeId, date) {
  return one(
    db,
    `SELECT s.temporary_site_id, s.number, s.name, s.purpose, s.starts_on::text AS starts_on, s.ends_on::text AS ends_on,
            s.hours, ${HHMM("s.starts_at")} AS starts_at, ${HHMM("s.ends_at")} AS ends_at,
            ${CLOCK_LOCATIONS} AS locations
       FROM attendance_temporary_site s
       JOIN attendance_temporary_site_member m ON m.temporary_site_id = s.temporary_site_id
      WHERE m.employee_id = $1 AND m.removed_at IS NULL AND s.status = 'approved'
        AND s.starts_on <= $2::date AND s.ends_on >= $2::date
      ORDER BY s.starts_on LIMIT 1`,
    [employeeId, date],
  );
}

/**
 * The approved sites a person is still on whose days touch `from`..`to`, each with its first
 * address's zone: at most a few (one a day), for the zone at an instant (attendance.sites.js zoneAt).
 */
async function sitesAround(db, employeeId, from, to) {
  // pagination:complete one site a day, so a three-day window holds at most three
  const { rows } = await completeQuery(
    db,
    `SELECT s.temporary_site_id, s.starts_on::text AS starts_on, s.ends_on::text AS ends_on,
            (SELECT l.timezone FROM attendance_temporary_site_location l
              WHERE l.temporary_site_id = s.temporary_site_id AND l.position = 1) AS timezone
       FROM attendance_temporary_site s
       JOIN attendance_temporary_site_member m ON m.temporary_site_id = s.temporary_site_id
      WHERE m.employee_id = $1 AND m.removed_at IS NULL AND s.status = 'approved'
        AND s.starts_on <= $3::date AND s.ends_on >= $2::date
      ORDER BY s.starts_on, s.temporary_site_id`,
    [employeeId, from, to],
    { label: "a person's temporary sites round a day", ceiling: 10 },
  );
  return rows;
}

/**
 * The name the register shows for a person's day on a site (§6.12), as SQL over an employee and a
 * date: at most one approved site covers a person's day (attendance.sites.js), read unpaged with min().
 */
const REGISTER_SITE = (employeeCol, dateExpr) => `(SELECT min(CASE WHEN rs.purpose = ${HOME} THEN 'Temporary Home' ELSE rs.name END)
     FROM attendance_temporary_site rs
     JOIN attendance_temporary_site_member rm ON rm.temporary_site_id = rs.temporary_site_id
    WHERE rm.employee_id = ${employeeCol} AND rm.removed_at IS NULL AND rs.status = 'approved'
      AND rs.starts_on <= ${dateExpr} AND rs.ends_on >= ${dateExpr})`;

/* ------------------------------------------------------------------ *
 * Writing a site
 * ------------------------------------------------------------------ */

/** The people a site is for, as the checks read them: employed, started, their name. */
async function peopleOf(db, employeeIds) {
  // pagination:complete at most 25 people a site, each checked
  const { rows } = await completeQuery(
    db,
    `SELECT e.employee_id, e.status, e.start_date::text AS start_date, e.left_on::text AS left_on, ${nameOf("e")} AS display_name
       FROM employee e WHERE e.employee_id = ANY($1::uuid[])
      ORDER BY e.employee_id`,
    [employeeIds],
    { label: "a temporary site's people", ceiling: 25 },
  );
  return rows;
}

/** Someone of `employeeIds` already on a site waiting or approved that shares a day with `from`..`to`. */
function overlappingSite(db, employeeIds, from, to) {
  return one(
    db,
    `SELECT m.employee_id, ${nameOf("e")} AS display_name, s.number
       FROM attendance_temporary_site_member m
       JOIN attendance_temporary_site s ON s.temporary_site_id = m.temporary_site_id
       JOIN employee e ON e.employee_id = m.employee_id
      WHERE m.employee_id = ANY($1::uuid[]) AND m.removed_at IS NULL AND s.status IN ('submitted', 'approved')
        AND s.starts_on <= $3::date AND s.ends_on >= $2::date
      ORDER BY s.starts_on, m.employee_id LIMIT 1`,
    [employeeIds, from, to],
  );
}

function insertSite(client, x) {
  return one(
    client,
    `INSERT INTO attendance_temporary_site
       (number, purpose, name, description, starts_on, ends_on, hours, starts_at, ends_at,
        status, submitted_by, approved_at, approved_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, CASE WHEN $10 = 'approved' THEN now() END, $12)
     RETURNING temporary_site_id`,
    [
      x.number, x.purpose, x.name, x.description, x.starts_on, x.ends_on,
      x.hours, x.hours === "site" ? x.starts_at : null, x.hours === "site" ? x.ends_at : null,
      x.status, x.submitted_by, x.approved_by || null,
    ],
  );
}

function insertLocation(client, x) {
  return client.query(
    `INSERT INTO attendance_temporary_site_location
       (temporary_site_location_id, temporary_site_id, position, name, place_id, address, latitude, longitude, radius_m, timezone)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [x.id, x.temporary_site_id, x.position, x.name || null, x.place_id, x.address, x.latitude, x.longitude, x.radius_m, x.timezone],
  );
}

function insertMembers(client, siteId, employeeIds) {
  return client.query(
    `INSERT INTO attendance_temporary_site_member (temporary_site_id, employee_id)
     SELECT $1, x FROM unnest($2::uuid[]) AS x`,
    [siteId, employeeIds],
  );
}

function setWorkflow(client, id, workflowInstanceId) {
  return client.query("UPDATE attendance_temporary_site SET workflow_instance_id = $2 WHERE temporary_site_id = $1", [
    id,
    workflowInstanceId,
  ]);
}

/** A site's own columns and who is or was on it (sorted); locked when `forUpdate`. */
function getSite(db, id, { forUpdate = false } = {}) {
  return one(
    db,
    `SELECT s.temporary_site_id, s.number, s.purpose, s.name, s.starts_on::text AS starts_on, s.ends_on::text AS ends_on,
            s.status, s.submitted_by, s.workflow_instance_id, s.approved_by,
            ARRAY(SELECT m.employee_id FROM attendance_temporary_site_member m
                   WHERE m.temporary_site_id = s.temporary_site_id AND m.removed_at IS NULL
                   ORDER BY m.employee_id) AS active_ids,
            ARRAY(SELECT m.employee_id FROM attendance_temporary_site_member m
                   WHERE m.temporary_site_id = s.temporary_site_id ORDER BY m.employee_id) AS member_ids
       FROM attendance_temporary_site s WHERE s.temporary_site_id = $1${forUpdate ? " FOR UPDATE OF s" : ""}`,
    [id],
  );
}

/** Copy an approval's outcome onto a site still waiting; null when it was not waiting. */
function settleSite(client, id, status, by) {
  return one(
    client,
    `UPDATE attendance_temporary_site
        SET status = $2,
            approved_at = CASE WHEN $2 = 'approved' THEN now() ELSE approved_at END,
            approved_by = CASE WHEN $2 = 'approved' THEN $3::uuid ELSE approved_by END,
            cancelled_at = CASE WHEN $2 = 'withdrawn' THEN now() ELSE cancelled_at END
      WHERE temporary_site_id = $1 AND status = 'submitted'
      RETURNING temporary_site_id`,
    [id, status, by || null],
  );
}

/** Close a site from `from` (its status) to `to`, with who and why; null when it was not `from`. */
function closeSite(client, id, from, to, userId, reason) {
  return one(
    client,
    `UPDATE attendance_temporary_site
        SET status = $3, cancelled_at = now(), cancelled_by = $4, cancel_reason = $5
      WHERE temporary_site_id = $1 AND status = $2
      RETURNING temporary_site_id`,
    [id, from, to, userId, reason],
  );
}

/** Take one person off; null when they were not on it. */
function removeMember(client, id, employeeId, userId, reason) {
  return one(
    client,
    `UPDATE attendance_temporary_site_member SET removed_at = now(), removed_by = $3, removed_reason = $4
      WHERE temporary_site_id = $1 AND employee_id = $2 AND removed_at IS NULL
      RETURNING employee_id`,
    [id, employeeId, userId, reason],
  );
}

/** Who approved an approval last, from its decisions: the login a site's approval is credited to. */
async function lastApprover(db, workflowInstanceId) {
  if (!workflowInstanceId) return null;
  const r = await one(
    db,
    `SELECT d.actor_id FROM workflow_decision d
      WHERE d.workflow_instance_id = $1 AND d.decision IN ('approve', 'timeout_approve') AND d.actor_id IS NOT NULL
      ORDER BY d.decided_at DESC, d.workflow_decision_id DESC LIMIT 1`,
    [workflowInstanceId],
  );
  return r ? r.actor_id : null;
}

/**
 * The open location flags a site's approval may cover (§6.11): a person still on it, a day of it,
 * and a reading (the punch's or the check-in's point). Whether the point falls inside an address is
 * shared/geo's to say, in attendance.sites.js.
 */
async function coverableExceptions(db, siteId) {
  // pagination:complete the approval settles every flag it covers, not a page of them
  const { rows } = await completeQuery(
    db,
    `SELECT x.attendance_exception_id, x.exception_type, ad.employee_id, ad.attendance_date::text AS work_date,
            COALESCE(ev.latitude, ci.latitude)::float8 AS latitude, COALESCE(ev.longitude, ci.longitude)::float8 AS longitude
       FROM attendance_exception x
       JOIN attendance_day ad ON ad.attendance_day_id = x.attendance_day_id
       JOIN attendance_temporary_site s ON s.temporary_site_id = $1
       JOIN attendance_temporary_site_member m
         ON m.temporary_site_id = s.temporary_site_id AND m.employee_id = ad.employee_id AND m.removed_at IS NULL
       LEFT JOIN attendance_event ev ON ev.attendance_event_id = x.attendance_event_id
       LEFT JOIN attendance_check_in ci ON ci.attendance_check_in_id = x.attendance_check_in_id
      WHERE x.status = 'open'
        AND x.exception_type IN ('outside_worksite', 'outside_home', 'location_unverified')
        AND ad.attendance_date BETWEEN s.starts_on AND s.ends_on
        AND COALESCE(ev.latitude, ci.latitude) IS NOT NULL
      ORDER BY ad.attendance_date, x.attendance_exception_id`,
    [siteId],
    { label: "the flags a temporary site covers", ceiling: 5000 },
  );
  return rows;
}

/** The addresses a covered flag is judged against: every point and radius, never a reader's view. */
async function locationsOf(db, siteId) {
  // pagination:complete at most eight addresses a site
  const { rows } = await completeQuery(
    db,
    `SELECT l.temporary_site_location_id, l.position, l.latitude::float8 AS latitude, l.longitude::float8 AS longitude, l.radius_m
       FROM attendance_temporary_site_location l WHERE l.temporary_site_id = $1 ORDER BY l.position`,
    [siteId],
    { label: "a temporary site's addresses", ceiling: 8 },
  );
  return rows;
}

/* ------------------------------------------------------------------ *
 * Reading sites
 * ------------------------------------------------------------------ */

/**
 * Sites as the screens read them.
 *   today     the date states are worked out on (Lagos)
 *   place     whether a Temporary Home's line and point travel (its own people, its submitter, scope all)
 *   reader    People's lists: { user, approves } works out whether the stage waits on the reader
 *   changer   the reader's `people` approve scope and employee: may cancel or take someone off
 *   userId    the reader's login: may withdraw what they submitted while it waits
 */
async function siteSelect(db, params, { today, place, reader = null, changer = null, userId = null }) {
  const t = bind(params, today);
  const p = bind(params, Boolean(place));
  let canDecide = "false";
  if (reader && reader.approves) {
    const roleCodes = await approvers.roleCodesOf(db, reader.user.role_ids || []);
    canDecide = `(wi.state = 'pending' AND ${approvers.waitingOnClause("wi", reader.user, roleCodes, params)})`;
  }
  let canChange = "false";
  if (changer && changer.scope === "all") {
    const me = bind(params, changer.employee_id || null);
    canChange = `(s.status IN ('submitted', 'approved') AND s.ends_on >= ${t}::date
      AND NOT EXISTS (SELECT 1 FROM attendance_temporary_site_member mc
                       WHERE mc.temporary_site_id = s.temporary_site_id AND mc.removed_at IS NULL
                         AND mc.employee_id = ${me}::uuid))`;
  }
  const canWithdraw = userId ? `(s.status = 'submitted' AND s.submitted_by = ${bind(params, userId)}::uuid)` : "false";
  return {
    today: t,
    sql: `SELECT s.temporary_site_id, s.number, s.purpose, s.name, s.description, s.starts_on, s.ends_on,
            (s.ends_on - s.starts_on + 1)::int AS days,
            s.hours, ${HHMM("s.starts_at")} AS starts_at, ${HHMM("s.ends_at")} AS ends_at,
            s.status, ${STATE(t)} AS state,
            ${LOCATIONS("s", p)} AS locations,
            COALESCE((
              SELECT json_agg(json_build_object('employee', ${personJson("me", "md")}, 'added_at', m.added_at,
                       'removed_at', m.removed_at, 'removed_reason', m.removed_reason)
                       ORDER BY m.removed_at NULLS FIRST, me.last_name, me.first_name)
                FROM attendance_temporary_site_member m
                JOIN employee me ON me.employee_id = m.employee_id
                LEFT JOIN department md ON md.department_id = me.department_id
               WHERE m.temporary_site_id = s.temporary_site_id), '[]'::json) AS members,
            (SELECT count(*)::int FROM attendance_temporary_site_member mp
              WHERE mp.temporary_site_id = s.temporary_site_id AND mp.removed_at IS NULL) AS people,
            (SELECT ${nameOf("ue")} FROM app_user u JOIN employee ue ON ue.employee_id = u.employee_id
              WHERE u.user_id = s.submitted_by) AS submitted_by_name,
            s.created_at AS submitted_at, s.workflow_instance_id,
            CASE WHEN wi.state = 'pending' THEN (
              SELECT min(st ->> 'name') FROM workflow_definition wd, jsonb_array_elements(wd.stages) st
               WHERE wd.workflow_definition_id = wi.workflow_definition_id AND st ->> 'key' = wi.current_stage
            ) END AS waiting_on,
            s.approved_at,
            (SELECT ${nameOf("ae")} FROM app_user au JOIN employee ae ON ae.employee_id = au.employee_id
              WHERE au.user_id = s.approved_by) AS approved_by_name,
            s.cancelled_at, s.cancel_reason,
            ${canDecide} AS can_decide, ${canChange} AS can_change, ${canWithdraw} AS can_withdraw`,
  };
}

const SITE_FROM = `
       FROM attendance_temporary_site s
       LEFT JOIN workflow_instance wi ON wi.workflow_instance_id = s.workflow_instance_id`;

/** Matches the number, the name or anyone on it, never an address (`q`, a placeholder). */
const SEARCH = (q) => `(${q}::text IS NULL OR search_fold(s.number || ' ' || s.name || ' ' || COALESCE((
  SELECT string_agg(mq.first_name || ' ' || mq.last_name || ' ' || COALESCE(mq.preferred_name, ''), ' ')
    FROM attendance_temporary_site_member mm JOIN employee mq ON mq.employee_id = mm.employee_id
   WHERE mm.temporary_site_id = s.temporary_site_id), '')) LIKE '%' || search_fold(${q}::text) || '%')`;

/**
 * A page of sites: with anyone in `scope` on them, or once on them (People's), or the person's own
 * (`mine`: those they submitted or are or were on). Waiting and current first.
 */
async function listSites(db, query, scope, opts) {
  const params = [];
  const { sql, today } = await siteSelect(db, params, opts);
  const status = bind(params, query.status || null);
  const state = bind(params, query.state || null);
  const purpose = bind(params, query.purpose || null);
  const employee = bind(params, query.employee_id || null);
  const q = bind(params, query.q || null);
  let who;
  if (opts.mine) {
    const u = bind(params, opts.mine.user_id);
    const e = bind(params, opts.mine.employee_id || null);
    who = `AND (s.submitted_by = ${u}::uuid OR EXISTS (SELECT 1 FROM attendance_temporary_site_member mv
                  WHERE mv.temporary_site_id = s.temporary_site_id AND mv.employee_id = ${e}::uuid))`;
  } else {
    const s = scopeClause(scope, { column: "mv.employee_id" }, params);
    who = `AND EXISTS (SELECT 1 FROM attendance_temporary_site_member mv
                        WHERE mv.temporary_site_id = s.temporary_site_id ${s.and})`;
  }
  const sorts = { current: CURRENT(today), starts_on: "s.starts_on" };
  return pageQuery(
    db,
    `${sql}, ${TOTAL_COL}
     ${SITE_FROM}
      WHERE (${status}::text IS NULL OR s.status = ${status}::text)
        AND (${state}::text IS NULL OR ${STATE(today)} = ${state}::text)
        AND (${purpose}::text IS NULL OR s.purpose = ${purpose}::text)
        AND (${employee}::uuid IS NULL OR EXISTS (SELECT 1 FROM attendance_temporary_site_member mf
                                                   WHERE mf.temporary_site_id = s.temporary_site_id
                                                     AND mf.employee_id = ${employee}::uuid))
        AND ${SEARCH(q)}
        ${who}
      ORDER BY ${orderBy(query, sorts, "s.temporary_site_id")}`,
    params,
    query,
  );
}

/** One site as a screen reads it (the caller checked who may see it). */
async function siteRow(db, id, opts) {
  const params = [];
  const { sql } = await siteSelect(db, params, opts);
  const at = bind(params, id);
  return one(db, `${sql} ${SITE_FROM} WHERE s.temporary_site_id = ${at}::uuid`, params);
}

/** Whether anyone in `scope` is or was on a site (People's reads). */
async function inScope(db, id, scope) {
  const params = [id];
  const s = scopeClause(scope, { column: "m.employee_id" }, params);
  const r = await one(
    db,
    `SELECT 1 AS ok FROM attendance_temporary_site_member m WHERE m.temporary_site_id = $1 ${s.and} LIMIT 1`,
    params,
  );
  return Boolean(r);
}

/* ------------------------------------------------------------------ *
 * Check-ins (attendance.check-ins.js)
 * ------------------------------------------------------------------ */

/**
 * A check-in as the contract's CheckIn; `place` (a placeholder) says whether a Temporary Home's line
 * travels. No point ever leaves.
 */
const CHECK_IN = (place) => `c.attendance_check_in_id, c.work_date, c.occurred_at, c.temporary_site_location_id, l.position,
  COALESCE(l.name, CASE WHEN cs.purpose = ${HOME} THEN 'Temporary Home'
    WHEN NOT EXISTS (SELECT 1 FROM attendance_temporary_site_location lx
                      WHERE lx.temporary_site_id = cs.temporary_site_id AND lx.position > 1) THEN cs.name
    ELSE 'Address ' || l.position END) AS location_name,
  CASE WHEN cs.purpose <> ${HOME} THEN l.address END AS address,
  CASE WHEN cs.purpose = ${HOME} AND ${place}::boolean THEN l.address END AS home_address,
  c.distance_m::float8 AS distance_m, c.accuracy_m::float8 AS accuracy_m, c.verdict,
  c.evidence ->> 'reason' AS location_reason,
  EXISTS (SELECT 1 FROM attendance_exception cx WHERE cx.attendance_check_in_id = c.attendance_check_in_id) AS flagged`;

const CHECK_IN_FROM = `
  FROM attendance_check_in c
  JOIN attendance_temporary_site_location l ON l.temporary_site_location_id = c.temporary_site_location_id
  JOIN attendance_temporary_site cs ON cs.temporary_site_id = l.temporary_site_id`;

/** The check-in an idempotency key already made, or null. */
function checkInByKey(db, employeeId, key) {
  return one(db, `SELECT ${CHECK_IN("true")} ${CHECK_IN_FROM} WHERE c.employee_id = $1 AND c.idempotency_key = $2`, [
    employeeId,
    key,
  ]);
}

/** A check-in by its id, as its person reads it. */
function checkInRow(db, id) {
  return one(db, `SELECT ${CHECK_IN("true")} ${CHECK_IN_FROM} WHERE c.attendance_check_in_id = $1`, [id]);
}

/** How many check-ins a person made on a work date. */
async function countOn(db, employeeId, date) {
  const r = await one(
    db,
    "SELECT count(*)::int AS n FROM attendance_check_in WHERE employee_id = $1 AND work_date = $2::date",
    [employeeId, date],
  );
  return r ? r.n : 0;
}

/** The latest check-in at an address since an instant, or null: a second press within 5 minutes answers it. */
function recentAt(db, employeeId, locationId, since) {
  return one(
    db,
    `SELECT ${CHECK_IN("true")} ${CHECK_IN_FROM}
      WHERE c.employee_id = $1 AND c.temporary_site_location_id = $2 AND c.occurred_at >= $3
      ORDER BY c.occurred_at DESC LIMIT 1`,
    [employeeId, locationId, since],
  );
}

async function insertCheckIn(client, x) {
  const row = await one(
    client,
    `INSERT INTO attendance_check_in
       (employee_id, work_date, occurred_at, device_at, latitude, longitude, accuracy_m, temporary_site_location_id,
        distance_m, verdict, evidence, policy_version_id, idempotency_key, request_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13, $14)
     RETURNING attendance_check_in_id`,
    [
      x.employee_id,
      x.work_date,
      x.occurred_at,
      x.device_at || null,
      x.latitude ?? null,
      x.longitude ?? null,
      x.accuracy_m ?? null,
      x.temporary_site_location_id,
      x.distance_m ?? null,
      x.verdict,
      JSON.stringify(x.evidence || {}),
      x.policy_version_id || null,
      x.idempotency_key,
      x.request_id || null,
    ],
  );
  return row.attendance_check_in_id;
}

/** A person's check-ins on a day, in time order: at most 20, for today's panel. */
async function checkInsOn(db, employeeId, date) {
  // pagination:complete at most 20 check-ins a day (CHECK_IN_LIMIT), all on the panel
  const { rows } = await completeQuery(
    db,
    `SELECT ${CHECK_IN("true")} ${CHECK_IN_FROM}
      WHERE c.employee_id = $1 AND c.work_date = $2::date
      ORDER BY c.occurred_at, c.attendance_check_in_id`,
    [employeeId, date],
    { label: "a day's check-ins", ceiling: 20 },
  );
  return rows;
}

/** A page of one person's check-ins on a day, in time order; a Temporary Home's line when `place`. */
function listCheckIns(db, employeeId, date, query, { place }) {
  return pageQuery(
    db,
    `SELECT ${CHECK_IN("$3")}, ${TOTAL_COL} ${CHECK_IN_FROM}
      WHERE c.employee_id = $1 AND c.work_date = $2::date
      ORDER BY c.occurred_at, c.attendance_check_in_id`,
    [employeeId, date, Boolean(place)],
    query,
  );
}

/** Where a site's address keeps its readable line (shared/places/owners.js). */
const ADDRESS_LINE = {
  "attendance_temporary_site_location.address":
    "UPDATE attendance_temporary_site_location SET address = $2 WHERE temporary_site_location_id = $1",
};

/** Rewrite one address's line (a place named by the places-name job, F27). */
function renameAddress(client, owner, key, line) {
  return client.query(ADDRESS_LINE[owner], [key, line]);
}

module.exports = {
  HOME,
  SITE_HOURS_DAY,
  REGISTER_SITE,
  ADDRESS_LINE,
  renameAddress,
  siteOn,
  sitesAround,
  peopleOf,
  overlappingSite,
  insertSite,
  insertLocation,
  insertMembers,
  setWorkflow,
  getSite,
  settleSite,
  closeSite,
  removeMember,
  lastApprover,
  coverableExceptions,
  locationsOf,
  listSites,
  siteRow,
  inScope,
  checkInByKey,
  checkInRow,
  countOn,
  recentAt,
  insertCheckIn,
  checkInsOn,
  listCheckIns,
};
