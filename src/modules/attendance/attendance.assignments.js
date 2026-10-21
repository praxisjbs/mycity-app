"use strict";
/**
 * Field assignments made before attendance's PR 4, which retired setting new ones in favour of
 * temporary sites (attendance.sites.js): the reads behind People · Worksites' Field and My
 * Attendance, and the changes that still apply to one in force until its last day
 * (docs/guides/attendance.md §6.12).
 *
 *   cancel()  stops it for the days still to come, with a reason everyone still on it reads
 *   remove()  takes one person off, with a reason they read; never the last one
 *
 * On a day it covers, the assignment decides the place a punch is matched to, before anything
 * else (attendance.calendar.js). A site is a client's venue, not personal data. Events carry ids,
 * the number, the name and the dates: never a site's address or centre.
 */
const { pool } = require("../../config/db");
const { atomically } = require("../../shared/db/tx");
const { AppError } = require("../../shared/errors");
const { emit } = require("../../shared/events/emit");
const { scopeFor } = require("../../middleware/rbac");
const lagos = require("../../shared/time/lagos");
const repo = require("./attendance.repo");
const { EVENTS } = require("./attendance.events");

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

const notFound = () => new AppError("NOT_FOUND", "That field assignment does not exist", 404);
const iso = (t) => (t ? new Date(t).toISOString() : null);
const ENTITY = (id) => ({ type: "attendance_field_assignment", id });

/** A row as the contract's FieldAssignment; never changeable by someone still on it. */
function present(row, reader = null) {
  if (!row) return row;
  const members = row.members.map((m) => ({ ...m, added_at: iso(m.added_at), removed_at: iso(m.removed_at) }));
  const onIt = Boolean(reader) && members.some((m) => !m.removed_at && m.employee.employee_id === reader.employee_id);
  return {
    ...row,
    days: Number(row.days),
    people: Number(row.people),
    assigned_at: iso(row.assigned_at),
    cancelled_at: iso(row.cancelled_at),
    sites: row.sites.map((x) => ({
      ...x,
      position: Number(x.position),
      latitude: Number(x.latitude),
      longitude: Number(x.longitude),
      radius_m: Number(x.radius_m),
    })),
    members,
    can_change: Boolean(row.can_change) && !onIt,
  };
}

const presentPage = (page, reader) => ({ ...page, data: page.data.map((r) => present(r, reader)) });

/** The reader's `people` approve scope: who they may send out, or null. */
const changerOf = (user) => scopeFor(user, "people", "approve");

const inScope = (scope, employeeId) => scope.scope === "all" || (scope.scope_ids || []).includes(employeeId);

/** The facts every event about one person on an assignment carries: no site, no address. */
const payloadOf = (row, employeeId, extra = {}) => ({
  field_assignment_id: row.field_assignment_id,
  number: row.number,
  name: row.name,
  starts_on: row.starts_on,
  ends_on: row.ends_on,
  employee_id: employeeId,
  subject_employee_id: employeeId,
  ...extra,
});

/** The assignment, 404 unless someone in `scope` is or was on it. */
async function visible(id, scope) {
  const row = await repo.getAssignment(pool, id);
  if (!row || !row.member_ids.some((e) => inScope(scope, e))) throw notFound();
  return row;
}

/** May the reader change it: active, not over, everyone still on it in scope, and not them. */
function assertChangeable(row, user, scope, today) {
  if (user.employee_id && row.active_ids.includes(user.employee_id))
    throw new AppError("OWN_RECORD", "Someone else changes your field assignment", 403);
  if (!row.active_ids.every((e) => inScope(scope, e)))
    throw new AppError("FORBIDDEN", "Someone on it is outside your team", 403);
  if (row.status !== "active") throw new AppError("ASSIGNMENT_CANCELLED", "This field assignment is cancelled", 409);
  if (row.ends_on < today) throw new AppError("ASSIGNMENT_ENDED", "This field assignment has ended", 409);
}

/** POST /attendance/field-assignments/:id/cancel */
async function cancel(user, id, body, scope) {
  const today = lagos.today();
  const seen = await visible(id, scope);
  assertChangeable(seen, user, scope, today);
  await tx(async (client) => {
    const row = await repo.getAssignment(client, id, { forUpdate: true });
    assertChangeable(row, user, scope, today);
    await repo.cancelAssignment(client, id, user.user_id, body.reason);
    for (const e of row.active_ids)
      await emit(client, {
        key: EVENTS.FIELD_ASSIGNMENT_CANCELLED,
        entity: ENTITY(id),
        actor: user,
        before: { status: "active" },
        after: { status: "cancelled", employee_id: e, cancel_reason: body.reason },
        payload: payloadOf(row, e, { reason: body.reason }),
      });
  });
  return present(await repo.assignmentRow(pool, id, { today, changer: scope }), user);
}

/** POST /attendance/field-assignments/:id/remove: one person off, never the last. */
async function remove(user, id, body, scope) {
  const today = lagos.today();
  const seen = await visible(id, scope);
  assertChangeable(seen, user, scope, today);
  await tx(async (client) => {
    const row = await repo.getAssignment(client, id, { forUpdate: true });
    assertChangeable(row, user, scope, today);
    if (!row.active_ids.includes(body.employee_id))
      throw new AppError("NOT_ON_ASSIGNMENT", "That person is not on this field assignment", 409, {
        employee_id: ["Not on it"],
      });
    if (row.active_ids.length === 1)
      throw new AppError("ASSIGNMENT_LAST_PERSON", "Cancel the field assignment instead", 409);
    await repo.removeMember(client, id, body.employee_id, user.user_id, body.reason);
    await emit(client, {
      key: EVENTS.FIELD_ASSIGNMENT_MEMBER_REMOVED,
      entity: ENTITY(id),
      actor: user,
      before: { employee_id: body.employee_id, on_it: true },
      after: { employee_id: body.employee_id, on_it: false, removed_reason: body.reason },
      payload: payloadOf(row, body.employee_id, { reason: body.reason }),
    });
  });
  return present(await repo.assignmentRow(pool, id, { today, changer: scope }), user);
}

/* ------------------------------------------------------------------ *
 * Reads
 * ------------------------------------------------------------------ */

/** GET /attendance/field-assignments: with anyone in the reader's `people` view scope on them. */
async function list(user, query, scope) {
  const page = await repo.listAssignments(pool, query, scope, { today: lagos.today(), changer: await changerOf(user) });
  return presentPage(page, user);
}

/** GET /attendance/field-assignments/:id */
async function get(user, id, scope) {
  await visible(id, scope);
  return present(await repo.assignmentRow(pool, id, { today: lagos.today(), changer: await changerOf(user) }), user);
}

/** GET /attendance/me/field-assignments: every one the person is or was on. */
async function mine(user, query) {
  const page = await repo.listAssignments(pool, query, null, {
    today: lagos.today(),
    changer: null,
    mine: user.employee_id,
  });
  return presentPage(page, user);
}

/** GET /attendance/me/field-assignments/:id; one they were never on is a 404. */
async function getMine(user, id) {
  const row = await repo.getAssignment(pool, id);
  if (!row || !row.member_ids.includes(user.employee_id)) throw notFound();
  return present(await repo.assignmentRow(pool, id, { today: lagos.today(), changer: null }), user);
}

module.exports = { cancel, remove, list, get, mine, getMine, present };
