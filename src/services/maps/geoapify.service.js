"use strict";
/**
 * Address search (FRONTEND_FOUNDATION F21): what a person types in a location field,
 * turned into a few places with their coordinates, from Geoapify's autocomplete.
 *
 *   const places = await geoapify.searchPlaces("7 Admiralty Way");
 *   → [{ place_id, formatted, lat, lon }, ...]   at most MAX_PLACES
 *
 * The key stays on the server: the browser asks our API (`GET /api/v1/maps/search`),
 * never the provider. Nothing is stored; the form that picks a place saves the address
 * and the coordinates as its own fields, through its own module.
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
 *    same office typed by two people, spends one request of the day's quota.
 */
const { config } = require("../../config/env");
const { logger } = require("../../config/logger");
const { AppError } = require("../../shared/errors");

const AUTOCOMPLETE_URL = "https://api.geoapify.com/v1/geocode/autocomplete";

/** Suggestions a field shows; a person picks from a handful, never a page. */
const MAX_PLACES = 6;

/** Below this many characters autocomplete answers with the whole of Lagos. */
const MIN_CHARS = 3;

/** The field waits on this; a stalled provider shows as a failed search, not a hung one. */
const TIMEOUT_MS = 4500;

/** "lon,lat" of Lagos, for the provider's proximity bias. */
const LAGOS = "3.3947,6.4541";

const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX = 500;
const cache = new Map();

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

function remember(key, places) {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(key, { places, at: Date.now() });
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
  if (!apiKey) throw new AppError("MAPS_OFF", "Address search is not set up.", 503);

  const key = query.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.places;

  const url = new URL(AUTOCOMPLETE_URL);
  url.searchParams.set("text", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("lang", "en");
  url.searchParams.set("limit", String(MAX_PLACES + 2));
  url.searchParams.set("bias", `proximity:${LAGOS}|countrycode:ng`);
  url.searchParams.set("apiKey", apiKey);

  let res;
  try {
    res = await fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    const timedOut = err && (err.name === "TimeoutError" || err.name === "AbortError");
    logger.warn({ provider: "geoapify", timed_out: timedOut, message: String((err && err.message) || "").slice(0, 200) }, "address search failed");
    throw new AppError("MAPS_UNAVAILABLE", "Address search is not answering.", 502);
  }
  if (res.status === 429) {
    logger.warn({ provider: "geoapify", status: 429 }, "address search over its quota");
    throw new AppError("MAPS_BUSY", "Address search is busy. Try again shortly.", 429);
  }
  if (!res.ok) {
    logger.warn({ provider: "geoapify", status: res.status }, "address search refused");
    throw new AppError("MAPS_UNAVAILABLE", "Address search is not answering.", 502);
  }

  let data;
  try {
    data = await res.json();
  } catch {
    throw new AppError("MAPS_UNAVAILABLE", "Address search is not answering.", 502);
  }
  const places = placesOf(data);
  remember(key, places);
  return places;
}

/** Tests: forget every remembered answer. */
function clearCache() {
  cache.clear();
}

module.exports = { searchPlaces, clearCache, MAX_PLACES, MIN_CHARS };
