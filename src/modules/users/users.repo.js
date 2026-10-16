"use strict";
/**
 * Users' reads: the logins as Settings · Users lists them, the counts above the
 * list, and the employees who have no login yet. Writes belong to identity (the
 * login) and access (the roles); this file only reads.
 */
const { pageQuery, orderBy, TOTAL_COL } = require("../../shared/http/paged");

/** invited / active / suspended / left, from the stored status and whether a password was ever chosen. */
const STATUS = `CASE WHEN u.status = 'active' AND u.password_changed_at IS NULL THEN 'invited' ELSE u.status END`;

const ROW = `
  u.user_id, u.employee_id, trim(e.first_name || ' ' || e.last_name) AS display_name,
  u.email::text AS email, e.job_title, d.name AS department, u.is_ceo,
  ${STATUS} AS status,
  COALESCE((SELECT json_agg(json_build_object('code', r.code::text, 'name', r.name) ORDER BY r.rank DESC, r.name)
              FROM user_role ur JOIN role r ON r.role_id = ur.role_id
             WHERE ur.user_id = u.user_id
               AND (ur.effective_to IS NULL OR ur.effective_to > CURRENT_DATE)), '[]'::json) AS roles,
  (SELECT max(s.last_seen_at) FROM user_session s WHERE s.user_id = u.user_id) AS last_seen_at,
  u.created_at`;

const FROM = `
  FROM app_user u
  JOIN employee e ON e.employee_id = u.employee_id
  JOIN department d ON d.department_id = e.department_id`;

const SORTS = {
  display_name: "e.last_name, e.first_name",
  last_seen_at: "(SELECT max(s.last_seen_at) FROM user_session s WHERE s.user_id = u.user_id)",
  created_at: "u.created_at",
};

/** @param {{q?: string, status?: string, role?: string, page?: number, sort?: object}} query */
function list(db, query) {
  return pageQuery(
    db,
    `SELECT ${ROW}, ${TOTAL_COL}
     ${FROM}
      WHERE ($1::text IS NULL OR search_fold(e.first_name || ' ' || e.last_name || ' ' || u.email || ' ' || e.job_title)
                                 LIKE '%' || search_fold($1) || '%')
        AND ($2::text IS NULL OR ${STATUS} = $2)
        AND ($3::text IS NULL OR EXISTS (
              SELECT 1 FROM user_role ur JOIN role r ON r.role_id = ur.role_id
               WHERE ur.user_id = u.user_id AND r.code = $3))
      ORDER BY ${orderBy(query, SORTS, "u.user_id")}`,
    [query.q || null, query.status || null, query.role || null],
    query,
  );
}

async function getRow(db, userId) {
  const { rows } = await db.query(`SELECT ${ROW} ${FROM} WHERE u.user_id = $1`, [userId]);
  return rows[0] || null;
}

async function summary(db, idleSeconds) {
  const { rows } = await db.query(
    `SELECT count(*)::int AS users,
            count(*) FILTER (WHERE ${STATUS} = 'active')::int AS active,
            count(*) FILTER (WHERE ${STATUS} = 'invited')::int AS invited,
            count(*) FILTER (WHERE u.status = 'suspended')::int AS suspended,
            (SELECT count(DISTINCT s.user_id)::int FROM user_session s
              WHERE s.killed_at IS NULL AND s.expires_at > now()
                AND s.last_seen_at > now() - make_interval(secs => $1)) AS signed_in_now
       FROM app_user u`,
    [idleSeconds],
  );
  return rows[0];
}

/** Holders per active role (roles are a short, fixed set). */
async function byRole(db) {
  const { rows } = await db.query(
    `SELECT r.code::text AS code, r.name,
            count(u.user_id) FILTER (WHERE u.status = 'active')::int AS users
       FROM role r
       LEFT JOIN user_role ur ON ur.role_id = r.role_id
       LEFT JOIN app_user u ON u.user_id = ur.user_id
      WHERE r.active
      GROUP BY r.role_id
      ORDER BY r.rank DESC, r.name`,
  );
  return rows;
}

const CANDIDATE_SORTS = { display_name: "e.last_name, e.first_name" };

/** Active employees with no login, for the invite picker. */
function candidates(db, query) {
  return pageQuery(
    db,
    `SELECT e.employee_id, trim(e.first_name || ' ' || e.last_name) AS display_name,
            e.work_email::text AS email, e.job_title, d.name AS department, ${TOTAL_COL}
       FROM employee e
       JOIN department d ON d.department_id = e.department_id
      WHERE e.status = 'active'
        AND NOT EXISTS (SELECT 1 FROM app_user u WHERE u.employee_id = e.employee_id)
        AND ($1::text IS NULL OR search_fold(e.first_name || ' ' || e.last_name || ' ' || e.work_email || ' ' || e.job_title)
                                 LIKE '%' || search_fold($1) || '%')
      ORDER BY ${orderBy(query, CANDIDATE_SORTS, "e.employee_id")}`,
    [query.q || null],
    query,
  );
}

module.exports = { list, getRow, summary, byRole, candidates };
