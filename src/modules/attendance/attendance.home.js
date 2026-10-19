"use strict";
/**
 * Remote staff's home locations: the one write path for a request and People's decision
 * on it, and the reads behind My Attendance's Home Location and People · Attendance's
 * Homes (docs/guides/attendance.md §6.10).
 *
 *   request    a remote employee, at home, sends one location reading (within the policy's
 *              max_accuracy_m) and the address in their words. A request still waiting is
 *              superseded by the new one; the approved home stays the fence meanwhile
 *   decide     People with `people` approve and scope all approve or reject it, never their
 *              own. Approving supersedes the home in force; rejecting needs a reason the
 *              person reads
 *
 * The address and the point are personal data: the person reads their own, People with
 * scope all read them (masked by the controller under employee.personal), team scope reads
 * the status and the distance only. Events carry ids and statuses, never either.
 */
const { pool } = require("../../config/db");
const { atomically } = require("../../shared/db/tx");
const { AppError } = require("../../shared/errors");
const { emit } = require("../../shared/events/emit");
const geo = require("../../shared/geo/geo");
const { assertInScope } = require("../../shared/rbac/scope");
const lagos = require("../../shared/time/lagos");
const calendar = require("./attendance.calendar");
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

const notFound = () => new AppError("NOT_FOUND", "That home location does not exist", 404);
const iso = (t) => (t ? new Date(t).toISOString() : null);

/** A home row as the person reads it: their own address and point. */
function asLocation(row, radiusM) {
  if (!row) return null;
  return {
    attendance_home_id: row.attendance_home_id,
    status: row.status,
    home_address: row.address,
    home_latitude: Number(row.latitude),
    home_longitude: Number(row.longitude),
    accuracy_m: row.accuracy_m === null ? null : Number(row.accuracy_m),
    radius_m: radiusM,
    requested_at: iso(row.requested_at),
    decided_at: iso(row.decided_at),
    decision_reason: row.decision_reason || null,
  };
}

async function personOf(db, employeeId) {
  const person = await repo.person(db, employeeId);
  if (!person || person.status !== "active")
    throw new AppError("NOT_EMPLOYED", "Only people who work here now set a home location.", 422);
  return person;
}

/** GET /attendance/me/home. */
async function mine(user) {
  const person = await personOf(pool, user.employee_id);
  const policy = await calendar.policyFor(pool, user.employee_id, lagos.today());
  const homes = await repo.homesOf(pool, user.employee_id);
  return {
    needed: person.work_pattern === "remote",
    approved: asLocation(homes.approved, policy.home_radius_m),
    pending: asLocation(homes.pending, policy.home_radius_m),
    rejected: asLocation(homes.rejected, policy.home_radius_m),
    max_accuracy_m: policy.max_accuracy_m,
  };
}

/**
 * POST /attendance/me/home.
 * @param {{user_id: string, employee_id: string}} user  the session's
 * @param {{home_address: string, home_latitude: number, home_longitude: number, accuracy_m: number}} body
 */
async function request(user, body) {
  const employeeId = user.employee_id;
  await tx(async (client) => {
    await repo.lockEmployee(client, employeeId);
    const person = await personOf(client, employeeId);
    if (person.work_pattern !== "remote")
      throw new AppError("HOME_NOT_NEEDED", "Only remote staff set a home location.", 422);
    const policy = await calendar.policyFor(client, employeeId, lagos.today());
    if (Number(body.accuracy_m) > Number(policy.max_accuracy_m))
      throw new AppError("HOME_READING_WEAK", "The location reading was not accurate enough.", 422, {
        accuracy_m: ["Reading too weak"],
      });

    const waiting = (await repo.homesOf(client, employeeId)).pending;
    if (waiting) await repo.supersedePending(client, employeeId);
    const home = await repo.insertHome(client, {
      employee_id: employeeId,
      address: body.home_address,
      latitude: body.home_latitude,
      longitude: body.home_longitude,
      accuracy_m: body.accuracy_m,
      requested_by: user.user_id,
    });
    await emit(client, {
      key: EVENTS.ATTENDANCE_HOME_REQUESTED,
      entity: { type: "attendance_home", id: home.attendance_home_id },
      actor: user,
      after: { status: "pending", superseded_home_id: waiting ? waiting.attendance_home_id : null },
      payload: {
        attendance_home_id: home.attendance_home_id,
        employee_id: employeeId,
        subject_employee_id: employeeId,
        employee_name: person.ref.display_name,
      },
    });
  });
  return mine(user);
}

