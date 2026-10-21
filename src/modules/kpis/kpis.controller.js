"use strict";
/**
 * KPIs: the HTTP edge for Performance · KPIs (docs/guides/performance.md §5). Scope comes from
 * the `performance` grant, on the person whose KPIs they are.
 */
const { ok } = require("../../shared/http/respond");
const { sendPaged } = require("../../shared/http/paged");
const { scopeOf } = require("../../shared/rbac/scope");
const { withActor } = require("../../shared/events/emit");
const service = require("./kpis.service");

const id = (req) => req.validated.params.id;

module.exports = {
  list: async (req, res) => sendPaged(res, await service.list(req.validated.query, scopeOf(req), req.user)),
  summary: async (req, res) => ok(res, await service.summary(req.validated.query, scopeOf(req))),
  ofEmployee: async (req, res) => ok(res, await service.ofEmployee(id(req), req.validated.query, scopeOf(req), req.user)),
  assign: async (req, res) => ok(res, await service.assign(withActor(req), scopeOf(req), id(req), req.validated.body)),
  actual: async (req, res) => ok(res, await service.recordActual(withActor(req), scopeOf(req), id(req), req.validated.body)),
  trace: async (req, res) => ok(res, await service.trace(id(req), scopeOf(req))),
};
