"use strict";
/**
 * Maps (FRONTEND_FOUNDATION F21), all through our API so the Geoapify key stays on the
 * server:
 *
 *   GET /maps/search?q=          the address search behind every location field: a
 *                                handful of places with their coordinates; picking one
 *                                fills the form's own fields, nothing is stored here
 *   GET /maps/tiles/:z/:x/:y.png the map's pictures (a PNG, no JSON body)
 *   GET /maps/reverse?lat=&lon=  the address at a worksite's centre
 *
 * The suggestions are a provider's answer to one search, at most six, never a page of
 * records, so they carry no page envelope.
 */
const { z } = require("zod");

/** What a person typed: three characters at least, or the whole of Lagos matches. */
const PlaceSearchQuery = z
  .object({
    q: z.string().trim().min(3).max(200),
  })
  .strict();

/** One place found. `lat` and `lon` in WGS84 degrees, as the map components take them. */
const Place = z
  .object({
    place_id: z.string(),
    formatted: z.string(),
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),
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

/** GET /maps/reverse: a worksite's centre. */
const PointQuery = z
  .object({
    lat: degrees(-90, 90),
    lon: degrees(-180, 180),
  })
  .strict();

/** The address at a point; null when the provider knows none. */
const PlaceAddress = z
  .object({
    formatted: z.string().nullable(),
  })
  .strict();

/** Which table each schema is a row of (gate 6, check/contract-columns.js). */
const TABLES = {
  PlaceSearchQuery: { table: null, reason: "the text of one address search" },
  Place: { table: null, reason: "a place the provider found; nothing is stored" },
  PlaceMatches: { table: null, reason: "the provider's suggestions for one search" },
  TileParams: { table: null, reason: "which map tile; a picture, not a row" },
  PointQuery: { table: null, reason: "the point to look an address up for" },
  PlaceAddress: { table: null, reason: "the provider's address for one point; nothing is stored" },
};

module.exports = { TABLES, PlaceSearchQuery, Place, PlaceMatches, TileParams, PointQuery, PlaceAddress };
