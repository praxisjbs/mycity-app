"use strict";
/**
 * Organisation: departments, employees, reporting lines and vacant seats, with one
 * write path for all of them (docs/guides/foundation.md §5, docs/guides/organogram.md §5).
 *
 * A screen, the staff importer, the roster loader and `scripts/db/create-admin.js` all
 * create and change people through the functions here, so numbering, audit, events and
 * the rules below apply whatever the entry point. Every write runs in the caller's
 * transaction and records itself with emit().
 *
 * Every EmployeeCreate field is a column (migrations 0040, 0110, 0210, 0300). The
 * restricted ones (bank, account, gross pay, personal details) are written here and
 * masked on the way out, in the controller (shared/rbac/field-mask.js).
 */
const crypto = require("node:crypto");
const { emit } = require("../../shared/events/emit");
const { AppError } = require("../../shared/errors");
const documents = require("../../shared/documents/generate");
const exportFiles = require("../../shared/documents/exports");
const numbering = require("../../shared/numbering/numbering");
const lagos = require("../../shared/time/lagos");
const routeMap = require("../../shared/route-map");
const managerText = require("./manager-text");
const { layout } = require("./org-chart.layout");
const repo = require("./organisation.repo");
const places = require("../../shared/places/places");
const { employeeDateProblems } = require("@mycity/contract").organisation;

/** A person's home address field (shared/places/owners.js). */
const HOME = "employee.home_address";
const { EVENTS, CHART_DOC_TYPE, CHART_EXPORT } = require("./organisation.events");

const findDepartmentByName = (client, name) => repo.findDepartmentByName(client, name);
const findEmployeeByWorkEmail = (client, email) => repo.findEmployeeByWorkEmail(client, email);
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
 * @param {{name: string, parent_department_id?: string, description?: string}} input
 * @param {object} actor
 */
async function createDepartment(client, input, actor) {
  const name = String(input.name).trim();
  const existing = await repo.findDepartmentByName(client, name);
  if (existing)
    throw new AppError("DEPARTMENT_EXISTS", "There is already a department with this name.", 409, {
      name: ["Already in use"],
    });
  await assertHead(client, input);
  const inserted = await repo.insertDepartment(client, {
    code: input.code ? await freeDepartmentCode(client, input.code) : await departmentCode(client, name),
    name,
    parent_department_id: input.parent_department_id ?? null,
    description: input.description ?? null,
    head_employee_id: input.head_employee_id ?? null,
    head_seat_id: input.head_seat_id ?? null,
  });
  const department = await withActingHead(client, await repo.departmentRow(client, inserted.department_id));
  await emit(client, {
    key: EVENTS.DEPARTMENT_CREATED,
    entity: { type: "department", id: department.department_id },
    actor,
    after: inserted,
  });
  return department;
}

async function updateDepartment(client, departmentId, patch, actor) {
  const before = await repo.findDepartmentById(client, departmentId);
  if (!before) throw new AppError("NOT_FOUND", "Not found", 404);
  if (patch.parent_department_id && patch.parent_department_id === departmentId)
    throw new AppError("DEPARTMENT_PARENT", "A department cannot sit inside itself.", 422, {
      parent_department_id: ["Not itself"],
    });
  const change = { ...patch };
  // A head is a person or a vacant seat: naming one clears the other.
  if (change.head_employee_id) change.head_seat_id = null;
  if (change.head_seat_id) change.head_employee_id = null;
  await assertHead(client, change);
  if (change.code !== undefined) {
    const code = change.code.toUpperCase();
    if (code !== before.code && (await repo.codeTaken(client, code)))
      throw new AppError("DEPARTMENT_CODE", "Another department has this code.", 409, { code: ["Already in use"] });
    change.code = code;
  }
  const after = await repo.updateDepartment(client, departmentId, change);
  await emit(client, {
    key: EVENTS.DEPARTMENT_UPDATED,
    entity: { type: "department", id: departmentId },
    actor,
    before,
    after,
  });
  return withActingHead(client, await repo.departmentRow(client, departmentId));
}

/** The head named must exist: an employee, or a seat. */
async function assertHead(client, input) {
  if (input.head_employee_id && !(await repo.findEmployeeById(client, input.head_employee_id)))
    throw new AppError("VALIDATION_FAILED", "Pick someone who works here.", 422, { head_employee_id: ["Not found"] });
  if (input.head_seat_id && !(await repo.findSeatById(client, input.head_seat_id)))
    throw new AppError("VALIDATION_FAILED", "Pick a seat on the chart.", 422, { head_seat_id: ["Not found"] });
}

/** A code a person chose, upper-cased, refused when another department has it. */
async function freeDepartmentCode(client, code) {
  const wanted = String(code).toUpperCase();
  if (await repo.codeTaken(client, wanted))
    throw new AppError("DEPARTMENT_CODE", "Another department has this code.", 409, { code: ["Already in use"] });
  return wanted;
}

