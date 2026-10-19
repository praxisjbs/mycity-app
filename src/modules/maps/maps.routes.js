"use strict";
/**
 * /api/v1/maps: the address search behind every location field (FRONTEND_FOUNDATION F21).
 *
 *   GET /search?q=   signed in (`self`): a few places for what was typed, with coordinates
 *
 * Everyone signed in may search: a worksite, a field assignment's site, a client visit
 * and a person's own home all take an address, and each form's save checks its own grant.
 * The search reads no record and writes nothing.
 */
const express = require("express");
const c = require("@mycity/contract");
const { route } = require("../../http/route");
const controller = require("./maps.controller");

const router = express.Router();

route(router, "get", "/search",
  { query: c.maps.PlaceSearchQuery, response: c.maps.PlaceMatches, self: true, summary: "Search an address" },
  controller.search);

module.exports = { basePath: "/maps", surface: "staff", router };
