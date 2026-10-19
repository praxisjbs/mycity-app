"use strict";
// ai:none an address search for forms; the assistant reads worksites and attendance through their own manifests
// search:none no records: a place found here is saved by the form that picked it, in its own module
/**
 * Maps: the HTTP edge for the address search. The provider call is
 * services/maps/geoapify.service.js, made outside any transaction.
 */
const { ok } = require("../../shared/http/respond");
const geoapify = require("../../services/maps/geoapify.service");

module.exports = {
  search: async (req, res) => ok(res, { places: await geoapify.searchPlaces(req.validated.query.q) }),
};
