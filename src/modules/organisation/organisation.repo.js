"use strict";
/**
 * Organisation's SQL: departments, employees, vacant seats and the reporting tree
 * (migrations 0040, 0110, 0210, 0300).
 *
 * Every list pages at 25 through shared/http/paged.js; the one exception is the org
 * tree, which a chart cannot draw in pieces and which goes through completeQuery with
 * a ceiling (docs/guides/foundation.md §6.6). Record scope (`all`, `team`, `own`) is
 * translated once, by shared/rbac/scope.js, on the employee the row is about.
 *
 * Two reads join tables another module owns, the way Settings · Users joins `employee`:
 * the register shows whether a person has a login (`app_user`) and the 360 shows their
 * roles (`user_role`, `role`). Reads only: a login is written by identity, a role by
 * access, and this module writes neither.
 */
const { pageQuery, completeQuery, orderBy, TOTAL_COL } = require("../../shared/http/paged");
const { scopeClause } = require("../../shared/rbac/scope");

const one = async (db, sql, params) => (await db.query(sql, params)).rows[0] || null;

/**
 * What a create returns and the audit records: no restricted field (bank, pay). The
 * reporting line is here whole, people and seats, because a caller that compares records
 * (the staff importer's snapshot) must see a line that points at a vacant post too.
 */
const EMPLOYEE_COLUMNS = `
  e.employee_id, e.staff_number::text AS staff_number, e.first_name, e.last_name,
  e.work_email::text AS work_email, e.phone, e.job_title, e.department_id, e.line_manager_id,
  e.line_manager_seat_id, e.dotted_manager_id, e.dotted_manager_seat_id, e.worksite_id,
  e.employment_type, e.work_pattern, e.status, e.start_date, e.created_at`;

/** The columns an EmployeeCreate fills (migrations 0040, 0110 and 0210), in insert order. */
const INSERT_COLUMNS = [
  "staff_number",
  "first_name",
  "middle_name",
  "last_name",
  "preferred_name",
  "work_email",
  "personal_email",
  "phone",
  "job_title",
  "department_id",
  "worksite_id",
  "line_manager_id",
  "dotted_manager_id",
  "employment_type",
  "work_pattern",
  "start_date",
  "contract_ends_on",
  "confirmation_due_on",
  "confirmed_on",
  "gender",
  "date_of_birth",
  "next_of_kin_name",
  "next_of_kin_phone",
  "next_of_kin_relationship",
  "home_address",
  "bank_name",
  "account_number",
  "gross_monthly",
];

/** The columns PATCH /employees/:id may set (EmployeeUpdate; the reporting line has its own route). */
const UPDATE_COLUMNS = [
  "first_name",
  "middle_name",
  "last_name",
  "preferred_name",
  "work_email",
  "personal_email",
  "phone",
  "job_title",
  "department_id",
  "worksite_id",
  "employment_type",
  "work_pattern",
  "start_date",
  "contract_ends_on",
  "confirmation_due_on",
  "confirmed_on",
  "left_on",
  "gender",
  "date_of_birth",
  "next_of_kin_name",
  "next_of_kin_phone",
  "next_of_kin_relationship",
  "home_address",
  "bank_name",
  "account_number",
  "gross_monthly",
];

/** The login a person has, as the register and the 360 name it. */
const LOGIN_STATE = `
  CASE WHEN u.user_id IS NULL THEN 'none'
       WHEN u.status = 'suspended' THEN 'suspended'
       WHEN u.password_changed_at IS NULL THEN 'invited'
       ELSE 'active' END`;

const DISPLAY_NAME = "btrim(e.first_name || ' ' || e.last_name)";
const MANAGER_NAME = "btrim(m.first_name || ' ' || m.last_name)";
const DOTTED_NAME = "btrim(dm.first_name || ' ' || dm.last_name)";

