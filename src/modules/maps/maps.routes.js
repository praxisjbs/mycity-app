"use strict";
/**
 * /api/v1/maps: Geoapify through our API, so the key stays on the server (FRONTEND_FOUNDATION F21).
 *
 *   GET /search?q=           signed in (`self`): a few places for what was typed, with coordinates
 *   GET /tiles/:z/:x/:y.png  signed in (`self`): one map tile, a PNG
 *   GET /reverse?lat=&lon=   `people` create or edit: the address at a worksite's centre
 *
 * Everyone signed in may search and see a map: a worksite, a field assignment's site, a
 * client visit and a person's own home all take an address, and each form's save checks
 * its own grant. The reverse lookup is for a worksite's centre only (decided 19/10/2026),
 * so it carries the grants that set worksites up: a home or a punch is never sent to the
 * provider. None of these reads a record or writes anything.
 */
const express = require("express");
const c = require("@mycity/contract");
const { route } = require("../../http/route");
const { requireAnyPermission } = require("../../middleware/rbac");
const controller = require("./maps.controller");

const router = express.Router();

route(router, "get", "/search",
  { query: c.maps.PlaceSearchQuery, response: c.maps.PlaceMatches, self: true, summary: "Search an address" },
  controller.search);

route(router, "get", "/tiles/:z/:x/:y.png",
  { params: c.maps.TileParams, no_content: true, self: true, summary: "One map tile" },
  controller.tile);

route(router, "get", "/reverse",
  { query: c.maps.PointQuery, response: c.maps.PlaceAddress, summary: "The address at a worksite's centre" },
  requireAnyPermission([["people", "create"], ["people", "edit"]]), controller.reverse);

module.exports = { basePath: "/maps", surface: "staff", router };
