"use strict";
/**
 * Maps (FRONTEND_FOUNDATION F21): the address search behind every location field.
 * A person types an address, the API asks Geoapify with the server's key, and a
 * handful of places come back with their coordinates. Picking one fills the form's
 * own address, latitude and longitude; nothing is stored here.
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

/** Which table each schema is a row of (gate 6, check/contract-columns.js). */
const TABLES = {
  PlaceSearchQuery: { table: null, reason: "the text of one address search" },
  Place: { table: null, reason: "a place the provider found; nothing is stored" },
  PlaceMatches: { table: null, reason: "the provider's suggestions for one search" },
};

module.exports = { TABLES, PlaceSearchQuery, Place, PlaceMatches };
