"use strict";
/**
 * Location maths for clock-in (M1): distance, the nearest worksite, and the
 * decision on a clock event. Pure: no database, so every rule is unit-tested.
 *
 *   const decision = geo.evaluateClockIn({
 *     point: { latitude: 6.4281, longitude: 3.4219 },
 *     accuracy_m: 25,
 *     worksites: [{ worksite_id, latitude, longitude, radius_m }],
 *   });
 *   → { recorded: true, is_offsite: false, worksite_id, distance_m: 38, low_accuracy: false, reason: null }
 *
 * Record and flag, never silently reject (the agreed attendance model): a
 * clock-in away from every worksite is still recorded, with its coordinates as
 * evidence, and flagged for review. Whether an off-site clock-in is allowed at
 * all on a given day (on-site day, hybrid, remote) is the attendance policy's
 * decision, made by the caller with this result.
 *
 * Coordinates are WGS84 degrees. Distances are whole metres. Worksites carry a
 * centre and a radius (`worksite.latitude`, `longitude`, `radius_m`, migration 0040).
 */
const EARTH_RADIUS_M = 6_371_000;
const DEFAULT_MAX_ACCURACY_M = 100;

const rad = (deg) => (Number(deg) * Math.PI) / 180;

/** True for a usable coordinate pair. */
function isPoint(p) {
  if (!p) return false;
  const lat = Number(p.latitude);
  const lng = Number(p.longitude);
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
    && p.latitude !== null && p.longitude !== null;
}

/** Great-circle distance in whole metres (haversine). */
function distanceM(a, b) {
  const dLat = rad(b.latitude - a.latitude);
  const dLng = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return Math.round(EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)));
}

/** The nearest worksite to a point: { worksite, distance_m }, or null when there are none. */
function nearest(point, worksites) {
  let best = null;
  for (const w of worksites || []) {
    if (!isPoint(w)) continue;
    const d = distanceM(point, w);
    if (!best || d < best.distance_m) best = { worksite: w, distance_m: d };
  }
  return best;
}

/** Inside a worksite's radius (the boundary counts as inside). */
function insideFence(point, worksite) {
  return distanceM(point, worksite) <= Number(worksite.radius_m);
}

/**
 * @param {{point: {latitude:number, longitude:number}|null, accuracy_m?: number|null,
 *          worksites: Array<{worksite_id: string, latitude: number, longitude: number, radius_m: number}>,
 *          maxAccuracyM?: number}} input
 * @returns {{recorded: boolean, is_offsite: boolean, worksite_id: string|null, distance_m: number|null,
 *            low_accuracy: boolean, reason: null|"no_location"|"no_worksites"|"outside_worksite"}}
 */
function evaluateClockIn({ point, accuracy_m = null, worksites, maxAccuracyM = DEFAULT_MAX_ACCURACY_M }) {
  if (!isPoint(point)) {
    return { recorded: false, is_offsite: false, worksite_id: null, distance_m: null, low_accuracy: false, reason: "no_location" };
  }
  const low_accuracy = accuracy_m !== null && accuracy_m !== undefined && Number(accuracy_m) > maxAccuracyM;
  const best = nearest(point, worksites);
  if (!best) {
    // No worksite configured yet: nobody is off-site before offices are set up.
    return { recorded: true, is_offsite: false, worksite_id: null, distance_m: null, low_accuracy, reason: "no_worksites" };
  }
  const within = best.distance_m <= Number(best.worksite.radius_m);
  return {
    recorded: true,
    is_offsite: !within,
    worksite_id: within ? best.worksite.worksite_id : null,
    distance_m: best.distance_m,
    low_accuracy,
    reason: within ? null : "outside_worksite",
  };
}

module.exports = { distanceM, nearest, insideFence, isPoint, evaluateClockIn, DEFAULT_MAX_ACCURACY_M, EARTH_RADIUS_M };
