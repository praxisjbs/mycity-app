"use strict";
/**
 * What Praxis AI's People cards name, re-check and run (docs/guides/praxis-ai.md §6.11, decision
 * 33; docs/guides/organogram.md §9): Add Employee, Save Record, Save Line, Add Department, Save
 * Department, Add Role and Save Role. Each runs the function the screen's own button reaches
 * (organisation.service), in a transaction of its own as the controller runs it, under the
 * controller's own rules: a record in the reader's `people` scope, a field their role hides never
 * theirs to set, a department changed only with the grant over everyone.
 *
 *   peopleNamed(db, ids)            the people a card's fields hold, by name
 *   cardEmployee(), assertCardEmployee()     the record a card changes, named, and its re-check
 *   cardDepartment(), departmentIdOf(), assertAllPeople(), assertCardDepartment()
 *   cardSeat(), seatIdOf(), assertCardSeat()
 *   addEmployee(), editEmployee(), editReporting(), addDepartment(), editDepartment(), addSeat(), editSeat()
 */
const c = require("@mycity/contract");
const { pool } = require("../../config/db");
const { atomically } = require("../../shared/db/tx");
const { AppError } = require("../../shared/errors");
const { assertInScope } = require("../../shared/rbac/scope");
const { assertWritable } = require("../../shared/rbac/field-mask");
const { oneNamed } = require("../../shared/ai/named");
const repo = require("./organisation.repo");
const service = require("./organisation.service");

const isId = (v) => c.common.uuid.safeParse(v).success;

/** One write in its own transaction, as the controller runs the screen's. */
async function inTx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

/** The people a card's fields hold, by name; an id that is nobody's is left out, and the card marks it Pick one. */
async function peopleNamed(db, ids) {
  const wanted = [...new Set((Array.isArray(ids) ? ids : [ids]).filter(isId))].slice(0, 50);
  if (!db || !wanted.length) return [];
  const names = await repo.namesOf(db, wanted);
  return wanted.filter((id) => names.get(id)).map((id) => ({ type: "employee", id, label: names.get(id).display_name }));
}

/** Is this person in the reader's reach? */
const reaches = (scope, employeeId) => {
  try {
    assertInScope(scope, employeeId);
    return true;
  } catch {
    return false;
  }
};

/** The record a card changes, by name, when it is in the reader's `people` scope; nothing otherwise. */
async function cardEmployee(db, employeeId, scope) {
  if (!db || !isId(employeeId) || !reaches(scope, employeeId)) return [];
  return peopleNamed(db, [employeeId]);
}

/** The card's re-check (§6.11 step 5): the record exists and is the reader's to open, as Edit Record's own. */
async function assertCardEmployee(db, employeeId, scope) {
  const row = isId(employeeId) ? await repo.findEmployeeById(db, employeeId) : null;
  if (!row || !reaches(scope, employeeId)) throw new AppError("NOT_FOUND", "That employee does not exist", 404, { employee_id: ["No such person"] });
}

/** A field the reader's role hides is not theirs to set (field-mask), as the screen's own routes refuse it. */
const assertMayWrite = (actor, values, employeeId = null) => assertWritable(pool, actor, values, { own: Boolean(employeeId) && employeeId === actor.employee_id });

/** Add Employee's re-check: nothing the reader's role hides. */
const assertMayAdd = (actor, values) => assertMayWrite(actor, values);

/** A department by its name or code, among the departments in use (those the words find, then the first page); null when none or several. */
async function departmentIdOf(db, words) {
  const pages = await Promise.all([repo.departments(db, { page: 1, active: "true", q: String(words).slice(0, 100) }), repo.departments(db, { page: 1, active: "true" })]);
  const byId = new Map(pages.flatMap((p) => p.data || []).map((d) => [d.department_id, d]));
  const found = oneNamed([...byId.values()], words, (d) => [d.name, d.code]);
  return found ? found.department_id : null;
}