/**
 * Who acts as a department's head (docs/guides/performance.md §6.13, §6.20): its head, the
 * person in its head seat, or the first person above a vacant head seat. Null when none.
 * @param {{query: Function}} db
 * @param {string} departmentId
 * @returns {Promise<string|null>} an employee id
 */
const headOf = (db, departmentId) => repo.headOf(db, departmentId);

/** A department row with the person who acts as its head. */
async function withActingHead(db, row) {
  if (!row) return row;
  const acting = await repo.headOf(db, row.department_id);
  return { ...row, acting_head: await repo.personRef(db, acting) };
}

/** The department with this name, or a new one. Used by create-admin and the importer. */
async function findOrCreateDepartment(client, name, actor) {
  return (
    (await repo.findDepartmentByName(client, name)) || createDepartment(client, { name }, actor)
  );
}

/**
 * Keep the staff-number counter above every number already issued, so the next person
 * added on screen cannot be given a number an imported sheet already used
 * (docs/DATABASE_SCHEMA.md M0: the importer moves the counter past imported numbers). Only
 * numbers of the scheme's own shape count (numbering.sequencePattern), in the period of
 * `date` for a scheme that resets.
 */
async function advanceStaffNumbers(client, { date } = {}) {
  const { pattern } = await numbering.sequenceOf(client, "employee", { date });
  if (!pattern) return 0;
  const highest = await repo.highestStaffNumberSeq(client, pattern);
  if (highest > 0) await numbering.advanceTo(client, "employee", highest, { date });
  return highest;
}

/**
 * Move the counter past a staff number someone gave, before the record that carries it is
 * written. Taking the counter first is the order allocate() takes it, so a create with a
 * number and a create without one cannot wait on each other. A number of another shape
 * leaves the counter alone.
 */
async function advancePast(client, staffNumber, date) {
  const { pattern } = await numbering.sequenceOf(client, "employee", { date });
  const m = pattern ? new RegExp(pattern).exec(staffNumber) : null;
  if (m) await numbering.advanceTo(client, "employee", Number(m[1]), { date });
}

/** The answer for a work email already on a record: an archived holder is named, since the register hides them. */
function emailTaken(holder) {
  if (holder.status === "archived")
    return new AppError("EMPLOYEE_EXISTS", "An archived record has this work email. Restore it instead.", 409, {
      work_email: ["Archived record"],
    });
  return new AppError("EMPLOYEE_EXISTS", "An employee already has this work email.", 409, {
    work_email: ["Already in use"],
  });
}

/**
 * A work email the person may hold: no other record has it, and no other person's login
 * signs in with it (a login keeps its address until it follows, docs/guides/identity.md §6).
 */
async function assertWorkEmailFree(client, email, employeeId = null) {
  const holder = await repo.findEmployeeByWorkEmail(client, email);
  if (holder && holder.employee_id !== employeeId) throw emailTaken(holder);
  const owner = await repo.loginEmailOwner(client, email);
  if (owner && owner !== employeeId)
    throw new AppError("LOGIN_EMAIL_TAKEN", "Another person's login signs in with this email.", 409, {
      work_email: ["Used by a login"],
    });
}

/** The department, line and dotted managers and worksite a record names exist and are in use. */
async function assertReferences(client, body, employeeId = null) {
  if (body.department_id) {
    const department = await repo.findDepartmentById(client, body.department_id);
    if (!department || department.active === false)
      throw new AppError("DEPARTMENT_NOT_FOUND", "Pick a department in use.", 422, {
        department_id: ["Not a department"],
      });
  }
  for (const key of ["line_manager_id", "dotted_manager_id"]) {
    const id = body[key];
    if (!id) continue;
    if (id === employeeId)
      throw new AppError("REPORTS_TO_SELF", "Nobody reports to themselves.", 422, { [key]: ["Not themselves"] });
    const manager = await repo.findEmployeeById(client, id);
    if (!manager || manager.status !== "active")
      throw new AppError("MANAGER_NOT_FOUND", "Pick a manager who works here now.", 422, {
        [key]: ["Not an employee"],
      });
  }
  if (body.worksite_id) {
    // Required here, not at the top: worksites.service requires this file.
    const site = await require("../worksites/worksites.service").fenceFor(client, body.worksite_id);
    if (!site)
      throw new AppError("WORKSITE_NOT_FOUND", "Pick a worksite in use.", 422, { worksite_id: ["Not a worksite"] });
  }
}

/**
 * The order an employee's dates keep (the contract's employeeDateProblems, the same rule a form
 * checks as it is filled), and two that need today: a birthday and a probation confirmation are
 * never in the future. Applied to a whole record, so a correction is checked against what is stored.
 */
function assertDates(record, only = null) {
  const today = lagos.today();
  let problems = employeeDateProblems(record);
  if (record.date_of_birth && record.date_of_birth > today) problems.push({ path: "date_of_birth", message: "Not in the future" });
  if (record.confirmed_on && record.confirmed_on > today) problems.push({ path: "confirmed_on", message: "Not in the future" });
  // A correction answers for the dates it touches: a stored oddity never blocks an unrelated edit.
  if (only) problems = problems.filter((p) => only.includes(p.path));
  if (!problems.length) return;
  const fields = {};
  for (const p of problems) fields[p.path] = [p.message];
  throw new AppError("EMPLOYEE_DATES", "Check the dates.", 422, fields);
}

