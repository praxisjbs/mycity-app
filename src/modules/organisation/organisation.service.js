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
const access = require("../access/access.service");
const { employeeDateProblems, ON_SITE_PATTERNS } = require("@mycity/contract").organisation;

/** A person's home address field (shared/places/owners.js). */
const HOME = "employee.home_address";
const { EVENTS, CHART_DOC_TYPE, CHART_EXPORT } = require("./organisation.events");

const findDepartmentByName = (client, name) => repo.findDepartmentByName(client, name);
const findDepartmentByCode = (client, code) => repo.findDepartmentByCode(client, code);
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

/* ------------------------------------------------------------------ *
 * Departments (docs/guides/organogram.md §6.1, JBS Praxis 27/10/2026)
 *
 * People keep them on People · Departments: one level, each a function on Performance. The
 * head may be a person or an open role of the department; a head's rights and the reporting
 * lines follow the head, so setting one is a single step.
 * ------------------------------------------------------------------ */

/**
 * Whoever heads a department in use, or acts for its open head role, holds Head of Department
 * while they do, unless a role of theirs already sets a function's goals.
 */
const HEAD_ROLE = Object.freeze({ role: "head_of_department", unless: "goals.function" });

const departmentExists = () =>
  new AppError("DEPARTMENT_EXISTS", "There is already a department with this name.", 409, {
    name: ["Already in use"],
  });

/**
 * @param {import("pg").PoolClient} client  inside atomically()
 * @param {{name: string, code?: string, description?: string, head_employee_id?: string|null, head_seat_id?: string|null}} input
 * @param {object} actor
 */
async function createDepartment(client, input, actor) {
  const name = String(input.name).trim();
  if (await repo.findDepartmentByName(client, name)) throw departmentExists();
  // A department made now has no roles of its own yet, so its head can only be a person.
  if (input.head_seat_id)
    throw new AppError("SEAT_NOT_FOUND", "Pick an open role in this department.", 422, {
      head_seat_id: ["Not in this department"],
    });
  if (input.head_employee_id) await assertHeadPerson(client, input.head_employee_id);
  const inserted = await repo.insertDepartment(client, {
    code: input.code ? await freeDepartmentCode(client, input.code) : await departmentCode(client, name),
    name,
    description: input.description ?? null,
  });
  if (input.head_employee_id)
    await applyHead(client, inserted, { head_employee_id: input.head_employee_id, head_seat_id: null }, actor);
  await emit(client, {
    key: EVENTS.DEPARTMENT_CREATED,
    entity: { type: "department", id: inserted.department_id },
    actor,
    after: await repo.findDepartmentById(client, inserted.department_id),
  });
  if (input.head_employee_id) await syncHeadRoles(client, actor);
  return departmentOf(client, inserted.department_id);
}

/**
 * PATCH /departments/:id: Edit Department (name, code), Set Head (a person, an open role of
 * this department, or none), Retire (`active: false`, only once empty) and Restore.
 */
async function updateDepartment(client, departmentId, patch, actor) {
  const before = await repo.findDepartmentById(client, departmentId);
  if (!before) throw new AppError("NOT_FOUND", "Not found", 404);
  const change = { ...patch };
  delete change.head_employee_id;
  delete change.head_seat_id;
  if (change.name !== undefined) {
    change.name = String(change.name).trim();
    const other = await repo.findDepartmentByName(client, change.name);
    if (other && other.department_id !== departmentId) throw departmentExists();
  }
  if (change.code !== undefined) {
    const code = change.code.toUpperCase();
    if (code !== before.code && (await repo.codeTaken(client, code)))
      throw new AppError("DEPARTMENT_CODE", "Another department has this code.", 409, { code: ["Already in use"] });
    change.code = code;
  }
  const retiring = change.active === false && before.active;
  const restoring = change.active === true && !before.active;
  if (retiring) {
    const load = await repo.departmentLoad(client, departmentId);
    if (load.people || load.open_roles)
      throw new AppError("DEPARTMENT_NOT_EMPTY", `Still has ${stillHere(load)}.`, 409);
    // A retired department heads nothing: its head, and the head's role, go with it.
    change.head_employee_id = null;
    change.head_seat_id = null;
  }
  if (restoring) change.merged_into_department_id = null;
  const headChange = "head_employee_id" in patch || "head_seat_id" in patch;
  if (headChange && !retiring) {
    if (!before.active && !restoring)
      throw new AppError("DEPARTMENT_RETIRED", "Restore this department before giving it a head.", 409);
    // A head is a person or a vacant seat: naming one clears the other.
    const next = {
      head_employee_id: "head_employee_id" in patch ? patch.head_employee_id : before.head_employee_id,
      head_seat_id: "head_seat_id" in patch ? patch.head_seat_id : before.head_seat_id,
    };
    if (patch.head_employee_id) next.head_seat_id = null;
    if (patch.head_seat_id) next.head_employee_id = null;
    await applyHead(client, { ...before, name: change.name ?? before.name }, next, actor);
  }
  if (Object.keys(change).length) await repo.updateDepartment(client, departmentId, change);
  await emit(client, {
    key: EVENTS.DEPARTMENT_UPDATED,
    entity: { type: "department", id: departmentId },
    actor,
    before,
    after: await repo.findDepartmentById(client, departmentId),
  });
  if (headChange || retiring || restoring) await syncHeadRoles(client, actor);
  return departmentOf(client, departmentId);
}