/** A department a card names, by its name. */
async function cardDepartment(db, departmentId) {
  if (!db || !isId(departmentId)) return [];
  const row = await repo.findDepartmentById(db, departmentId);
  return row ? [{ type: "department", id: departmentId, label: row.name }] : [];
}

/** Departments are the company's: changed only with the `people` grant over everyone (organogram.md §6.1, §8). */
function assertAllPeople(scope) {
  if (!scope || scope.scope !== "all") throw new AppError("FORBIDDEN", "Only People with access to everyone change departments.", 403);
}

/** The card's re-check for a department: the grant over everyone, and the department there. */
async function assertCardDepartment(db, departmentId, scope) {
  assertAllPeople(scope);
  const row = isId(departmentId) ? await repo.findDepartmentById(db, departmentId) : null;
  if (!row) throw new AppError("NOT_FOUND", "That department does not exist", 404, { department_id: ["No such department"] });
}

/** An open role by its title; null when none matches. */
async function seatIdOf(db, words) {
  const seat = await repo.findSeatByTitle(db, words);
  return seat ? seat.org_seat_id : null;
}

/** A role a card names, by its title and department. */
async function cardSeat(db, seatId) {
  if (!db || !isId(seatId)) return [];
  const seat = await repo.findSeatById(db, seatId);
  return seat ? [{ type: "org_seat", id: seatId, label: seat.department ? `${seat.title}, ${seat.department}` : seat.title }] : [];
}

/** The card's re-check for a role: it is there, and open (a filled one changes with its person). */
async function assertCardSeat(db, seatId) {
  const seat = isId(seatId) ? await repo.findSeatById(db, seatId) : null;
  if (!seat) throw new AppError("NOT_FOUND", "That role does not exist", 404, { org_seat_id: ["No such role"] });
}

/** Add Employee: the record through the screen's own function, no field the reader's role hides. */
async function addEmployee(actor, body) {
  await assertMayWrite(actor, body);
  return inTx((client) => service.createEmployee(client, body, actor));
}

/** Save Record: Edit Record's own function, a new department moving the person as People · Departments does. */
async function editEmployee(actor, employeeId, changes) {
  await assertCardEmployee(pool, employeeId, actor.scope);
  await assertMayWrite(actor, changes, employeeId);
  return inTx((client) => service.updateEmployee(client, employeeId, changes, actor, { followHead: true }));
}

/** Save Line: who the person reports to, through the Reporting Line form's own function. */
async function editReporting(actor, employeeId, body) {
  await assertCardEmployee(pool, employeeId, actor.scope);
  await inTx((client) => service.setReportingLine(client, employeeId, body, actor));
  return repo.findEmployeeById(pool, employeeId);
}

/** Add Department, with the grant over everyone. */
async function addDepartment(actor, body) {
  assertAllPeople(actor.scope);
  return inTx((client) => service.createDepartment(client, body, actor));
}

/** Save Department, with the grant over everyone: its words, head, or retired and restored. */
async function editDepartment(actor, departmentId, changes) {
  assertAllPeople(actor.scope);
  return inTx((client) => service.updateDepartment(client, departmentId, changes, actor));
}

/** Add Role: an open role on the Organogram. */
const addSeat = (actor, body) => inTx((client) => service.createSeat(client, body, actor));

/** Save Role: Edit Open Role's own function. */
const editSeat = (actor, seatId, changes) => inTx((client) => service.updateSeat(client, seatId, changes, actor));

module.exports = {
  peopleNamed,
  cardEmployee,
  assertCardEmployee,
  assertMayAdd,
  cardDepartment,
  departmentIdOf,
  assertAllPeople,
  assertCardDepartment,
  cardSeat,
  seatIdOf,
  assertCardSeat,
  addEmployee,
  editEmployee,
  editReporting,
  addDepartment,
  editDepartment,
  addSeat,
  editSeat,
};