/**
 * Two saves racing with one work email or staff number both pass the checks above; the
 * database refuses the second, and this names its field as the checks would have.
 */
function uniqueRefusal(err) {
  if (err && err.code === "23505") {
    if (/work_email/.test(err.constraint || ""))
      return new AppError("EMPLOYEE_EXISTS", "An employee already has this work email.", 409, { work_email: ["Already in use"] });
    if (/number/.test(err.constraint || ""))
      return new AppError("STAFF_NUMBER_TAKEN", "Another employee has this staff number.", 409, { staff_number: ["Already in use"] });
  }
  return err;
}

/**
 * Add a person. Every check names its field, so a form shows what to fix where it is
 * (docs/guides/foundation.md §6.16).
 * @param {import("pg").PoolClient} client  inside atomically()
 * @param {object} body  EmployeeCreate (or EmployeeAdd), already parsed; or the importer's row
 * @param {object} actor
 * @returns {Promise<object>} the employee, with employee_id and staff_number
 */
async function createEmployee(client, body, actor) {
  await assertWorkEmailFree(client, body.work_email);
  if (body.staff_number && (await repo.findEmployeeByStaffNumber(client, body.staff_number))) {
    throw new AppError("STAFF_NUMBER_TAKEN", "Another employee has this staff number.", 409, {
      staff_number: ["Already in use"],
    });
  }
  await assertReferences(client, body);
  assertDates(body);
  if (body.staff_number) await advancePast(client, body.staff_number, body.start_date);
  const staffNumber = body.staff_number
    ? body.staff_number
    : (await numbering.allocate(client, "employee", { date: body.start_date })).number;

  const home = body.home_address;
  let employee;
  try {
    employee = await repo.insertEmployee(client, {
      ...body,
      home_address: home ? places.lineOf(home) : null,
      staff_number: staffNumber,
    });
  } catch (err) {
    throw uniqueRefusal(err);
  }
  if (home) await places.save(client, HOME, employee.employee_id, home, { field: "home_address" });
  if (employee.line_manager_id)
    await repo.recordReportingLine(
      client,
      employee.employee_id,
      employee.line_manager_id,
      employee.start_date || lagos.today(),
    );
  await emit(client, {
    key: EVENTS.EMPLOYEE_CREATED,
    entity: { type: "employee", id: employee.employee_id },
    actor,
    after: await repo.auditRow(client, employee.employee_id),
    payload: { employee_id: employee.employee_id, staff_number: employee.staff_number },
  });
  return employee;
}

/** PATCH /employees/:id: correct a record. */
async function updateEmployee(client, employeeId, patch, actor) {
  const before = await repo.auditRow(client, employeeId);
  if (!before) throw new AppError("NOT_FOUND", "Not found", 404);
  if (patch.work_email && patch.work_email.toLowerCase() !== String(before.work_email).toLowerCase())
    await assertWorkEmailFree(client, patch.work_email, employeeId);
  await assertReferences(
    client,
    {
      ...(patch.department_id && patch.department_id !== before.department_id ? { department_id: patch.department_id } : {}),
      ...(patch.worksite_id && patch.worksite_id !== before.worksite_id ? { worksite_id: patch.worksite_id } : {}),
    },
    employeeId,
  );
  const given = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined && v !== ""));
  const dated = ["contract_ends_on", "confirmation_due_on", "confirmed_on", "date_of_birth"];
  assertDates({ ...before, ...given }, "start_date" in given ? dated : dated.filter((k) => k in given));
  const change = { ...patch };
  // The home address is a place (F27), kept through shared/places; the record keeps its line.
  if (patch.home_address !== undefined)
    change.home_address = (await places.save(client, HOME, employeeId, patch.home_address, { field: "home_address" })).line;
  let after;
  try {
    after = await repo.updateEmployee(client, employeeId, change);
  } catch (err) {
    throw uniqueRefusal(err);
  }
  await emit(client, {
    key: EVENTS.EMPLOYEE_UPDATED,
    entity: { type: "employee", id: employeeId },
    actor,
    before,
    after: await repo.auditRow(client, employeeId),
  });
  return after;
}

/**
 * Record a birthday known only as a day and month, for the celebrations (migration 1180).
 * A full date_of_birth wins wherever both exist.
 *
 * @param {import("pg").PoolClient} client  inside atomically()
 */
async function setBirthday(client, employeeId, { day, month }, actor) {
  const change = await repo.setBirthday(client, employeeId, { day, month });
  if (!change) throw new AppError("NOT_FOUND", "Not found", 404);
  await emit(client, {
    key: EVENTS.EMPLOYEE_UPDATED,
    entity: { type: "employee", id: employeeId },
    actor,
    before: change.before,
    after: change.after,
  });
  return change.after;
}

