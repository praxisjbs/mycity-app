"use strict";
/**
 * /api/v1/search: ⌘K (docs/guides/foundation.md §6.7). Everyone signed in searches
 * (`self`); what comes back is decided per group by the reader's own grants and scope
 * (shared/search/search.service.js), never by a grant on this route.
 */
const express = require("express");
const c = require("@mycity/contract");
const { route } = require("../../http/route");
const controller = require("./search.controller");

const router = express.Router();

route(router, "get", "/",
  { query: c.search.SearchQuery, response: c.search.SearchResult, self: true, summary: "Search screens, actions and records" },
  controller.search);

module.exports = { basePath: "/search", surface: "staff", router };
