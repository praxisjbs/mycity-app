"use strict";
/**
 * Access's SQL: roles and who holds them (migrations 0020, 0100; roles seeded by
 * seeds/reference/0101). Grants themselves are read by shared/rbac/grants-cache.js.
 */
const { pageQuery, orderBy, TOTAL_COL } = require("../../shared/http/paged");

const one = async (db, sql, params) => (await db.query(sql, params)).rows[0] || null;

const ROLE_COLUMNS =
  "r.role_id, r.code::text AS code, r.name, r.description, r.home_view, r.rank, r.is_system, r.active";

function findRoleByCode(db, code) {
  return one(db, `SELECT ${ROLE_COLUMNS} FROM role r WHERE r.code = $1 AND r.active`, [code]);
}

/** Every active role, most senior first: create-admin's picker. Roles are a short, fixed set. */
async function allRoles(db) {
  const { rows } = await db.query(
    `SELECT ${ROLE_COLUMNS} FROM role r WHERE r.active ORDER BY r.rank DESC, r.name`,
  );
  return rows;
}

/** `rank` ascending is most senior first: the expression is the rank negated. */
const ROLE_SORTS = { rank: "(0 - r.rank)", name: "r.name" };

/** Active roles with how many active logins hold each, one page. */
function rolePage(db, query) {
  return pageQuery(
    db,
    `SELECT r.role_id, r.code::text AS code, r.name, r.description,
            (SELECT count(*)::int
               FROM user_role ur JOIN app_user u ON u.user_id = ur.user_id
              WHERE ur.role_id = r.role_id AND u.status = 'active') AS users,
            ${TOTAL_COL}
       FROM role r
      WHERE r.active
        AND ($1::text IS NULL OR search_fold(r.name || ' ' || r.code) LIKE '%' || search_fold($1) || '%')
      ORDER BY ${orderBy(query, ROLE_SORTS, "r.role_id")}`,
    [query.q || null],
    query,
  );
}

async function countActiveUsersWithRole(db, roleId) {
  const row = await one(
    db,
    `SELECT count(*)::int AS n
       FROM user_role ur JOIN app_user u ON u.user_id = ur.user_id
      WHERE ur.role_id = $1 AND u.status = 'active'
        AND (ur.effective_to IS NULL OR ur.effective_to > CURRENT_DATE)`,
    [roleId],
  );
  return row ? row.n : 0;
}

/** The role codes a person holds now. */
async function roleCodesOf(db, userId) {
  const { rows } = await db.query(
    `SELECT r.code::text AS code
       FROM user_role ur JOIN role r ON r.role_id = ur.role_id
      WHERE ur.user_id = $1
        AND (ur.effective_to IS NULL OR ur.effective_to > CURRENT_DATE)
      ORDER BY r.rank DESC, r.code`,
    [userId],
  );
  return rows.map((r) => r.code);
}

function insertUserRole(db, { userId, roleId, grantedBy }) {
  return db.query(
    `INSERT INTO user_role (user_id, role_id, granted_by)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, role_id, effective_from) DO NOTHING`,
    [userId, roleId, grantedBy || null],
  );
}

/** Remove the roles a person should no longer hold (not in `keepRoleIds`). */
function removeUserRolesExcept(db, userId, keepRoleIds) {
  return db.query(
    `DELETE FROM user_role WHERE user_id = $1 AND NOT (role_id = ANY($2::uuid[]))`,
    [userId, keepRoleIds],
  );
}

module.exports = {
  findRoleByCode,
  allRoles,
  rolePage,
  countActiveUsersWithRole,
  roleCodesOf,
  insertUserRole,
  removeUserRolesExcept,
};
