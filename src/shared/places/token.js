"use strict";
/**
 * The token on every place our API hands a browser (docs/guides/addresses.md §6.2): proof that
 * an address came from our own address search, a pin, or a record's saved place, so a typed or
 * altered address can never be saved.
 *
 *   const token = token.sign(place);   // "p1.<payload>.<signature>"
 *   token.verify(token);               // true only for one this environment made, unaltered
 *
 * The payload is the place (source, line, point, provider id, kind, city, state, country,
 * verified, pending, accuracy, and its time zone when the provider named one) as base64url JSON; the contract reads it back
 * (`readPlaceToken`). The signature is HMAC-SHA256 over the payload, cut to 128 bits, with a
 * key derived from ENCRYPTION_KEY (HKDF, info "place-token v1"): no new secret, and a token made
 * on staging never verifies on production. A token does not expire: it says where a place came
 * from, not when.
 *
 * Requiring this file installs the check into the contract (`installPlaceVerifier`), so every
 * `PlaceInput` a route validates is checked at the edge; src/app.js requires it at boot.
 */
const crypto = require("node:crypto");
const { config } = require("../../config/env");
const contract = require("@mycity/contract");

const VERSION = "p1";

let key = null;
function keyOf() {
  if (!key)
    key = Buffer.from(
      crypto.hkdfSync("sha256", Buffer.from(String(config.ENCRYPTION_KEY), "hex"), Buffer.from("mycity"), Buffer.from("place-token v1"), 32),
    );
  return key;
}

const signatureOf = (payload) => crypto.createHmac("sha256", keyOf()).update(`${VERSION}.${payload}`).digest().subarray(0, 16).toString("base64url");

/** Trim a number to what a point needs: six places is about 10 cm. */
const round = (v, places) => (typeof v === "number" && Number.isFinite(v) ? Number(v.toFixed(places)) : null);

/**
 * Sign a place. Details are never in a token: they travel beside it, typed by the person.
 * @param {{source: string, formatted?: string|null, lat?: number|null, lon?: number|null,
 *          accuracy_m?: number|null, provider_id?: string|null, kind?: string, city?: string|null,
 *          state?: string|null, country_code?: string|null, timezone?: string|null, verified?: boolean,
 *          pending?: boolean}} place
 * @returns {string}
 */
function sign(place) {
  const body = {
    s: place.source,
    f: place.formatted || null,
    la: round(place.lat, 6),
    lo: round(place.lon, 6),
    a: round(place.accuracy_m, 1),
    id: place.provider_id || null,
    k: place.kind || "unknown",
    c: place.city || null,
    st: place.state || null,
    cc: place.country_code || null,
    // Optional, so a token signed before the zone was kept still verifies and reads as no zone.
    tz: place.timezone || null,
    v: Boolean(place.verified),
    p: Boolean(place.pending),
  };
  for (const k of Object.keys(body)) if (body[k] === null) delete body[k];
  const payload = Buffer.from(JSON.stringify(body), "utf8").toString("base64url");
  return `${VERSION}.${payload}.${signatureOf(payload)}`;
}

/** True for a token this environment made, unaltered. */
function verify(token) {
  if (typeof token !== "string") return false;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== VERSION) return false;
  const want = Buffer.from(signatureOf(parts[1]));
  const got = Buffer.from(parts[2]);
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}

contract.maps.installPlaceVerifier(verify);

module.exports = { sign, verify };
