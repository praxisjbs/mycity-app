"use strict";
/**
 * Worksites: the SQL. Writes only worksite; reads employee for who is assigned (the
 * assignment itself is written by the organisation service). Never emits.
 *
 * `address` is jsonb ({ text }) in the table and a line of text on the wire.
 */
const { pageQuery, orderBy, TOTAL_COL } = require("../../shared/http/paged");
const { scopeClause } = require("../../shared/rbac/scope");
const { photoUrlSql } = require("../../shared/db/person");

const one = async (db, sql, params) => (await db.query(sql, params)).rows[0] || null;

const ROW = `
  w.worksite_id, w.code::text AS code, w.name, NULLIF(w.address ->> 'text', '') AS address,
  w.latitude::float8 AS latitude, w.longitude::float8 AS longitude, w.radius_m, w.timezone, w.active,
  (SELECT count(*)::int FROM employee e
    WHERE e.worksite_id = w.worksite_id AND e.status = 'active') AS assigned_count,
  w.created_at, w.updated_at`;

const SORTS = { name: "w.name", created_at: "w.created_at" };

function list(db, query) {
  const params = [query.active === undefined ? null : query.active, query.q || null];
  return pageQuery(
    db,
    `SELECT ${ROW}, ${TOTAL_COL}
       FROM worksite w
      WHERE ($1::boolean IS NULL OR w.active = $1)
        AND ($2::text IS NULL OR search_fold(w.name || ' ' || w.code || ' ' || COALESCE(w.address ->> 'text', ''))
                                 LIKE '%' || search_fold($2) || '%')
      ORDER BY ${orderBy(query, SORTS, "w.worksite_id")}`,
    params,
    query,
  );
}

const get = (db, id) => one(db, `SELECT ${ROW} FROM worksite w WHERE w.worksite_id = $1`, [id]);

/** The fence a punch is matched to: an active worksite's centre, radius and zone. */
const fence = (db, id) =>
  one(
    db,
    `SELECT w.worksite_id, w.name, w.latitude::float8 AS latitude, w.longitude::float8 AS longitude,
            w.radius_m, w.timezone
       FROM worksite w WHERE w.worksite_id = $1 AND w.active`,
    [id],
  );

const codeTaken = async (db, code) =>
  Boolean(await one(db, "SELECT 1 AS x FROM worksite WHERE code = $1", [code]));

function insert(client, w) {
  return one(
    client,
    `INSERT INTO worksite (code, name, address, latitude, longitude, radius_m, timezone)
     VALUES ($1, $2, jsonb_build_object('text', $3::text), $4, $5, $6, $7)
     RETURNING worksite_id`,
    [w.code, w.name, w.address || "", w.latitude, w.longitude, w.radius_m, w.timezone],
  );
}

/** Change the fields given; `address` replaces the text. */
async function update(client, id, patch) {
  const sets = [];
  const params = [id];
  const set = (sql, value) => {
    params.push(value);
    sets.push(sql.replace("?", `$${params.length}`));
  };
  if (patch.name !== undefined) set("name = ?", patch.name);
  if (Object.prototype.hasOwnProperty.call(patch, "address"))
    set("address = jsonb_build_object('text', ?::text)", patch.address || "");
  if (patch.latitude !== undefined) set("latitude = ?", patch.latitude);
  if (patch.longitude !== undefined) set("longitude = ?", patch.longitude);
  if (patch.radius_m !== undefined) set("radius_m = ?", patch.radius_m);
  if (patch.timezone !== undefined) set("timezone = ?", patch.timezone);
  if (patch.active !== undefined) set("active = ?", patch.active);
  if (sets.length === 0) return { worksite_id: id };
  return one(client, `UPDATE worksite SET ${sets.join(", ")} WHERE worksite_id = $1 RETURNING worksite_id`, params);
}

/** The employees assigned to a worksite, within the reader's `people` scope. */
function employees(db, worksiteId, query, scope) {
  const params = [worksiteId];
  const s = scopeClause(scope, { column: "e.employee_id" }, params);
  return pageQuery(
    db,
    `SELECT e.employee_id, btrim(e.first_name || ' ' || e.last_name) AS display_name, e.job_title,
            d.name AS department, e.work_pattern, e.worksite_id, ${photoUrlSql("e")} AS photo_url, ${TOTAL_COL}
       FROM employee e
       LEFT JOIN department d ON d.department_id = e.department_id
      WHERE e.worksite_id = $1 AND e.status = 'active' ${s.and}
      ORDER BY e.last_name, e.first_name, e.employee_id`,
    params,
    query,
  );
}

/** One employee as the worksite's list shows them. */
const employee = (db, employeeId) =>
  one(
    db,
    `SELECT e.employee_id, btrim(e.first_name || ' ' || e.last_name) AS display_name, e.job_title,
            d.name AS department, e.work_pattern, e.worksite_id, ${photoUrlSql("e")} AS photo_url, e.status
       FROM employee e LEFT JOIN department d ON d.department_id = e.department_id
      WHERE e.employee_id = $1`,
    [employeeId],
  );

module.exports = { list, get, fence, codeTaken, insert, update, employees, employee };