/** The joins every employee read shares. */
const EMPLOYEE_JOINS = `
  FROM employee e
  JOIN department d ON d.department_id = e.department_id
  LEFT JOIN employee m ON m.employee_id = e.line_manager_id
  LEFT JOIN org_seat ms ON ms.org_seat_id = e.line_manager_seat_id
  LEFT JOIN employee dm ON dm.employee_id = e.dotted_manager_id
  LEFT JOIN org_seat ds ON ds.org_seat_id = e.dotted_manager_seat_id
  LEFT JOIN app_user u ON u.employee_id = e.employee_id`;

const MANAGER_SELECT = `
  m.employee_id AS manager_employee_id, ${MANAGER_NAME} AS manager_name, m.job_title AS manager_job_title,
  ms.org_seat_id AS manager_seat_id, ms.title AS manager_seat_title`;

const DOTTED_SELECT = `
  dm.employee_id AS dotted_employee_id, ${DOTTED_NAME} AS dotted_name, dm.job_title AS dotted_job_title,
  ds.org_seat_id AS dotted_seat_id, ds.title AS dotted_seat_title`;

/** A person or a seat as the contract's ManagerRef, or null when nobody is above them. */
function managerRef(row, prefix) {
  const employeeId = row[`${prefix}_employee_id`];
  const seatId = row[`${prefix}_seat_id`];
  if (employeeId)
    return {
      employee_id: employeeId,
      org_seat_id: null,
      display_name: row[`${prefix}_name`],
      job_title: row[`${prefix}_job_title`] || null,
      vacant: false,
    };
  if (seatId)
    return {
      employee_id: null,
      org_seat_id: seatId,
      display_name: row[`${prefix}_seat_title`],
      job_title: row[`${prefix}_seat_title`],
      vacant: true,
    };
  return null;
}

/** One row of the register, in the contract's shape. */
const toRow = (r) => ({
  employee_id: r.employee_id,
  staff_number: r.staff_number,
  display_name: r.display_name,
  job_title: r.job_title,
  department_id: r.department_id,
  department: r.department,
  line_manager: managerRef(r, "manager"),
  work_pattern: r.work_pattern,
  employment_type: r.employment_type,
  status: r.status,
  login: r.login,
  start_date: r.start_date,
  confirmation_due_on: r.confirmation_due_on,
  confirmed_on: r.confirmed_on,
});

/** The SQL for each field EmployeeListQuery allow-lists. The first is the default order. */
const EMPLOYEE_SORTS = {
  display_name: "e.last_name, e.first_name",
  staff_number: "e.staff_number",
  job_title: "e.job_title",
  department: "d.name",
  start_date: "e.start_date",
  created_at: "e.created_at",
};

/**
 * One page of the register. An archived record is left out unless the caller asks for
 * that status by name, so Archive takes a person off the list without losing them.
 *
 * @param {{query: Function}} db
 * @param {object} query  EmployeeListQuery, validated
 * @param {{scope: string, scope_ids: string[]|null}} scope
 */
async function list(db, query, scope) {
  const params = [
    query.q ?? null,
    query.department_id ?? null,
    query.status ?? null,
    query.work_pattern ?? null,
    query.employment_type ?? null,
    query.line_manager_id ?? null,
  ];
  const s = scopeClause(scope, { column: "e.employee_id" }, params);
  const page = await pageQuery(
    db,
    `SELECT e.employee_id, e.staff_number::text AS staff_number, ${DISPLAY_NAME} AS display_name,
            e.job_title, e.department_id, d.name AS department, e.work_pattern, e.employment_type,
            e.status, e.start_date, e.confirmation_due_on, e.confirmed_on,
            ${LOGIN_STATE} AS login, ${MANAGER_SELECT}, ${TOTAL_COL}
       ${EMPLOYEE_JOINS}
      WHERE ($1::text IS NULL
             OR search_fold(e.first_name || ' ' || e.last_name || ' ' || e.job_title) LIKE '%' || search_fold($1) || '%'
             OR e.staff_number::text ILIKE '%' || $1 || '%'
             OR e.work_email::text ILIKE '%' || $1 || '%')
        AND ($2::uuid IS NULL OR e.department_id = $2)
        AND ($3::text IS NULL OR e.status = $3)
        AND ($3::text IS NOT NULL OR e.status <> 'archived')
        AND ($4::text IS NULL OR e.work_pattern = $4)
        AND ($5::text IS NULL OR e.employment_type = $5)
        AND ($6::uuid IS NULL OR e.line_manager_id = $6)
        ${s.and}
      ORDER BY ${orderBy(query, EMPLOYEE_SORTS, "e.employee_id")}`,
    params,
    query,
  );
  return { ...page, data: page.data.map(toRow) };
}