/** "2 people and 1 open role", for a department that cannot retire yet. */
function stillHere({ people, open_roles: roles }) {
  const parts = [];
  if (people) parts.push(`${people} ${people === 1 ? "person" : "people"}`);
  if (roles) parts.push(`${roles} open ${roles === 1 ? "role" : "roles"}`);
  return parts.join(" and ");
}

/** A head who is a person must work here now. */
async function assertHeadPerson(client, employeeId) {
  const person = await repo.findEmployeeById(client, employeeId);
  if (!person || person.status !== "active")
    throw new AppError("MANAGER_NOT_FOUND", "Pick someone who works here now.", 422, {
      head_employee_id: ["Not working here now"],
    });
  return person;
}

/** A head that is a role must be one of this department's, not closed. */
async function assertHeadSeat(client, seatId, departmentId) {
  const seat = await repo.findSeatById(client, seatId);
  if (!seat || seat.status === "closed" || seat.department_id !== departmentId)
    throw new AppError("SEAT_NOT_FOUND", "Pick an open role in this department.", 422, {
      head_seat_id: ["Not in this department"],
    });
  return seat;
}

/** A code a person chose, upper-cased, refused when another department has it. */
async function freeDepartmentCode(client, code) {
  const wanted = String(code).toUpperCase();
  if (await repo.codeTaken(client, wanted))
    throw new AppError("DEPARTMENT_CODE", "Another department has this code.", 409, { code: ["Already in use"] });
  return wanted;
}

/** Where a person reports to (their line), or where a seat does, as a reporting write names it. */
const lineOfPerson = (e) => (e ? { line_manager_id: e.line_manager_id || null, line_manager_seat_id: e.line_manager_seat_id || null } : null);
const lineOfSeat = (s) =>
  s && s.line_manager
    ? { line_manager_id: s.line_manager.employee_id || null, line_manager_seat_id: s.line_manager.org_seat_id || null }
    : null;
const hasLine = (line) => Boolean(line && (line.line_manager_id || line.line_manager_seat_id));

/**
 * Where the people of a department report when they report to its head: the head, the person
 * filling its head seat, or the open head role itself. Null when it has none.
 */
async function headLineOf(client, dept) {
  if (dept.head_employee_id) {
    const head = await repo.findEmployeeById(client, dept.head_employee_id);
    return head && head.status === "active" ? { line_manager_id: head.employee_id } : null;
  }
  if (dept.head_seat_id) {
    const seat = await repo.findSeatById(client, dept.head_seat_id);
    if (!seat || seat.status === "closed") return null;
    if (seat.status === "filled" && seat.filled_by_employee_id) return { line_manager_id: seat.filled_by_employee_id };
    return { line_manager_seat_id: seat.org_seat_id };
  }
  return null;
}

/**
 * Point someone's solid line at `line` through the reporting write, so it is audited with its
 * reason and approvals and team scope follow. Skipped, saying so, when it changes nothing, would
 * report to themselves, would make a loop, or names a manager who has left.
 * @returns {Promise<boolean>} whether it moved
 */
