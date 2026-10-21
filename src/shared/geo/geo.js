"use strict";
/**
 * Location maths: whether a coordinate pair is usable, and the distance between two in whole
 * metres. Pure: no database, so every rule is unit-tested.
 *
 *   geo.distanceM({ latitude: 6.4281, longitude: 3.4219 }, { latitude: 6.4285, longitude: 3.4221 })
 *   → 50
 *
 * What a distance means for a punch (inside, outside or unclear under the policy's mode) is the
 * attendance module's decision (attendance.geofence.js), never this file's.
 *
 * Coordinates are WGS84 degrees. Distances are whole metres.
 */
const EARTH_RADIUS_M = 6_371_000;

const rad = (deg) => (Number(deg) * Math.PI) / 180;

/** True for a usable coordinate pair. */
function isPoint(p) {
  if (!p) return false;
  const lat = Number(p.latitude);
  const lng = Number(p.longitude);
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180 &&
    p.latitude !== null &&
    p.longitude !== null
  );
}

/** Great-circle distance in whole metres (haversine). */
function distanceM(a, b) {
  const dLat = rad(b.latitude - a.latitude);
  const dLng = rad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.latitude)) *
      Math.cos(rad(b.latitude)) *
      Math.sin(dLng / 2) ** 2;
  return Math.round(
    EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)),
  );
}

module.exports = {
  distanceM,
  isPoint,
  EARTH_RADIUS_M,
};
