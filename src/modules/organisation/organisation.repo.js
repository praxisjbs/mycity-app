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
const { photoUrlSql, personJson } = require("../../shared/db/person");
const lagos = require("../../shared/time/lagos");

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
       WHEN u.status = 'left' OR e.status IN ('archived', 'left') THEN 'left'
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
  photo_url: r.photo_url,
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
    query.contract === "ending" ? lagos.today() : null,
  ];
  const s = scopeClause(scope, { column: "e.employee_id" }, params);
  const page = await pageQuery(
    db,
    `SELECT e.employee_id, e.staff_number::text AS staff_number, ${DISPLAY_NAME} AS display_name,
            e.job_title, e.department_id, d.name AS department, e.work_pattern, e.employment_type,
            e.status, e.start_date, e.confirmation_due_on, e.confirmed_on, ${photoUrlSql("e")} AS photo_url,
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
        AND ($7::date IS NULL OR (e.status = 'active' AND e.contract_ends_on IS NOT NULL AND e.contract_ends_on <= $7::date + 30))
        ${s.and}
      ORDER BY ${orderBy(query, EMPLOYEE_SORTS, "e.employee_id")}`,
    params,
    query,
  );
  return { ...page, data: page.data.map(toRow) };
}

/**
 * The counts above the register, for the caller's own scope. `today` is the Lagos date
 * (shared/time/lagos.js) the 90 and 30 day windows count from, never the database's
 * CURRENT_DATE, whose zone is the session's.
 *
 * @param {{query: Function}} db
 * @param {{scope: string, scope_ids: string[]|null}} scope
 * @param {string} today  YYYY-MM-DD
 */
