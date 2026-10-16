"use strict";
/**
 * Organisation's SQL: departments and employees (migration 0040).
 *
 * First cut, for the first login (create-admin) and invitations: find and create.
 * The People · Employees list, edits and reporting lines join this file with the
 * organisation module's routes.
 */
const one = async (db, sql, params) => (await db.query(sql, params)).rows[0] || null;

const EMPLOYEE_COLUMNS = `
  e.employee_id, e.number::text AS number, e.first_name, e.last_name, e.work_email::text AS work_email,
  e.phone, e.job_title, e.department_id, e.line_manager_id, e.worksite_id, e.employment_type,
  e.work_pattern, e.status, e.start_date, e.created_at`;

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
  return one(
    db,
    `INSERT INTO employee
       (number, first_name, last_name, work_email, phone, job_title, department_id,
        worksite_id, line_manager_id, employment_type, work_pattern, start_date, profile)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb)
     RETURNING ${EMPLOYEE_COLUMNS.replace(/\be\./g, "")}`,
    [
      e.number,
      e.first_name,
      e.last_name,
      e.work_email,
      e.phone,
      e.job_title,
      e.department_id,
      e.worksite_id || null,
      e.line_manager_id || null,
      e.employment_type,
      e.work_pattern,
      e.start_date,
      JSON.stringify(e.profile || {}),
    ],
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