/** The counts above the register, for the caller's own scope. */
async function counts(db, scope) {
  const params = [];
  const s = scopeClause(scope, { column: "e.employee_id" }, params);
  return one(
    db,
    `SELECT count(*) FILTER (WHERE e.status = 'active')::int AS headcount,
            count(*) FILTER (WHERE e.status = 'active' AND e.confirmed_on IS NOT NULL)::int AS confirmed,
            count(*) FILTER (WHERE e.status = 'active' AND e.confirmed_on IS NULL
                             AND e.confirmation_due_on IS NOT NULL)::int AS probation,
            count(*) FILTER (WHERE e.left_on IS NOT NULL
                             AND e.left_on >= current_date - 90)::int AS attrition,
            count(*) FILTER (WHERE e.status = 'active' AND e.confirmed_on IS NULL
                             AND e.confirmation_due_on IS NOT NULL
                             AND e.confirmation_due_on <= current_date + 30)::int AS probation_due,
            count(*) FILTER (WHERE e.status = 'active' AND e.contract_ends_on IS NOT NULL
                             AND e.contract_ends_on <= current_date + 30)::int AS contracts_ending,
            count(*) FILTER (WHERE e.status = 'active' AND e.line_manager_id IS NULL
                             AND e.line_manager_seat_id IS NULL
                             AND COALESCE(u.is_ceo, false) = false)::int AS no_manager,
            count(*) FILTER (WHERE e.status = 'active' AND u.user_id IS NULL)::int AS no_login
       FROM employee e
       LEFT JOIN app_user u ON u.employee_id = e.employee_id
      WHERE true ${s.and}`,
    params,
  );
}

/** Active staff per work pattern, for the strip under the counts. */
async function byWorkPattern(db, scope) {
  const params = [];
  const s = scopeClause(scope, { column: "e.employee_id" }, params);
  const { rows } = await db.query(
    `SELECT e.work_pattern, count(*)::int AS people
       FROM employee e
      WHERE e.status = 'active' ${s.and}
      GROUP BY e.work_pattern
      ORDER BY e.work_pattern`,
    params,
  );
  return rows;
}

/** Active staff per department, biggest first. */
async function byDepartment(db, scope) {
  const params = [];
  const s = scopeClause(scope, { column: "e.employee_id" }, params);
  const { rows } = await db.query(
    `SELECT d.name, count(e.employee_id)::int AS people
       FROM department d
       JOIN employee e ON e.department_id = d.department_id AND e.status = 'active'
      WHERE true ${s.and}
      GROUP BY d.name
      ORDER BY count(e.employee_id) DESC, d.name`,
    params,
  );
  return rows;
}

/** Vacant seats, counted for the summary. */
async function vacantSeatCount(db) {
  const row = await one(
    db,
    "SELECT count(*)::int AS seats FROM org_seat WHERE status = 'vacant'",
  );
  return row ? row.seats : 0;
}

