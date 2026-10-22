"use strict";
/**
 * The geofence decision on one punch, under the policy's mode. Pure; the distance is
 * shared/geo's (docs/guides/attendance.md §6.5).
 *
 * What the server knows is the reading the browser sent (or why it sent none) and the place the
 * person is expected: a temporary site's addresses (the nearest judges the punch, a Temporary Home
 * as a home), on a field assignment's day the nearer of its sites, on a day an approved work
 * location request covers its temporary home, client's site or approved home, for remote staff and
 * a Remote day of the schedule their approved home (§6.13), else their worksite. A distance or an
 * "inside" flag from the client is never read; the server works it out from the coordinates.
 *
 * A reading is judged with its accuracy `a`, the distance `d` from the centre and the radius `r`:
 *
 *   verdict       inside       d <= r and a <= max_accuracy_m (the boundary counts as inside)
 *                 outside      d - a > r: even the nearest point the reading allows is beyond the fence
 *                 unverified   unclear: the reading's circle crosses the fence (edge), or it is rougher
 *                              than max_accuracy_m (poor_accuracy); or no reading at all: none sent
 *                              (denied, unavailable, timeout, unsupported, insecure, no_location), or
 *                              one with no accuracy or an accuracy of 0 or less (no_accuracy); or
 *                              nothing to match it to: someone working from home with no approved
 *                              home yet (no_home), or someone expected at an office with none
 *                              assigned (no_worksite)
 *                 not_applied  an approved remote day, or a client visit sent before sites were
 *                              asked for, with no fence: the approval is the check (approved_request);
 *                              or a day worked from home while the policy's Home Location is off:
 *                              nothing is checked and no reading is kept (home_location_off, §1.3)
 *
 *   mode off      every verdict is accepted; it is kept as evidence
 *   mode warn     outside or unverified goes to review, with an exception
 *   mode block    outside is rejected and opens its exception, so People see every refusal;
 *                 unverified goes to review, because a reading that could not prove where someone
 *                 was is not proof of being somewhere else
 */
const geo = require("../../shared/geo/geo");
const { GOOD_ACCURACY_M } = require("./attendance.rules");

/**
 * Of a temporary site's addresses (or a field assignment's sites), the one a reading is judged
 * against: the nearest it is inside, else the one it is least far outside. Without a reading, the
 * first.
 */
function nearestSite(sites, point) {
  if (!geo.isPoint(point)) return sites[0];
  const scored = sites.map((x) => ({ x, d: geo.distanceM(point, x) }));
  const inside = scored.filter((c) => c.d <= c.x.radius_m).sort((a, b) => a.d - b.d);
  if (inside.length) return inside[0].x;
  return scored.sort((a, b) => a.d - a.x.radius_m - (b.d - b.x.radius_m))[0].x;
}

/** Is this a usable accuracy: a number above 0? A reading without one proves nothing (no_accuracy). */
const hasAccuracy = (a) => a !== null && a !== undefined && Number.isFinite(Number(a)) && Number(a) > 0;

/**
 * One reading against one fence (§6.5): inside when the centre is within the radius and the reading
 * is as fine as the policy asks; outside when even its nearest possible point is beyond the fence;
 * otherwise unclear, at the edge or too rough, which is never proof of being elsewhere. Pure.
 * @param {{distance_m: number, accuracy_m: number, radius_m: number, max_accuracy_m: number}} reading
 * @returns {{verdict: "inside"|"outside"|"unverified", reason: null|"edge"|"poor_accuracy"}}
 */
function judgeReading({ distance_m: d, accuracy_m: a, radius_m: r, max_accuracy_m: max }) {
  if (d <= r && a <= max) return { verdict: "inside", reason: null };
  if (d - a > r) return { verdict: "outside", reason: null };
  return { verdict: "unverified", reason: a > max ? "poor_accuracy" : "edge" };
}

/**
 * @param {object} input
 * @param {"off"|"warn"|"block"} input.mode
 * @param {{latitude: number, longitude: number}|null} input.point
 * @param {number|null} input.accuracy_m
 * @param {string|null} input.location_error  why there is no reading
 * @param {{kind?: "worksite"|"home"|"temporary_home"|"field", place?: string, attendance_home_id?: string|null,
 *          location_request_id?: string|null, field_assignment_id?: string|null, worksite_id: string|null,
 *          name: string, latitude: number, longitude: number, radius_m: number|null,
 *          sites?: Array<{field_site_id: string, name: string, latitude: number, longitude: number,
 *          radius_m: number}>}|null} input.expected
 * @param {{location_request_id: string, place: string, name: string}|null} [input.approved]  an approved
 *          day with no fence
 * @param {"on_site"|"hybrid"|"remote"} input.work_pattern
 * @param {boolean} [input.home_day]  the date is worked from home by the schedule (a Remote day)
 * @param {boolean} [input.unchecked]  worked from home while Home Location is off: never checked
 * @param {number} input.max_accuracy_m
 * @returns {{verdict: string, reason: string|null, distance_m: number|null, radius_m: number|null,
 *            accuracy: "good"|"fair"|"poor"|null, place: "worksite"|"home"|null, worksite_id: string|null,
 *            worksite_name: string|null, home_id: string|null, request_id: string|null,
 *            assignment_id: string|null, site_id: string|null, outside: string,
 *            result: "accepted"|"review"|"rejected", exception: string|null, retry_location: boolean}}
 */
