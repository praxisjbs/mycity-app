"use strict";
/**
 * Organisation: departments and employees, the one write path for both.
 *
 * First cut, for the first login (scripts/db/create-admin.js) and invitations:
 * find a department or employee, create one. Every create runs in the caller's
 * transaction, takes its number from numbering and records itself with emit(), so a
 * script and a screen create the same thing.
 *
 * EmployeeCreate (packages/contract/schemas/organisation.js) carries a few fields
 * migration 0040 has no column for yet (date of birth, next of kin, bank, gross pay);
 * they are kept on `employee.profile` until the employee migration gives them columns.
 */
const { emit } = require("../../shared/events/emit");
const { AppError } = require("../../shared/errors");
const numbering = require("../../shared/numbering/numbering");
const repo = require("./organisation.repo");
const { EVENTS } = require("./organisation.events");

const PROFILE_FIELDS = [
  "date_of_birth",
  "next_of_kin",
  "bank_name",
  "account_number",
  "gross_monthly",
];

const findDepartmentByName = (client, name) => repo.findDepartmentByName(client, name);
const findEmployeeByWorkEmail = (client, email) =>
  repo.findEmployeeByWorkEmail(client, email);
const findEmployeeById = (client, employeeId) => repo.findEmployeeById(client, employeeId);

/** "HR & Operations" → "HR_OPERATIONS"; a number is added when the code is taken. */
async function departmentCode(client, name) {
  const base =
    String(name)
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || "DEPARTMENT";
  for (let n = 1; n < 100; n += 1) {
    const code = n === 1 ? base : `${base}_${n}`;
    if (!(await repo.codeTaken(client, code))) return code;
  }
  throw new AppError("DEPARTMENT_CODE", "Could not name this department.", 409);
}

/**
 * @param {import("pg").PoolClient} client  inside atomically()
 * @param {{name: string}} input
 * @param {object} actor
 */
async function createDepartment(client, { name }, actor) {
  const department = await repo.insertDepartment(client, {
    code: await departmentCode(client, name),
    name: String(name).trim(),
  });
  await emit(client, {
    key: EVENTS.DEPARTMENT_CREATED,
    entity: { type: "department", id: department.department_id },
    actor,
    after: department,
  });
  return department;
}

/**
 * @param {import("pg").PoolClient} client  inside atomically()
 * @param {object} body  EmployeeCreate, already parsed
 * @param {object} actor
 * @returns {Promise<object>} the employee, with employee_id and number
 */
async function createEmployee(client, body, actor) {
  if (await repo.findEmployeeByWorkEmail(client, body.work_email)) {
    throw new AppError("EMPLOYEE_EXISTS", "An employee already has this work email.", 409, {
      work_email: ["Already in use"],
    });
  }
  const number = body.staff_number
    ? body.staff_number
    : (await numbering.allocate(client, "employee", { date: body.start_date })).number;
  const profile = {};
  for (const k of PROFILE_FIELDS) if (body[k] !== undefined) profile[k] = body[k];

  const employee = await repo.insertEmployee(client, { ...body, number, profile });
  await emit(client, {
    key: EVENTS.EMPLOYEE_CREATED,
    entity: { type: "employee", id: employee.employee_id },
    actor,
    after: { ...employee, profile },
    payload: { employee_id: employee.employee_id, number: employee.number },
  });
  return employee;
}

module.exports = {
  findDepartmentByName,
  createDepartment,
  findEmployeeByWorkEmail,
  findEmployeeById,
  createEmployee,
};