/** One employee, every column, with their department, managers and login. */
function get(db, employeeId) {
  return one(
    db,
    `SELECT e.*, e.staff_number::text AS staff_number, e.work_email::text AS work_email,
            e.personal_email::text AS personal_email, ${DISPLAY_NAME} AS display_name,
            d.name AS department, ${MANAGER_SELECT}, ${DOTTED_SELECT},
            u.user_id, u.email::text AS login_email, u.last_login_at, ${LOGIN_STATE} AS login,
            (SELECT count(*) FROM employee r
              WHERE r.line_manager_id = e.employee_id AND r.status <> 'archived')::int AS direct_reports
       ${EMPLOYEE_JOINS}
      WHERE e.employee_id = $1`,
    [employeeId],
  );
}

/** The roles on a login, most senior first (access owns the rows; this read shows them). */
async function rolesOf(db, userId) {
  if (!userId) return [];
  const { rows } = await db.query(
    `SELECT r.code::text AS code, r.name
       FROM user_role ur JOIN role r ON r.role_id = ur.role_id
      WHERE ur.user_id = $1
      ORDER BY r.rank DESC, r.name`,
    [userId],
  );
  return rows;
}

/** One page of what has been done to a record (the audit ledger, newest first). */
function historyOf(db, employeeId, query) {
  return pageQuery(
    db,
    `SELECT a.event_id, a.occurred_at, a.action, a.actor_name,
            COALESCE(a.changed_fields, '{}')::text[] AS changed_fields, ${TOTAL_COL}
       FROM audit_ledger a
      WHERE a.entity_type = 'employee' AND a.entity_id = $1
      ORDER BY a.occurred_at DESC, a.event_id`,
    [employeeId],
    query,
  );
}

function findDepartmentByName(db, name) {
  return one(
    db,
    `SELECT department_id, code::text AS code, name, active
       FROM department WHERE lower(name) = lower($1)
      ORDER BY active DESC, created_at
      LIMIT 1`,
    [name],
  );
}

function findDepartmentById(db, departmentId) {
  return one(
    db,
    `SELECT department_id, code::text AS code, name, parent_department_id, description, active
       FROM department WHERE department_id = $1`,
    [departmentId],
  );
}

async function codeTaken(db, code) {
  return Boolean(await one(db, "SELECT 1 AS x FROM department WHERE code = $1", [code]));
}

function insertDepartment(db, { code, name, parent_department_id: parent = null, description = null }) {
  return one(
    db,
    `INSERT INTO department (code, name, parent_department_id, description)
     VALUES ($1, $2, $3, $4)
     RETURNING department_id, code::text AS code, name, parent_department_id, description, active, created_at`,
    [code, name, parent, description],
  );
}

/** One department in the shape the contract gives a list row, headcount included. */
function departmentRow(db, departmentId) {
  return one(
    db,
    `SELECT d.department_id, d.code::text AS code, d.name, d.parent_department_id, d.active,
            count(e.employee_id) FILTER (WHERE e.status = 'active')::int AS headcount
       FROM department d
       LEFT JOIN employee e ON e.department_id = d.department_id
      WHERE d.department_id = $1
      GROUP BY d.department_id, d.code, d.name, d.parent_department_id, d.active`,
    [departmentId],
  );
}

const DEPARTMENT_SORTS = { name: "d.name", created_at: "d.created_at" };

/** One page of departments, each with its headcount. */
function departments(db, query) {
  return pageQuery(
    db,
    `SELECT d.department_id, d.code::text AS code, d.name, d.parent_department_id, d.active,
            count(e.employee_id) FILTER (WHERE e.status = 'active')::int AS headcount, ${TOTAL_COL}
       FROM department d
       LEFT JOIN employee e ON e.department_id = d.department_id
      WHERE ($1::text IS NULL OR search_fold(d.name) LIKE '%' || search_fold($1) || '%')
        AND ($2::text IS NULL OR d.active = ($2 = 'true'))
      GROUP BY d.department_id, d.code, d.name, d.parent_department_id, d.active, d.created_at
      ORDER BY ${orderBy(query, DEPARTMENT_SORTS, "d.department_id")}`,
    [query.q ?? null, query.active ?? null],
    query,
  );
}

