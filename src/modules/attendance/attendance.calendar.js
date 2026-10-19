"use strict";
/**
 * What a person's work date is made of: the policy that applies, the place their punch
 * is matched to, the shift and the zone (docs/guides/attendance.md §6.1, §6.5).
 * The I/O beside the pure rules in attendance.rules.js.
 *
 *   policy     their own active policy for the date (employee_attendance_policy), else the
 *              organisation's (the oldest active one), else the code's defaults. MyCity
 *              enters policies; none is seeded (A26)
 *   fence      a field assignment the person is still on covering the date before anything
 *              (§6.12): its sites, the nearer judging the punch (attendance.geofence.js).
 *              Then an approved work location request covering the date (§6.11): its
 *              temporary home, fenced like a home; a client visit, its site; a remote day, the
 *              approved home when the person has one; otherwise no fence and `approved` names
 *              the day, the approval being the check. Then someone working from home that date
 *              (remote staff, or a hybrid employee's home day by their schedule, §6.13): their
 *              approved home, with the policy's home_radius_m, or none until People approve one.
 *              Everyone else: the policy row's worksite for the date when it names one, else the
 *              employee's own (employee.worksite_id); only an active worksite fences
 *   home_day   the date is worked from home by the pattern or the schedule, so having no fence
 *              means no approved home (no_home) rather than no office (no_worksite)
 *   zone       the worksite's timezone, else Africa/Lagos (a home has none of its own)
 *   shift      the working week's hours for that weekday, the policy's grace, and whether
 *              the day is worked at all (shared/time/working-week)
 */
const workingWeek = require("../../shared/time/working-week");
const lagos = require("../../shared/time/lagos");
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
 * Whether a hybrid employee works `date` from home: the schedule in force then leaves its weekday
 * out (§6.13). No schedule, or any other pattern, is not a home day here.
 */
async function hybridHomeDay(db, person, date) {
  if (person.work_pattern !== "hybrid") return false;
  const schedule = await repo.scheduleOn(db, person.employee_id, date);
  return Boolean(schedule) && !schedule.office_days.includes(lagos.weekday(date));
}

/** The approved home as a fence, or null when People have approved none. */
async function homeFence(db, person, policy, extra = {}) {
  const home = await repo.approvedHome(db, person.employee_id);
  if (!home) return null;
  return {
    ...extra,
    kind: "home",
    attendance_home_id: home.attendance_home_id,
    worksite_id: null,
    name: "Home",
    latitude: Number(home.latitude),
    longitude: Number(home.longitude),
    radius_m: Number(policy.home_radius_m),
  };
}

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
  const assignment = await repo.fieldAssignmentOn(db, person.employee_id, date);
  if (assignment)
    return { policy, shift, timeZone: zoneOf(person), fence: fieldFence(assignment), approved: null, home_day: false };
  const request = await repo.approvedRequestOn(db, person.employee_id, date);
  if (request)
    return { policy, shift, timeZone: zoneOf(person), home_day: false, ...(await requestPlace(db, person, request, policy)) };
  if (person.work_pattern === "remote" || (await hybridHomeDay(db, person, date))) {
    return { policy, fence: await homeFence(db, person, policy), timeZone: zoneOf(person), shift, home_day: true };
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
    home_day: false,
  };
}

/**
 * A field assignment's fence (§6.12): its sites, the first standing for the place until the punch
 * picks the nearer. `name` is how the panel names it: the site, or both when there are two.
 */
function fieldFence(assignment) {
  const sites = assignment.sites.map((x) => ({
    field_site_id: x.field_site_id,
    name: x.name,
    latitude: Number(x.latitude),
    longitude: Number(x.longitude),
    radius_m: Number(x.radius_m),
  }));
  return {
    kind: "field",
    place: "field",
    attendance_home_id: null,
    worksite_id: null,
    field_assignment_id: assignment.field_assignment_id,
    assignment_number: assignment.number,
    name: sites.map((x) => x.name).join(" or "),
    latitude: sites[0].latitude,
    longitude: sites[0].longitude,
    radius_m: sites.length === 1 ? sites[0].radius_m : null,
    sites,
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
  if (request.request_type === "client_visit" && request.site_latitude !== null)
    return {
      fence: {
        ...base,
        kind: "client_visit",
        place: "client_visit",
        name: PLACE_NAME.client_visit,
        latitude: Number(request.site_latitude),
        longitude: Number(request.site_longitude),
        radius_m: Number(request.site_radius_m),
      },
      approved: null,
    };
  if (request.request_type === "remote_day") {
    const fence = await homeFence(db, person, policy, { ...base, place: "remote_day" });
    if (fence) return { fence, approved: null };
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

module.exports = { policyFor, contextFor, zoneOf, hybridHomeDay, PLACE_NAME };