async function followLine(client, employeeId, line, reason, actor) {
  const person = await repo.findEmployeeById(client, employeeId);
  if (!person || person.status === "archived" || !hasLine(line)) return false;
  const to = line.line_manager_id || null;
  const toSeat = to ? null : line.line_manager_seat_id;
  if ((person.line_manager_id || null) === to && (person.line_manager_seat_id || null) === (toSeat || null)) return false;
  if (to === employeeId || (await repo.wouldLoop(client, employeeId, to || toSeat))) return false;
  if (to) {
    const manager = await repo.findEmployeeById(client, to);
    if (!manager || manager.status !== "active") return false;
  }
  await setReportingLine(client, employeeId, to ? { line_manager_id: to, reason } : { line_manager_seat_id: toSeat, reason }, actor);
  return true;
}

/** The same for an open role's line (Edit Role's write). */
async function followSeatLine(client, seatId, line, actor) {
  const seat = await repo.findSeatById(client, seatId);
  if (!seat || seat.status === "closed" || !hasLine(line)) return false;
  const now = lineOfSeat(seat) || {};
  const to = line.line_manager_id || null;
  const toSeat = to ? null : line.line_manager_seat_id;
  if ((now.line_manager_id || null) === to && (now.line_manager_seat_id || null) === (toSeat || null)) return false;
  if (toSeat === seatId || (await repo.wouldLoop(client, seatId, to || toSeat))) return false;
  await changeSeat(client, seatId, to ? { line_manager_id: to } : { line_manager_seat_id: toSeat }, actor);
  return true;
}

/**
 * Give a department its head and move the lines with it (docs/guides/organogram.md §6.1):
 *   1. a new head who works in another department and heads none moves into this one;
 *   2. the new head takes the old head's place, reporting to whoever the old head reported to
 *      (one who heads another department too keeps their own line);
 *   3. everyone here who reported to the old head, people and open roles, reports to the new one;
 *   4. the old head, still working here, reports to the new head.
 * Clearing the head moves no line, and the CEO's own line never changes. The head is saved last;
 * the caller records the change and gives the head their role (syncHeadRoles).
 * @param {object} dept  the department as it is now (findDepartmentById, or the row just made)
 * @param {{head_employee_id: string|null, head_seat_id: string|null}} next
 */
async function applyHead(client, dept, next, actor) {
  const departmentId = dept.department_id;
  const was = { person: dept.head_employee_id || null, seat: dept.head_seat_id || null };
  const will = { person: next.head_employee_id || null, seat: next.head_seat_id || null };
  if (was.person === will.person && was.seat === will.seat) return;
  const newPerson = will.person ? await assertHeadPerson(client, will.person) : null;
  const newSeat = will.seat ? await assertHeadSeat(client, will.seat, departmentId) : null;
  const target = { ...dept, head_employee_id: will.person, head_seat_id: will.seat };
  const newLine = await headLineOf(client, target);
  if (newLine) {
    const reason = `Head of ${dept.name} changed`;
    const ceo = await repo.findCeoEmployee(client);
    const ceoId = ceo ? ceo.employee_id : null;
    const oldSeat = was.seat ? await repo.findSeatById(client, was.seat) : null;
    const oldPerson = was.person || (oldSeat && oldSeat.status === "filled" ? oldSeat.filled_by_employee_id : null);
    const oldLine = was.person ? lineOfPerson(await repo.findEmployeeById(client, was.person)) : lineOfSeat(oldSeat);
    const headId = newLine.line_manager_id || null;

    // Someone who heads another department too keeps where they work and whom they report to.
    const headsOther =
      newPerson && (await repo.departmentsHeadedBy(client, newPerson.employee_id)).some((id) => id !== departmentId);

    // 1. The new head joins the department, unless they head another one.
    if (newPerson && newPerson.department_id !== departmentId && !headsOther)
      await updateEmployee(client, newPerson.employee_id, { department_id: departmentId }, actor);

    // 2. The new head takes the old head's place in the tree.
    if (hasLine(oldLine)) {
      if (newPerson && newPerson.employee_id !== ceoId && !headsOther) await followLine(client, newPerson.employee_id, oldLine, reason, actor);
      if (newSeat) await followSeatLine(client, newSeat.org_seat_id, oldLine, actor);
    }

    if (oldPerson || was.seat) {
      const reportedToOld = (r) =>
        (oldPerson && r.line_manager_id === oldPerson) || (was.seat && r.line_manager_seat_id === was.seat);
      // 3. Whoever reported to the old head, people and open roles, reports to the new head.
      for (const m of await repo.departmentMembers(client, departmentId)) {
        if (m.employee_id === headId || m.employee_id === oldPerson || m.employee_id === ceoId) continue;
        if (reportedToOld(m)) await followLine(client, m.employee_id, newLine, reason, actor);
      }
      for (const s of await repo.departmentSeats(client, departmentId)) {
        if (s.org_seat_id === will.seat || s.org_seat_id === was.seat) continue;
        if (reportedToOld(s)) await followSeatLine(client, s.org_seat_id, newLine, actor);
      }
      // 4. The old head, still here, reports to the new head.
      if (oldPerson && oldPerson !== headId && oldPerson !== ceoId) {
        const old = await repo.findEmployeeById(client, oldPerson);
        if (old && old.status !== "archived" && old.department_id === departmentId)
          await followLine(client, oldPerson, newLine, reason, actor);
      }
    }
  }
  await repo.updateDepartment(client, departmentId, { head_employee_id: will.person, head_seat_id: will.seat });
}