/**
 * Give a person the next free staff number, so the roster can take back a number its
 * sheet says belongs to somebody else. The counter is moved past every number already
 * in use first, so the new one is above them all; a number taken in the meantime is
 * stepped over rather than failing the row.
 *
 * @param {import("pg").PoolClient} client  inside atomically()
 * @returns {Promise<object>} the person, on their new number
 */
async function renumberEmployee(client, employeeId, actor) {
  const before = await repo.findEmployeeById(client, employeeId);
  if (!before) throw new AppError("NOT_FOUND", "Not found", 404);
  await advanceStaffNumbers(client, { date: before.start_date });
  let number = null;
  for (let tries = 0; tries < 50 && number === null; tries += 1) {
    const next = (await numbering.allocate(client, "employee", { date: before.start_date })).number;
    if (!(await repo.findEmployeeByStaffNumber(client, next))) number = next;
  }
  if (number === null)
    throw new AppError("STAFF_NUMBER_TAKEN", "No free staff number to move this person to.", 409, {
      staff_number: ["Already in use"],
    });
  const after = await repo.setStaffNumber(client, employeeId, number);
  await emit(client, {
    key: EVENTS.EMPLOYEE_UPDATED,
    entity: { type: "employee", id: employeeId },
    actor,
    before,
    after,
  });
  return after;
}

/** Archive a record: off every list and out of the tree, its history kept. */
async function archiveEmployee(client, employeeId, reason, actor) {
  const before = await repo.findEmployeeById(client, employeeId);
  if (!before) throw new AppError("NOT_FOUND", "Not found", 404);
  if (before.status === "archived")
    throw new AppError("ALREADY_ARCHIVED", "This record is already archived.", 422);
  const ceo = await repo.findCeoEmployee(client);
  if (ceo && ceo.employee_id === employeeId)
    throw new AppError("CEO_PROTECTED", "The CEO's record cannot be archived.", 422);
  const after = await repo.archiveEmployee(client, employeeId, reason);
  await emit(client, {
    key: EVENTS.EMPLOYEE_ARCHIVED,
    entity: { type: "employee", id: employeeId },
    actor,
    before,
    after,
    metadata: { archive_reason: reason },
  });
  return after;
}

async function restoreEmployee(client, employeeId, actor) {
  const before = await repo.findEmployeeById(client, employeeId);
  if (!before) throw new AppError("NOT_FOUND", "Not found", 404);
  if (before.status !== "archived")
    throw new AppError("NOT_ARCHIVED", "This record is not archived.", 422);
  const after = await repo.restoreEmployee(client, employeeId);
  await emit(client, {
    key: EVENTS.EMPLOYEE_RESTORED,
    entity: { type: "employee", id: employeeId },
    actor,
    before,
    after,
  });
  return after;
}

/**
 * Set who someone reports to: a person or a vacant seat, solid or dotted. The same write
 * a drag on the organogram and the employee form both make (docs/guides/organogram.md §3).
 */
async function setReportingLine(client, employeeId, input, actor) {
  const before = await repo.findEmployeeById(client, employeeId);
  if (!before) throw new AppError("NOT_FOUND", "Not found", 404);
  const patch = {};
  if ("line_manager_id" in input) {
    patch.line_manager_id = input.line_manager_id ?? null;
    patch.line_manager_seat_id = null;
  }
  if ("line_manager_seat_id" in input) {
    patch.line_manager_seat_id = input.line_manager_seat_id ?? null;
    if (input.line_manager_seat_id) patch.line_manager_id = null;
  }
  if ("dotted_manager_id" in input) {
    patch.dotted_manager_id = input.dotted_manager_id ?? null;
    patch.dotted_manager_seat_id = null;
  }
  if ("dotted_manager_seat_id" in input) {
    patch.dotted_manager_seat_id = input.dotted_manager_seat_id ?? null;
    if (input.dotted_manager_seat_id) patch.dotted_manager_id = null;
  }
  if (Object.keys(patch).length === 0)
    throw new AppError("NOTHING_TO_CHANGE", "Name the manager to set.", 422);

  for (const [key, id] of [
    ["line_manager_id", patch.line_manager_id],
    ["dotted_manager_id", patch.dotted_manager_id],
  ]) {
    if (!id) continue;
    if (id === employeeId)
      throw new AppError("REPORTS_TO_SELF", "Nobody reports to themselves.", 422, {
        [key]: ["Not themselves"],
      });
    const manager = await repo.findEmployeeById(client, id);
    if (!manager || manager.status !== "active")
      throw new AppError("MANAGER_NOT_FOUND", "That manager is not on the staff list now.", 422, {
        [key]: ["Not an employee"],
      });
  }
  for (const [key, id] of [
    ["line_manager_seat_id", patch.line_manager_seat_id],
    ["dotted_manager_seat_id", patch.dotted_manager_seat_id],
  ]) {
    if (id && !(await repo.findSeatById(client, id)))
      throw new AppError("SEAT_NOT_FOUND", "That seat is not in the structure.", 422, {
        [key]: ["Not a seat"],
      });
  }
  const above = patch.line_manager_id || patch.line_manager_seat_id;
  if (above && (await repo.wouldLoop(client, employeeId, above))) {
    throw new AppError(
      "REPORTING_LOOP",
      "That would make a loop in the reporting line.",
      422,
      { [patch.line_manager_id ? "line_manager_id" : "line_manager_seat_id"]: ["Would make a loop"] },
    );
  }

  const after = await repo.setReporting(client, employeeId, patch);
  if ("line_manager_id" in patch || "line_manager_seat_id" in patch)
    await repo.recordReportingLine(client, employeeId, after.line_manager_id, lagos.today());
  await emit(client, {
    key: EVENTS.EMPLOYEE_REPORTING_LINE_CHANGED,
    entity: { type: "employee", id: employeeId },
    actor,
    before,
    after,
    payload: {
      employee_id: employeeId,
      line_manager_id: after.line_manager_id,
      dotted_manager_id: after.dotted_manager_id,
    },
    metadata: input.reason ? { reason: input.reason } : undefined,
  });
  return after;
}