function decideGeofence({ mode, point, accuracy_m: accuracyM, location_error: locationError, expected: given, approved = null, work_pattern: pattern, home_day: homeDay = false, unchecked = false, max_accuracy_m: maxAccuracyM }) {
  if (unchecked) {
    // Home Location off (§1.3): no place to match and no reading to judge, under every mode.
    return {
      verdict: "not_applied",
      reason: "home_location_off",
      distance_m: null,
      radius_m: null,
      accuracy: null,
      place: null,
      worksite_id: null,
      worksite_name: null,
      home_id: null,
      request_id: null,
      assignment_id: null,
      site_id: null,
      outside: "outside_home",
      retry_location: false,
      result: "accepted",
      exception: null,
    };
  }
  const hasPoint = geo.isPoint(point);
  // A temporary site's or a field assignment's day: judged as at the address the reading is nearest, named by it.
  const site = given && Array.isArray(given.sites) && given.sites.length ? nearestSite(given.sites, point) : null;
  const expected = site
    ? { ...given, name: site.name, latitude: site.latitude, longitude: site.longitude, radius_m: site.radius_m, site_id: site.field_site_id }
    : given;
  const measured = hasPoint && hasAccuracy(accuracyM);
  const accuracy = !measured
    ? null
    : Number(accuracyM) <= GOOD_ACCURACY_M
      ? "good"
      : Number(accuracyM) <= Number(maxAccuracyM)
        ? "fair"
        : "poor";
  const atHome = Boolean(expected) && (expected.kind === "home" || expected.kind === "temporary_home");
  const onApprovedDay = !expected && Boolean(approved);
  const base = {
    distance_m: null,
    radius_m: expected ? Number(expected.radius_m) : null,
    accuracy,
    place: expected ? expected.place || (atHome ? "home" : "worksite") : onApprovedDay ? approved.place : null,
    worksite_id: expected && !atHome ? expected.worksite_id : null,
    worksite_name: expected ? expected.name : onApprovedDay ? approved.name : null,
    home_id: atHome ? expected.attendance_home_id || null : null,
    request_id: (expected && expected.location_request_id) || (onApprovedDay ? approved.location_request_id : null),
    assignment_id: (expected && expected.field_assignment_id) || null,
    site_id: (expected && expected.site_id) || null,
    // The exception an outside reading is, whether it is reviewed or rejected.
    outside: atHome ? "outside_home" : "outside_worksite",
    retry_location: false,
  };

  let verdict;
  let reason;
  if (onApprovedDay) {
    // An approved remote day or client visit with no fence: the approval is the check.
    verdict = "not_applied";
    reason = "approved_request";
  } else if ((pattern === "remote" || homeDay) && !expected) {
    // Nothing approved to match the reading to: People check it by hand, never a refusal.
    verdict = "unverified";
    reason = "no_home";
  } else if (!expected) {
    // Expected at an office with none assigned: the missing setup shows on the first punch.
    verdict = "unverified";
    reason = "no_worksite";
  } else if (!hasPoint) {
    verdict = "unverified";
    reason = locationError || "no_location";
  } else if (!measured) {
    // Coordinates with no accuracy say nothing about how far off they may be: no reading.
    verdict = "unverified";
    reason = "no_accuracy";
  } else {
    base.distance_m = geo.distanceM(point, expected);
    ({ verdict, reason } = judgeReading({
      distance_m: base.distance_m,
      accuracy_m: Number(accuracyM),
      radius_m: Number(expected.radius_m),
      max_accuracy_m: Number(maxAccuracyM),
    }));
  }
  // A new reading changes nothing when there is no place to match it to.
  base.retry_location = verdict === "unverified" && reason !== "no_home" && reason !== "no_worksite";

  const judged = { ...base, verdict, reason };
  if (mode === "off" || verdict === "inside" || verdict === "not_applied")
    return { ...judged, result: "accepted", exception: null };
  if (verdict === "outside")
    return { ...judged, result: mode === "block" ? "rejected" : "review", exception: base.outside };
  return { ...judged, result: "review", exception: "location_unverified" };
}

module.exports = { decideGeofence, judgeReading };
