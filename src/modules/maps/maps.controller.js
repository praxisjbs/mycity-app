"use strict";
// ai:none an address search and a map for forms; the assistant reads each address through the manifest of the record that holds it
// search:none no records: a place found here is saved by the form that picked it, in its own module
/**
 * Maps: the HTTP edge for the address search, a pinned point's name and the map's tiles
 * (docs/guides/addresses.md §5). Every place handed out is signed (shared/places/token.js), so
 * the form that saves it can prove it came from here. The provider calls are
 * services/maps/geoapify.service.js, made outside any transaction.
 */
const { ok } = require("../../shared/http/respond");
const geoapify = require("../../services/maps/geoapify.service");
const token = require("../../shared/places/token");

/** A tile is the same for everyone and for a long time; only this person's browser keeps it. */
const TILE_CACHE = "private, max-age=604800";

/** A place as the contract's Place: its line, point and kind, and our signature over all of it. */
function signed(found, source) {
  return {
    place_id: found.place_id,
    formatted: found.formatted,
    lat: found.lat,
    lon: found.lon,
    kind: found.kind,
    token: token.sign({
      source,
      formatted: found.formatted,
      lat: found.lat,
      lon: found.lon,
      provider_id: found.provider_id === undefined ? found.place_id : found.provider_id,
      kind: found.kind,
      city: found.city,
      state: found.state,
      country_code: found.country_code,
      verified: true,
      pending: false,
    }),
  };
}

module.exports = {
  search: async (req, res) => {
    const { q, level } = req.validated.query;
    const found = await geoapify.searchPlaces(q, { level: level || "address" });
    ok(res, { places: found.map((p) => signed(p, "search")) });
  },

  /**
   * The nearest named place to the point tapped. The tapped point is kept as the place's point,
   * except at level city, where the city's own point stands for the city.
   */
  pin: async (req, res) => {
    const { lat, lon, level } = req.validated.query;
    const near = await geoapify.nearest(lat, lon, { level: level || "address" });
    const keepTap = level !== "city" || !near;
    ok(
      res,
      signed(
        {
          place_id: near ? near.place_id : `${lat.toFixed(6)},${lon.toFixed(6)}`,
          provider_id: near ? near.place_id : null,
          formatted: near ? near.formatted : `${lat.toFixed(5)}, ${lon.toFixed(5)}`,
          lat: keepTap ? lat : near.lat,
          lon: keepTap ? lon : near.lon,
          kind: near ? near.kind : "unknown",
          city: near ? near.city : null,
          state: near ? near.state : null,
          country_code: near ? near.country_code : null,
        },
        "pin",
      ),
    );
  },

  tile: async (req, res) => {
    const { z, x, y } = req.validated.params;
    const found = await geoapify.tile(z, x, y);
    res.status(200).set({ "Content-Type": found.type, "Cache-Control": TILE_CACHE }).send(found.bytes);
  },
};
