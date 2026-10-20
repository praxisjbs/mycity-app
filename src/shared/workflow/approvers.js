"use strict";
/**
 * Who may decide a stage, worked out once when the stage starts.
 *
 * A stage names its approvers by kind (shared/workflow/conditions.js):
 *
 *   { type: "role", value: "hr_manager" }      anyone holding that role (role.code)
 *   { type: "user", value: "<user id>" }       one named person
 *   { type: "manager_of_subject" }             the line manager of the person the request is about;
 *                                              for someone who reports to a vacant seat, the first
 *                                              person above the seat (employee_effective_manager)
 *   { type: "ceo" }                            the CEO (app_user.is_ceo)
 *
 * When a stage starts, resolve() turns that into a snapshot stored on the instance
 * (workflow_instance.stage_approvers), so "who can act" and "my approvals" are one
 * indexed read, and a reorganisation mid-approval does not silently move a request
 * someone is already looking at:
 *
 *   { type: "role", value: "hr_manager" }
 *   { type: "user", value: "<user id>" }
 *   { type: "employee", value: "<employee id>", via: "manager_of_subject" }
 *   { type: "ceo" }      also what manager_of_subject becomes when the subject has no
 *                        line manager, nor anybody above their empty seat (the top of
 *                        the tree goes to the CEO)
 *
 * Rules canAct() applies:
 *  - The CEO may act on any stage of any approval (by design; A11).
 *  - Nobody else decides their own request: the person who opened it cannot approve,
 *    reject or return any stage of it, even when they hold the role.
 *  - Nor anyone the approval excludes (workflow_instance.excluded_employee_ids, set when it
 *    opened: a temporary site's people, docs/guides/foundation.md §6.5).
 *  - Otherwise the caller must match one snapshot entry.
 *
 * The route that records a decision also checks the module's `approve` grant; this
 * file never widens access, it only narrows it to the people the stage names.
 */
const { pool: defaultPool } = require("../../config/db");

/** Role codes for a set of role ids. */
async function roleCodesOf(client, roleIds) {
  if (!roleIds || roleIds.length === 0) return [];
  const { rows } = await client.query(
    "SELECT code FROM role WHERE role_id = ANY($1::uuid[]) ORDER BY code",
    [roleIds],
  );
  return rows.map((r) => r.code);
}

/** The person the subject answers to: their line manager, or whoever is above their empty seat. */
async function lineManagerOf(client, employeeId) {
  if (!employeeId) return null;
  const { rows } = await client.query(
    "SELECT manager_id FROM employee_effective_manager WHERE employee_id = $1",
    [employeeId],
  );
  return rows[0] ? rows[0].manager_id : null;
}

/**
 * Snapshot a stage's approvers for one request.
 * @param {{query: Function}} client
 * @param {Array<{type: string, value?: string}>} approvers  normalised stage approvers
 * @param {{subject_employee_id?: string|null}} subject
 * @returns {Promise<Array<{type: string, value?: string, via?: string}>>}
 */
