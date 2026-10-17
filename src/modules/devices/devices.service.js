"use strict";
/**
 * Devices: the one write path for a clock-in device (docs/guides/attendance.md §6.6).
 *
 * A device is the session's own: identity remembers each browser a person signs in on
 * (known_device, from the device cookie) and the session points at it. Attendance keeps
 * its own row per known device, so identity's table is only ever read here.
 *
 *   observeForPunch   inside the punch's transaction: the first punch from a device
 *                     records it as observed (devices register even when the device
 *                     policy is off, which is what lets People switch it on later)
 *   registerMine      ESS · My Devices, Register This Device: this session's device,
 *                     after a fresh sign-in (security.assertFresh), at most three at a
 *                     time; nobody at People approves it (12 and 13 October meetings)
 *   removeMine        the person takes one of theirs off
 *   removeFor         People take any device in their scope off, saying why
 *
 * Writes for one person run one after the other (an advisory lock), so two tabs
 * registering at once cannot pass the cap together.
 */
const { pool } = require("../../config/db");
const { atomically } = require("../../shared/db/tx");
const { AppError } = require("../../shared/errors");
const { emit } = require("../../shared/events/emit");
const { assertInScope } = require("../../shared/rbac/scope");
const { MAX_REGISTERED } = require("@mycity/contract").devices;
const identity = require("../identity/identity.service");
const repo = require("./devices.repo");
const guard = require("./devices.guard");
const { EVENTS } = require("./devices.events");

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

const notFound = () => new AppError("NOT_FOUND", "That device does not exist", 404);

/** The audit and notification facts about a device: its id and label, never an identifier. */
const payloadOf = (row) => ({
  attendance_device_id: row.attendance_device_id,
  employee_id: row.employee_id,
  subject_employee_id: row.employee_id,
  label: row.label,
});

/* ------------------------------------------------------------------ *
 * The punch's side
 * ------------------------------------------------------------------ */

/**
 * The punching device, recorded the first time it punches. In the caller's transaction.
 * @returns {Promise<{attendance_device_id: string, status: string, label: string, first_seen: boolean}|null>}
 */
async function observeForPunch(client, { employeeId, knownDeviceId }) {
  if (!knownDeviceId) return null;
  return repo.observe(client, { employeeId, knownDeviceId });
}

/** The device made a punch. In the caller's transaction. */
const notePunch = (client, attendanceDeviceId, at) => repo.notePunch(client, attendanceDeviceId, at);

/**
 * What the clock panel says about the device this session is on.
 * @param {{query: Function}} db
 * @param {{user_id: string, session_id: string, employee_id: string}} user
 */
async function statusForSession(db, user) {
  const knownDeviceId = await identity.sessionDevice(db, user);
  const registered = await repo.countRegistered(db, user.employee_id);
  if (!knownDeviceId)
    return { state: "none", label: null, registered_count: registered, can_register: false };
  const row = await repo.forKnownDevice(db, knownDeviceId);
  const known = row ? null : await repo.knownDevice(db, knownDeviceId);
  const state = row ? row.status : "observed";
  return {
    state,
    label: row ? row.label : known ? known.label : null,
    registered_count: registered,
    can_register: state !== "registered" && guard.canRegister(registered, MAX_REGISTERED),
  };
}

/* ------------------------------------------------------------------ *
 * The person's own
 * ------------------------------------------------------------------ */

async function listMine(user, query) {
  const knownDeviceId = await identity.sessionDevice(pool, user);
  return repo.listMine(pool, user.employee_id, query, knownDeviceId);
}

async function getMine(user, id) {
  const knownDeviceId = await identity.sessionDevice(pool, user);
  const row = await repo.getMine(pool, user.employee_id, id, knownDeviceId);
  if (!row) throw notFound();
  return row;
}

/** Register the device this session is on. */
async function registerMine(user, body) {
  const security = require("../security/security.service");
  await security.assertFresh(pool, user);
  const knownDeviceId = await identity.sessionDevice(pool, user);
  if (!knownDeviceId)
    throw new AppError("NO_DEVICE", "Sign in again on this device to register it.", 409);
  const id = await tx(async (client) => {
    await repo.lockEmployee(client, user.employee_id);
    const row = await repo.observe(client, { employeeId: user.employee_id, knownDeviceId });
    if (!row || row.employee_id !== user.employee_id) throw notFound();
    if (row.status === "registered") return row.attendance_device_id;
    const count = await repo.countRegistered(client, user.employee_id);
    if (!guard.canRegister(count, MAX_REGISTERED))
      throw new AppError(
        "DEVICE_LIMIT",
        `You have ${MAX_REGISTERED} registered devices. Remove one first.`,
        409,
      );
    const after = await repo.register(client, row.attendance_device_id, body.label);
    await emit(client, {
      key: EVENTS.DEVICE_REGISTERED,
      entity: { type: "device", id: row.attendance_device_id },
      actor: user,
      before: { status: row.status },
      after: { status: after.status, label: after.label },
      payload: payloadOf(after),
    });
    return row.attendance_device_id;
  });
  return getMine(user, id);
}

/** Take one of my devices off. */
async function removeMine(user, id) {
  await tx(async (client) => {
    await repo.lockEmployee(client, user.employee_id);
    const before = await repo.get(client, id);
    if (!before || before.employee_id !== user.employee_id) throw notFound();
    const after = await repo.remove(client, id, { by: user.user_id, reason: null });
    if (!after) return;
    await emit(client, {
      key: EVENTS.DEVICE_REMOVED,
      entity: { type: "device", id },
      actor: user,
      before: { status: before.status },
      after: { status: "removed" },
      payload: payloadOf(after),
    });
  });
  return getMine(user, id);
}

/* ------------------------------------------------------------------ *
 * People
 * ------------------------------------------------------------------ */

const list = (query, scope) => repo.list(pool, query, scope);

async function getFor(id, scope) {
  const row = await repo.get(pool, id);
  if (!row) throw notFound();
  assertInScope(scope, row.employee_id);
  const { employee_id: _e, ...out } = row;
  return out;
}

/** People take a device off, with a reason; the person is told. */
async function removeFor(actor, scope, id, body) {
  const before = await repo.get(pool, id);
  if (!before) throw notFound();
  assertInScope(scope, before.employee_id);
  if (before.status === "removed")
    throw new AppError("DEVICE_REMOVED", "This device is already removed.", 409);
  await tx(async (client) => {
    await repo.lockEmployee(client, before.employee_id);
    const after = await repo.remove(client, id, { by: actor.user_id, reason: body.removal_reason });
    if (!after) throw new AppError("DEVICE_REMOVED", "This device is already removed.", 409);
    await emit(client, {
      key: EVENTS.DEVICE_REMOVED,
      entity: { type: "device", id },
      actor,
      before: { status: before.status },
      after: { status: "removed", removal_reason: body.removal_reason },
      payload: payloadOf(after),
    });
  });
  return getFor(id, scope);
}

module.exports = {
  observeForPunch,
  notePunch,
  statusForSession,
  listMine,
  getMine,
  registerMine,
  removeMine,
  list,
  getFor,
  removeFor,
};
