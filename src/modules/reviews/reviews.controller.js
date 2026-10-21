"use strict";
/**
 * Reviews: the HTTP edge for Performance · Reviews and review cycles
 * (docs/guides/performance.md §5). Lists keep to the `performance` scope; a review's content
 * keeps to the people §8 names (reviews.sequence.js).
 */
const { ok, created } = require("../../shared/http/respond");
const { sendPaged } = require("../../shared/http/paged");
const { scopeOf } = require("../../shared/rbac/scope");
const { withActor } = require("../../shared/events/emit");
const { readUpload } = require("../../middleware/upload");
const service = require("./reviews.service");
const dictation = require("./reviews.dictation");

const id = (req) => req.validated.params.id;

module.exports = {
  cycles: async (req, res) => sendPaged(res, await service.listCycles(req.validated.query)),
  createCycle: async (req, res) => created(res, await service.createCycle(withActor(req), req.validated.body)),
  closeCycle: async (req, res) => ok(res, await service.closeCycle(withActor(req), id(req))),
  list: async (req, res) => sendPaged(res, await service.list(req.validated.query, scopeOf(req), req.user)),
  summary: async (req, res) => ok(res, await service.summary(scopeOf(req))),
  get: async (req, res) => ok(res, await service.detail(id(req), req.user)),
  save: async (req, res) => ok(res, await service.save(id(req), withActor(req), req.validated.body)),
  submit: async (req, res) => ok(res, await service.submit(id(req), withActor(req))),
  dictate: async (req, res) =>
    ok(res, await dictation.dictate(id(req), withActor(req), readUpload(req), req.validated.body)),
  analytics: async (req, res) => ok(res, await service.analytics(req.validated.query, scopeOf(req))),
  decide: async (req, res) => ok(res, await service.decide(id(req), withActor(req), req.validated.body)),
};