async function resolve(
  client,
  approvers,
  { subject_employee_id: subjectId = null } = {},
) {
  const out = [];
  for (const a of approvers) {
    if (a.type === "role" || a.type === "user")
      out.push({ type: a.type, value: a.value });
    else if (a.type === "ceo") out.push({ type: "ceo" });
    else if (a.type === "manager_of_subject") {
      const manager = await lineManagerOf(client, subjectId);
      out.push(
        manager
          ? { type: "employee", value: manager, via: "manager_of_subject" }
          : { type: "ceo", via: "no_line_manager" },
      );
    } else {
      throw new Error(`workflow: unknown approver type "${a.type}"`);
    }
  }
  // One entry per distinct approver, in stage order.
  const seen = new Set();
  return out.filter((a) => {
    const k = `${a.type}:${a.value || ""}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * May this user decide the current stage?
 * @param {{query: Function}} client
 * @param {Array<object>} snapshot  workflow_instance.stage_approvers
 * @param {{user_id: string, employee_id?: string, role_ids?: string[], is_ceo?: boolean}} user
 * @param {{opened_by?: string|null, excluded_employee_ids?: string[]}} instance
 */
async function canAct(client, snapshot, user, instance = {}) {
  if (!user || !user.user_id) return false;
  if (user.is_ceo === true) return true;
  if (instance.opened_by && instance.opened_by === user.user_id) return false;
  if (user.employee_id && (instance.excluded_employee_ids || []).includes(user.employee_id)) return false;
  const list = snapshot || [];
  if (list.some((a) => a.type === "user" && a.value === user.user_id))
    return true;
  if (
    user.employee_id &&
    list.some((a) => a.type === "employee" && a.value === user.employee_id)
  )
    return true;
  const wanted = list.filter((a) => a.type === "role").map((a) => a.value);
  if (wanted.length === 0) return false;
  const held = await roleCodesOf(client, user.role_ids || []);
  return held.some((code) => wanted.includes(code));
}

/**
 * The SQL condition "the current stage of instance `alias` names this user", for the
 * My Approvals list. Appends to `params`.
 * @param {string} alias  the workflow_instance alias in the query
 * @param {{user_id: string, employee_id?: string|null, is_ceo?: boolean}} user
 * @param {string[]} roleCodes
 * @param {Array} params
 */
function waitingOnClause(alias, user, roleCodes, params) {
  params.push(
    user.user_id,
    user.employee_id || null,
    roleCodes,
    user.is_ceo === true,
  );
  const n = params.length;
  return `(${alias}.opened_by IS DISTINCT FROM $${n - 3}::uuid OR $${n}::boolean)
    AND ($${n - 2}::text IS NULL OR $${n}::boolean
         OR NOT ($${n - 2}::text = ANY(${alias}.excluded_employee_ids::text[])))
    AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(${alias}.stage_approvers) a
       WHERE (a->>'type' = 'user' AND a->>'value' = $${n - 3}::text)
          OR (a->>'type' = 'employee' AND a->>'value' = $${n - 2}::text)
          OR (a->>'type' = 'role' AND a->>'value' = ANY($${n - 1}::text[]))
          OR (a->>'type' = 'ceo' AND $${n}::boolean)
    )`;
}

/**
 * The user ids to tell that a stage is waiting on them: holders of the roles, the
 * named users, the manager's login, and the CEO when named. Active accounts only.
 * @param {{query: Function}} [client]
 * @param {Array<object>} snapshot
 * @param {{exclude?: string|null, excludeEmployees?: string[]}} [opts]  the requester, who is never
 *        asked to approve, and the employees the approval excludes (their logins are not told)
 * @returns {Promise<string[]>}
 */
async function recipients(
  client = defaultPool,
  snapshot = [],
  { exclude = null, excludeEmployees = [] } = {},
) {
  const roles = snapshot.filter((a) => a.type === "role").map((a) => a.value);
  const users = snapshot.filter((a) => a.type === "user").map((a) => a.value);
  const employees = snapshot
    .filter((a) => a.type === "employee")
    .map((a) => a.value);
  const ceo = snapshot.some((a) => a.type === "ceo");
  const { rows } = await client.query(
    `SELECT DISTINCT u.user_id
       FROM app_user u
      WHERE u.status = 'active'
        AND u.user_id IS DISTINCT FROM $5::uuid
        AND (u.employee_id IS NULL OR NOT (u.employee_id = ANY($6::uuid[])))
        AND (
              u.user_id = ANY($2::uuid[])
           OR u.employee_id = ANY($3::uuid[])
           OR ($4::boolean AND u.is_ceo = true)
           OR EXISTS (SELECT 1 FROM user_role ur JOIN role r ON r.role_id = ur.role_id
                       WHERE ur.user_id = u.user_id AND r.code = ANY($1::text[]))
        )
      ORDER BY u.user_id`,
    [roles, users, employees, ceo, exclude, excludeEmployees || []],
  );
  return rows.map((r) => r.user_id);
}

module.exports = {
  resolve,
  canAct,
  waitingOnClause,
  recipients,
  roleCodesOf,
  lineManagerOf,
};
