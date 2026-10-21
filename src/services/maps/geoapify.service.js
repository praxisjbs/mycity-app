"use strict";
/**
 * Geoapify through our own API (FRONTEND_FOUNDATION F21, F27): the address search behind
 * every address field, the nearest named place to a point (a pin, a device location waiting to
 * be named), and the map's tiles (docs/guides/addresses.md).
 *
 *   const places = await geoapify.searchPlaces("7 Admiralty Way", { level: "address" });
 *   → [{ place_id, formatted, lat, lon, kind, city, state, country_code }, ...]   at most MAX_PLACES
 *   const near = await geoapify.nearest(6.4321, 3.4219, { level: "address" });   → a place, or null
 *   const { bytes, type } = await geoapify.tile(15, 18_525, 15_632);              → one PNG
 *
 * The key stays on the server: the browser asks our API (`/api/v1/maps/...`), never the
 * provider. Nothing is stored here: the maps module signs what it hands a browser, and the
 * form that picks a place saves it through shared/places in its own module. The key is
 * Settings · Integrations' (shared/integrations/settings.js: saved there, else
 * GEOAPIFY_API_KEY in the server file; docs/guides/integrations.md §6.3), read at each call, so
 * a new key works at once.
 *
 * Rules:
 *  - Call it outside any transaction: an HTTP wait must never hold a pooled connection.
 *  - Lagos first: results are biased to Lagos and Nigeria, never filtered, so a client site
 *    abroad is still found.
 *  - A level says what a pick may be (contract PlaceLevel): `address` drops areas, cities,
 *    regions and countries; `area` drops regions and countries; `city` asks for cities only.
 *  - The provider's answer is untrusted: every field is coerced and capped, and a result
 *    without a usable point is dropped (a missing coordinate is not 0°, 0°).
 *  - The same building under two ids is one suggestion.
 *  - The key is never logged. The request URL carries it, so a failure is logged as its
 *    status and a short message, never as the error object.
 *  - Fast and frugal (guide §6.4): an answer is kept ten minutes in this process and seven
 *    days in Redis (shared by every process, across restarts), so the same text typed twice,
 *    or by two people, spends one credit; the same text asked twice at once is one request;
 *    and at most RATE requests a second go to the provider (its free plan's limit), a later
 *    one waiting up to RATE_WAIT_MS before it is refused as busy.
 *  - Every request that reached the provider is counted (shared/integrations/usage.js): an
 *    answer from memory spent nothing and is not. A refusal carries the provider's status
 *    (`upstream`) so Settings · Integrations can tell a refused key from an outage.
 *  - A dropped connection (closed, reset, refused, a failed lookup) is asked once more at once;
 *    a request that ran out of time is not, so a person never waits twice the timeout.
 *  - The provider not answering is its outage, not a defect of ours: Settings · Integrations
 *    and the `maps` readiness check carry it, so System Health counts it as a warning, which
 *    never alerts (TB, 20/10/2026, fault #1).
 */
const crypto = require("node:crypto");
const { logger } = require("../../config/logger");
const { tryClient, rkey } = require("../../config/redis");
const { AppError } = require("../../shared/errors");
const integrations = require("../../shared/integrations/settings");
const usage = require("../../shared/integrations/usage");

const AUTOCOMPLETE_URL = "https://api.geoapify.com/v1/geocode/autocomplete";
const REVERSE_URL = "https://api.geoapify.com/v1/geocode/reverse";
/** One style for every map: streets and names readable at office scale. */
const TILE_URL = "https://maps.geoapify.com/v1/tile/osm-bright";

/** Suggestions a field shows; a person picks from a handful, never a page. */
const MAX_PLACES = 6;

/** The field searches from the second character (TB, 20/10/2026: instant, credit-aware). */
const MIN_CHARS = 2;

/** Requests a second to the provider: its free plan's limit. */
const RATE = 5;
/** How long a request over the rate waits for a slot before it is refused as busy. */
const RATE_WAIT_MS = 300;

/** How long Redis keeps an answer: addresses change slowly, and each one kept is a credit saved. */
const SHARED_TTL_S = 7 * 24 * 60 * 60;

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
const nearby = store(500, 10 * 60 * 1000);
/** About 300 PNGs of 15 to 40 KB: a few offices' maps, at most around 12 MB. */
const tiles = store(300, DAY_MS);

const blank = (v) => v === null || v === undefined || v === "";
const capped = (v, max) => (blank(v) ? null : String(v).slice(0, max));

/** The provider's `result_type` as our PlaceKind (contract). */
const KIND = {
  building: "building",
  street: "street",
  amenity: "landmark",
  suburb: "area",
  district: "area",
  postcode: "area",
  locality: "area",
  city: "city",
  county: "region",
  state: "region",
  country: "country",
};