async function counts(db, scope, today) {
  const params = [today];
  const s = scopeClause(scope, { column: "e.employee_id" }, params);
  return one(
    db,
    `SELECT count(*) FILTER (WHERE e.status = 'active')::int AS headcount,
            count(*) FILTER (WHERE e.status = 'active' AND e.confirmed_on IS NOT NULL)::int AS confirmed,
            count(*) FILTER (WHERE e.status = 'active' AND e.confirmed_on IS NULL
                             AND e.confirmation_due_on IS NOT NULL)::int AS probation,
            count(*) FILTER (WHERE e.left_on IS NOT NULL
                             AND e.left_on >= $1::date - 90)::int AS attrition,
            count(*) FILTER (WHERE e.status = 'active' AND e.confirmed_on IS NULL
                             AND e.confirmation_due_on IS NOT NULL
                             AND e.confirmation_due_on <= $1::date + 30)::int AS probation_due,
            count(*) FILTER (WHERE e.status = 'active' AND e.contract_ends_on IS NOT NULL
                             AND e.contract_ends_on <= $1::date + 30)::int AS contracts_ending,
            count(*) FILTER (WHERE e.status = 'active' AND e.line_manager_id IS NULL
                             AND e.line_manager_seat_id IS NULL
                             AND COALESCE(u.is_ceo, false) = false)::int AS no_manager,
            count(*) FILTER (WHERE e.status = 'active' AND u.user_id IS NULL)::int AS no_login,
            -- A roster login nobody has emailed yet: Invited on the register, but never sent.
            count(*) FILTER (WHERE e.status = 'active' AND u.user_id IS NOT NULL AND u.status = 'active'
                               AND u.password_changed_at IS NULL
                               AND NOT EXISTS (SELECT 1 FROM password_reset p
                                                WHERE p.user_id = u.user_id AND p.purpose = 'invite'))::int AS invite_unsent
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

/** A name with its punctuation as spaces: "Technology & Back-Office Ops" is "Technology & Back Office Ops". */
const LOOSE_NAME = (sql) => `btrim(regexp_replace(search_fold(${sql}), '[^a-z0-9]+', ' ', 'g'))`;

/** A department by name: as written first, else with case, accents and punctuation set aside. */
function findDepartmentByName(db, name) {
  return one(
    db,
    `SELECT department_id, code::text AS code, name, active
       FROM department
      WHERE lower(name) = lower($1) OR ${LOOSE_NAME("name")} = ${LOOSE_NAME("$1::text")}
      ORDER BY (lower(name) = lower($1)) DESC, active DESC, created_at
      LIMIT 1`,
    [name],
  );
}

function findDepartmentById(db, departmentId) {
  return one(
    db,
    `SELECT department_id, code::text AS code, name, parent_department_id, description, active,
            head_employee_id, head_seat_id, merged_into_department_id
       FROM department WHERE department_id = $1`,
    [departmentId],
  );
}

/** The department holding this code, any case (a department renamed on screen keeps its code). */
function findDepartmentByCode(db, code) {
  return one(
    db,
    `SELECT department_id, code::text AS code, name, active, head_employee_id, head_seat_id
       FROM department WHERE code = $1::citext`,
    [code],
  );
}

async function codeTaken(db, code) {
  return Boolean(await one(db, "SELECT 1 AS x FROM department WHERE code = $1", [code]));
}

function insertDepartment(
  db,
  { code, name, parent_department_id: parent = null, description = null, head_employee_id: headId = null, head_seat_id: seatId = null },
) {
  return one(
    db,
    `INSERT INTO department (code, name, parent_department_id, description, head_employee_id, head_seat_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING department_id, code::text AS code, name, parent_department_id, description, active,
               head_employee_id, head_seat_id, created_at`,
    [code, name, parent, description, headId, seatId],
  );
}

/**
 * A department as the contract gives it: its headcount and open roles, its head as a ManagerRef
 * (a person, the person in a filled head seat, or the vacant seat), and where it went if merged.
 * `acting_head` and `can_delete` are added by the service.
 */
const DEPARTMENT_ROW = `
  d.department_id, d.code::text AS code, d.name, d.parent_department_id, d.active,
  (SELECT count(*)::int FROM employee e WHERE e.department_id = d.department_id AND e.status = 'active') AS headcount,
  (SELECT count(*)::int FROM org_seat os WHERE os.department_id = d.department_id AND os.status = 'vacant') AS open_roles,
  CASE WHEN mi.department_id IS NOT NULL
       THEN json_build_object('department_id', mi.department_id, 'name', mi.name) END AS merged_into,
  d.head_employee_id, d.head_seat_id,
  CASE
    WHEN he.employee_id IS NOT NULL THEN json_build_object(
      'employee_id', he.employee_id, 'org_seat_id', NULL,
      'display_name', btrim(he.first_name || ' ' || he.last_name), 'job_title', he.job_title, 'vacant', false)
    WHEN hf.employee_id IS NOT NULL THEN json_build_object(
      'employee_id', hf.employee_id, 'org_seat_id', NULL,
      'display_name', btrim(hf.first_name || ' ' || hf.last_name), 'job_title', hs.title, 'vacant', false)
    WHEN hs.org_seat_id IS NOT NULL THEN json_build_object(
      'employee_id', NULL, 'org_seat_id', hs.org_seat_id,
      'display_name', hs.title, 'job_title', hs.title, 'vacant', true)
  END AS head`;
const DEPARTMENT_JOINS = `
  LEFT JOIN employee he ON he.employee_id = d.head_employee_id
  LEFT JOIN org_seat hs ON hs.org_seat_id = d.head_seat_id
  LEFT JOIN employee hf ON hf.employee_id = hs.filled_by_employee_id AND hs.status = 'filled'
  LEFT JOIN department mi ON mi.department_id = d.merged_into_department_id`;

/** One department in the shape the contract gives a list row, headcount included. */
function departmentRow(db, departmentId) {
  return one(
    db,
    `SELECT ${DEPARTMENT_ROW} FROM department d ${DEPARTMENT_JOINS} WHERE d.department_id = $1`,
    [departmentId],
  );
}

/**
 * Who acts as a department's head (docs/guides/performance.md §6.20): its head; the person in
 * its head seat; or, while the seat is vacant, the first person above it, through any vacant
 * seats between. Null when it has none.
 */
async function headOf(db, departmentId) {
  const row = await one(
    db,
    `WITH RECURSIVE up AS (
       SELECT s.org_seat_id, s.status, s.filled_by_employee_id, s.line_manager_id, s.line_manager_seat_id, 0 AS hops
         FROM department d JOIN org_seat s ON s.org_seat_id = d.head_seat_id
        WHERE d.department_id = $1
       UNION ALL
       SELECT n.org_seat_id, n.status, n.filled_by_employee_id, n.line_manager_id, n.line_manager_seat_id, up.hops + 1
         FROM up JOIN org_seat n ON n.org_seat_id = up.line_manager_seat_id
        WHERE up.status <> 'filled' AND up.line_manager_id IS NULL AND up.hops < 32
     )
     SELECT COALESCE(
              (SELECT d.head_employee_id FROM department d WHERE d.department_id = $1),
              (SELECT CASE WHEN up.status = 'filled' THEN up.filled_by_employee_id ELSE up.line_manager_id END
                 FROM up
                WHERE (up.status = 'filled' AND up.filled_by_employee_id IS NOT NULL) OR up.line_manager_id IS NOT NULL
                ORDER BY up.hops LIMIT 1)
            ) AS employee_id`,
    [departmentId],
  );
  return row ? row.employee_id : null;
}

/** A person as the contract's PersonRef, or null. */
function personRef(db, employeeId) {
  if (!employeeId) return null;
  return one(
    db,
    `SELECT ${personJson("e", "d")} AS person
       FROM employee e LEFT JOIN department d ON d.department_id = e.department_id
      WHERE e.employee_id = $1`,
    [employeeId],
  ).then((r) => (r ? r.person : null));
}

const DEPARTMENT_SORTS = { name: "d.name", headcount: "headcount", created_at: "d.created_at" };

/** One page of departments, each with its headcount. */
function departments(db, query) {
  return pageQuery(
    db,
    `SELECT ${DEPARTMENT_ROW}, ${TOTAL_COL}
       FROM department d ${DEPARTMENT_JOINS}
      WHERE ($1::text IS NULL OR search_fold(d.name || ' ' || d.code) LIKE '%' || search_fold($1) || '%')
        AND ($2::text IS NULL OR d.active = ($2 = 'true'))
      ORDER BY ${orderBy(query, DEPARTMENT_SORTS, "d.department_id")}`,
    [query.q ?? null, query.active ?? null],
    query,
  );
}

function updateDepartment(db, departmentId, patch) {
  const keys = [
    "name",
    "code",
    "parent_department_id",
    "description",
    "active",
    "head_employee_id",
    "head_seat_id",
    "merged_into_department_id",
  ].filter((k) => Object.prototype.hasOwnProperty.call(patch, k));
  const sets = keys.map((k, i) => `${k} = $${i + 2}`);
  return one(
    db,
    `UPDATE department SET ${sets.join(", ")}, updated_at = now()
      WHERE department_id = $1
      RETURNING department_id, code::text AS code, name, parent_department_id, description, active,
                head_employee_id, head_seat_id, merged_into_department_id, created_at`,
    [departmentId, ...keys.map((k) => patch[k])],
  );
}

/**
 * The people on a department's books (everyone not archived) and where each reports: what a
 * head change and a merge move (docs/guides/organogram.md §6.1). A set for one write, never a
 * list anyone pages through.
 */
async function departmentMembers(db, departmentId) {
  const { rows } = await db.query(
    `SELECT employee_id, status, department_id, line_manager_id, line_manager_seat_id
       FROM employee WHERE department_id = $1 AND status <> 'archived'
      ORDER BY created_at, employee_id`,
    [departmentId],
  );
  return rows;
}

/** A department's seats that are not closed, with their lines: a head change and a merge move them too. */
async function departmentSeats(db, departmentId) {
  const { rows } = await db.query(
    `SELECT org_seat_id, status, department_id, filled_by_employee_id, line_manager_id, line_manager_seat_id
       FROM org_seat WHERE department_id = $1 AND status <> 'closed'
      ORDER BY created_at, org_seat_id`,
    [departmentId],
  );
  return rows;
}

/** These people as a move reads them, in the order given; an id that names nobody is left out. */
async function employeesByIds(db, employeeIds) {
  const { rows } = await db.query(
    `SELECT e.employee_id, e.status, e.department_id, e.line_manager_id, e.line_manager_seat_id,
            ${DISPLAY_NAME} AS display_name
       FROM unnest($1::uuid[]) WITH ORDINALITY AS ids(employee_id, n)
       JOIN employee e ON e.employee_id = ids.employee_id
      ORDER BY ids.n`,
    [employeeIds],
  );
  return rows;
}

/** How many work in a department now (active or suspended) and how many of its roles are open. */
async function departmentLoad(db, departmentId) {
  return one(
    db,
    `SELECT (SELECT count(*)::int FROM employee WHERE department_id = $1 AND status IN ('active', 'suspended')) AS people,
            (SELECT count(*)::int FROM org_seat WHERE department_id = $1 AND status = 'vacant') AS open_roles`,
    [departmentId],
  );
}

/** The departments in use this person heads, in person or in the head seat they fill. */
async function departmentsHeadedBy(db, employeeId) {
  const { rows } = await db.query(
    `SELECT d.department_id
       FROM department d
       LEFT JOIN org_seat s ON s.org_seat_id = d.head_seat_id
      WHERE d.active AND (d.head_employee_id = $1 OR (s.status = 'filled' AND s.filled_by_employee_id = $1))`,
    [employeeId],
  );
  return rows.map((r) => r.department_id);
}

/** Every department in use, for the heads' roles (organisation.syncHeadRoles). */
async function activeDepartmentIds(db) {
  const { rows } = await db.query("SELECT department_id FROM department WHERE active ORDER BY department_id");
  return rows.map((r) => r.department_id);
}

/** A name from the catalogue, quoted as an identifier. */
const ident = (name) => `"${String(name).replace(/"/g, '""')}"`;

/**
 * Every column that names a department: the foreign keys the catalogue holds, so a table added
 * later counts by itself. Read once per process; the schema does not change while it runs.
 */
let departmentReferences = null;
async function departmentColumns(db) {
  if (!departmentReferences) {
    const { rows } = await db.query(
      `SELECT n.nspname AS schema, t.relname AS tbl, a.attname AS col
         FROM pg_constraint c
         JOIN pg_class t ON t.oid = c.conrelid
         JOIN pg_namespace n ON n.oid = t.relnamespace
         JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
        WHERE c.contype = 'f' AND c.confrelid = 'department'::regclass
        ORDER BY 1, 2, 3`,
    );
    departmentReferences = rows;
  }
  return departmentReferences;
}

/**
 * Which of these departments something names: a row behind any foreign key (people archived or
 * not, seats, plans, goals, KPIs, scorecards, channels, policies, vacancies, offers, expenses,
 * another department merged into it) or an announcement's audience. Those are never deleted.
 */
async function usedDepartmentIds(db, departmentIds) {
  if (!departmentIds.length) return new Set();
  const parts = (await departmentColumns(db)).map(
    (r) => `SELECT ${ident(r.col)} AS id FROM ${ident(r.schema)}.${ident(r.tbl)} WHERE ${ident(r.col)} = ANY ($1::uuid[])`,
  );
  parts.push(
    `SELECT x.id::uuid FROM announcement a, jsonb_array_elements_text(a.audience -> 'department_ids') AS x(id)
      WHERE jsonb_typeof(a.audience -> 'department_ids') = 'array' AND x.id = ANY (CAST($1::uuid[] AS text[]))`,
  );
  const { rows } = await db.query(`SELECT DISTINCT id FROM (${parts.join(" UNION ALL ")}) used`, [departmentIds]);
  return new Set(rows.map((r) => r.id));
}

/** Delete a department nothing names (the caller checked usedDepartmentIds first). */
function deleteDepartment(db, departmentId) {
  return one(
    db,
    `DELETE FROM department WHERE department_id = $1
     RETURNING department_id, code::text AS code, name, active, head_employee_id, head_seat_id`,
    [departmentId],
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

/** The document of the photo an employee uses, or null (1170). */
async function photoDocumentOf(db, employeeId) {
  const row = await one(db, "SELECT e.photo_document_id FROM employee e WHERE e.employee_id = $1", [employeeId]);
  return row ? row.photo_document_id : null;
}

/** Point an employee at a photo, or at none (null). */
function setPhotoDocument(db, employeeId, documentId) {
  return db.query("UPDATE employee SET photo_document_id = $2, updated_at = now() WHERE employee_id = $1", [
    employeeId,
    documentId,
  ]);
}

function findEmployeeById(db, employeeId) {
  return one(db, `SELECT ${EMPLOYEE_COLUMNS} FROM employee e WHERE e.employee_id = $1`, [employeeId]);
}

/**
 * A name as two spellings of it compare: hyphens and runs of space as one space, apostrophes
 * dropped, then search_fold (case and accents). "Shola-Adido" and "Shola Adido" are one name.
 */
const NAME_FOLD = (sql) =>
  `search_fold(btrim(regexp_replace(regexp_replace(${sql}, '[''’]', '', 'g'), '[\\s-]+', ' ', 'g')))`;

/**
 * The active people whose name matches, for the importer's manager matching: one hit is the
 * manager, several are an error on the row and never a guess. A name matches written in full
 * (with the middle name) or as first and last name only, the way a sheet usually writes it.
 */
async function findEmployeesByName(db, name) {
  const { rows } = await db.query(
    `SELECT e.employee_id, ${DISPLAY_NAME} AS display_name, e.job_title
       FROM employee e
      WHERE e.status = 'active'
        AND (${NAME_FOLD("e.first_name || ' ' || COALESCE(e.middle_name, '') || ' ' || e.last_name")} = ${NAME_FOLD("$1::text")}
             OR ${NAME_FOLD("e.first_name || ' ' || e.last_name")} = ${NAME_FOLD("$1::text")})
      ORDER BY e.employee_id`,
    [name],
  );
  return rows;
}

/** The active people with this first name, at most two: one is the answer, two are ambiguous. */
async function findEmployeesByFirstName(db, firstName) {
  const { rows } = await db.query(
    `SELECT e.employee_id, ${DISPLAY_NAME} AS display_name, e.job_title
       FROM employee e
      WHERE e.status = 'active' AND ${NAME_FOLD("e.first_name")} = ${NAME_FOLD("$1::text")}
      ORDER BY e.employee_id
      LIMIT 2 -- pagination:batch one hit is the answer and a second makes it ambiguous`,
    [firstName],
  );
  return rows;
}

/**
 * The people on the register, archived aside, with this first and last name: before a roster
 * row with no staff number creates somebody, so a changed email cannot make a second record.
 */
async function findEmployeesByFirstAndLast(db, firstName, lastName) {
  const { rows } = await db.query(
    `SELECT e.employee_id, e.staff_number::text AS staff_number, e.work_email::text AS work_email
       FROM employee e
      WHERE e.status <> 'archived'
        AND ${NAME_FOLD("e.first_name")} = ${NAME_FOLD("$1::text")}
        AND ${NAME_FOLD("e.last_name")} = ${NAME_FOLD("$2::text")}
      ORDER BY e.employee_id`,
    [firstName, lastName],
  );
  return rows;
}

/**
 * Whether a committed staff roster batch (one carrying the sheet's checksum) created this
 * person: the roster never takes a staff number back from somebody it brought itself.
 */
async function importedByRoster(db, employeeId) {
  const row = await one(
    db,
    `SELECT 1 AS x
       FROM import_row r
       JOIN import_batch b ON b.import_batch_id = r.import_batch_id
      WHERE b.importer_key = 'employees' AND b.status = 'committed' AND b.options ? 'source_sha256'
        AND r.action = 'create' AND r.target_id = $1::text
      LIMIT 1`,
    [employeeId],
  );
  return Boolean(row);
}

/**
 * Whether anything now hangs off a person the import created: a login, a leave request or a
 * clock-in. Reverting the import would archive somebody already in use, so it is refused.
 */
async function employeeInUse(db, employeeId) {
  const row = await one(
    db,
    `SELECT EXISTS (SELECT 1 FROM app_user WHERE employee_id = $1)
         OR EXISTS (SELECT 1 FROM leave_request WHERE employee_id = $1)
         OR EXISTS (SELECT 1 FROM attendance_event WHERE employee_id = $1) AS used`,
    [employeeId],
  );
  return Boolean(row && row.used);
}

/**
 * The fields of a person the staff importer compares and puts back on revert that a record
 * read does not carry: the middle name and the personal fields. Read only by the importer,
 * whose preview and error file mask what a reader may not see.
 */
function importSnapshot(db, employeeId) {
  return one(
    db,
    `SELECT e.middle_name, e.gender, to_char(e.date_of_birth, 'YYYY-MM-DD') AS date_of_birth, e.bank_name
       FROM employee e WHERE e.employee_id = $1`,
    [employeeId],
  );
}

/** The people holding a job title, for a manager named by their post ("Program Manager"). */
async function findEmployeesByJobTitle(db, title) {
  const { rows } = await db.query(
    `SELECT e.employee_id, ${DISPLAY_NAME} AS display_name, e.job_title
       FROM employee e
      WHERE e.status = 'active'
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
      WHERE e.status = 'active'
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

/**
 * Apply an EmployeeUpdate. A key left out (undefined) or arriving empty ("") is not touched;
 * a key set to null is cleared. Only a correction's clearable fields (EmployeeUpdate) can carry
 * null, and only for a field the person emptied on Edit: a field their role hides is refused at
 * the controller before it gets here (shared/rbac/field-mask.js assertWritable), so a masked
 * value is never written back as a blank (docs/guides/foundation.md §6.16).
 */
function updateEmployee(db, employeeId, patch) {
  const keys = UPDATE_COLUMNS.filter(
    (k) => Object.prototype.hasOwnProperty.call(patch, k) && patch[k] !== undefined && patch[k] !== "",
  );
  if (keys.length === 0) return findEmployeeById(db, employeeId);
  const sets = keys.map((k, i) => `${k} = $${i + 2}`);
  return one(
    db,
    `UPDATE employee SET ${sets.join(", ")}, updated_at = now()
      WHERE employee_id = $1
      RETURNING ${EMPLOYEE_COLUMNS.replace(/\be\./g, "")}`,
    [employeeId, ...keys.map((k) => patch[k])],
  );
}

/**
 * Every field of a record that a create or a correction writes, for the audit row, so the
 * ledger names a changed salary, bank account or probation date as well as a job title
 * (shared/events/emit.js: restricted fields are kept, and masked per reader on the Audit Log).
 */
function auditRow(db, employeeId) {
  return one(
    db,
    `SELECT e.employee_id, e.status, ${[...new Set([...INSERT_COLUMNS, ...UPDATE_COLUMNS, "line_manager_seat_id", "dotted_manager_seat_id"])]
      .map((c) => (c === "staff_number" || c === "work_email" ? `e.${c}::text AS ${c}` : `e.${c}`))
      .join(", ")}
       FROM employee e WHERE e.employee_id = $1`,
    [employeeId],
  );
}

/** The employee a login's email belongs to, when a login uses this address (identity's app_user, read only). */
async function loginEmailOwner(db, email) {
  const row = await one(db, "SELECT u.employee_id FROM app_user u WHERE u.email = $1", [email]);
  return row ? row.employee_id : null;
}

/**
 * A birthday known only as a day and month (migration 1180); null for both clears it.
 * Returns the day and month before and after, for the audit; null when there is no such person.
 */
async function setBirthday(db, employeeId, { day, month }) {
  const row = await one(
    db,
    `WITH old AS (SELECT birth_day, birth_month FROM employee WHERE employee_id = $1 FOR UPDATE)
     UPDATE employee e SET birth_day = $2, birth_month = $3, updated_at = now()
       FROM old
      WHERE e.employee_id = $1
      RETURNING old.birth_day AS was_day, old.birth_month AS was_month, e.birth_day, e.birth_month`,
    [employeeId, day, month],
  );
  if (!row) return null;
  return {
    before: { birth_day: row.was_day, birth_month: row.was_month },
    after: { birth_day: row.birth_day, birth_month: row.birth_month },
  };
}

/**
 * Move a person to another staff number. A staff number is not a field of the form, so
 * it is not in UPDATE_COLUMNS: only the roster reaches this, when the sheet takes back a
 * number it says belongs to someone else.
 */
function setStaffNumber(db, employeeId, staffNumber) {
  return one(
    db,
    `UPDATE employee SET staff_number = $2, updated_at = now()
      WHERE employee_id = $1
      RETURNING ${EMPLOYEE_COLUMNS.replace(/\be\./g, "")}`,
    [employeeId, staffNumber],
  );
}

/** `leftOn`: the last day, or null to keep what is there (an import reverted names no leaver). */
function archiveEmployee(db, employeeId, reason, leftOn = null) {
  return one(
    db,
    `UPDATE employee
        SET status = 'archived', archived_at = now(), archive_reason = $2,
            left_on = COALESCE($3::date, left_on), updated_at = now()
      WHERE employee_id = $1
      RETURNING ${EMPLOYEE_COLUMNS.replace(/\be\./g, "")}`,
    [employeeId, reason, leftOn],
  );
}

function restoreEmployee(db, employeeId) {
  return one(
    db,
    `UPDATE employee
        SET status = 'active', archived_at = NULL, archive_reason = NULL, left_on = NULL, updated_at = now()
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

/**
 * True when putting `nodeId` (a person or a seat) under `managerNodeId` would close a
 * loop: the manager is the node itself, or already sits below it, through people and
 * seats alike (a seat placed under one of its own reports). Every line is walked,
 * whatever its status, so no stored line can circle.
 */
async function wouldLoop(db, nodeId, managerNodeId) {
  if (!nodeId || !managerNodeId) return false;
  if (nodeId === managerNodeId) return true;
  const row = await one(
    db,
    `WITH RECURSIVE up AS (
       SELECT $2::uuid AS node_id, 0 AS depth
       UNION ALL
       SELECT COALESCE(e.line_manager_id, e.line_manager_seat_id, s.line_manager_id, s.line_manager_seat_id),
              up.depth + 1
         FROM up
         LEFT JOIN employee e ON e.employee_id = up.node_id
         LEFT JOIN org_seat s ON s.org_seat_id = up.node_id
        WHERE up.node_id IS NOT NULL AND up.node_id <> $1::uuid AND up.depth < 64
     )
     SELECT 1 AS x FROM up WHERE node_id = $1::uuid LIMIT 1`,
    [nodeId, managerNodeId],
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
        AND ($3::uuid IS NULL OR s.department_id = $3)
      ORDER BY ${orderBy(query, SEAT_SORTS, "s.org_seat_id")}`,
    [query.q ?? null, query.status ?? null, query.department_id ?? null],
    query,
  );
  return { ...page, data: page.data.map(toSeat) };
}

async function findSeatById(db, seatId) {
  const row = await one(db, `SELECT ${SEAT_SELECT} ${SEAT_JOINS} WHERE s.org_seat_id = $1`, [seatId]);
  return row ? toSeat(row) : null;
}

/**
 * A seat by the title the sheet or a screen names, ignoring case and spacing; an open one
 * unless `includeClosed`, an open one first when it is. `departmentId` keeps to one department
 * and `createdBefore` to seats made before then (the staff importer's VACANT rows).
 * @param {{departmentId?: string|null, includeClosed?: boolean, createdBefore?: Date|string|null}} [opts]
 */
async function findSeatByTitle(db, title, { departmentId = null, includeClosed = false, createdBefore = null } = {}) {
  const row = await one(
    db,
    `SELECT ${SEAT_SELECT} ${SEAT_JOINS}
      WHERE ($3::boolean OR s.status <> 'closed')
        AND ($2::uuid IS NULL OR s.department_id = $2)
        AND ($4::timestamptz IS NULL OR s.created_at < $4)
        AND search_fold(btrim(regexp_replace(s.title, '\\s+', ' ', 'g'))) = search_fold(btrim(regexp_replace($1::text, '\\s+', ' ', 'g')))
      ORDER BY (s.status <> 'closed') DESC, s.created_at
      LIMIT 1`,
    [title, departmentId, includeClosed, createdBefore],
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

/**
 * Whether MyCity's names at this checksum were applied (organisation.service.recordNamesApplied);
 * with no checksum, whether any version ever was.
 */
async function namesApplied(db, sha256 = null) {
  const row = await one(
    db,
    `SELECT 1 AS x FROM event_log
      WHERE event_key = 'department.names_applied' AND ($1::text IS NULL OR entity_id = $1)
      LIMIT 1`,
    [sha256],
  );
  return Boolean(row);
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
            to_char(e.start_date, 'YYYY') AS since, e.work_pattern, ${photoUrlSql("e")} AS photo_url
       ${EMPLOYEE_JOINS}
      WHERE e.status = 'active'
      UNION ALL
     SELECT s.org_seat_id AS node_id, 'seat' AS node_kind, NULL::uuid AS employee_id, s.org_seat_id,
            s.title AS display_name, s.title AS job_title, d.name AS department,
            COALESCE(s.line_manager_id, s.line_manager_seat_id) AS manager_node_id,
            NULL::uuid AS dotted_manager_node_id, NULL::text AS dotted_line_to,
            false AS is_ceo, true AS vacant, NULL::text AS since, NULL::text AS work_pattern,
            NULL::text AS photo_url
       FROM org_seat s
       JOIN department d ON d.department_id = s.department_id
      WHERE s.status = 'vacant'
      ORDER BY vacant, display_name`,
    [],
    { label: "the reporting tree", ceiling: TREE_CEILING },
  );
  return rows;
}

/**
 * The highest sequence a staff number of the scheme's own shape carries (numbering.sequencePattern),
 * so numbering can be moved past it. A number of another shape is never read as a sequence: a
 * phone number in a Staff ID column once pushed every later number past eight billion.
 * @param {{query: Function}} db
 * @param {string} pattern  the scheme's sequence pattern, its one captured group the sequence
 */
async function highestStaffNumberSeq(db, pattern) {
  const row = await one(
    db,
    `SELECT COALESCE(max(substring(staff_number::text from $1)::bigint), 0)::bigint AS seq
       FROM employee
      WHERE staff_number::text ~ $1`,
    [pattern],
  );
  return row ? Number(row.seq) : 0;
}

module.exports = {
  EMPLOYEE_COLUMNS,
  setBirthday,
  photoDocumentOf,
  setPhotoDocument,
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
  findDepartmentByCode,
  departmentRow,
  headOf,
  personRef,
  codeTaken,
  insertDepartment,
  departments,
  updateDepartment,
  departmentMembers,
  departmentSeats,
  employeesByIds,
  departmentLoad,
  departmentsHeadedBy,
  activeDepartmentIds,
  usedDepartmentIds,
  deleteDepartment,
  findEmployeeByWorkEmail,
  findEmployeeByStaffNumber,
  findEmployeeById,
  findEmployeesByName,
  findEmployeesByFirstName,
  findEmployeesByFirstAndLast,
  importedByRoster,
  employeeInUse,
  importSnapshot,
  namesApplied,
  findEmployeesByJobTitle,
  jobTitles,
  seatTitles,
  findCeoEmployee,
  insertEmployee,
  updateEmployee,
  auditRow,
  loginEmailOwner,
  setStaffNumber,
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
