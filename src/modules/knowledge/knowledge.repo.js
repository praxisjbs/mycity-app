"use strict";
/**
 * The SOPs' SQL (docs/guides/knowledge.md §4). Reads and writes sop, sop_version and sop_step;
 * nothing else writes them.
 *
 * The version in force is an SOP's newest published version. A reader sees active SOPs with one;
 * a writer of a department (its head, or `sops.manage`) also sees that department's drafts and
 * archived SOPs (§6.2, §6.3). Who may write is worked out by the service and passed in as
 * `reach`: `{ all: true }`, or the department ids the reader heads.
 */
const { pageQuery, orderBy, TOTAL_COL } = require("../../shared/http/paged");

const one = async (db, sql, params) => (await db.query(sql, params)).rows[0] || null;

/** Who a user column names. */
const NAME_OF = (userCol) => `(SELECT btrim(ne.first_name || ' ' || ne.last_name) FROM app_user nu
   JOIN employee ne ON ne.employee_id = nu.employee_id WHERE nu.user_id = ${userCol})`;
/** Version `iv` of SOP `s` is its version in force: published, with no later one. */
const IN_FORCE = (s, iv) => `${iv}.sop_id = ${s}.sop_id AND ${iv}.status = 'published'
   AND NOT EXISTS (SELECT 1 FROM sop_version nv WHERE nv.sop_id = ${s}.sop_id AND nv.status = 'published' AND nv.version > ${iv}.version)`;

const SOP = `s.sop_id, s.number::text AS number, s.department_id, d.name AS department_name, s.title, s.status,
       s.archived_at, s.archive_reason, s.created_at, s.updated_at`;

const VERSION = `v.sop_version_id, v.sop_id, v.status, v.version, v.title, v.purpose, v.scope, v.roles, v.note,
       v.content_hash, v.published_at, v.updated_at, ${NAME_OF("v.published_by")} AS published_by_name,
       ${NAME_OF("COALESCE(v.updated_by, v.created_by)")} AS updated_by_name`;

/* ------------------------------------------------------------------ *
 * One SOP
 * ------------------------------------------------------------------ */

/** One change to an SOP at a time: a draft saved or discarded, a publication, an archive. */
function lock(client, sopId) {
  return client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`sop:${sopId}`]);
}

function getSop(db, id) {
  return one(db, `SELECT ${SOP} FROM sop s JOIN department d ON d.department_id = s.department_id WHERE s.sop_id = $1`, [id]);
}

function insertSop(client, { number, department_id: departmentId, title, userId }) {
  return one(
    client,
    `INSERT INTO sop (number, department_id, title, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $4)
     RETURNING sop_id`,
    [number, departmentId, title, userId],
  );
}

/** The title the list shows: the version in force's, or the draft's before the first one. */
function renameSop(client, sopId, title, userId) {
  return client.query("UPDATE sop SET title = $2, updated_by = $3 WHERE sop_id = $1 AND title IS DISTINCT FROM $2", [sopId, title, userId]);
}

/** A publication moves the SOP's Updated, whatever its title. */
function touchSop(client, sopId, title, userId) {
  return client.query("UPDATE sop SET title = $2, updated_by = $3, updated_at = now() WHERE sop_id = $1", [sopId, title, userId]);
}

function archiveSop(client, sopId, { reason, userId }) {
  return one(
    client,
    `UPDATE sop SET status = 'archived', archived_at = now(), archived_by = $2, archive_reason = $3, updated_by = $2
      WHERE sop_id = $1 AND status = 'active'
      RETURNING sop_id`,
    [sopId, userId, reason],
  );
}

/* ------------------------------------------------------------------ *
 * Versions and steps
 * ------------------------------------------------------------------ */

/** The SOP's draft, or null. */
function draftOf(db, sopId) {
  return one(db, `SELECT ${VERSION} FROM sop_version v WHERE v.sop_id = $1 AND v.status = 'draft'`, [sopId]);
}

/** The version in force: the newest published one, or null. */
function inForceOf(db, sopId) {
  return one(
    db,
    `SELECT ${VERSION} FROM sop_version v WHERE v.sop_id = $1 AND v.status = 'published' ORDER BY v.version DESC LIMIT 1`,
    [sopId],
  );
}

/** One published version, with its SOP's number, department and state. */
function publishedVersion(db, versionId) {
  return one(
    db,
    `SELECT ${VERSION}, s.number::text AS number, s.department_id, d.name AS department_name, s.status AS sop_status
       FROM sop_version v
       JOIN sop s ON s.sop_id = v.sop_id
       JOIN department d ON d.department_id = s.department_id
      WHERE v.sop_version_id = $1 AND v.status = 'published'`,
    [versionId],
  );
}

