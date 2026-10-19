"use strict";
/**
 * What a person's work date is made of: the policy that applies, the place their punch
 * is matched to, the shift and the zone (docs/guides/attendance.md §6.1, §6.5).
 * The I/O beside the pure rules in attendance.rules.js.
 *
 *   policy     their own active policy for the date (employee_attendance_policy), else the
 *              organisation's (the oldest active one), else the code's defaults. MyCity
 *              enters policies; none is seeded (A26)
 *   fence      an approved work location request covering the date first (§6.11): its
 *              temporary home, fenced like a home; a remote day, the approved home when the
 *              person has one; otherwise no fence and `approved` names the day, the approval
 *              being the check. Then remote staff: their approved home, with the policy's
 *              home_radius_m, or none until People approve one. Everyone else: the policy row's
 *              worksite for the date when it names one, else the employee's own
 *              (employee.worksite_id); only an active worksite fences
 *   zone       the worksite's timezone, else Africa/Lagos (a home has none of its own)
 *   shift      the working week's hours for that weekday, the policy's grace, and whether
 *              the day is worked at all (shared/time/working-week)
 */
const workingWeek = require("../../shared/time/working-week");
const worksites = require("../worksites/worksites.service");
const rules = require("./attendance.rules");
const repo = require("./attendance.repo");

/** The policy for a person on a date, defaults filled in. */
async function policyFor(db, employeeId, date) {
  const row = (await repo.assignedPolicy(db, employeeId, date)) || (await repo.defaultPolicy(db));
  if (!row) return { ...rules.DEFAULT_POLICY, override_worksite_id: null };
  return {
    attendance_policy_id: row.attendance_policy_id,
    name: row.name,
    grace_minutes: Number(row.grace_minutes) || 0,
    latest_clock_out_minutes: Number(row.latest_clock_out_minutes),
    geofence_mode: row.geofence_mode || rules.DEFAULT_POLICY.geofence_mode,
    device_mode: row.device_mode || rules.DEFAULT_POLICY.device_mode,
    max_accuracy_m: Number(row.max_accuracy_m) || rules.DEFAULT_POLICY.max_accuracy_m,
    home_radius_m: Number(row.home_radius_m) || rules.DEFAULT_POLICY.home_radius_m,
    override_worksite_id: row.override_worksite_id || null,
  };
}

/** The zone a person's dates are read in, before their date is known. */
const zoneOf = (person) => (person && person.timezone) || rules.DEFAULT_TZ;

/**
 * Everything a punch or a day of a person on `date` is judged with.
 * @param {{query: Function}} db
 * @param {{employee_id: string, worksite_id: string|null, work_pattern: string}} person  repo.person()
 * @param {string} date
 */
async function contextFor(db, person, date) {
  const policy = await policyFor(db, person.employee_id, date);
  const calendar = await workingWeek.loadCalendar(db);
  const shift = rules.shiftFor(date, calendar, policy);
  const request = await repo.approvedRequestOn(db, person.employee_id, date);
  if (request) return { policy, shift, timeZone: zoneOf(person), ...(await requestPlace(db, person, request, policy)) };
  if (person.work_pattern === "remote") {
    const home = await repo.approvedHome(db, person.employee_id);
    return {
      policy,
      fence: home
        ? {
            kind: "home",
            attendance_home_id: home.attendance_home_id,
            worksite_id: null,
            name: "Home",
            latitude: Number(home.latitude),
            longitude: Number(home.longitude),
            radius_m: Number(policy.home_radius_m),
          }
        : null,
      timeZone: zoneOf(person),
      shift,
    };
  }
  const fence =
    (await worksites.fenceFor(db, policy.override_worksite_id)) || (await worksites.fenceFor(db, person.worksite_id));
  return {
    policy,
    fence: fence
      ? {
          kind: "worksite",
          attendance_home_id: null,
          worksite_id: fence.worksite_id,
          name: fence.name,
          latitude: Number(fence.latitude),
          longitude: Number(fence.longitude),
          radius_m: Number(fence.radius_m),
        }
      : null,
    timeZone: (fence && fence.timezone) || zoneOf(person),
    shift,
  };
}

/** What an approved work location request's day is matched to (§6.11). */
const PLACE_NAME = Object.freeze({ temporary_home: "Temporary Home", remote_day: "Remote Day", client_visit: "Client Visit" });

async function requestPlace(db, person, request, policy) {
  const base = { attendance_home_id: null, location_request_id: request.location_request_id, worksite_id: null };
  if (request.request_type === "temporary_home")
    return {
      fence: {
        ...base,
        kind: "temporary_home",
        place: "temporary_home",
        name: PLACE_NAME.temporary_home,
        latitude: Number(request.latitude),
        longitude: Number(request.longitude),
        radius_m: Number(policy.home_radius_m),
      },
      approved: null,
    };
  if (request.request_type === "remote_day") {
    const home = await repo.approvedHome(db, person.employee_id);
    if (home)
      return {
        fence: {
          ...base,
          kind: "home",
          place: "remote_day",
          attendance_home_id: home.attendance_home_id,
          name: "Home",
          latitude: Number(home.latitude),
          longitude: Number(home.longitude),
          radius_m: Number(policy.home_radius_m),
        },
        approved: null,
      };
  }
  return {
    fence: null,
    approved: {
      location_request_id: request.location_request_id,
      place: request.request_type,
      name: PLACE_NAME[request.request_type],
    },
  };
}

module.exports = { policyFor, contextFor, zoneOf, PLACE_NAME };
