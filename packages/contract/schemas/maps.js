"use strict";
/**
 * Maps and addresses (FRONTEND_FOUNDATION F21, F27; docs/guides/addresses.md), all through our
 * API so the Geoapify key stays on the server:
 *
 *   GET /maps/search?q=&level=   the address search behind every address field: up to six
 *                                places, each with its point, its kind and a token (our
 *                                signature over the place, §6.2 of the guide)
 *   GET /maps/pin?lat=&lon=&level=  the nearest named address to a point a person pinned,
 *                                signed, with the pinned point kept
 *   GET /maps/tiles/:z/:x/:y.png the map's pictures (a PNG, no JSON body)
 *
 * An address is picked, never typed (F27). Every request body field that holds one is a
 * `PlaceInput`: a token our search or pin made, or the device's location while address search
 * is down, with an optional Details line. The server installs the check of a token's signature
 * (`installPlaceVerifier`, from src/shared/places/token.js) and parses each into the place; a
 * browser checks the shape only and keeps the input as given; a Node process with no verifier
 * refuses every token. A record opened for editing carries its address back as a `PlaceView`,
 * with a fresh token, so an untouched address saves as it came.
 *
 * The suggestions are a provider's answer to one search, at most six, never a page of
 * records, so they carry no page envelope.
 */
const { z } = require("zod");
const { blank } = require("./common");

/** What a pick may be: a door (`address`), anything from a door to a city (`area`), a city. */
const PlaceLevel = z.enum(["address", "area", "city"]);

/** What a place is, from the provider's own type. */
const PlaceKind = z.enum(["building", "street", "landmark", "area", "city", "region", "country", "unknown"]);

/** How a place came to be the address: picked, pinned, the device's location, or typed before F27. */
const PlaceSource = z.enum(["search", "pin", "device", "typed"]);

/** What a person typed: from the second character. */
const PlaceSearchQuery = z
  .object({
    q: z.string().trim().min(2).max(200),
    level: PlaceLevel.optional(),
  })
  .strict();

/** One place found, signed. `lat` and `lon` in WGS84 degrees, as the map components take them. */
const Place = z
  .object({
    place_id: z.string(),
    formatted: z.string(),
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),
    kind: PlaceKind,
    /** Our signature over the place: what a form sends back to save it. */
    token: z.string(),
  })
  .strict();

/** GET /maps/search */
const PlaceMatches = z
  .object({
    places: z.array(Place).max(6),
  })
  .strict();

/** A whole number written in a path: digits only, at most seven of them. */
const whole = z
  .string()
  .regex(/^\d{1,7}$/, "Not a whole number")
  .transform(Number);

/** GET /maps/tiles/:z/:x/:y.png: zoom 0 to 20, and a column and row that exist at that zoom. */
const TileParams = z
  .object({ z: whole, x: whole, y: whole })
  .strict()
  .refine((t) => t.z <= 20 && t.x < 2 ** t.z && t.y < 2 ** t.z, { message: "No such tile" });

/** Degrees as a query string writes them: "6.4321", "-0.12". Never empty. */
const degrees = (min, max) =>
  z
    .string()
    .trim()
    .regex(/^-?\d{1,3}(\.\d{1,10})?$/, "Not a coordinate")
    .transform(Number)
    .pipe(z.number().min(min).max(max));

/** GET /maps/pin: the point a person tapped, and the level of the field it is for. */
const PinQuery = z
  .object({
    lat: degrees(-90, 90),
    lon: degrees(-180, 180),
    level: PlaceLevel.optional(),
  })
  .strict();

/* ------------------------------------------------------------------ *
 * An address in a request body, and back out to an edit form
 * ------------------------------------------------------------------ */

/** A device's reading, given as the address while address search is down (guide §6.5). */
const DevicePoint = z
  .object({
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),
    accuracy_m: z.number().min(0).max(100000),
  })
  .strict();

let verifier = null;

/**
 * The server's check of a token's signature (src/shared/places/token.js installs it). Without
 * one, a browser checks the shape only, and any other process refuses every token.
 * @param {(token: string) => boolean} fn
 */
function installPlaceVerifier(fn) {
  verifier = fn;
}

const inBrowser = () => typeof window !== "undefined" && typeof document !== "undefined";

function fromBase64Url(s) {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  if (typeof Buffer !== "undefined") return Buffer.from(b64, "base64").toString("utf8");
  const bytes = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

const SOURCES = new Set(PlaceSource.options);
const KINDS = new Set(PlaceKind.options);
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v, max) => (typeof v === "string" && v.trim() ? v.slice(0, max) : null);

/**
 * What a token says, without checking who made it: the place, or null when it is not one of
 * ours in shape. The signature is the server's to check (installPlaceVerifier).
 * @param {string} token
 */
