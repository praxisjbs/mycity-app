"use strict";
/**
 * MyCity's real staff, as the staging seeds find them (docs/guides/foundation.md §6.2): the
 * people the roster loader put on the register, picked out by their POST as
 * seeds/staff/roles.json names it, never by a name written in a seed. A staging seed hangs its
 * records off these people, so a demonstration shows the organisation the client knows.
 *
 *   const staff = await realStaff(pool);
 *   staff.ceo          the post roles.json marks as the CEO
 *   staff.operations   the post given Operations & People
 *   staff.head         the post given Head of Department
 *   staff.manager      the post given Line Manager
 *   staff.management   the other posts given Management, in register order
 *   staff.reportsOf(p) the people on the register whose line manager `p` is
 *   staff.everyone     every active person on the register
 *
 * A post is matched with the roster loader's own rule (scripts/db/load-staff.js
 * rolesForTitle), so the post the loader gave a role to is the post found here. A post nobody
 * holds today is null, and a seed leaves out whatever would hang off it.
 */
const loader = require("../../../scripts/db/load-staff");

/**
 * Everyone active on the register, with their login when they have one, oldest first.
 * The whole register, on purpose: a staging seed works with every person on it.
 * @param {{query: Function}} db
 */
async function register(db) {
  const { rows } = await db.query(
    `SELECT e.employee_id, e.first_name, e.last_name, e.job_title, e.work_email::text AS work_email,
            e.department_id, d.name AS department, e.line_manager_id, e.start_date::text AS start_date,
            e.left_on::text AS left_on, u.user_id
       FROM employee e
       LEFT JOIN department d ON d.department_id = e.department_id
       LEFT JOIN app_user u ON u.employee_id = e.employee_id AND u.status = 'active'
      WHERE e.status = 'active'
      ORDER BY e.created_at, e.employee_id`,
  );
  return rows;
}

/**
 * The real staff by post.
 * @param {{query: Function}} db
 * @param {{rolesFile?: string}} [opts]  roles.json; the one the loader reads unless a test says otherwise
 */
async function realStaff(db, { rolesFile = loader.ROLES } = {}) {
  const roles = loader.readRoles(rolesFile);
  const posts = Object.entries(roles.by_job_title);
  const everyone = (await register(db)).map((person) => {
    const entry = loader.rolesForTitle(roles, person.job_title);
    const post = posts.find(([, e]) => e === entry);
    return Object.freeze({
      ...person,
      post: post ? post[0] : null,
      roles: Object.freeze([...(entry.roles || [])]),
      is_ceo: entry.is_ceo === true,
    });
  });
  const holding = (test) => everyone.filter((p) => p.post !== null && test(p));
  const first = (test) => holding(test)[0] || null;
  return Object.freeze({
    everyone: Object.freeze(everyone),
    ceo: first((p) => p.is_ceo),
    operations: first((p) => p.roles.includes("operations_people")),
    head: first((p) => p.roles.includes("head_of_department")),
    manager: first((p) => p.roles.includes("manager")),
    management: Object.freeze(holding((p) => !p.is_ceo && p.roles.includes("management"))),
    reportsOf: (person) => (person ? everyone.filter((p) => p.line_manager_id === person.employee_id) : []),
  });
}

module.exports = { realStaff, register };
