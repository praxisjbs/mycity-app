"use strict";
/**
 * Organisation's SQL: departments and employees (migration 0040).
 *
 * First cut, for the first login (create-admin) and invitations: find and create.
 * The People · Employees list, edits and reporting lines join this file with the
 * organisation module's routes.
 */
const one = async (db, sql, params) => (await db.query(sql, params)).rows[0] || null;

/** What a create returns and the audit records: no restricted field (bank, pay). */
const EMPLOYEE_COLUMNS = `
  e.employee_id, e.staff_number::text AS staff_number, e.first_name, e.last_name,
  e.work_email::text AS work_email, e.phone, e.job_title, e.department_id, e.line_manager_id,
  e.dotted_manager_id, e.worksite_id, e.employment_type, e.work_pattern, e.status, e.start_date,
  e.created_at`;

/** The columns an EmployeeCreate fills (migrations 0040 and 0110), in insert order. */
const INSERT_COLUMNS = [
  "staff_number",
  "first_name",
  "last_name",
  "work_email",
  "phone",
  "job_title",
  "department_id",
  "worksite_id",
  "line_manager_id",
  "dotted_manager_id",
  "employment_type",
  "work_pattern",
  "start_date",
  "gender",
  "date_of_birth",
  "next_of_kin_name",
  "next_of_kin_phone",
  "next_of_kin_relationship",
  "bank_name",
  "account_number",
  "gross_monthly",
];

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

async function codeTaken(db, code) {
  return Boolean(await one(db, "SELECT 1 AS x FROM department WHERE code = $1", [code]));
}

function insertDepartment(db, { code, name }) {
  return one(
    db,
    `INSERT INTO department (code, name) VALUES ($1, $2)
     RETURNING department_id, code::text AS code, name, active, created_at`,
    [code, name],
  );
}

function findEmployeeByWorkEmail(db, email) {
  return one(db, `SELECT ${EMPLOYEE_COLUMNS} FROM employee e WHERE e.work_email = $1`, [email]);
}

function findEmployeeById(db, employeeId) {
  return one(db, `SELECT ${EMPLOYEE_COLUMNS} FROM employee e WHERE e.employee_id = $1`, [employeeId]);
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

module.exports = {
  findDepartmentByName,
  codeTaken,
  insertDepartment,
  findEmployeeByWorkEmail,
  findEmployeeById,
  insertEmployee,
};
