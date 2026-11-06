"use strict";
/**
 * Partnerships · the pipeline: the HTTP edge for deals, Pipeline, returns and the lists, categories
 * and custom fields the screens read (docs/guides/partnerships.md §5). Scope comes from the
 * `partnerships` grant (§6.1); money from `partnerships.money`, checked on the route and in the
 * service. Categories, lists and fields are written on Categories (M7 PR 2).
 */
const { ok, created } = require("../../shared/http/respond");
const { sendPaged } = require("../../shared/http/paged");
const { scopeOf } = require("../../shared/rbac/scope");
const { withActor } = require("../../shared/events/emit");
const service = require("./partner_pipeline.service");
const stages = require("./partner_pipeline.stages");
const health = require("./partner_pipeline.health");
const returns = require("./partner_pipeline.returns");

const id = (req) => req.validated.params.id;

module.exports = {
  pipeline: async (req, res) => ok(res, await service.pipeline(req.validated.query, scopeOf(req))),
  list: async (req, res) => sendPaged(res, await service.list(req.validated.query, scopeOf(req))),
  get: async (req, res) => ok(res, await service.get(id(req), scopeOf(req), req.user)),
  create: async (req, res) => created(res, await service.create(withActor(req), scopeOf(req), req.validated.body)),
  update: async (req, res) => ok(res, await service.update(withActor(req), scopeOf(req), id(req), req.validated.body)),
  move: async (req, res) => ok(res, await stages.move(withActor(req), scopeOf(req), id(req), req.validated.body)),
  health: async (req, res) => ok(res, await health.set(withActor(req), scopeOf(req), id(req), req.validated.body)),
  returns: async (req, res) => sendPaged(res, await returns.page(id(req), req.validated.query, scopeOf(req))),
  saveReturn: async (req, res) =>
    ok(res, await returns.save(withActor(req), scopeOf(req), id(req), req.validated.params.month, req.validated.body)),
  categories: async (req, res) => sendPaged(res, await service.categoryPage(req.validated.query)),
  fields: async (req, res) => ok(res, await service.fieldList(req.validated.query)),
  list_values: async (req, res) => ok(res, await service.values(req.validated.params.list)),
};