function updateDepartment(db, departmentId, patch) {
  const keys = ["name", "parent_department_id", "description", "active"].filter((k) =>
    Object.prototype.hasOwnProperty.call(patch, k),
  );
  const sets = keys.map((k, i) => `${k} = $${i + 2}`);
  return one(
    db,
    `UPDATE department SET ${sets.join(", ")}, updated_at = now()
      WHERE department_id = $1
      RETURNING department_id, code::text AS code, name, parent_department_id, description, active, created_at`,
    [departmentId, ...keys.map((k) => patch[k])],
  );
}

function findEmployeeByWorkEmail(db, email) {
  return one(db, `SELECT ${EMPLOYEE_COLUMNS} FROM employee e WHERE e.work_email = $1`, [email]);
}

function findEmployeeByStaffNumber(db, staffNumber) {
  return one(db, `SELECT ${EMPLOYEE_COLUMNS} FROM employee e WHERE e.staff_number = $1`, [
    staffNumber,
  ]);
}

function findEmployeeById(db, employeeId) {
  return one(db, `SELECT ${EMPLOYEE_COLUMNS} FROM employee e WHERE e.employee_id = $1`, [employeeId]);
}

/**
 * The people whose name matches, for the importer's two-pass manager matching: one hit
 * is the manager, several are an error on the row and never a guess.
 */
async function findEmployeesByName(db, name) {
  const { rows } = await db.query(
    `SELECT e.employee_id, ${DISPLAY_NAME} AS display_name, e.job_title
       FROM employee e
      WHERE e.status <> 'archived'
        AND search_fold(btrim(regexp_replace(e.first_name || ' ' || COALESCE(e.middle_name, '') || ' ' || e.last_name, '\\s+', ' ', 'g')))
            = search_fold(btrim(regexp_replace($1::text, '\\s+', ' ', 'g')))
      ORDER BY e.employee_id`,
    [name],
  );
  return rows;
}

/** The people holding a job title, for a manager named by their post ("Program Manager"). */
async function findEmployeesByJobTitle(db, title) {
  const { rows } = await db.query(
    `SELECT e.employee_id, ${DISPLAY_NAME} AS display_name, e.job_title
       FROM employee e
      WHERE e.status <> 'archived'
        AND search_fold(e.job_title) = search_fold(btrim($1::text))
      ORDER BY e.employee_id`,
    [title],
  );
  return rows;
}

/**
 * Every active person's post, and every open seat's title: what a manager named by
 * their post is matched against (organisation.service.resolveManager). Whole, because a
 * page of posts would match the wrong person as often as the right one.
 */
async function jobTitles(db) {
  // pagination:complete a post named in a sheet is matched against every post, never a page of them
  const { rows } = await completeQuery(
    db,
    `SELECT e.employee_id, e.job_title, ${DISPLAY_NAME} AS display_name
       FROM employee e
      WHERE e.status <> 'archived'
      ORDER BY e.employee_id`,
    [],
    { label: "staff job titles", ceiling: TREE_CEILING },
  );
  return rows;
}

async function seatTitles(db) {
  // pagination:complete a post named in a sheet is matched against every open seat
  const { rows } = await completeQuery(
    db,
    `SELECT s.org_seat_id, s.title
       FROM org_seat s
      WHERE s.status <> 'closed'
      ORDER BY s.org_seat_id`,
    [],
    { label: "seat titles", ceiling: TREE_CEILING },
  );
  return rows;
}

/** The employee whose login carries the CEO flag, or null. */
function findCeoEmployee(db) {
  return one(
    db,
    `SELECT e.employee_id, ${DISPLAY_NAME} AS display_name
       FROM employee e JOIN app_user u ON u.employee_id = e.employee_id
      WHERE u.is_ceo
      LIMIT 1`,
    [],
  );
}