/**
 * Lines follow the head for the people (and open roles) who just joined a department: each
 * reports to its head unless they are its head, it has none, or their manager is already here
 * or joined with them, so a team moved together keeps its lines. The CEO's line never changes.
 * `people` and `seats` carry their lines as they were before the move.
 */
async function linesFollowHead(client, dept, people, seats, reason, actor) {
  const headLine = await headLineOf(client, dept);
  if (!headLine) return;
  const departmentId = dept.department_id;
  const ceo = await repo.findCeoEmployee(client);
  const joined = new Set(people.map((p) => p.employee_id));
  const joinedSeats = new Set(seats.map((s) => s.org_seat_id));
  const managerHere = async (r) => {
    if (r.line_manager_id) {
      if (joined.has(r.line_manager_id)) return true;
      const m = await repo.findEmployeeById(client, r.line_manager_id);
      return Boolean(m && m.department_id === departmentId);
    }
    if (r.line_manager_seat_id) {
      if (joinedSeats.has(r.line_manager_seat_id)) return true;
      const s = await repo.findSeatById(client, r.line_manager_seat_id);
      return Boolean(s && s.department_id === departmentId);
    }
    return false;
  };
  for (const p of people) {
    if ((ceo && p.employee_id === ceo.employee_id) || p.employee_id === headLine.line_manager_id) continue;
    if (await managerHere(p)) continue;
    await followLine(client, p.employee_id, headLine, reason, actor);
  }
  for (const s of seats) {
    if (s.org_seat_id === dept.head_seat_id || s.org_seat_id === headLine.line_manager_seat_id) continue;
    if (await managerHere(s)) continue;
    await followSeatLine(client, s.org_seat_id, headLine, actor);
  }
}

/**
 * Add People and Move To: these people join the department, and each line follows its head
 * (linesFollowHead). One transaction: all of them, or none.
 * @param {import("pg").PoolClient} client  inside atomically()
 * @param {string} departmentId
 * @param {string[]} employeeIds  at most 25 (DepartmentPeopleMove)
 */
async function moveToDepartment(client, departmentId, employeeIds, actor) {
  const dept = await repo.findDepartmentById(client, departmentId);
  if (!dept) throw new AppError("NOT_FOUND", "Not found", 404);
  if (!dept.active)
    throw new AppError("DEPARTMENT_RETIRED", "Restore this department before moving anyone into it.", 409);
  const ids = [...new Set(employeeIds)];
  const people = await repo.employeesByIds(client, ids);
  if (people.length !== ids.length || people.some((p) => p.status === "archived"))
    throw new AppError("EMPLOYEE_NOT_FOUND", "Pick people on the staff list.", 422, {
      employee_ids: ["Not on the staff list"],
    });
  const moving = people.filter((p) => p.department_id !== departmentId);
  for (const p of moving) await updateEmployee(client, p.employee_id, { department_id: departmentId }, actor);
  await linesFollowHead(client, dept, moving, [], `Moved to ${dept.name}`, actor);
  if (moving.length)
    await emit(client, {
      key: EVENTS.DEPARTMENT_PEOPLE_MOVED,
      entity: { type: "department", id: departmentId },
      actor,
      payload: {
        department_id: departmentId,
        moved: moving.map((p) => ({ employee_id: p.employee_id, from_department_id: p.department_id })),
      },
    });
  return departmentOf(client, departmentId);
}