function readPlaceToken(token) {
  const parts = typeof token === "string" ? token.split(".") : [];
  if (parts.length !== 3 || parts[0] !== "p1") return null;
  let p;
  try {
    p = JSON.parse(fromBase64Url(parts[1]));
  } catch {
    return null;
  }
  if (!p || typeof p !== "object" || !SOURCES.has(p.s)) return null;
  const place = {
    source: p.s,
    formatted: str(p.f, 300),
    lat: num(p.la),
    lon: num(p.lo),
    accuracy_m: num(p.a),
    provider_id: str(p.id, 300),
    kind: KINDS.has(p.k) ? p.k : "unknown",
    city: str(p.c, 120),
    state: str(p.st, 120),
    country_code: str(p.cc, 2),
    verified: p.v === true,
    pending: p.p === true,
  };
  if ((place.lat === null) !== (place.lon === null)) return null;
  if (place.source !== "typed" && place.lat === null) return null;
  if (place.formatted === null && !place.pending) return null;
  return place;
}

const PICK = "Pick an address";

/**
 * An address as a form sends it: `{ token, details }` for a pick, a pin or the record's own place
 * sent back, or `{ device, details }` for the device's location while search is down. Parsed, it
 * is the place itself (source, line, point, kind, ...) with its details, for `places.save()`.
 */
const PlaceInput = z
  .object(
    {
      token: z.string().min(16).max(4000).optional(),
      device: DevicePoint.optional(),
      /** House number, flat or directions: printed before the address, never searched. */
      details: blank(z.string().trim().max(120, "Too long")),
    },
    // A line of text where a place belongs, or none where one is required, says the same.
    { invalid_type_error: PICK, required_error: PICK },
  )
  .strict()
  .superRefine((v, ctx) => {
    if (Boolean(v.token) === Boolean(v.device)) {
      ctx.addIssue({ code: "custom", message: PICK });
      return;
    }
    if (!v.token) return;
    if (!readPlaceToken(v.token)) {
      ctx.addIssue({ code: "custom", message: PICK });
      return;
    }
    // The server always checks the signature; only a browser, with no check installed, takes the shape.
    if (verifier ? !verifier(v.token) : !inBrowser()) ctx.addIssue({ code: "custom", message: PICK });
  })
  .transform((v) => {
    // A browser keeps the address as the person gave it, since that is what it sends; the server
    // turns it into the place.
    if (!verifier && inBrowser()) return v;
    const details = v.details === undefined ? null : v.details;
    if (v.device)
      return {
        source: "device",
        formatted: null,
        lat: v.device.lat,
        lon: v.device.lon,
        accuracy_m: v.device.accuracy_m,
        provider_id: null,
        kind: "unknown",
        city: null,
        state: null,
        country_code: null,
        verified: false,
        pending: true,
        details,
      };
    return { ...readPlaceToken(v.token), details };
  });

/** An address as an edit form reads it: the place saved, with a fresh token to send it back. */
const PlaceView = z
  .object({
    token: z.string(),
    /** The provider's line; null while a device location waits to be named. */
    formatted: z.string().nullable(),
    details: z.string().nullable(),
    lat: z.number().nullable(),
    lon: z.number().nullable(),
    source: PlaceSource,
    kind: PlaceKind,
    /** False for an address typed before F27: kept until it is changed, and a change is a pick. */
    verified: z.boolean(),
    /** A device location not yet named. */
    pending: z.boolean(),
  })
  .strict();

/** Which table each schema is a row of (gate 6, check/contract-columns.js). */
const TABLES = {
  PlaceSearchQuery: { table: null, reason: "the text of one address search and the level of its field" },
  Place: { table: null, reason: "a place the provider found, signed; kept only by the form that picks it" },
  PlaceMatches: { table: null, reason: "the provider's suggestions for one search" },
  TileParams: { table: null, reason: "which map tile; a picture, not a row" },
  PinQuery: { table: null, reason: "the point a person pinned and the level of its field" },
  DevicePoint: { table: null, reason: "a device's reading given as an address while search is down" },
  PlaceInput: { table: null, reason: "an address as a form sends it: a signed pick or pin, or the device's location" },
  PlaceView: {
    table: "place",
    virtual: { token: "signed on read, so an address left alone goes back as it came" },
  },
};

module.exports = {
  TABLES,
  PlaceLevel,
  PlaceKind,
  PlaceSource,
  PlaceSearchQuery,
  Place,
  PlaceMatches,
  TileParams,
  PinQuery,
  DevicePoint,
  PlaceInput,
  PlaceView,
  installPlaceVerifier,
  readPlaceToken,
};
