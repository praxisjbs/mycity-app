"use strict";
/**
 * The geofence decision on one punch, under the policy's mode. Pure; the distance is
 * shared/geo's (docs/guides/attendance.md §6.5).
 *
 * What the server knows is the reading the browser sent (or why it sent none) and
 * the place the person is expected: their worksite, for remote staff their approved home,
 * on a day an approved work location request covers, its temporary home or approved home
 * (§6.11), and on a field assignment's day its sites, the nearer judging the punch (§6.12).
 * A distance or an "inside" flag from the client is never read; the server works it out from
 * the coordinates.
 *
 *   verdict       inside       within the radius (the boundary counts as inside)
 *                 outside      beyond it, with a reading good enough to say so
 *                 unverified   no reading (denied, unavailable, timeout, unsupported),
 *                              or one coarser than the policy's accuracy, or a remote
 *                              person with no approved home yet (no_home)
 *                 not_applied  nowhere to judge against: someone not remote with no worksite, or
 *                              an approved remote day or client visit with no fence, where
 *                              the approval is the check (approved_request)
 *
 *   mode off      every verdict is accepted; it is kept as evidence
 *   mode warn     outside or unverified goes to review, with an exception
 *   mode block    outside is rejected; unverified goes to review, because a reading
 *                 that could not be taken is not proof of being somewhere else
 */
const geo = require("../../shared/geo/geo");
const { GOOD_ACCURACY_M } = require("./attendance.rules");

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
 * @param {number} input.max_accuracy_m
 * @returns {{verdict: string, reason: string|null, distance_m: number|null, radius_m: number|null,
 *            accuracy: "good"|"fair"|"poor"|null, place: "worksite"|"home"|null, worksite_id: string|null,
 *            worksite_name: string|null, home_id: string|null, request_id: string|null,
 *            assignment_id: string|null, site_id: string|null, outside: string,
 *            result: "accepted"|"review"|"rejected", exception: string|null, retry_location: boolean}}
 */
/**
 * Of a field assignment's sites, the one a reading is judged against: the nearest it is inside,
 * else the one it is least far outside. Without a reading, the first.
 */
function nearestSite(sites, point) {
  if (!geo.isPoint(point)) return sites[0];
  const scored = sites.map((x) => ({ x, d: geo.distanceM(point, x) }));
  const inside = scored.filter((c) => c.d <= c.x.radius_m).sort((a, b) => a.d - b.d);
  if (inside.length) return inside[0].x;
  return scored.sort((a, b) => a.d - a.x.radius_m - (b.d - b.x.radius_m))[0].x;
}

function decideGeofence({ mode, point, accuracy_m: accuracyM, location_error: locationError, expected: given, approved = null, work_pattern: pattern, max_accuracy_m: maxAccuracyM }) {
  const hasPoint = geo.isPoint(point);
  // A field assignment's day: judged as at the site the reading is nearest, named by it.
  const site = given && Array.isArray(given.sites) && given.sites.length ? nearestSite(given.sites, point) : null;
  const expected = site
    ? { ...given, name: site.name, latitude: site.latitude, longitude: site.longitude, radius_m: site.radius_m, site_id: site.field_site_id }
    : given;
  const accuracy =
    !hasPoint || accuracyM === null || accuracyM === undefined
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
  let reason = null;
  if (onApprovedDay) {
    // An approved remote day or client visit with no fence: the approval is the check.
    verdict = "not_applied";
    reason = "approved_request";
  } else if (pattern === "remote" && !expected) {
    // Nothing approved to match the reading to: People check it by hand, never a refusal.
    verdict = "unverified";
    reason = "no_home";
  } else if (!expected) {
    verdict = "not_applied";
    reason = "no_worksite";
  } else if (!hasPoint) {
    verdict = "unverified";
    reason = locationError || "no_location";
  } else {
    base.distance_m = geo.distanceM(point, expected);
    if (accuracy === "poor") {
      verdict = "unverified";
      reason = "poor_accuracy";
    } else {
      verdict = base.distance_m <= Number(expected.radius_m) ? "inside" : "outside";
    }
  }
  base.retry_location = verdict === "unverified" && reason !== "no_home";

  const judged = { ...base, verdict, reason };
  if (mode === "off" || verdict === "inside" || verdict === "not_applied")
    return { ...judged, result: "accepted", exception: null };
  if (verdict === "outside" && mode === "block")
    return { ...judged, result: "rejected", exception: null };
  return {
    ...judged,
    result: "review",
    exception: verdict === "outside" ? base.outside : "location_unverified",
  };
}

module.exports = { decideGeofence };