/* ------------------------------------------------------------------ *
 * Vacant seats
 * ------------------------------------------------------------------ */

async function createSeat(client, input, actor) {
  if (!(await repo.findDepartmentById(client, input.department_id)))
    throw new AppError("DEPARTMENT_NOT_FOUND", "Pick a department that exists.", 422, {
      department_id: ["Not a department"],
    });
  const seat = await repo.insertSeat(client, input);
  await emit(client, {
    key: EVENTS.ORG_SEAT_CREATED,
    entity: { type: "org_seat", id: seat.org_seat_id },
    actor,
    after: seat,
  });
  return seat;
}

async function updateSeat(client, seatId, patch, actor) {
  const before = await repo.findSeatById(client, seatId);
  if (!before) throw new AppError("NOT_FOUND", "Not found", 404);
  if (patch.line_manager_seat_id && patch.line_manager_seat_id === seatId)
    throw new AppError("SEAT_PARENT", "A seat cannot report to itself.", 422, {
      line_manager_seat_id: ["Not itself"],
    });
  if (before.status === "filled" && patch.status)
    throw new AppError("SEAT_FILLED", "This seat is filled; archive the person instead.", 422);
  /* A seat reports to a person or to another seat, never both: naming one clears the
     other, exactly as setting an employee's line does. */
  const change = { ...patch };
  if ("line_manager_id" in change && change.line_manager_id) change.line_manager_seat_id = null;
  if ("line_manager_seat_id" in change && change.line_manager_seat_id) change.line_manager_id = null;
  const above = change.line_manager_id || change.line_manager_seat_id;
  if (above && (await repo.wouldLoop(client, seatId, above)))
    throw new AppError("REPORTING_LOOP", "That would make a loop in the reporting line.", 422, {
      [change.line_manager_id ? "line_manager_id" : "line_manager_seat_id"]: ["Would make a loop"],
    });
  const after = await repo.updateSeat(client, seatId, change);
  await emit(client, {
    key: EVENTS.ORG_SEAT_UPDATED,
    entity: { type: "org_seat", id: seatId },
    actor,
    before,
    after,
  });
  return after;
}

/** The seat with this title, or a new one (the importer's VACANT rows). */
async function findOrCreateSeat(client, { title, department_id: departmentId }, actor) {
  const existing = await repo.findSeatByTitle(client, title);
  if (existing) return { seat: existing, created: false };
  const seat = await createSeat(client, { title, department_id: departmentId }, actor);
  return { seat, created: true };
}

/* ------------------------------------------------------------------ *
 * Reads
 * ------------------------------------------------------------------ */

const list = (client, query, scope) => repo.list(client, query, scope);
async function departments(client, query) {
  const page = await repo.departments(client, query);
  const data = [];
  for (const row of page.data) data.push(await withActingHead(client, row));
  return { ...page, data };
}
const seats = (client, query) => repo.seats(client, query);
const historyOf = (client, employeeId, query) => repo.historyOf(client, employeeId, query);

/** A screen's own URL, derived and never stored (shared/route-map.js). */
const screen = (module, tab) => routeMap.screenPath(module, tab);

/**
 * Headcount, attrition over 90 days and confirmations due in the next 30, as the
 * register's counts define them, for whoever else shows them (Home's cards). One
 * definition: People · Employees and Home read the same SQL.
 *
 * @param {{query: Function}} client
 * @param {{scope: string, scope_ids: string[]|null}} scope
 * @param {{today?: string}} [opts]  the Lagos date the windows count from; today when left out
 * @returns {Promise<{headcount: number, attrition_90d: number, confirmations_due: number}>}
 */
async function counts(client, scope, { today = lagos.today() } = {}) {
  const row = await repo.counts(client, scope, lagos.assertDate(today, "today"));
  return {
    headcount: row.headcount,
    attrition_90d: row.attrition,
    confirmations_due: row.probation_due,
  };
}