/** The steps of some versions, in order, each with its file's name. At most 50 a version. */
async function stepsOf(db, versionIds) {
  if (!versionIds.length) return [];
  const { rows } = await db.query(
    `SELECT st.sop_version_id, st.position, st.text, st.who, st.screen_key, st.document_id,
            doc.original_name AS document_name
       FROM sop_step st
       LEFT JOIN document doc ON doc.document_id = st.document_id
      WHERE st.sop_version_id = ANY($1::uuid[])
      ORDER BY st.sop_version_id, st.position`,
    [versionIds],
  );
  return rows;
}

function insertDraft(client, sopId, fields, userId) {
  return one(
    client,
    `INSERT INTO sop_version (sop_id, status, title, purpose, scope, roles, created_by, updated_by)
     VALUES ($1, 'draft', $2, $3, $4, $5, $6, $6)
     RETURNING sop_version_id`,
    [sopId, fields.title, fields.purpose, fields.scope, fields.roles, userId],
  );
}

function updateDraft(client, versionId, fields, userId) {
  return one(
    client,
    `UPDATE sop_version SET title = $2, purpose = $3, scope = $4, roles = $5, updated_by = $6, updated_at = now()
      WHERE sop_version_id = $1 AND status = 'draft'
      RETURNING sop_version_id`,
    [versionId, fields.title, fields.purpose, fields.scope, fields.roles, userId],
  );
}

/** A draft's steps written whole, in order. */
async function replaceSteps(client, versionId, steps) {
  await client.query("DELETE FROM sop_step WHERE sop_version_id = $1", [versionId]);
  if (!steps.length) return;
  await client.query(
    `INSERT INTO sop_step (sop_version_id, position, text, who, screen_key, document_id)
     SELECT $1, x.position, x.text, x.who, x.screen_key, x.document_id
       FROM jsonb_to_recordset($2::jsonb) AS x(position int, text text, who text, screen_key text, document_id uuid)`,
    [versionId, JSON.stringify(steps.map((s, i) => ({ position: i + 1, text: s.text, who: s.who, screen_key: s.screen_key, document_id: s.document_id })))],
  );
}

/** Discard: its steps go with it (ON DELETE CASCADE). */
async function deleteDraft(client, versionId) {
  const r = await client.query("DELETE FROM sop_version WHERE sop_version_id = $1 AND status = 'draft'", [versionId]);
  return r.rowCount === 1;
}

/** The next version number: one past every number this SOP has used. */
async function nextVersion(client, sopId) {
  const r = await one(client, "SELECT COALESCE(max(version), 0) + 1 AS n FROM sop_version WHERE sop_id = $1", [sopId]);
  return Number(r.n);
}

function publish(client, versionId, { version, note, contentHash, userId }) {
  return one(
    client,
    `UPDATE sop_version
        SET status = 'published', version = $2, note = $3, content_hash = $4, published_at = now(), published_by = $5,
            updated_by = $5, updated_at = now()
      WHERE sop_version_id = $1 AND status = 'draft'
      RETURNING sop_version_id, published_at`,
    [versionId, version, note, contentHash, userId],
  );
}

/* ------------------------------------------------------------------ *
 * Lists
 * ------------------------------------------------------------------ */

/** The sortable fields of SopListQuery; with none asked, by department, then title. */
const SORTS = { title: "s.title", number: "s.number", updated_at: "s.updated_at" };
const BY_DEPARTMENT = "d.name, s.title, s.sop_id";

const ROW = `s.sop_id, s.number::text AS number, s.title, s.department_id, d.name AS department_name, s.status,
       iv.version, EXISTS (SELECT 1 FROM sop_version dv WHERE dv.sop_id = s.sop_id AND dv.status = 'draft') AS has_draft,
       s.updated_at`;

/** The departments a writer may see drafts and archived SOPs of: every one, or those they head. */
function writable(reach, params, column) {
  if (reach.all) return "TRUE";
  params.push(reach.departments);
  return `${column} = ANY($${params.length}::uuid[])`;
}

/**
 * GET /knowledge/sops: published SOPs for everyone; under Draft (an SOP with a draft) and Archived,
 * only those of the departments the reader may write.
 */
function list(db, query, reach) {
  const params = [query.department_id ?? null, query.q ?? null];
  const state = query.state || "published";
  let where;
  if (state === "archived") where = `s.status = 'archived' AND ${writable(reach, params, "s.department_id")}`;
  else if (state === "draft")
    where = `s.status = 'active' AND EXISTS (SELECT 1 FROM sop_version dv WHERE dv.sop_id = s.sop_id AND dv.status = 'draft')
             AND ${writable(reach, params, "s.department_id")}`;
  else where = "s.status = 'active' AND iv.version IS NOT NULL";
  return pageQuery(
    db,
    `SELECT ${ROW}, ${TOTAL_COL}
       FROM sop s
       JOIN department d ON d.department_id = s.department_id
       LEFT JOIN sop_version iv ON ${IN_FORCE("s", "iv")}
      WHERE ${where}
        AND ($1::uuid IS NULL OR s.department_id = $1)
        AND ($2::text IS NULL OR search_fold(s.title) LIKE '%' || search_fold($2) || '%'
             OR search_fold(s.number::text) LIKE '%' || search_fold($2) || '%')
      ORDER BY ${query.sort ? orderBy(query, SORTS, "s.sop_id") : BY_DEPARTMENT}`,
    params,
    query,
  );
}

