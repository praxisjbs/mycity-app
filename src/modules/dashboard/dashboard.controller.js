"use strict";
/**
 * Home · Overview and Team over HTTP (dashboard.routes.js). Reads the request, calls the
 * service, sends the answer. The records behind a card and the Team tab's lists leave
 * through the field mask: they list people, and a field the reader may not see is null on
 * the way out. The Team tab reads in the scope the `home` grant gave the route. The Overview
 * Export is a run of the reports engine, answered 202 while its file is made, and read again by
 * the screen waiting to download it.
 */
const { pool } = require("../../config/db");
const { withActor } = require("../../shared/events/emit");
const { sendPaged } = require("../../shared/http/paged");
const { ok, noContent, accepted } = require("../../shared/http/respond");
const { maskForUser } = require("../../shared/rbac/field-mask");
const { scopeOf } = require("../../shared/rbac/scope");
const service = require("./dashboard.service");
const team = require("./dashboard.team");
const reports = require("../reports/reports.service");

const key = (req) => req.validated.params.key;
const roleId = (req) => req.validated.params.role_id;

module.exports = {
  overview: async (req, res) => ok(res, await service.overview(req.user)),
  exportOverview: async (req, res) => accepted(res, await reports.exportOverview(withActor(req), req.validated.body)),
  overviewExport: async (req, res) => ok(res, await reports.getOverviewRun(req.user, req.validated.params.id)),

  kpiMeta: async (req, res) => ok(res, await service.kpiMeta(req.user, key(req))),
  kpiPage: async (req, res) =>
    sendPaged(res, await maskForUser(pool, req.user, await service.kpiPage(req.user, key(req), req.validated.query))),

  picker: async (req, res) => ok(res, await service.picker(req.user)),
  savePicks: async (req, res) => ok(res, await service.savePicks(withActor(req), req.validated.body)),
  resetPicks: async (req, res) => {
    await service.resetPicks(withActor(req));
    noContent(res);
  },

  teamSummary: async (req, res) => ok(res, await team.summary(req.user, scopeOf(req))),
  team: async (req, res) =>
    sendPaged(res, await maskForUser(pool, req.user, await team.roster(scopeOf(req), req.validated.query))),
  teamAttendance: async (req, res) =>
    sendPaged(res, await maskForUser(pool, req.user, await team.month(scopeOf(req), req.validated.query))),

  roleCards: async (req, res) => ok(res, await service.roleCards(roleId(req))),
  saveRoleCards: async (req, res) =>
    ok(res, await service.saveRoleCards(roleId(req), req.validated.body, withActor(req))),
  resetRoleCards: async (req, res) => {
    await service.resetRoleCards(roleId(req), withActor(req));
    noContent(res);
  },
};