/**
 * A list row as the contract's HomeRequest: the distance from the approved home is worked
 * out here, and the points it was worked out from are dropped.
 */
function present(row, radiusM) {
  const {
    point_latitude: pLat,
    point_longitude: pLng,
    approved_latitude: aLat,
    approved_longitude: aLng,
    ...out
  } = row;
  const distance =
    aLat === null || aLat === undefined
      ? null
      : geo.distanceM({ latitude: pLat, longitude: pLng }, { latitude: aLat, longitude: aLng });
  return {
    ...out,
    requested_at: iso(out.requested_at),
    decided_at: iso(out.decided_at),
    radius_m: radiusM,
    distance_from_approved_m: distance,
  };
}

/** Each person's home radius today, from their own policy (at most a page of people). */
async function radii(employeeIds) {
  const today = lagos.today();
  const ids = [...new Set(employeeIds)];
  const policies = await Promise.all(ids.map((id) => calendar.policyFor(pool, id, today)));
  return new Map(ids.map((id, i) => [id, policies[i].home_radius_m]));
}

/** GET /attendance/homes: within the caller's scope, the place only for scope all. */
async function list(query, scope) {
  const page = await repo.listHomes(pool, query, scope, { place: scope.scope === "all" });
  const r = await radii(page.data.map((row) => row.employee.employee_id));
  return { ...page, data: page.data.map((row) => present(row, r.get(row.employee.employee_id))) };
}

/** One home location as People read it, within the caller's scope. */
async function get(id, scope) {
  const home = await repo.getHome(pool, id);
  if (!home) throw notFound();
  assertInScope(scope, home.employee_id);
  const row = await repo.homeRow(pool, id, { place: scope.scope === "all" });
  return present(row, (await radii([home.employee_id])).get(home.employee_id));
}

/**
 * POST /attendance/homes/:id/decision.
 * @param {{user_id: string, employee_id: string}} actor
 * @param {{scope: string}} scope  the caller's `people` approve scope
 * @param {string} id
 * @param {{decision: "approve"|"reject", reason?: string|null}} body
 */
async function decide(actor, scope, id, body) {
  if (scope.scope !== "all")
    throw new AppError("FORBIDDEN", "Only People with access to everyone decide home locations", 403);
  const home = await repo.getHome(pool, id);
  if (!home) throw notFound();
  if (home.employee_id === actor.employee_id)
    throw new AppError("OWN_RECORD", "Someone else decides your own home location", 403);
  if (home.status !== "pending") throw new AppError("HOME_DECIDED", "This home location was already decided", 409);

  const status = body.decision === "approve" ? "approved" : "rejected";
  const reason = body.decision === "reject" ? body.reason : null;
  await tx(async (client) => {
    await repo.lockEmployee(client, home.employee_id);
    const before = await repo.approvedHome(client, home.employee_id);
    const done =
      status === "approved"
        ? await repo.approveHome(client, id, home.employee_id, actor.user_id)
        : await repo.rejectHome(client, id, actor.user_id, reason);
    if (!done) throw new AppError("HOME_DECIDED", "This home location was already decided", 409);
    await emit(client, {
      key: EVENTS.ATTENDANCE_HOME_DECIDED,
      entity: { type: "attendance_home", id },
      actor,
      before: { status: "pending" },
      after: {
        status,
        decision_reason: reason,
        superseded_home_id: status === "approved" && before ? before.attendance_home_id : null,
      },
      payload: {
        attendance_home_id: id,
        employee_id: home.employee_id,
        subject_employee_id: home.employee_id,
        status,
      },
    });
  });
  return get(id, scope);
}

module.exports = { mine, request, list, get, decide, present };