/** GET /knowledge/sops/for-screen: active SOPs a step of whose version in force names the screen. */
function forScreen(db, query) {
  return pageQuery(
    db,
    `SELECT ${ROW}, ${TOTAL_COL}
       FROM sop s
       JOIN department d ON d.department_id = s.department_id
       JOIN sop_version iv ON ${IN_FORCE("s", "iv")}
      WHERE s.status = 'active'
        AND EXISTS (SELECT 1 FROM sop_step st WHERE st.sop_version_id = iv.sop_version_id AND st.screen_key = $1)
        AND ($2::text IS NULL OR search_fold(s.title) LIKE '%' || search_fold($2) || '%')
      ORDER BY ${BY_DEPARTMENT}`,
    [query.screen_key, query.q ?? null],
    query,
  );
}

/** GET /knowledge/sops/:id/versions: its published versions, newest first. */
function versions(db, sopId, query) {
  return pageQuery(
    db,
    `SELECT v.sop_version_id, v.version, v.title, v.note, v.published_at, ${NAME_OF("v.published_by")} AS published_by_name,
            ${TOTAL_COL}
       FROM sop_version v
      WHERE v.sop_id = $1 AND v.status = 'published'
      ORDER BY v.version DESC, v.sop_version_id`,
    [sopId],
    query,
  );
}

/**
 * GET /knowledge/sops/departments: the departments with an SOP the reader may read (the chips), or
 * with `writable` the active ones they may write for (New SOP's Department).
 */
function departments(db, query, reach) {
  const params = [query.q ?? null];
  let where;
  if (query.writable === "true") where = `d.active AND ${writable(reach, params, "d.department_id")}`;
  else
    where = `EXISTS (SELECT 1 FROM sop s
                 LEFT JOIN sop_version iv ON ${IN_FORCE("s", "iv")}
                WHERE s.department_id = d.department_id
                  AND ((s.status = 'active' AND iv.version IS NOT NULL) OR ${writable(reach, params, "s.department_id")}))`;
  return pageQuery(
    db,
    `SELECT d.department_id, d.name, ${TOTAL_COL}
       FROM department d
      WHERE ${where}
        AND ($1::text IS NULL OR search_fold(d.name) LIKE '%' || search_fold($1) || '%')
      ORDER BY d.name, d.department_id`,
    params,
    query,
  );
}

/* ------------------------------------------------------------------ *
 * Departments and their heads
 * ------------------------------------------------------------------ */

function department(db, id) {
  return one(db, "SELECT department_id, name, active FROM department WHERE department_id = $1", [id]);
}

/** The departments a person heads now: as its head, or in its filled head seat (§6.2). */
async function headedBy(db, employeeId) {
  if (!employeeId) return [];
  const { rows } = await db.query(
    `SELECT d.department_id
       FROM department d
       LEFT JOIN org_seat s ON s.org_seat_id = d.head_seat_id
      WHERE d.head_employee_id = $1 OR (d.head_employee_id IS NULL AND s.status = 'filled' AND s.filled_by_employee_id = $1)`,
    [employeeId],
  );
  return rows.map((r) => r.department_id);
}

/** The logins of a department's members at work today (Lagos): whom a new version is told to. */
async function departmentUsers(db, departmentId) {
  const { rows } = await db.query(
    `SELECT u.user_id
       FROM employee e
       JOIN app_user u ON u.employee_id = e.employee_id AND u.status = 'active'
      WHERE e.department_id = $1 AND e.status = 'active'
        AND (e.start_date IS NULL OR e.start_date <= (now() AT TIME ZONE 'Africa/Lagos')::date)
        AND (e.left_on IS NULL OR e.left_on > (now() AT TIME ZONE 'Africa/Lagos')::date)`,
    [departmentId],
  );
  return rows.map((r) => r.user_id);
}

module.exports = {
  lock,
  getSop,
  insertSop,
  renameSop,
  touchSop,
  archiveSop,
  draftOf,
  inForceOf,
  publishedVersion,
  stepsOf,
  insertDraft,
  updateDraft,
  replaceSteps,
  deleteDraft,
  nextVersion,
  publish,
  list,
  forScreen,
  versions,
  departments,
  department,
  headedBy,
  departmentUsers,
  SORTS,
};
