"use strict";
/**
 * Geoapify through our own API (FRONTEND_FOUNDATION F21): the address search behind
 * every location field, the map's tiles, and an address for a worksite's point.
 *
 *   const places = await geoapify.searchPlaces("7 Admiralty Way");
 *   → [{ place_id, formatted, lat, lon }, ...]   at most MAX_PLACES
 *   const { bytes, type } = await geoapify.tile(15, 18_525, 15_632);   → one PNG
 *   const address = await geoapify.reverseGeocode(6.4321, 3.4219);    → "12 Admiralty Way, …" or null
 *
 * The key stays on the server: the browser asks our API (`/api/v1/maps/...`), never
 * the provider. Nothing is stored; a form that picks a place saves the address and the
 * coordinates as its own fields, through its own module.
 *
 * Rules:
 *  - Call it outside any transaction: an HTTP wait must never hold a pooled connection.
 *  - Lagos first: results are biased to Lagos and Nigeria, never filtered, so a client
 *    site abroad is still found.
 *  - The provider's answer is untrusted: every field is coerced and capped, and a result
 *    without a usable point is dropped (a missing coordinate is not 0°, 0°).
 *  - The same building under two ids is one suggestion.
 *  - The key is never logged. The request URL carries it, so a failure is logged as its
 *    status and a short message, never as the error object.
 *  - An answer is kept for ten minutes per text, so the same address typed twice, or the
 *    same office typed by two people, spends one request of the day's quota. A tile is kept
 *    for a day (the map of an office is the same for everyone who opens it), an address
 *    for a point for a day; both stores are bounded.
 */
const { config } = require("../../config/env");
const { logger } = require("../../config/logger");
const { AppError } = require("../../shared/errors");

const AUTOCOMPLETE_URL = "https://api.geoapify.com/v1/geocode/autocomplete";
const REVERSE_URL = "https://api.geoapify.com/v1/geocode/reverse";
/** One style for every map: streets and names readable at office scale. */
const TILE_URL = "https://maps.geoapify.com/v1/tile/osm-bright";

/** Suggestions a field shows; a person picks from a handful, never a page. */
const MAX_PLACES = 6;

/** Below this many characters autocomplete answers with the whole of Lagos. */
const MIN_CHARS = 3;

/** The field waits on this; a stalled provider shows as a failed search, not a hung one. */
const TIMEOUT_MS = 4500;

/** "lon,lat" of Lagos, for the provider's proximity bias. */
const LAGOS = "3.3947,6.4541";

/** The closest the tiles go: a street and its doors. */
const MAX_ZOOM = 20;

const DAY_MS = 24 * 60 * 60 * 1000;

/** A bounded store that forgets its oldest entry first, and anything past its age. */
function store(max, ttlMs) {
  const items = new Map();
  return {
    get(key) {
      const hit = items.get(key);
      if (!hit) return undefined;
      if (Date.now() - hit.at >= ttlMs) {
        items.delete(key);
        return undefined;
      }
      return hit.value;
    },
    set(key, value) {
      if (items.size >= max) items.delete(items.keys().next().value);
      items.set(key, { value, at: Date.now() });
    },
    clear: () => items.clear(),
  };
}

const searches = store(500, 10 * 60 * 1000);
/** About 300 PNGs of 15 to 40 KB: a few offices' maps, at most around 12 MB. */
const tiles = store(300, DAY_MS);
const addresses = store(500, DAY_MS);

const blank = (v) => v === null || v === undefined || v === "";
const capped = (v, max) => (blank(v) ? null : String(v).slice(0, max));

