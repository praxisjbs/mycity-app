"use strict";
/**
 * The device decision on one punch, under the policy's mode. Pure
 * (docs/guides/attendance.md §6.6).
 *
 * The device is the session's own: the known device identity sign-in keeps from the
 * device cookie (identity.service.sessionDevice). Nothing the client says about the
 * device is read. What attendance knows of that device is its row here
 * (attendance_device), or none the first time it punches.
 *
 *   state   registered   the person registered it: known
 *           observed     seen on a punch, never registered (first_seen on its first
 *                        punch, when the devices service has just recorded it): unknown
 *           removed      the person or People took it off: unknown
 *           none         the session has no device: unknown
 *
 *   mode off      accepted whatever the state; the device is still recorded, which is
 *                 what lets People switch the policy on later
 *   mode warn     unknown goes to review, with an unknown_device exception
 *   mode block    unknown is rejected
 *
 * There is no exemption by role and no "nobody registered anything yet" pass: an
 * unregistered device is unknown, and the policy alone says what that costs.
 */

/**
 * @param {{mode: "off"|"warn"|"block", status: "registered"|"observed"|"removed"|null, first_seen: boolean,
 *          has_session_device: boolean}} input
 * @returns {{state: string, known: boolean, reason: string|null, result: string, exception: string|null}}
 */
function evaluateDevice({ mode, status, first_seen: firstSeen, has_session_device: hasDevice }) {
  const state = !hasDevice ? "none" : status || "none";
  const known = hasDevice && status === "registered";
  const reason = known
    ? null
    : !hasDevice
      ? "no_device"
      : firstSeen
        ? "new"
        : status === "removed"
          ? "removed"
          : "not_registered";
  if (known || mode === "off") return { state, known, reason, result: "accepted", exception: null };
  if (mode === "block") return { state, known, reason, result: "rejected", exception: null };
  return { state, known, reason, result: "review", exception: "unknown_device" };
}

/** May one more device be registered, given how many are now? */
const canRegister = (registeredCount, max) => Number(registeredCount) < Number(max);

module.exports = { evaluateDevice, canRegister };