/** The counts above the register, the work-pattern strip, and what needs a decision. */
async function summary(client, scope) {
  const [tally, patterns, byDepartment, openSeats] = await Promise.all([
    repo.counts(client, scope, lagos.today()),
    repo.byWorkPattern(client, scope),
    repo.byDepartment(client, scope),
    repo.vacantSeatCount(client),
  ]);
  const biggest = byDepartment.reduce((max, d) => Math.max(max, d.people), 0) || 1;
  const PATTERN_LABELS = { on_site: "On Site", hybrid: "Hybrid", remote: "Remote" };
  const people = (n) => `${n} ${n === 1 ? "person" : "people"}`;
  const decisions = [
    tally.probation_due > 0 && {
      title: "Probation Ending",
      text: `${people(tally.probation_due)} in the next 30 days`,
      action: { tone: "warn", text: "Confirm or extend" },
      link: screen("people", "employees"),
    },
    tally.contracts_ending > 0 && {
      title: "Contracts Ending",
      text: `${people(tally.contracts_ending)} in the next 30 days`,
      action: { tone: "warn", text: "Renew or close" },
      link: screen("people", "employees"),
    },
    tally.no_manager > 0 && {
      title: "No Line Manager",
      text: people(tally.no_manager),
      action: { tone: "warn", text: "Set a manager" },
      link: screen("people", "organogram"),
    },
    openSeats > 0 && {
      title: "Open Seats",
      text: `${openSeats} ${openSeats === 1 ? "seat" : "seats"} with nobody in them`,
      action: { tone: "info", text: "Create vacancy" },
      link: screen("people", "organogram"),
    },
    tally.no_login > 0 && {
      title: "Not Yet Invited",
      text: `${people(tally.no_login)} with no login`,
      action: { tone: "info", text: "Send invites" },
      link: screen("settings", "users"),
    },
  ].filter(Boolean);
  return {
    kpis: [
      { key: "headcount", label: "Headcount", value: String(tally.headcount) },
      { key: "confirmed", label: "Confirmed", value: String(tally.confirmed), tone: "ok" },
      { key: "probation", label: "On Probation", value: String(tally.probation), tone: "warn" },
      { key: "attrition", label: "Attrition, 90 Days", value: String(tally.attrition) },
    ],
    arrangements: Object.keys(PATTERN_LABELS).map((key) => {
      const hit = patterns.find((p) => p.work_pattern === key);
      return { label: PATTERN_LABELS[key], value: `${hit ? hit.people : 0} staff` };
    }),
    departments: byDepartment.map((d) => ({
      label: d.name,
      pct: Math.round((d.people / biggest) * 100),
      value: String(d.people),
    })),
    decisions,
  };
}

/**
 * The whole reporting tree, for Org Chart and Organogram. A manager who is no longer an
 * active node (archived, or left) is dropped from the line, so their former reports show
 * as roots the builder can flag instead of vanishing (docs/guides/organogram.md §11).
 */
async function orgChart(client, { view = "viewer" } = {}) {
  const rows = await repo.tree(client);
  const ids = new Set(rows.map((r) => r.node_id));
  const PATTERN_LABELS = { on_site: "On Site", hybrid: "Hybrid", remote: "Remote" };
  const nodes = rows.map((r) => {
    const meta =
      view === "builder" && !r.vacant
        ? [r.since ? `Since ${r.since}` : null, PATTERN_LABELS[r.work_pattern] || null]
            .filter(Boolean)
            .join(" · ") || null
        : null;
    return {
      node_id: r.node_id,
      node_kind: r.node_kind,
      employee_id: r.employee_id,
      org_seat_id: r.org_seat_id,
      display_name: r.display_name,
      job_title: r.job_title,
      department: r.department,
      manager_node_id: ids.has(r.manager_node_id) ? r.manager_node_id : null,
      dotted_manager_node_id: ids.has(r.dotted_manager_node_id) ? r.dotted_manager_node_id : null,
      dotted_line_to: ids.has(r.dotted_manager_node_id) ? r.dotted_line_to : null,
      is_ceo: r.is_ceo,
      vacant: r.vacant,
      meta,
      photo_url: r.photo_url,
    };
  });
  return {
    nodes,
    seats: nodes.length,
    filled: nodes.filter((n) => !n.vacant).length,
    open: nodes.filter((n) => n.vacant).length,
    roots: nodes.filter((n) => !n.manager_node_id).length,
  };
}

/**
 * POST /org-chart/exports, Download PDF: the whole chart, in the view asked for, read and laid
 * out now (org-chart.layout.js) and queued through documents.generate, so the pdf-render job
 * draws it after commit; the screen that asked waits for it and downloads it there
 * (docs/guides/organogram.md §5, §7). Nothing is emailed. In the caller's transaction, with
 * its event.
 * @returns {Promise<object>} the ExportFile, pending
 */