/**
 * Merge Department: every person on its books and every role not closed move into another in
 * use, as Add People moves them, and it retires with no head, marked merged. Its plans, goals,
 * KPIs and scorecards stay with it for their quarters.
 * @returns {Promise<object>} the department it went into
 */
async function mergeDepartment(client, departmentId, intoId, actor) {
  const from = await repo.findDepartmentById(client, departmentId);
  if (!from) throw new AppError("NOT_FOUND", "Not found", 404);
  if (!from.active) throw new AppError("DEPARTMENT_RETIRED", "This department is retired already.", 409);
  if (intoId === departmentId)
    throw new AppError("DEPARTMENT_MERGE", "Pick another department to merge into.", 422, {
      into_department_id: ["Pick another department"],
    });
  const into = await repo.findDepartmentById(client, intoId);
  if (!into || !into.active)
    throw new AppError("DEPARTMENT_NOT_FOUND", "Pick a department in use.", 422, {
      into_department_id: ["Not in use"],
    });
  const people = await repo.departmentMembers(client, departmentId);
  const seats = await repo.departmentSeats(client, departmentId);
  for (const p of people) await updateEmployee(client, p.employee_id, { department_id: intoId }, actor);
  for (const s of seats) await changeSeat(client, s.org_seat_id, { department_id: intoId }, actor);
  await linesFollowHead(client, into, people, seats, `${from.name} merged into ${into.name}`, actor);
  await repo.updateDepartment(client, departmentId, {
    active: false,
    head_employee_id: null,
    head_seat_id: null,
    merged_into_department_id: intoId,
  });
  await emit(client, {
    key: EVENTS.DEPARTMENT_MERGED,
    entity: { type: "department", id: departmentId },
    actor,
    before: from,
    after: await repo.findDepartmentById(client, departmentId),
    payload: { department_id: departmentId, into_department_id: intoId, people: people.length, roles: seats.length },
  });
  await syncHeadRoles(client, actor);
  return departmentOf(client, intoId);
}

/**
 * Delete Department: only one nothing names (`can_delete`): no row behind a foreign key, no
 * announcement's audience, and not merged away. Otherwise Retire keeps its history.
 */
async function deleteDepartment(client, departmentId, actor) {
  const before = await repo.findDepartmentById(client, departmentId);
  if (!before) throw new AppError("NOT_FOUND", "Not found", 404);
  const inUse = () => new AppError("DEPARTMENT_IN_USE", "Used before. Retire it instead.", 409);
  // A merged one keeps its record of where it went.
  if (before.merged_into_department_id || (await repo.usedDepartmentIds(client, [departmentId])).has(departmentId)) throw inUse();
  try {
    await repo.deleteDepartment(client, departmentId);
  } catch (err) {
    // Something began naming it since the check: the same answer.
    if (err && err.code === "23503") throw inUse();
    throw err;
  }
  await emit(client, {
    key: EVENTS.DEPARTMENT_DELETED,
    entity: { type: "department", id: departmentId },
    actor,
    before,
  });
  if (before.head_employee_id || before.head_seat_id) await syncHeadRoles(client, actor);
}

/**
 * Give Head of Department to whoever heads a department in use, or acts for its open head role,
 * and take back the ones it gave that no longer do (access.syncHeadshipRole). Run after every
 * write that can move a head, in the same transaction.
 */
