"use strict";
/**
 * The Talent Pool: the HTTP edge for Recruitment · Talent Pool (docs/guides/recruitment.md §5). Scope
 * comes from the `recruitment` grant (the hiring manager of the vacancy each person applied for).
 */
const { ok, created, accepted } = require("../../shared/http/respond");
const { sendPaged } = require("../../shared/http/paged");
const { scopeOf } = require("../../shared/rbac/scope");
const { withActor } = require("../../shared/events/emit");
const service = require("./talent_pool.service");

const id = (req) => req.validated.params.id;

module.exports = {
  list: async (req, res) => sendPaged(res, await service.list(req.validated.query, scopeOf(req))),
  summary: async (req, res) => ok(res, await service.summary(scopeOf(req))),
  get: async (req, res) => ok(res, await service.get(id(req), scopeOf(req))),
  add: async (req, res) => created(res, await service.add(withActor(req), scopeOf(req), req.validated.body)),
  invite: async (req, res) => ok(res, await service.invite(withActor(req), scopeOf(req), id(req), req.validated.body)),
  remove: async (req, res) => ok(res, await service.remove(withActor(req), scopeOf(req), id(req), req.validated.body)),
  requestExport: async (req, res) => accepted(res, await service.requestExport(withActor(req), req.validated.body)),
};
