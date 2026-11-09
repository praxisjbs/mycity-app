"use strict";
// search:none Analytics holds figures, not records; the screen is found by its name in ⌘K's screens
/**
 * Partnerships · Analytics: the HTTP edge (docs/guides/partnerships.md §5, §6.18). `partnerships`
 * view; the reader's scope from the grant; returns only with `partnerships.money`, decided in the
 * service.
 */
const { ok } = require("../../shared/http/respond");
const { scopeOf } = require("../../shared/rbac/scope");
const service = require("./partnership_analytics.service");

module.exports = {
  get: async (req, res) => ok(res, await service.get(req.validated.query, scopeOf(req), req.user)),
};