function insertEmployee(db, e) {
  const values = INSERT_COLUMNS.map((c) => (e[c] === undefined || e[c] === "" ? null : e[c]));
  const marks = INSERT_COLUMNS.map((_, i) => `$${i + 1}`).join(", ");
  return one(
    db,
    `INSERT INTO employee (${INSERT_COLUMNS.join(", ")})
     VALUES (${marks})
     RETURNING ${EMPLOYEE_COLUMNS.replace(/\be\./g, "")}`,
    values,
  );
}

/** Apply an EmployeeUpdate. Only the keys the caller sent are touched. */
function updateEmployee(db, employeeId, patch) {
  const keys = UPDATE_COLUMNS.filter((k) => Object.prototype.hasOwnProperty.call(patch, k));
  if (keys.length === 0) return findEmployeeById(db, employeeId);
  const sets = keys.map((k, i) => `${k} = $${i + 2}`);
  return one(
    db,
    `UPDATE employee SET ${sets.join(", ")}, updated_at = now()
      WHERE employee_id = $1
      RETURNING ${EMPLOYEE_COLUMNS.replace(/\be\./g, "")}`,
    [employeeId, ...keys.map((k) => (patch[k] === "" ? null : patch[k]))],
  );
}

function archiveEmployee(db, employeeId, reason) {
  return one(
    db,
    `UPDATE employee
        SET status = 'archived', archived_at = now(), archive_reason = $2, updated_at = now()
      WHERE employee_id = $1
      RETURNING ${EMPLOYEE_COLUMNS.replace(/\be\./g, "")}`,
    [employeeId, reason],
  );
}

function restoreEmployee(db, employeeId) {
  return one(
    db,
    `UPDATE employee
        SET status = 'active', archived_at = NULL, archive_reason = NULL, updated_at = now()
      WHERE employee_id = $1
      RETURNING ${EMPLOYEE_COLUMNS.replace(/\be\./g, "")}`,
    [employeeId],
  );
}

/** Set the reporting line: a person or a seat, solid or dotted. Only the keys sent are touched. */
function setReporting(db, employeeId, patch) {
  const keys = [
    "line_manager_id",
    "line_manager_seat_id",
    "dotted_manager_id",
    "dotted_manager_seat_id",
  ].filter((k) => Object.prototype.hasOwnProperty.call(patch, k));
  const sets = keys.map((k, i) => `${k} = $${i + 2}`);
  return one(
    db,
    `UPDATE employee SET ${sets.join(", ")}, updated_at = now()
      WHERE employee_id = $1
      RETURNING ${EMPLOYEE_COLUMNS.replace(/\be\./g, "")}`,
    [employeeId, ...keys.map((k) => patch[k] ?? null)],
  );
}

/** True when `managerId` already reports to `employeeId`, directly or through others. */
async function wouldLoop(db, employeeId, managerId) {
  const row = await one(
    db,
    `SELECT 1 AS x FROM employee_team_closure
      WHERE manager_id = $1 AND employee_id = $2 AND depth > 0`,
    [employeeId, managerId],
  );
  return Boolean(row);
}

/**
 * The reporting line as history (0040): the open row is closed today and a new one
 * opens, so who reported to whom on a date can be answered later.
 */
async function recordReportingLine(db, employeeId, managerId, day) {
  await db.query(
    `UPDATE reporting_line SET effective_to = $2, updated_at = now()
      WHERE employee_id = $1 AND effective_to IS NULL AND effective_from < $2`,
    [employeeId, day],
  );
  await db.query(
    "DELETE FROM reporting_line WHERE employee_id = $1 AND effective_from >= $2",
    [employeeId, day],
  );
  if (!managerId) return null;
  return one(
    db,
    `INSERT INTO reporting_line (employee_id, manager_id, effective_from)
     VALUES ($1, $2, $3)
     ON CONFLICT (employee_id, manager_id, effective_from) DO UPDATE SET effective_to = NULL
     RETURNING reporting_line_id`,
    [employeeId, managerId, day],
  );
}