async function requestOrgChartExport(client, { view = "viewer" } = {}, actor) {
  const tree = await orgChart(client, { view });
  const doc = await documents.generate(client, {
    doc_type: CHART_DOC_TYPE,
    entity: { type: CHART_EXPORT, id: crypto.randomUUID() },
    data: { ...layout(tree.nodes), seats: tree.seats, filled: tree.filled, open: tree.open },
    actor,
  });
  await emit(client, {
    key: EVENTS.ORG_CHART_EXPORT_REQUESTED,
    entity: { type: CHART_EXPORT, id: doc.entity_id },
    actor,
    payload: { view, requested_by: actor.user_id, document_id: doc.document_id },
  });
  return exportFiles.present(doc);
}

/* ------------------------------------------------------------------ *
 * Managers named in a sheet
 * ------------------------------------------------------------------ */

/**
 * Who a Line Manager cell points at: a person, or the vacant seat holding that post
 * (docs/guides/foundation.md §6.1). Looked for in this order, and nothing is guessed:
 *
 *   1. the whole cell as a person's name
 *   2. the name beside a post ("Chinyere - Head PR & Marketing"), in full or as a first name
 *   3. a job title somebody holds
 *   4. the title of a seat nobody holds
 *
 * @param {import("pg").PoolClient} client
 * @param {{text: string, name: string|null, title: string|null}} target  managerText.parse()
 * @param {{exclude?: string}} [opts]  an employee id the answer may not be (the row itself)
 * @returns {Promise<{employee_id: string}|{org_seat_id: string}|null>}
 */
async function resolveManager(client, target, { exclude = null } = {}) {
  if (!target || !target.text) return null;
  const notExcluded = (rows) => rows.filter((r) => r.employee_id !== exclude);
  const onePerson = (rows) => (notExcluded(rows).length === 1 ? notExcluded(rows)[0] : null);

  for (const name of [target.text, target.name].filter(Boolean)) {
    if (managerText.isVacantName(name)) break;
    const hit = onePerson(await repo.findEmployeesByName(client, name));
    if (hit) return { employee_id: hit.employee_id };
  }
  if (target.name && !target.name.includes(" ")) {
    const folded = managerText.fold(target.name);
    const page = await repo.list(
      client,
      { page: 1, q: target.name },
      { scope: "all", scope_ids: null },
    );
    const byFirstName = page.data.filter(
      (r) => managerText.fold(r.display_name).split(" ")[0] === folded && r.employee_id !== exclude,
    );
    if (byFirstName.length === 1) return { employee_id: byFirstName[0].employee_id };
  }
  for (const title of [target.title, target.text].filter(Boolean)) {
    const exact = onePerson(await repo.findEmployeesByJobTitle(client, title));
    if (exact) return { employee_id: exact.employee_id };
  }
  for (const title of [target.title, target.text].filter(Boolean)) {
    const seat = await repo.findSeatByTitle(client, title);
    if (seat) return { org_seat_id: seat.org_seat_id };
  }
  /* A post named in the sheet's own words: "CEO" for the Chief Executive Officer,
     "Head PR & Marketing" for the Head of PR, Marketing and Brand Strategy. One match
     is the answer; several are an error on the row (manager-text.js matchesTitle). */
  for (const title of [target.title, target.text].filter(Boolean)) {
    const people = notExcluded(
      (await repo.jobTitles(client)).filter((p) => managerText.matchesTitle(title, p.job_title)),
    );
    if (people.length === 1) return { employee_id: people[0].employee_id };
    if (people.length > 1) return null;
    const posts = (await repo.seatTitles(client)).filter((seat) =>
      managerText.matchesTitle(title, seat.title),
    );
    if (posts.length === 1) return { org_seat_id: posts[0].org_seat_id };
  }
  return null;
}

/**
 * The one write the staff importer and the roster loader call
 * (docs/guides/foundation.md §5): create or update a person by staff number or work
 * email, or keep the vacant seat a VACANT row stands for.
 *
 * Options on the batch (`ctx.options`), which only the roster loader sets:
 *   keep_existing              a person already in the system is left exactly as the app
 *                              has them, so an edit made on screen is never overwritten
 *   work_email_by_job_title    a work email for a row whose Email cell is empty
 *
 * @param {import("pg").PoolClient} client  inside the engine's transaction
 * @param {object} values  EmployeeImportRow, with references already resolved to ids
 * @param {{actor: object, existing?: object|null, options?: object}} ctx
 * @returns {Promise<{action: "create"|"update"|"none", target_id: string, before: object|null}>}
 */