/** The kinds a level never offers (§ Rules). */
const DROPPED = {
  address: new Set(["area", "city", "region", "country"]),
  area: new Set(["region", "country"]),
  city: new Set(["building", "street", "landmark", "area", "region", "country"]),
};

/**
 * The provider's time zone of a result (`timezone.name`, "Africa/Lagos"), when the runtime knows it;
 * else null. Kept so an owner that needs a place's zone can read it (docs/guides/addresses.md §4).
 */
function zoneOf(tz) {
  const name = tz && typeof tz === "object" ? capped(tz.name, 64) : null;
  if (!name) return null;
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: name });
    return name;
  } catch {
    return null;
  }
}

/** One provider result as a place, or null when it has no usable point or address. */
function toPlace(hit) {
  if (!hit || typeof hit !== "object") return null;
  if (blank(hit.lat) || blank(hit.lon)) return null;
  const lat = Number(hit.lat);
  const lon = Number(hit.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  const formatted = capped(hit.formatted, 300);
  if (!formatted) return null;
  const country = capped(hit.country_code, 2);
  return {
    place_id: capped(hit.place_id, 300) || `${lat.toFixed(6)},${lon.toFixed(6)}`,
    formatted,
    lat,
    lon,
    kind: KIND[String(hit.result_type || "").toLowerCase()] || "unknown",
    city: capped(hit.city, 120),
    state: capped(hit.state, 120),
    country_code: country && /^[a-z]{2}$/i.test(country) ? country.toLowerCase() : null,
    timezone: zoneOf(hit.timezone),
  };
}

/** The provider's answer as at most MAX_PLACES places a level offers, one per point. */
function placesOf(data, level = "address") {
  const raw = Array.isArray(data && data.results)
    ? data.results
    : Array.isArray(data && data.features)
      ? data.features.map((f) => (f && f.properties) || null)
      : [];
  const dropped = DROPPED[level] || DROPPED.address;
  const out = [];
  const seen = new Set();
  for (const hit of raw) {
    const place = toPlace(hit);
    if (!place || dropped.has(place.kind)) continue;
    const point = `${place.lat.toFixed(5)},${place.lon.toFixed(5)}`;
    if (seen.has(point)) continue;
    seen.add(point);
    out.push(place);
    if (out.length >= MAX_PLACES) break;
  }
  return out;
}

/** What a refusal means on Settings · Integrations (contract StepCode). */
function codeOf(err) {
  const status = err && err.upstream;
  if (status === 401 || status === 403) return "KEY_REFUSED";
  if (status === 429) return "OVER_QUOTA";
  if (err && err.timed_out) return "TIMEOUT";
  return "UNAVAILABLE";
}

/** A failure the screen can tell apart, carrying the provider's status for codeOf(). */
function refusal(code, message, status, { upstream = null, timedOut = false } = {}) {
  const err = new AppError(code, message, status);
  err.upstream = upstream;
  err.timed_out = timedOut;
  // The provider's outage, recorded without alerting (§ Rules; shared/errors.js).
  if (code === "MAPS_UNAVAILABLE") err.severity = "warning";
  return err;
}

/** Our own timeout, rather than the connection dropping. */
const ranOut = (err) => !!err && (err.name === "TimeoutError" || err.name === "AbortError");

/**
 * One request to the provider, its failures turned into the errors a screen can tell
 * apart, and counted as `kind`. Logged by status and message only: the URL carries the key.
 * @returns {Promise<Response>}
 */
async function ask(url, what, fetchImpl, kind) {
  let res;
  for (let attempt = 1; ; attempt += 1) {
    await slot();
    try {
      res = await fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      break;
    } catch (err) {
      const timedOut = ranOut(err);
      // fetch says only "fetch failed"; the cause names the network's own error (UND_ERR_SOCKET,
      // ECONNRESET, ENOTFOUND), which tells a dropped connection from a failed lookup.
      const cause = (err && err.cause) || {};
      logger.warn(
        { provider: "geoapify", attempt, timed_out: timedOut, code: cause.code || (err && err.code) || null, message: String((err && err.message) || "").slice(0, 200) },
        `${what} failed`,
      );
      if (!timedOut && attempt === 1) continue;
      const e = refusal("MAPS_UNAVAILABLE", "Maps are not answering.", 502, { timedOut });
      usage.record("geoapify", kind, { ok: false, error_code: codeOf(e) });
      throw e;
    }
  }
  if (res.status === 429) {
    logger.warn({ provider: "geoapify", status: 429 }, `${what} over its quota`);
    usage.record("geoapify", kind, { ok: false, error_code: "OVER_QUOTA" });
    throw refusal("MAPS_BUSY", "Maps are busy. Try again shortly.", 429, { upstream: 429 });
  }
  if (!res.ok) {
    logger.warn({ provider: "geoapify", status: res.status }, `${what} refused`);
    const e = refusal("MAPS_UNAVAILABLE", "Maps are not answering.", 502, { upstream: res.status });
    usage.record("geoapify", kind, { ok: false, error_code: codeOf(e) });
    throw e;
  }
  usage.record("geoapify", kind, { ok: true });
  return res;
}

/** When the last RATE requests went out, oldest first. */
const sent = [];

/** Wait for a slot under the provider's rate, or refuse as busy past RATE_WAIT_MS. */
async function slot(now = Date.now()) {
  while (sent.length && now - sent[0] >= 1000) sent.shift();
  if (sent.length >= RATE) {
    const wait = sent[0] + 1000 - now;
    if (wait > RATE_WAIT_MS) throw refusal("MAPS_BUSY", "Maps are busy. Try again shortly.", 429);
    await new Promise((resolve) => setTimeout(resolve, wait));
    return slot(Date.now());
  }
  sent.push(now);
}

/** An answer kept in Redis, shared by every process; undefined when not kept or Redis is away. */
async function shared(key) {
  const redis = tryClient();
  if (!redis) return undefined;
  try {
    const hit = await redis.get(key);
    return hit === null ? undefined : JSON.parse(hit);
  } catch {
    return undefined;
  }
}

function share(key, value) {
  const redis = tryClient();
  if (!redis) return;
  redis.set(key, JSON.stringify(value), "EX", SHARED_TTL_S).catch(() => {});
}

/** The same question asked twice at once is one request: the second waits on the first. */
const asking = new Map();
function once(key, work) {
  const known = asking.get(key);
  if (known) return known;
  const p = work().finally(() => asking.delete(key));
  asking.set(key, p);
  return p;
}

const hashOf = (s) => crypto.createHash("sha1").update(s).digest("hex");

/**
 * The key given (tests, a test before save), else the key in use; MAPS_OFF without one. On the
 * Free plan, today's daily limit reached stops real use (docs/guides/integrations.md §1.2
 * decision 4): MAPS_BUSY, as when Geoapify itself says the quota is spent.
 */
async function keyOf(apiKey) {
  const key = apiKey === undefined ? await integrations.secret("geoapify", "api_key") : apiKey;
  if (!key) throw new AppError("MAPS_OFF", "Maps are not set up.", 503);
  if (apiKey === undefined && (await require("../../shared/integrations/quota").spent("geoapify")))
    throw refusal("MAPS_BUSY", "Maps have used today's allowance.", 429, { upstream: 429 });
  return key;
}

async function jsonOf(res) {
  try {
    return await res.json();
  } catch {
    throw refusal("MAPS_UNAVAILABLE", "Maps are not answering.", 502);
  }
}

/**
 * Places matching what a person typed, of the kinds a level offers.
 * @param {string} text
 * @param {{level?: "address"|"area"|"city", apiKey?: string, fetchImpl?: typeof fetch, fresh?: boolean}} [opts]
 *   apiKey  a key to use instead of the one in use (a test before save; tests)
 *   fresh   ask the provider even when the answer is remembered (a test)
 * @returns {Promise<Array<{place_id: string, formatted: string, lat: number, lon: number, kind: string,
 *          city: string|null, state: string|null, country_code: string|null}>>}
 */
async function searchPlaces(text, { level = "address", apiKey, fetchImpl = fetch, fresh = false } = {}) {
  const query = String(text || "").trim().replace(/\s+/g, " ");
  if (query.length < MIN_CHARS) return [];
  const usedKey = await keyOf(apiKey);

  const key = `${level}|${query.toLowerCase()}`;
  const known = fresh ? undefined : searches.get(key);
  if (known) return known;
  const redisKey = rkey("maps", "search", hashOf(key));
  if (!fresh) {
    const kept = await shared(redisKey);
    if (kept) {
      searches.set(key, kept);
      return kept;
    }
  }

  return once(`search|${key}|${fresh}`, async () => {
    const url = new URL(AUTOCOMPLETE_URL);
    url.searchParams.set("text", query);
    url.searchParams.set("format", "json");
    url.searchParams.set("lang", "en");
    // More than a field shows, so the kinds a level drops still leave six.
    url.searchParams.set("limit", String(level === "city" ? MAX_PLACES : MAX_PLACES + 4));
    if (level === "city") url.searchParams.set("type", "city");
    url.searchParams.set("bias", `proximity:${LAGOS}|countrycode:ng`);
    url.searchParams.set("apiKey", usedKey);

    const places = placesOf(await jsonOf(await ask(url, "address search", fetchImpl, "search")), level);
    if (!fresh) {
      searches.set(key, places);
      share(redisKey, places);
    }
    return places;
  });
}

/** True for a tile that exists at its zoom: 0 to 2^z - 1 across and down. */
function isTile(z, x, y) {
  const span = 2 ** z;
  return [z, x, y].every(Number.isInteger) && z >= 0 && z <= MAX_ZOOM && x >= 0 && y >= 0 && x < span && y < span;
}

/**
 * One map tile, as the provider draws it.
 * @param {number} z  @param {number} x  @param {number} y
 * @param {{apiKey?: string, fetchImpl?: typeof fetch, fresh?: boolean}} [opts]  as searchPlaces
 * @returns {Promise<{bytes: Buffer, type: string}>}
 */
async function tile(z, x, y, { apiKey, fetchImpl = fetch, fresh = false } = {}) {
  if (!isTile(z, x, y)) throw new AppError("NOT_FOUND", "No such tile.", 404);
  const usedKey = await keyOf(apiKey);
  const key = `${z}/${x}/${y}`;
  const known = fresh ? undefined : tiles.get(key);
  if (known) return known;

  const url = new URL(`${TILE_URL}/${key}.png`);
  url.searchParams.set("apiKey", usedKey);
  const res = await ask(url, "map tile", fetchImpl, "tile");
  const type = String(res.headers.get("content-type") || "");
  // Only an image goes back to the browser: anything else from the provider is a failure.
  if (!/^image\/(png|jpeg|webp)$/.test(type.split(";")[0].trim())) {
    logger.warn({ provider: "geoapify", type: type.slice(0, 60) }, "map tile was not an image");
    throw refusal("MAPS_UNAVAILABLE", "Maps are not answering.", 502);
  }
  const found = { bytes: Buffer.from(await res.arrayBuffer()), type: type.split(";")[0].trim() };
  if (!fresh) tiles.set(key, found);
  return found;
}

/**
 * The named place nearest a point (a pin; a device location waiting to be named), or null when
 * the provider knows none. At level city, the city round the point.
 * @param {number} lat  @param {number} lon
 * @param {{level?: "address"|"area"|"city", apiKey?: string, fetchImpl?: typeof fetch, fresh?: boolean}} [opts]
 * @returns {Promise<{place_id: string, formatted: string, lat: number, lon: number, kind: string,
 *          city: string|null, state: string|null, country_code: string|null}|null>}
 */
async function nearest(lat, lon, { level = "address", apiKey, fetchImpl = fetch, fresh = false } = {}) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180)
    throw new AppError("VALIDATION_FAILED", "Not a point.", 422);
  const usedKey = await keyOf(apiKey);
  // About a metre: two people on the same spot ask once.
  const key = `${level}|${lat.toFixed(5)},${lon.toFixed(5)}`;
  const known = fresh ? undefined : nearby.get(key);
  if (known !== undefined) return known;
  const redisKey = rkey("maps", "near", hashOf(key));
  if (!fresh) {
    const kept = await shared(redisKey);
    if (kept !== undefined) {
      nearby.set(key, kept);
      return kept;
    }
  }

  return once(`near|${key}|${fresh}`, async () => {
    const url = new URL(REVERSE_URL);
    url.searchParams.set("lat", String(lat));
    url.searchParams.set("lon", String(lon));
    url.searchParams.set("format", "json");
    url.searchParams.set("lang", "en");
    url.searchParams.set("limit", "1");
    if (level === "city") url.searchParams.set("type", "city");
    url.searchParams.set("apiKey", usedKey);
    const data = await jsonOf(await ask(url, "address lookup", fetchImpl, "reverse"));
    const hit = (Array.isArray(data && data.results) && data.results[0]) || (Array.isArray(data && data.features) && data.features[0] && data.features[0].properties) || null;
    const found = hit ? toPlace(hit) : null;
    if (!fresh) {
      nearby.set(key, found);
      share(redisKey, found);
    }
    return found;
  });
}

/** The address line at a point, or null: Settings · Integrations' lookup step. */
async function reverseGeocode(lat, lon, opts) {
  const found = await nearest(lat, lon, opts);
  return found ? found.formatted : null;
}

/** The tile at zoom `z` that holds a point (the Web Mercator tiling every map uses). */
function tileOf(lat, lon, z) {
  const n = 2 ** z;
  const rad = (lat * Math.PI) / 180;
  const x = Math.floor(((lon + 180) / 360) * n);
  const y = Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n);
  return { z, x: Math.min(n - 1, Math.max(0, x)), y: Math.min(n - 1, Math.max(0, y)) };
}

/** Tests: forget every remembered answer, and the rate's recent requests. */
function clearCache() {
  searches.clear();
  nearby.clear();
  tiles.clear();
  asking.clear();
  sent.length = 0;
}

module.exports = { searchPlaces, nearest, tile, reverseGeocode, tileOf, codeOf, clearCache, placesOf, MAX_PLACES, MIN_CHARS, MAX_ZOOM, RATE };