/* ------------------------------------------------------------------ *
 * Vacant seats
 * ------------------------------------------------------------------ */

const SEAT_SELECT = `
  s.org_seat_id, s.title, s.department_id, d.name AS department, s.status,
  s.filled_by_employee_id, s.filled_on, s.created_at,
  m.employee_id AS manager_employee_id, btrim(m.first_name || ' ' || m.last_name) AS manager_name,
  m.job_title AS manager_job_title, ps.org_seat_id AS manager_seat_id, ps.title AS manager_seat_title,
  (SELECT count(*) FROM employee r WHERE r.line_manager_seat_id = s.org_seat_id AND r.status <> 'archived')::int AS reports`;

const SEAT_JOINS = `
  FROM org_seat s
  JOIN department d ON d.department_id = s.department_id
  LEFT JOIN employee m ON m.employee_id = s.line_manager_id
  LEFT JOIN org_seat ps ON ps.org_seat_id = s.line_manager_seat_id`;

const toSeat = (r) => ({
  org_seat_id: r.org_seat_id,
  title: r.title,
  department_id: r.department_id,
  department: r.department,
  status: r.status,
  line_manager: managerRef(r, "manager"),
  filled_by_employee_id: r.filled_by_employee_id,
  filled_on: r.filled_on,
  reports: r.reports,
  created_at: r.created_at,
});

const SEAT_SORTS = { title: "s.title", created_at: "s.created_at" };

async function seats(db, query) {
  const page = await pageQuery(
    db,
    `SELECT ${SEAT_SELECT}, ${TOTAL_COL}
       ${SEAT_JOINS}
      WHERE ($1::text IS NULL OR search_fold(s.title) LIKE '%' || search_fold($1) || '%')
        AND ($2::text IS NULL OR s.status = $2)
      ORDER BY ${orderBy(query, SEAT_SORTS, "s.org_seat_id")}`,
    [query.q ?? null, query.status ?? null],
    query,
  );
  return { ...page, data: page.data.map(toSeat) };
}

async function findSeatById(db, seatId) {
  const row = await one(db, `SELECT ${SEAT_SELECT} ${SEAT_JOINS} WHERE s.org_seat_id = $1`, [seatId]);
  return row ? toSeat(row) : null;
}

/** A seat by the title the sheet or a screen names, ignoring case and spacing. */
async function findSeatByTitle(db, title) {
  const row = await one(
    db,
    `SELECT ${SEAT_SELECT} ${SEAT_JOINS}
      WHERE s.status <> 'closed'
        AND search_fold(btrim(regexp_replace(s.title, '\\s+', ' ', 'g'))) = search_fold(btrim(regexp_replace($1::text, '\\s+', ' ', 'g')))
      ORDER BY s.created_at
      LIMIT 1`,
    [title],
  );
  return row ? toSeat(row) : null;
}

async function insertSeat(db, seat) {
  const row = await one(
    db,
    `INSERT INTO org_seat (title, department_id, line_manager_id, line_manager_seat_id)
     VALUES ($1, $2, $3, $4)
     RETURNING org_seat_id`,
    [
      seat.title,
      seat.department_id,
      seat.line_manager_id ?? null,
      seat.line_manager_seat_id ?? null,
    ],
  );
  return findSeatById(db, row.org_seat_id);
}

async function updateSeat(db, seatId, patch) {
  const keys = ["title", "department_id", "line_manager_id", "line_manager_seat_id", "status"].filter(
    (k) => Object.prototype.hasOwnProperty.call(patch, k),
  );
  const sets = keys.map((k, i) => `${k} = $${i + 2}`);
  await db.query(
    `UPDATE org_seat SET ${sets.join(", ")}, updated_at = now() WHERE org_seat_id = $1`,
    [seatId, ...keys.map((k) => patch[k] ?? null)],
  );
  return findSeatById(db, seatId);
}

