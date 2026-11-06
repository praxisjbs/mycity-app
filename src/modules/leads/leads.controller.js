"use strict";
/**
 * Partnerships · Leads: the HTTP edge for leads and the Lead 360 (docs/guides/partnerships.md §5).
 * Scope comes from the `partnerships` grant (§6.1), never from the request.
 */
const { ok, created } = require("../../shared/http/respond");
const { sendPaged } = require("../../shared/http/paged");
const { scopeOf } = require("../../shared/rbac/scope");
const { withActor } = require("../../shared/events/emit");
const service = require("./leads.service");

const id = (req) => req.validated.params.id;

module.exports = {
  summary: async (req, res) => ok(res, await service.summary(scopeOf(req))),
  list: async (req, res) => sendPaged(res, await service.list(req.validated.query, scopeOf(req))),
  get: async (req, res) => ok(res, await service.get360(id(req), scopeOf(req), req.user)),
  create: async (req, res) => created(res, await service.create(withActor(req), scopeOf(req), req.validated.body)),
  update: async (req, res) => ok(res, await service.update(withActor(req), scopeOf(req), id(req), req.validated.body)),
  lose: async (req, res) => ok(res, await service.lose(withActor(req), scopeOf(req), id(req), req.validated.body)),
  convert: async (req, res) => ok(res, await service.convert(withActor(req), scopeOf(req), id(req), req.validated.body)),
};
