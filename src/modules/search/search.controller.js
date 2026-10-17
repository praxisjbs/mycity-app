"use strict";
// ai:none search is a way to open screens and records; the assistant reads each module's own manifest
// search:none this module is ⌘K itself; its screens and actions are catalogues in shared/search
/**
 * ⌘K: the HTTP edge. The work is shared/search/search.service.js `everything()`.
 */
const { pool } = require("../../config/db");
const { ok } = require("../../shared/http/respond");
const searchService = require("../../shared/search/search.service");

module.exports = {
  search: async (req, res) => ok(res, await searchService.everything(pool, req.user, req.validated.query)),
};
