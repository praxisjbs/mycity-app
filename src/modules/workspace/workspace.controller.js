"use strict";
/**
 * My Workspace: the HTTP edge for Today, Analytics and the week (docs/guides/workspace.md §5).
 */
// ai:none Today, Analytics and the week are views over tasks and events, which tasks.ai.js and calendar.ai.js read
// search:none Today, Analytics and the week are views over tasks and events, which tasks.search.js and calendar.search.js find
const { ok, accepted } = require("../../shared/http/respond");
const { sendPaged } = require("../../shared/http/paged");
const { scopeOf } = require("../../shared/rbac/scope");
const { withActor } = require("../../shared/events/emit");
const service = require("./workspace.service");

module.exports = {
  today: async (req, res) => ok(res, await service.today(req.user, scopeOf(req))),
  analytics: async (req, res) => ok(res, await service.analytics(req.validated.query, scopeOf(req))),
  exportAnalytics: async (req, res) => accepted(res, await service.exportAnalytics(withActor(req), req.validated.body)),
  analyticsExport: async (req, res) => ok(res, await service.analyticsExport(req.user, req.validated.params.id)),
  week: async (req, res) => ok(res, await service.week(req.user, scopeOf(req), req.validated.query)),
  saveWeek: async (req, res) => ok(res, await service.save(withActor(req), req.validated.body)),
  teamWeeks: async (req, res) => sendPaged(res, await service.teamWeeks(req.user, scopeOf(req), req.validated.query)),
  tidyWeek: async (req, res) => ok(res, await service.tidy(withActor(req), req.validated.body)),
};
