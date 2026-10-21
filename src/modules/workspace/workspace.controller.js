"use strict";
/**
 * My Workspace: the HTTP edge for Today and Analytics (docs/guides/workspace.md §5).
 */
// ai:none Today and Analytics are views over tasks and events, which tasks.ai.js and calendar.ai.js read
// search:none Today and Analytics are views over tasks and events, which tasks.search.js and calendar.search.js find
const { ok } = require("../../shared/http/respond");
const { scopeOf } = require("../../shared/rbac/scope");
const service = require("./workspace.service");

module.exports = {
  today: async (req, res) => ok(res, await service.today(req.user, scopeOf(req))),
  analytics: async (req, res) => ok(res, await service.analytics(req.validated.query, scopeOf(req))),
};
