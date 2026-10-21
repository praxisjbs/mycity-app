"use strict";
/**
 * What a person's work date is made of: the policy that applies, the place their punch
 * is matched to, the shift and the zone (docs/guides/attendance.md §6.1, §6.5).
 * The I/O beside the pure rules in attendance.rules.js.
 *
 *   policy     the Attendance policy's version in force that date, read through
 *              policies.rulesFor (docs/guides/policies.md §6.8), else the type's defaults. MyCity
 *              publishes it on Knowledge Hub · Policies; none is seeded (A26). Nothing is cached:
 *              each call reads the version, so a new one applies from its first day. Its
 *              `geofence_mode` is the mode of the date's place (§6.1):
 *              a field site's on a field assignment or a client visit, a home's when the date is
 *              worked from home (a Remote day of the person's week, a temporary home, a remote
 *              day), the office's otherwise
 *   fence      an approved temporary site the person is still on covering the date before
 *              anything (§6.11, PR 4, attendance.sites.js contextOf): its addresses, the nearest
 *              judging the punch, a Temporary Home judged as a home, read in its own zone.
 *              Then a field assignment the person is still on covering the date
 *              (§6.12): its sites, the nearer judging the punch (attendance.geofence.js).
 *              Then an approved work location request covering the date (§6.11): its
 *              temporary home, fenced like a home; a client visit, its site; a remote day, the
 *              approved home when the person has one; otherwise no fence and `approved` names
 *              the day, the approval being the check. Then someone working from home that date (a
 *              Remote day of their work schedule, or with none a remote work pattern, §6.13): their
 *              approved home, with the policy's home_radius_m, or none until People approve one.
 *              Everyone else: the employee's own worksite (employee.worksite_id); only an active
 *              worksite fences
 *   home_day   the date is worked from home by the schedule or the pattern, so having no fence
 *              means no approved home (no_home) rather than no office (no_worksite)
 *   zone       the worksite's timezone, else Africa/Lagos (a home has none of its own)
 *   shift      the person's own (§6.13, rules.shiftFor): their work schedule in force for that
 *              weekday, else the company hours (the policy's `hours`, else the working week of
 *              Settings · Organisation), the policy's grace, and whether the day is worked at all;
 *              on a day of a temporary site with its own hours, the site's (§6.11)
 */
const workingWeek = require("../../shared/time/working-week");
const lagos = require("../../shared/time/lagos");
const worksites = require("../worksites/worksites.service");
const rules = require("./attendance.rules");
const repo = require("./attendance.repo");
const policies = require("../policies/policies.service");
const temporarySites = require("./attendance.sites");
// The Attendance policy type registers itself with policies when it is loaded.
require("./attendance.policy-type");

/**
 * The rules for a date, defaults filled in: the Attendance policy's version in force then. One
 * organisation policy, so the person does not change them; `employeeId` is kept for the callers.
 */
async function policyFor(db, _employeeId, date) {
  const { policy_version_id: versionId, version, rules: r } = await policies.rulesFor(db, "attendance", date);
  return {
    policy_version_id: versionId,
    version,
    ...r,
    geofence_mode: r.office_geofence_mode,
    override_worksite_id: null,
  };
}

/** The zone a person's dates are read in, before their date is known. */
const zoneOf = (person) => (person && person.timezone) || rules.DEFAULT_TZ;

/**
 * The company hours in force on a date: the Attendance policy version's `hours`, or null while no
 * version sets them (the working week then applies, A22). The SQL that works a day out per person
 * takes them as a parameter (attendance.repo.js EXPECTED_ON).
 */
async function companyHoursOn(db, date) {
  const { rules: r } = await policies.rulesFor(db, "attendance", date);
  return r.hours || null;
}

/** The company hours for each date from `from` to `to` (at most a month), as `{ date: hours|null }`. */
async function companyHoursBetween(db, from, to) {
  const out = {};
  for (let d = from; d <= to; d = lagos.addDays(d, 1)) out[d] = await companyHoursOn(db, d);
  return out;
}

/**
 * A person's shift on a date (§6.4, §6.13): their work schedule in force then, else the company
 * hours, at the place the schedule or their pattern gives. `policy` is the rules to read the hours
 * and grace from (the version in force, unless the caller holds the one that judged the day).
 */
async function shiftOn(db, person, date, { policy = null, calendar: cal = null } = {}) {
  const rulesThen = policy || (await policyFor(db, person.employee_id, date));
  const schedule = await repo.workScheduleOn(db, person.employee_id, date);
  const shift = rules.shiftFor(date, cal || (await workingWeek.loadCalendar(db)), rulesThen, {
    schedule,
    pattern: person.work_pattern,
  });
  // A temporary site with its own hours sets the day: worked, from its start to its end (§6.11).
  return temporarySites.siteShift(await temporarySites.siteOn(db, person.employee_id, date), shift);
}

/** Whether a shift's date is worked from home: a Remote day, or with no working day a remote pattern. */
const homeDay = (person, shift) => (shift.place ? shift.place === "remote" : person.work_pattern === "remote");

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
  const shift = await shiftOn(db, person, date, { policy });
  // A temporary site the person is still on that day comes first (§6.11).
  const site = await temporarySites.siteOn(db, person.employee_id, date);
  if (site) return temporarySites.contextOf(site, { policy, shift });
  const assignment = await repo.fieldAssignmentOn(db, person.employee_id, date);
  if (assignment)
    return {
      policy: rules.forPlace(policy, "site"),
      shift,
      timeZone: zoneOf(person),
      fence: fieldFence(assignment),
      approved: null,
      home_day: false,
    };
  const request = await repo.approvedRequestOn(db, person.employee_id, date);
  if (request)
    return {
      policy: rules.forPlace(policy, request.request_type === "client_visit" ? "site" : "home"),
      shift,
      timeZone: zoneOf(person),
      home_day: false,
      ...(await requestPlace(db, person, request, policy)),
    };
  if (homeDay(person, shift)) {
    return {
      policy: rules.forPlace(policy, "home"),
      fence: await homeFence(db, person, policy),
      timeZone: zoneOf(person),
      shift,
      home_day: true,
    };
  }
  const fence =
    (await worksites.fenceFor(db, policy.override_worksite_id)) || (await worksites.fenceFor(db, person.worksite_id));
  return {
    policy: rules.forPlace(policy, "office"),
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

module.exports = { policyFor, contextFor, zoneOf, companyHoursOn, companyHoursBetween, shiftOn, homeDay, PLACE_NAME };