/* ------------------------------------------------------------------ *
 * The reporting tree
 * ------------------------------------------------------------------ */

/** Rows the whole-tree read may return before it fails loudly (docs/guides/foundation.md §6.6). */
const TREE_CEILING = 2000;

/**
 * The whole company: every active person and every open seat, with the solid line above
 * each and the dotted line beside it. A chart cannot be drawn from a page of it, so this
 * is the one read in the module that is not paged.
 */
async function tree(db) {
  // pagination:complete a reporting tree is drawn whole or not at all; 2,000 nodes is the ceiling
  const { rows } = await completeQuery(
    db,
    `SELECT e.employee_id AS node_id, 'employee' AS node_kind, e.employee_id, NULL::uuid AS org_seat_id,
            ${DISPLAY_NAME} AS display_name, e.job_title, d.name AS department,
            COALESCE(e.line_manager_id, e.line_manager_seat_id) AS manager_node_id,
            COALESCE(e.dotted_manager_id, e.dotted_manager_seat_id) AS dotted_manager_node_id,
            COALESCE(${DOTTED_NAME}, ds.title) AS dotted_line_to,
            COALESCE(u.is_ceo, false) AS is_ceo, false AS vacant,
            to_char(e.start_date, 'YYYY') AS since, e.work_pattern
       ${EMPLOYEE_JOINS}
      WHERE e.status = 'active'
      UNION ALL
     SELECT s.org_seat_id AS node_id, 'seat' AS node_kind, NULL::uuid AS employee_id, s.org_seat_id,
            s.title AS display_name, s.title AS job_title, d.name AS department,
            COALESCE(s.line_manager_id, s.line_manager_seat_id) AS manager_node_id,
            NULL::uuid AS dotted_manager_node_id, NULL::text AS dotted_line_to,
            false AS is_ceo, true AS vacant, NULL::text AS since, NULL::text AS work_pattern
       FROM org_seat s
       JOIN department d ON d.department_id = s.department_id
      WHERE s.status = 'vacant'
      ORDER BY vacant, display_name`,
    [],
    { label: "the reporting tree", ceiling: TREE_CEILING },
  );
  return rows;
}

/** The highest sequence a staff number carries, so numbering can be moved past it. */
async function highestStaffNumberSeq(db) {
  const row = await one(
    db,
    `SELECT COALESCE(max((regexp_replace(staff_number::text, '\\D', '', 'g'))::bigint), 0)::bigint AS seq
       FROM employee
      WHERE staff_number::text ~ '[0-9]'`,
  );
  return row ? Number(row.seq) : 0;
}

module.exports = {
  EMPLOYEE_COLUMNS,
  INSERT_COLUMNS,
  UPDATE_COLUMNS,
  TREE_CEILING,
  managerRef,
  toRow,
  toSeat,
  list,
  counts,
  byWorkPattern,
  byDepartment,
  vacantSeatCount,
  get,
  rolesOf,
  historyOf,
  findDepartmentByName,
  findDepartmentById,
  departmentRow,
  codeTaken,
  insertDepartment,
  departments,
  updateDepartment,
  findEmployeeByWorkEmail,
  findEmployeeByStaffNumber,
  findEmployeeById,
  findEmployeesByName,
  findEmployeesByJobTitle,
  jobTitles,
  seatTitles,
  findCeoEmployee,
  insertEmployee,
  updateEmployee,
  archiveEmployee,
  restoreEmployee,
  setReporting,
  wouldLoop,
  recordReportingLine,
  seats,
  findSeatById,
  findSeatByTitle,
  insertSeat,
  updateSeat,
  tree,
  highestStaffNumberSeq,
};
