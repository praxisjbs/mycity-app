"use strict";
/**
 * Access's SQL: roles, who holds them, and what each grants (migrations 0020, 0200,
 * 0400; roles seeded by seeds/reference/0290, field visibility and capabilities by
 * 0449). The grants cache (shared/rbac/grants-cache.js) reads the same tables for
 * every request; this file is where Settings · Roles & Permissions reads and writes.
 */
const { pageQuery, orderBy, completeQuery, TOTAL_COL } = require("../../shared/http/paged");

const one = async (db, sql, params) => (await db.query(sql, params)).rows[0] || null;

const ROLE_COLUMNS =
  "r.role_id, r.code::text AS code, r.name, r.description, r.home_view, r.rank, r.is_system, r.active, r.two_step_required";

/** Active logins holding a role now, as a correlated count on `r`. */
const HOLDERS = `(SELECT count(*)::int
                    FROM user_role ur JOIN app_user u ON u.user_id = ur.user_id
                   WHERE ur.role_id = r.role_id AND u.status = 'active'
                     AND (ur.effective_to IS NULL OR ur.effective_to > CURRENT_DATE))`;

function findRoleByCode(db, code) {
  return one(db, `SELECT ${ROLE_COLUMNS} FROM role r WHERE r.code = $1 AND r.active`, [code]);
}

