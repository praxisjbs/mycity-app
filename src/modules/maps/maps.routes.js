"use strict";
/**
 * /api/v1/maps: Geoapify through our API, so the key stays on the server (FRONTEND_FOUNDATION
 * F21, F27; docs/guides/addresses.md §5).
 *
 *   GET /search?q=&level=        signed in (`self`): up to six places for what was typed, signed
 *   GET /pin?lat=&lon=&level=    signed in (`self`): the nearest named place to a pinned point, signed
 *   GET /tiles/:z/:x/:y.png      signed in (`self`): one map tile, a PNG
 *
 * Everyone signed in may search, pin and see a map: every address field takes them, and each
 * form's save checks its own grant. A pin sends the provider a point the person chose as an
 * address (TB, 20/10/2026, guide §6.7); a clock-in's point never comes here. None of these reads
 * a record or writes anything.
 */
const express = require("express");
const c = require("@mycity/contract");
const { route } = require("../../http/route");
const controller = require("./maps.controller");

const router = express.Router();

route(router, "get", "/search",
  { query: c.maps.PlaceSearchQuery, response: c.maps.PlaceMatches, self: true, summary: "Search an address" },
  controller.search);

route(router, "get", "/pin",
  { query: c.maps.PinQuery, response: c.maps.Place, self: true, summary: "Name a pinned point" },
  controller.pin);

route(router, "get", "/tiles/:z/:x/:y.png",
  { params: c.maps.TileParams, no_content: true, self: true, summary: "One map tile" },
  controller.tile);

module.exports = { basePath: "/maps", surface: "staff", router };
