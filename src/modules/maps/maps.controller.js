"use strict";
// ai:none an address search and a map for forms; the assistant reads worksites and attendance through their own manifests
// search:none no records: a place found here is saved by the form that picked it, in its own module
/**
 * Maps: the HTTP edge for the address search, the map's tiles and a worksite's address.
 * The provider calls are services/maps/geoapify.service.js, made outside any transaction.
 */
const { ok } = require("../../shared/http/respond");
const geoapify = require("../../services/maps/geoapify.service");

/** A tile is the same for everyone and for a long time; only this person's browser keeps it. */
const TILE_CACHE = "private, max-age=604800";

module.exports = {
  search: async (req, res) => ok(res, { places: await geoapify.searchPlaces(req.validated.query.q) }),

  tile: async (req, res) => {
    const { z, x, y } = req.validated.params;
    const found = await geoapify.tile(z, x, y);
    res.status(200).set({ "Content-Type": found.type, "Cache-Control": TILE_CACHE }).send(found.bytes);
  },

  reverse: async (req, res) => {
    const { lat, lon } = req.validated.query;
    ok(res, { formatted: await geoapify.reverseGeocode(lat, lon) });
  },
};
