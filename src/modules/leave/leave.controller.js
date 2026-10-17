"use strict";
/**
 * Leave: the HTTP edge for People · Leave and the leave types. The employee's own
 * leave is served by ESS (/ess/leave, src/modules/ess/ess.leave.js), through the same
 * service. Scope comes from the `people` grant (scopeOf), never from the request.
 */
const { ok, created, noContent } = require("../../shared/http/respond");
const { sendPaged } = require("../../shared/http/paged");
const { scopeOf } = require("../../shared/rbac/scope");
const { withActor } = require("../../shared/events/emit");
const service = require("./leave.service");

const id = (req) => req.validated.params.id;
const body = (req) => req.validated.body || {};

module.exports = {
  listTypes: async (req, res) => sendPaged(res, await service.listTypes(req.validated.query)),

  createType: async (req, res) => created(res, await service.createType(withActor(req), body(req))),

  updateType: async (req, res) => ok(res, await service.updateType(withActor(req), id(req), body(req))),

  deleteType: async (req, res) => {
    await service.deleteType(withActor(req), id(req));
    return noContent(res);
  },

  list: async (req, res) => sendPaged(res, await service.list(req.validated.query, scopeOf(req))),

  summary: async (req, res) => ok(res, await service.summary(scopeOf(req))),

  get: async (req, res) => ok(res, await service.getFor(id(req), scopeOf(req))),

  clashes: async (req, res) =>
    sendPaged(res, await service.clashes(id(req), req.validated.query, scopeOf(req))),

  balances: async (req, res) =>
    ok(res, await service.balancesOf(scopeOf(req), req.validated.query.employee_id, req.validated.query.year)),

  setAllowance: async (req, res) =>
    ok(res, await service.setAllowance(withActor(req), scopeOf(req), body(req))),

  record: async (req, res) =>
    created(res, await service.record(withActor(req), scopeOf(req), body(req))),

  cancel: async (req, res) =>
    ok(res, await service.cancelFor(withActor(req), scopeOf(req), id(req), body(req))),
};