async function syncHeadRoles(client, actor) {
  const heads = [];
  for (const departmentId of await repo.activeDepartmentIds(client)) {
    const who = await repo.headOf(client, departmentId);
    if (who) heads.push(who);
  }
  const working = heads.length ? (await repo.employeesByIds(client, [...new Set(heads)])).filter((e) => e.status === "active") : [];
  return access.syncHeadshipRole(client, working.map((e) => e.employee_id), HEAD_ROLE, actor);
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

/** One department as the contract gives it: its acting head, and whether Delete may be offered. */
async function departmentOf(db, departmentId) {
  const row = await repo.departmentRow(db, departmentId);
  if (!row) return null;
  const used = await repo.usedDepartmentIds(db, [departmentId]);
  return { ...(await withActingHead(db, row)), can_delete: !used.has(departmentId) && !row.merged_into };
}

/** GET /departments/:id. */
async function getDepartment(db, departmentId) {
  const found = await departmentOf(db, departmentId);
  if (!found) throw new AppError("NOT_FOUND", "Not found", 404);
  return found;
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

/**
 * PATCH /employees/:id: correct a record. With `followHead` (the screen's Edit Record), a new
 * department moves the person as People · Departments does: their line follows its head unless
 * this same write names one (docs/guides/organogram.md §6.1). The importer and the deploy loader
 * set lines from their sheet and leave it off.
 */
async function updateEmployee(client, employeeId, patch, actor, { followHead = false } = {}) {
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
  // On Site and Hybrid keep a worksite, so clock-in has an office to check. Asked only when the
  // edit moves the pattern or the worksite: a roster record made before its worksite existed can
  // still be corrected elsewhere (JBS Praxis, 25/10/2026).
  if ("work_pattern" in patch || "worksite_id" in patch) {
    const pattern = patch.work_pattern || before.work_pattern;
    const site = "worksite_id" in patch ? patch.worksite_id : before.worksite_id;
    if (ON_SITE_PATTERNS.includes(pattern) && !site)
      throw new AppError("WORKSITE_REQUIRED", "Pick a worksite for someone who works On Site or Hybrid.", 422, { worksite_id: ["Pick a worksite"] });
  }
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
  const changedEmail = patch.work_email && patch.work_email.toLowerCase() !== String(before.work_email).toLowerCase();
  await emit(client, {
    key: EVENTS.EMPLOYEE_UPDATED,
    entity: { type: "employee", id: employeeId },
    actor,
    before,
    after: await repo.auditRow(client, employeeId),
    // identity follows a corrected work email with a login nobody has used yet (identity.events.js).
    payload: changedEmail ? { employee_id: employeeId, work_email: { from: before.work_email, to: after.work_email } } : { employee_id: employeeId },
  });
  const moved = patch.department_id && patch.department_id !== before.department_id;
  if (followHead && moved && !("line_manager_id" in patch) && !("line_manager_seat_id" in patch)) {
    const dept = await repo.findDepartmentById(client, patch.department_id);
    await linesFollowHead(client, dept, [before], [], `Moved to ${dept.name}`, actor);
    return repo.findEmployeeById(client, employeeId);
  }
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

/**
 * Archive a record: off every list and out of the tree, its history kept. `leftOn` is the last day
 * (Archive Record's, today by default), which Attrition counts; null keeps the record's own.
 */
async function archiveEmployee(client, employeeId, reason, actor, leftOn = null) {
  const before = await repo.findEmployeeById(client, employeeId);
  if (!before) throw new AppError("NOT_FOUND", "Not found", 404);
  if (before.status === "archived")
    throw new AppError("ALREADY_ARCHIVED", "This record is already archived.", 422);
  const ceo = await repo.findCeoEmployee(client);
  if (ceo && ceo.employee_id === employeeId)
    throw new AppError("CEO_PROTECTED", "The CEO's record cannot be archived.", 422);
  if (leftOn && leftOn > lagos.today())
    throw new AppError("VALIDATION_FAILED", "Check the highlighted fields", 422, { left_on: ["Not after today"] });
  if (leftOn && before.start_date && leftOn < String(before.start_date).slice(0, 10))
    throw new AppError("VALIDATION_FAILED", "Check the highlighted fields", 422, { left_on: ["Before their start"] });
  const after = await repo.archiveEmployee(client, employeeId, reason, leftOn);
  await emit(client, {
    key: EVENTS.EMPLOYEE_ARCHIVED,
    entity: { type: "employee", id: employeeId },
    actor,
    before,
    after,
    metadata: { archive_reason: reason, ...(leftOn && { left_on: leftOn }) },
  });
  // Someone who headed or acted for a department no longer does: the role headship gave goes.
  await syncHeadRoles(client, actor);
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
  await syncHeadRoles(client, actor);
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

/**
 * Edit Role, and the line or department a head change or a merge gives a seat. An open head role's
 * line decides who acts as head, so the heads' roles are worked out again (syncHeadRoles).
 */
async function updateSeat(client, seatId, patch, actor) {
  const seat = await changeSeat(client, seatId, patch, actor);
  await syncHeadRoles(client, actor);
  return seat;
}

async function changeSeat(client, seatId, patch, actor) {
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

/**
 * The seat with this title, or a new one (the importer's VACANT rows). A seat in the row's own
 * department is the one; failing that, a seat of that title made before this import (one the
 * names step moved to another department), never one an earlier row of the same import made,
 * so two departments' vacancies with one title stay two seats. `keepClosed` (the roster) also
 * finds a closed seat and leaves it closed: a post People closed does not come back.
 * @param {{keepClosed?: boolean, before?: Date|string|null}} [opts]  before: the import's start
 */
async function findOrCreateSeat(client, { title, department_id: departmentId }, actor, { keepClosed = false, before = null } = {}) {
  const existing =
    (await repo.findSeatByTitle(client, title, { departmentId, includeClosed: keepClosed })) ||
    (await repo.findSeatByTitle(client, title, { includeClosed: keepClosed, createdBefore: before || new Date(0) }));
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
  const used = await repo.usedDepartmentIds(client, page.data.map((d) => d.department_id));
  const data = [];
  for (const row of page.data)
    data.push({ ...(await withActingHead(client, row)), can_delete: !used.has(row.department_id) && !row.merged_into });
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
      // Confirmed or extended through the probation review (the owner, 26/10/2026).
      link: routeMap.screenPath("performance", "reviews", { params: { kind: "probation" } }),
    },
    tally.contracts_ending > 0 && {
      title: "Contracts Ending",
      text: `${people(tally.contracts_ending)} in the next 30 days`,
      action: { tone: "warn", text: "Renew or close" },
      link: routeMap.screenPath("people", "employees", { params: { contract: "ending" } }),
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
    tally.no_login + (tally.invite_unsent || 0) > 0 && {
      title: "Not Yet Invited",
      // A roster login is Invited but was never emailed: it waits for Invite All Pending too.
      text: tally.invite_unsent
        ? `${people(tally.no_login + tally.invite_unsent)} not invited yet`
        : `${people(tally.no_login)} with no login`,
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
  /* A first name alone ("Chinyere - Head PR & Marketing") is one person only when nobody
     else has it, and when a post is written beside it, only when that person holds it. */
  if (target.name && !target.name.includes(" ")) {
    const byFirstName = notExcluded(await repo.findEmployeesByFirstName(client, target.name));
    const hit = byFirstName.length === 1 ? byFirstName[0] : null;
    if (hit && (!target.title || managerText.matchesTitle(target.title, hit.job_title)))
      return { employee_id: hit.employee_id };
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
      { keepClosed: Boolean(options.keep_existing), before: ctx.batch ? ctx.batch.created_at : null },
    );
    return { action: created ? "create" : "none", target_id: seat.org_seat_id, before: null };
  }

  const postEmail = (options.work_email_by_job_title || {})[String(values.job_title || "").trim()] || null;
  const workEmail = values.work_email || postEmail || null;
  let byNumber = values.staff_number
    ? await repo.findEmployeeByStaffNumber(client, values.staff_number)
    : null;
  const byEmail = workEmail ? await repo.findEmployeeByWorkEmail(client, workEmail) : null;

  /*
   * The row's Email cell is empty and the post's address (roles.json) is already somebody's.
   * That somebody is this row only when the number or the name says so: a second person in
   * the same post must bring their own address, or they would be read as the first.
   */
  if (!values.work_email && postEmail && byEmail) {
    const other = values.staff_number
      ? byEmail.staff_number !== values.staff_number
      : !sameName(byEmail, name);
    if (other)
      throw new AppError(
        "WORK_EMAIL_REQUIRED",
        `${postEmail} belongs to staff number ${byEmail.staff_number}; give this person their own email.`,
        422,
        { work_email: ["Required"] },
      );
  }

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
    /* Somebody an earlier roster brought is MyCity's own person under this number: a new
       name and a new email on their row is them, changed, never a stranger to move aside. */
    const ours =
      !byEmail && options.reclaim_staff_numbers && !onSheet && (await repo.importedByRoster(client, byNumber.employee_id));
    if (!byEmail && (!options.reclaim_staff_numbers || onSheet || ours))
      throw new AppError(
        "STAFF_NUMBER_TAKEN",
        ours
          ? `Staff number ${values.staff_number} belongs to ${byNumber.work_email}, loaded from the roster before; correct their record on screen.`
          : `Staff number ${values.staff_number} belongs to ${byNumber.work_email}.`,
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
  /* A row with no staff number whose email matched nobody: somebody of the same first and
     last name already on the register is most likely this person under a changed address,
     and a second record would split their history. The row names its staff number to go on. */
  if (!values.staff_number) {
    const namesakes = await repo.findEmployeesByFirstAndLast(client, name.first_name, name.last_name);
    if (namesakes.length)
      throw new AppError(
        "POSSIBLE_DUPLICATE",
        `${name.first_name} ${name.last_name} may already be staff number ${namesakes[0].staff_number}; add their Staff ID to the row.`,
        409,
        { full_name: ["Already on the register"] },
      );
  }
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

/** Titles a sheet writes before a name ("Mrs", "Engr."): not part of anybody's name. */
const HONORIFICS = new Set([
  "mr", "mrs", "ms", "miss", "mx", "dr", "engr", "prof", "chief", "alhaji", "alhaja", "barr",
  "pastor", "rev", "hon", "sir", "dame", "arc", "pharm",
]);

/** A word written all in capitals or all in small letters ("OBI", "obi"), as a name is spelt: Obi. "McCarthy" stays. */
const nameCase = (word) =>
  /\p{L}/u.test(word) && (word === word.toUpperCase() || word === word.toLowerCase())
    ? word.toLowerCase().replace(/(^|[-'’])(\p{L})/gu, (_, sep, ch) => sep + ch.toUpperCase())
    : word;

/**
 * A Name cell tidied: spacing collapsed, leading titles dropped ("Engr. Tunde Bakare"), a word
 * in capitals or small letters put in name case ("TOBILOBA dada" → "Tobiloba Dada"). The importer's Name column
 * runs it (employee.import.js clean), so a sheet's spelling is compared as the record holds it.
 */
function cleanName(full) {
  const parts = String(full ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  while (parts.length > 1 && HONORIFICS.has(parts[0].toLowerCase().replace(/\.$/, ""))) parts.shift();
  return parts.map(nameCase).join(" ");
}

/** One Name cell into first, middle and last. A single word is both first and last name. */
function splitName(full) {
  const parts = cleanName(full).split(" ").filter(Boolean);
  if (parts.length === 0) return { first_name: "", middle_name: undefined, last_name: "" };
  if (parts.length === 1)
    return { first_name: parts[0], middle_name: undefined, last_name: parts[0] };
  return {
    first_name: parts[0],
    middle_name: parts.length > 2 ? parts.slice(1, -1).join(" ") : undefined,
    last_name: parts[parts.length - 1],
  };
}

/**
 * Keep the staff-number counter above every number a roster about to be loaded claims, before
 * any row is written: a row with no Staff ID is then given a number above all of them, and a
 * holder moved off a number lands above them too, once.
 * @param {string[]} numbers  the sheet's Staff ID cells
 */
async function reserveStaffNumbers(client, numbers) {
  const pad = await numbering.paddingOf(client, "employee");
  for (const n of numbers) {
    const text = String(n ?? "").trim().toUpperCase();
    if (text) await advancePast(client, /^\d+$/.test(text) && text.length < pad ? text.padStart(pad, "0") : text);
  }
}

/**
 * Note that MyCity's names (seeds/staff/nomenclature.json, at this checksum) were applied, so
 * the next deploy does not apply them again over what People changed on screen since.
 */
async function recordNamesApplied(client, sha256, tally, actor) {
  await emit(client, {
    key: EVENTS.DEPARTMENT_NAMES_APPLIED,
    entity: { type: "nomenclature", id: sha256 },
    actor,
    payload: { sha256, ...tally },
  });
}

/** Whether the names at this checksum were applied already. */
const namesApplied = (client, sha256) => repo.namesApplied(client, sha256);

module.exports = {
  setBirthday,
  findDepartmentByName,
  findDepartmentByCode,
  findOrCreateDepartment,
  createDepartment,
  headOf,
  updateDepartment,
  moveToDepartment,
  mergeDepartment,
  deleteDepartment,
  syncHeadRoles,
  getDepartment,
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
  cleanName,
  reserveStaffNumbers,
  recordNamesApplied,
  namesApplied,
};
