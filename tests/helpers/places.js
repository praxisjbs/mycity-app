"use strict";
/**
 * Addresses for tests, as a form sends them (docs/guides/addresses.md §6.2): a place signed as
 * the address search signs one, or the device's location while search is down. Requiring this
 * installs the server's check of a token into the contract, as src/app.js does at boot.
 *
 *   const { picked, pinned, device } = require("../helpers/places");
 *   await as("staff").post("/attendance/me/home", { home_address: picked("3 Example Close, Yaba"), ... });
 *   picked("Lekki Phase 1", { kind: "area" })               // a pick the level may refuse
 *   picked("3 Example Close, Yaba", { details: "Flat 2" })  // with a Details line
 *   device(6.6, 3.5, 12)                                     // search down: the device stands in
 *
 * The places are invented; the points default to the middle of Lagos.
 */
const token = require("../../src/shared/places/token");

const LAGOS = { lat: 6.4541, lon: 3.3947 };

/** The place itself, signed: what /maps/search hands a browser for a pick. */
function signedPlace(formatted, { lat = LAGOS.lat, lon = LAGOS.lon, kind = "building", source = "search" } = {}) {
  return token.sign({
    source,
    formatted,
    lat,
    lon,
    provider_id: `test-${formatted.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    kind,
    city: "Lagos",
    state: "Lagos State",
    country_code: "ng",
    verified: true,
    pending: false,
  });
}

/** A place picked from the address search, as the field sends it. */
function picked(formatted, { details, ...place } = {}) {
  return { token: signedPlace(formatted, place), ...(details === undefined ? {} : { details }) };
}

/** A point pinned on the map and named by /maps/pin. */
const pinned = (formatted, place = {}) => picked(formatted, { kind: "street", ...place, source: "pin" });

/** The device's location given while address search is down. */
function device(lat, lon, accuracy_m = 10, details) {
  return { device: { lat, lon, accuracy_m }, ...(details === undefined ? {} : { details }) };
}

module.exports = { picked, pinned, device, signedPlace, LAGOS };