/** One provider result as a Place, or null when it has no usable point or address. */
function toPlace(hit) {
  if (!hit || typeof hit !== "object") return null;
  if (blank(hit.lat) || blank(hit.lon)) return null;
  const lat = Number(hit.lat);
  const lon = Number(hit.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  const formatted = capped(hit.formatted, 300);
  if (!formatted) return null;
  return {
    place_id: capped(hit.place_id, 300) || `${lat.toFixed(6)},${lon.toFixed(6)}`,
    formatted,
    lat,
    lon,
  };
}

/** The provider's answer as at most MAX_PLACES places, one per point. */
function placesOf(data) {
  const raw = Array.isArray(data && data.results)
    ? data.results
    : Array.isArray(data && data.features)
      ? data.features.map((f) => (f && f.properties) || null)
      : [];
  const out = [];
  const seen = new Set();
  for (const hit of raw) {
    const place = toPlace(hit);
    if (!place) continue;
    const point = `${place.lat.toFixed(5)},${place.lon.toFixed(5)}`;
    if (seen.has(point)) continue;
    seen.add(point);
    out.push(place);
    if (out.length >= MAX_PLACES) break;
  }
  return out;
}

/**
 * One request to the provider, its failures turned into the errors a screen can tell
 * apart. Logged by status and message only: the URL carries the key.
 * @returns {Promise<Response>}
 */
async function ask(url, what, fetchImpl) {
  let res;
  try {
    res = await fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    const timedOut = err && (err.name === "TimeoutError" || err.name === "AbortError");
    logger.warn({ provider: "geoapify", timed_out: timedOut, message: String((err && err.message) || "").slice(0, 200) }, `${what} failed`);
    throw new AppError("MAPS_UNAVAILABLE", "Maps are not answering.", 502);
  }
  if (res.status === 429) {
    logger.warn({ provider: "geoapify", status: 429 }, `${what} over its quota`);
    throw new AppError("MAPS_BUSY", "Maps are busy. Try again shortly.", 429);
  }
  if (!res.ok) {
    logger.warn({ provider: "geoapify", status: res.status }, `${what} refused`);
    throw new AppError("MAPS_UNAVAILABLE", "Maps are not answering.", 502);
  }
  return res;
}

const keyOf = (apiKey) => {
  if (!apiKey) throw new AppError("MAPS_OFF", "Maps are not set up.", 503);
  return apiKey;
};

async function jsonOf(res) {
  try {
    return await res.json();
  } catch {
    throw new AppError("MAPS_UNAVAILABLE", "Maps are not answering.", 502);
  }
}

/**
 * Places matching what a person typed.
 * @param {string} text
 * @param {{apiKey?: string, fetchImpl?: typeof fetch}} [opts]  tests
 * @returns {Promise<Array<{place_id: string, formatted: string, lat: number, lon: number}>>}
 */
async function searchPlaces(text, { apiKey = config.GEOAPIFY_API_KEY, fetchImpl = fetch } = {}) {
  const query = String(text || "").trim().replace(/\s+/g, " ");
  if (query.length < MIN_CHARS) return [];
  keyOf(apiKey);

  const key = query.toLowerCase();
  const known = searches.get(key);
  if (known) return known;

  const url = new URL(AUTOCOMPLETE_URL);
  url.searchParams.set("text", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("lang", "en");
  url.searchParams.set("limit", String(MAX_PLACES + 2));
  url.searchParams.set("bias", `proximity:${LAGOS}|countrycode:ng`);
  url.searchParams.set("apiKey", apiKey);

  const places = placesOf(await jsonOf(await ask(url, "address search", fetchImpl)));
  searches.set(key, places);
  return places;
}

/** True for a tile that exists at its zoom: 0 to 2^z - 1 across and down. */
function isTile(z, x, y) {
  const span = 2 ** z;
  return [z, x, y].every(Number.isInteger) && z >= 0 && z <= MAX_ZOOM && x >= 0 && y >= 0 && x < span && y < span;
}

/**
 * One map tile, as the provider draws it.
 * @param {number} z  @param {number} x  @param {number} y
 * @param {{apiKey?: string, fetchImpl?: typeof fetch}} [opts]  tests
 * @returns {Promise<{bytes: Buffer, type: string}>}
 */
async function tile(z, x, y, { apiKey = config.GEOAPIFY_API_KEY, fetchImpl = fetch } = {}) {
  if (!isTile(z, x, y)) throw new AppError("NOT_FOUND", "No such tile.", 404);
  keyOf(apiKey);
  const key = `${z}/${x}/${y}`;
  const known = tiles.get(key);
  if (known) return known;

  const url = new URL(`${TILE_URL}/${key}.png`);
  url.searchParams.set("apiKey", apiKey);
  const res = await ask(url, "map tile", fetchImpl);
  const type = String(res.headers.get("content-type") || "");
  // Only an image goes back to the browser: anything else from the provider is a failure.
  if (!/^image\/(png|jpeg|webp)$/.test(type.split(";")[0].trim())) {
    logger.warn({ provider: "geoapify", type: type.slice(0, 60) }, "map tile was not an image");
    throw new AppError("MAPS_UNAVAILABLE", "Maps are not answering.", 502);
  }
  const found = { bytes: Buffer.from(await res.arrayBuffer()), type: type.split(";")[0].trim() };
  tiles.set(key, found);
  return found;
}

/**
 * The address at a point, or null when the provider knows none. Used for a worksite's
 * centre only: a person's home or a punch is never sent (docs/guides/foundation.md §6.13).
 * @param {number} lat  @param {number} lon
 * @param {{apiKey?: string, fetchImpl?: typeof fetch}} [opts]  tests
 * @returns {Promise<string|null>}
 */
async function reverseGeocode(lat, lon, { apiKey = config.GEOAPIFY_API_KEY, fetchImpl = fetch } = {}) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180)
    throw new AppError("VALIDATION_FAILED", "Not a point.", 422);
  keyOf(apiKey);
  // About a metre: two people on the same spot ask once.
  const key = `${lat.toFixed(5)},${lon.toFixed(5)}`;
  const known = addresses.get(key);
  if (known !== undefined) return known;

  const url = new URL(REVERSE_URL);
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lon));
  url.searchParams.set("format", "json");
  url.searchParams.set("lang", "en");
  url.searchParams.set("limit", "1");
  url.searchParams.set("apiKey", apiKey);
  const data = await jsonOf(await ask(url, "address lookup", fetchImpl));
  const hit = (Array.isArray(data && data.results) && data.results[0]) || (Array.isArray(data && data.features) && data.features[0] && data.features[0].properties) || null;
  const formatted = hit ? capped(hit.formatted, 300) : null;
  addresses.set(key, formatted);
  return formatted;
}

/** Tests: forget every remembered answer. */
function clearCache() {
  searches.clear();
  tiles.clear();
  addresses.clear();
}

module.exports = { searchPlaces, tile, reverseGeocode, clearCache, MAX_PLACES, MIN_CHARS, MAX_ZOOM };