async function importRow(client, values, ctx = {}) {
  const actor = ctx.actor || null;
  const options = ctx.options || {};
  const name = splitName(values.full_name);

  if (managerText.isVacantName(values.full_name)) {
    const { seat, created } = await findOrCreateSeat(
      client,
      { title: values.job_title, department_id: values.department },
      actor,
    );
    return { action: created ? "create" : "none", target_id: seat.org_seat_id, before: null };
  }

  const workEmail =
    values.work_email ||
    (options.work_email_by_job_title || {})[String(values.job_title || "").trim()] ||
    null;
  let byNumber = values.staff_number
    ? await repo.findEmployeeByStaffNumber(client, values.staff_number)
    : null;
  const byEmail = workEmail ? await repo.findEmployeeByWorkEmail(client, workEmail) : null;

  /*
   * The staff number this row claims is held by a different work email, so the holder is
   * a different person and this row is not an edit of their record. The sheet is the
   * organisation's own record of who holds which number, so the holder gives it up and
   * takes the next free one. Two guards: a holder the same sheet names keeps their
   * number, because a sheet that gives one number to two people is wrong rather than
   * authoritative; and a person already here under another number is left where they
   * are, so no number is freed for nothing. Only the roster loader reclaims a number
   * (`reclaim_staff_numbers`); for anyone importing a sheet by hand the row is a problem
   * to look at.
   *
   * A holder with the row's own first and last name is not somebody else: it is the same
   * person, and the sheet now spells their work email differently (a corrected domain).
   * The row is theirs by number, and nobody moves.
   */
  if (byNumber && workEmail && !sameEmail(byNumber.work_email, workEmail) && !sameName(byNumber, name)) {
    const onSheet = (options.roster_work_emails || []).some((e) => sameEmail(e, byNumber.work_email));
    if (!byEmail && (!options.reclaim_staff_numbers || onSheet))
      throw new AppError(
        "STAFF_NUMBER_TAKEN",
        `Staff number ${values.staff_number} belongs to ${byNumber.work_email}.`,
        409,
        { staff_number: ["Already in use"] },
      );
    if (!byEmail) await renumberEmployee(client, byNumber.employee_id, actor);
    byNumber = null;
  }

  const existing = byNumber || byEmail || null;

  if (existing) {
    if (options.keep_existing)
      return { action: "none", target_id: existing.employee_id, before: existing };
    const patch = {
      first_name: name.first_name,
      middle_name: name.middle_name,
      last_name: name.last_name,
      job_title: values.job_title,
      department_id: values.department,
      ...(workEmail ? { work_email: workEmail } : {}),
      ...optional(values, ["gender", "start_date", "date_of_birth", "phone", "bank_name"]),
      ...(values.employment_type ? { employment_type: values.employment_type } : {}),
      ...(values.work_pattern ? { work_pattern: values.work_pattern } : {}),
    };
    const after = await updateEmployee(client, existing.employee_id, patch, actor);
    return { action: "update", target_id: after.employee_id, before: existing };
  }

  if (!workEmail)
    throw new AppError("WORK_EMAIL_REQUIRED", "Work Email is required to create a person.", 422, {
      work_email: ["Required"],
    });
  const employee = await createEmployee(
    client,
    {
      ...name,
      staff_number: values.staff_number,
      work_email: workEmail,
      job_title: values.job_title,
      department_id: values.department,
      employment_type: values.employment_type || "full_time",
      work_pattern: values.work_pattern || "on_site",
      ...optional(values, ["gender", "start_date", "date_of_birth", "phone", "bank_name"]),
    },
    actor,
  );
  return { action: "create", target_id: employee.employee_id, before: null };
}

/** Whether two work emails name the same person. Stored as citext, compared as written. */
function sameEmail(a, b) {
  const fold = (v) => String(v ?? "").trim().toLowerCase();
  return fold(a) !== "" && fold(a) === fold(b);
}

/** Whether a record and a row's split name have the same first and last name, folded. */
function sameName(employee, name) {
  const fold = managerText.fold;
  return (
    fold(employee.first_name) !== "" &&
    fold(employee.first_name) === fold(name.first_name) &&
    fold(employee.last_name) === fold(name.last_name)
  );
}

/** The keys that carry a value, so an empty cell never writes over something. */
function optional(values, keys) {
  const out = {};
  for (const k of keys)
    if (values[k] !== undefined && values[k] !== null && values[k] !== "") out[k] = values[k];
  return out;
}

/** One Name cell into first, middle and last. A single word is both first and last name. */
function splitName(full) {
  const parts = String(full ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  if (parts.length === 0) return { first_name: "", middle_name: undefined, last_name: "" };
  if (parts.length === 1)
    return { first_name: parts[0], middle_name: undefined, last_name: parts[0] };
  return {
    first_name: parts[0],
    middle_name: parts.length > 2 ? parts.slice(1, -1).join(" ") : undefined,
    last_name: parts[parts.length - 1],
  };
}

module.exports = {
  setBirthday,
  findDepartmentByName,
  findOrCreateDepartment,
  createDepartment,
  headOf,
  updateDepartment,
  departments,
  findEmployeeByWorkEmail,
  findEmployeeById,
  createEmployee,
  updateEmployee,
  renumberEmployee,
  archiveEmployee,
  restoreEmployee,
  setReportingLine,
  advanceStaffNumbers,
  list,
  counts,
  summary,
  historyOf,
  seats,
  createSeat,
  updateSeat,
  findOrCreateSeat,
  orgChart,
  requestOrgChartExport,
  resolveManager,
  importRow,
  splitName,
};