/** An active role by id, with how many hold it; `lock` holds the row for the transaction. */
function findRole(db, roleId, { lock = false } = {}) {
  return one(
    db,
    `SELECT ${ROLE_COLUMNS}, ${HOLDERS} AS users
       FROM role r WHERE r.role_id = $1 AND r.active ${lock ? "FOR UPDATE OF r" : ""}`,
    [roleId],
  );
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
            ${HOLDERS} AS users,
            ${TOTAL_COL}
       FROM role r
      WHERE r.active
        AND ($1::text IS NULL OR search_fold(r.name || ' ' || r.code) LIKE '%' || search_fold($1) || '%')
      ORDER BY ${orderBy(query, ROLE_SORTS, "r.role_id")}`,
    [query.q || null],
    query,
  );
}

/**
 * Settings · Roles & Permissions: active roles with what each grants, counted. The
 * scope shown is the one most of its grants use (the wider on a tie), leaving out
 * modules that are always the person's own (`ownOnly`).
 */
function roleRowPage(db, query, ownOnly) {
  return pageQuery(
    db,
    `SELECT r.role_id, r.code::text AS code, r.name, r.description, r.is_system, r.two_step_required,
            ${HOLDERS} AS users,
            (SELECT count(*)::int FROM permission p WHERE p.role_id = r.role_id AND p.can_view) AS modules,
            COALESCE((SELECT (array_agg(g.scope ORDER BY g.n DESC,
                                        CASE g.scope WHEN 'all' THEN 0 WHEN 'team' THEN 1 ELSE 2 END))[1]
                        FROM (SELECT p.scope, count(*) AS n FROM permission p
                               WHERE p.role_id = r.role_id AND p.can_view AND p.module_key <> ALL($2::text[])
                               GROUP BY p.scope) g),
                     'none') AS scope,
            (SELECT count(*)::int FROM field_visibility fv
              WHERE fv.role_id = r.role_id AND fv.visibility = 'visible') AS fields_visible,
            ${TOTAL_COL}
       FROM role r
      WHERE r.active
        AND ($1::text IS NULL OR search_fold(r.name || ' ' || r.code) LIKE '%' || search_fold($1) || '%')
      ORDER BY ${orderBy(query, ROLE_SORTS, "r.role_id")}`,
    [query.q || null, ownOnly],
    query,
  );
}

/** Is this code used by any role, active or deleted? Codes are never reused. */
async function codeTaken(db, code) {
  return Boolean(await one(db, "SELECT 1 AS hit FROM role WHERE code = $1", [code]));
}

/** Another active role with this name (any case), other than `exceptRoleId`. */
function roleNamed(db, name, exceptRoleId = null) {
  return one(
    db,
    `SELECT r.role_id FROM role r
      WHERE r.active AND lower(r.name) = lower($1) AND ($2::uuid IS NULL OR r.role_id <> $2::uuid)
      LIMIT 1`,
    [name, exceptRoleId],
  );
}

function insertRole(db, { code, name, description, homeView }) {
  return one(
    db,
    `INSERT INTO role (code, name, description, home_view, is_system)
     VALUES ($1, $2, $3, $4, false)
     ON CONFLICT (code) DO NOTHING
     RETURNING role_id`,
    [code, name, description, homeView],
  );
}

function updateRole(db, roleId, { name, description, homeView }) {
  return db.query(
    "UPDATE role SET name = $2, description = $3, home_view = $4, updated_at = now() WHERE role_id = $1",
    [roleId, name, description, homeView],
  );
}

/** A role is deleted by retiring it: its code is never given out again, and history keeps its name. */
function retireRole(db, roleId) {
  return db.query("UPDATE role SET active = false, two_step_required = false, updated_at = now() WHERE role_id = $1", [
    roleId,
  ]);
}

/* ------------------------------------------------------------------ *
 * What a role grants, masks and holds
 * ------------------------------------------------------------------ */

/** The role's permission rows, by module. */
async function grantsOf(db, roleId) {
  const { rows } = await db.query(
    `SELECT module_key, scope, can_view, can_create, can_edit, can_delete, can_approve, can_export
       FROM permission WHERE role_id = $1 ORDER BY module_key`,
    [roleId],
  );
  return rows;
}

/** Make the role's permission rows exactly `rows` (module_key, scope, can_*). */
async function replaceGrants(db, roleId, rows) {
  const keys = rows.map((r) => r.module_key);
  await db.query("DELETE FROM permission WHERE role_id = $1 AND NOT (module_key = ANY($2::text[]))", [
    roleId,
    keys,
  ]);
  for (const r of rows) {
    await db.query(
      `INSERT INTO permission (role_id, module_key, scope, can_view, can_create, can_edit, can_delete, can_approve, can_export)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (role_id, module_key) DO UPDATE SET
         scope = EXCLUDED.scope, can_view = EXCLUDED.can_view, can_create = EXCLUDED.can_create,
         can_edit = EXCLUDED.can_edit, can_delete = EXCLUDED.can_delete, can_approve = EXCLUDED.can_approve,
         can_export = EXCLUDED.can_export, updated_at = now()`,
      [roleId, r.module_key, r.scope, r.can_view, r.can_create, r.can_edit, r.can_delete, r.can_approve, r.can_export],
    );
  }
}

/** The role's field visibility rows: field_key → visible | masked. */
async function fieldsOf(db, roleId) {
  const { rows } = await db.query(
    "SELECT field_key, visibility FROM field_visibility WHERE role_id = $1 ORDER BY field_key",
    [roleId],
  );
  return rows;
}

/** One row per field key, visible when listed in `visible`, masked otherwise. */
async function replaceFields(db, roleId, fieldKeys, visible) {
  for (const key of fieldKeys) {
    await db.query(
      `INSERT INTO field_visibility (role_id, field_key, visibility) VALUES ($1, $2, $3)
       ON CONFLICT (role_id, field_key) DO UPDATE SET visibility = EXCLUDED.visibility, updated_at = now()
        WHERE field_visibility.visibility <> EXCLUDED.visibility`,
      [roleId, key, visible.includes(key) ? "visible" : "masked"],
    );
  }
}

/** The capability codes the role holds. */
async function capabilitiesOf(db, roleId) {
  const { rows } = await db.query(
    `SELECT c.code::text AS code FROM role_capability rc JOIN capability c ON c.capability_id = rc.capability_id
      WHERE rc.role_id = $1 ORDER BY c.code`,
    [roleId],
  );
  return rows.map((r) => r.code);
}

/** Capabilities by code; unknown codes are simply absent. */
async function capabilitiesByCode(db, codes) {
  const { rows } = await db.query(
    "SELECT capability_id, code::text AS code FROM capability WHERE code = ANY($1::citext[])",
    [codes],
  );
  return rows;
}

async function replaceCapabilities(db, roleId, capabilityIds, grantedBy) {
  await db.query("DELETE FROM role_capability WHERE role_id = $1 AND NOT (capability_id = ANY($2::uuid[]))", [
    roleId,
    capabilityIds,
  ]);
  for (const id of capabilityIds) {
    await db.query(
      `INSERT INTO role_capability (role_id, capability_id, granted_by) VALUES ($1, $2, $3)
       ON CONFLICT (role_id, capability_id) DO NOTHING`,
      [roleId, id, grantedBy],
    );
  }
}

/** Every capability, for the editor's switches. A short code list. */
async function allCapabilities(db) {
  // pagination:complete the role editor shows a switch for every capability there is
  const { rows } = await completeQuery(
    db,
    "SELECT code::text AS code, name, description FROM capability ORDER BY code",
    [],
    { label: "capabilities", ceiling: 200 },
  );
  return rows;
}

/** Every active role and every permission row they hold, for the matrix. */
async function matrix(db) {
  // pagination:complete the matrix is every role against every module, edited and read whole
  const { rows: roles } = await completeQuery(
    db,
    "SELECT r.role_id, r.code::text AS code, r.name, r.is_system FROM role r WHERE r.active ORDER BY r.rank DESC, r.name, r.role_id",
    [],
    { label: "permission matrix roles", ceiling: 200 },
  );
  // pagination:complete the matrix is every role against every module, edited and read whole
  const { rows: grants } = await completeQuery(
    db,
    `SELECT p.role_id, p.module_key, p.scope, p.can_view, p.can_create, p.can_edit, p.can_delete,
            p.can_approve, p.can_export
       FROM permission p JOIN role r ON r.role_id = p.role_id
      WHERE r.active
      ORDER BY p.role_id, p.module_key`,
    [],
    { label: "permission matrix" },
  );
  return { roles, grants };
}

/* ------------------------------------------------------------------ *
 * Who holds which role
 * ------------------------------------------------------------------ */

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

/** Any login (whatever its status) still holding the role now: a role they hold cannot go. */
async function countHolders(db, roleId) {
  const row = await one(
    db,
    `SELECT count(*)::int AS n FROM user_role ur
      WHERE ur.role_id = $1 AND (ur.effective_to IS NULL OR ur.effective_to > CURRENT_DATE)`,
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

/** The ids of the active roles a person holds now. */
async function roleIdsOf(db, userId) {
  const { rows } = await db.query(
    `SELECT ur.role_id FROM user_role ur JOIN role r ON r.role_id = ur.role_id
      WHERE ur.user_id = $1 AND r.active
        AND (ur.effective_to IS NULL OR ur.effective_to > CURRENT_DATE)`,
    [userId],
  );
  return rows.map((r) => r.role_id);
}

/** The `settings` permission rows of these roles. */
async function settingsGrantsOf(db, roleIds) {
  const { rows } = await db.query(
    "SELECT role_id, scope, can_view, can_edit FROM permission WHERE module_key = 'settings' AND role_id = ANY($1::uuid[])",
    [roleIds],
  );
  return rows;
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

/* ------------------------------------------------------------------ *
 * Two-step sign-in required by role
 * ------------------------------------------------------------------ */

/** Does any role this person holds now require two-step sign-in? */
async function requiresTwoStep(db, userId) {
  const row = await one(
    db,
    `SELECT EXISTS (
       SELECT 1 FROM user_role ur JOIN role r ON r.role_id = ur.role_id
        WHERE ur.user_id = $1 AND r.active AND r.two_step_required
          AND (ur.effective_to IS NULL OR ur.effective_to > CURRENT_DATE)
     ) AS required`,
    [userId],
  );
  return Boolean(row && row.required);
}

/** Every active role with its two-step rule, how many hold it and how many of them have it on. */
async function twoStepRoles(db) {
  // pagination:complete the rule is saved as the whole list of roles, so it is shown whole
  const { rows } = await completeQuery(
    db,
    `SELECT r.role_id, r.code::text AS code, r.name, r.two_step_required,
            ${HOLDERS} AS holders,
            (SELECT count(DISTINCT u.user_id)::int
               FROM user_role ur JOIN app_user u ON u.user_id = ur.user_id
              WHERE ur.role_id = r.role_id AND u.status = 'active' AND u.mfa_enrolled_at IS NOT NULL
                AND (ur.effective_to IS NULL OR ur.effective_to > CURRENT_DATE)) AS enrolled
       FROM role r
      WHERE r.active
      ORDER BY r.rank DESC, r.name, r.role_id`,
    [],
    { label: "roles", ceiling: 200 },
  );
  return rows;
}

/** Exactly these active roles require two-step; every other does not. */
function setTwoStepRoles(db, codes) {
  return db.query(
    `UPDATE role SET two_step_required = (code = ANY($1::citext[])), updated_at = now()
      WHERE active AND two_step_required IS DISTINCT FROM (code = ANY($1::citext[]))`,
    [codes],
  );
}

module.exports = {
  findRoleByCode,
  findRole,
  allRoles,
  rolePage,
  roleRowPage,
  codeTaken,
  roleNamed,
  insertRole,
  updateRole,
  retireRole,
  grantsOf,
  replaceGrants,
  fieldsOf,
  replaceFields,
  capabilitiesOf,
  capabilitiesByCode,
  replaceCapabilities,
  allCapabilities,
  matrix,
  countActiveUsersWithRole,
  countHolders,
  roleCodesOf,
  roleIdsOf,
  settingsGrantsOf,
  insertUserRole,
  removeUserRolesExcept,
  requiresTwoStep,
  twoStepRoles,
  setTwoStepRoles,
};
