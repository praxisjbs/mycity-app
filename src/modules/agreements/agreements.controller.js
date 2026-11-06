"use strict";
// ai:none design: an agreement is generated, approved and sent on screen, where the person confirms each step; Tidy With AI shows its draft before anything is kept; the reads arrive with M7 PR 8
// search:none agreements are found by agreements.search.js when M7 PR 6 builds them
/**
 * Agreements: the HTTP edge. M7 PR 2 serves Tidy With AI for the template editor (docs/guides/partnerships.md
 * §6.8); the agreement's own routes arrive with PR 6.
 */
const { ok } = require("../../shared/http/respond");
const tidy = require("./agreements.tidy");

module.exports = {
  tidy: async (req, res) => ok(res, await tidy.tidy(req.user, req.validated.body)),
};
