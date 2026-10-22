"use strict";
/**
 * Scorecards: the HTTP edge for Performance · Scorecards (docs/guides/performance.md §5).
 */
const { ok, created } = require("../../shared/http/respond");
const { sendPaged } = require("../../shared/http/paged");
const { scopeOf } = require("../../shared/rbac/scope");
const { withActor } = require("../../shared/events/emit");
const service = require("./targets.service");

const id = (req) => req.validated.params.id;

module.exports = {
  list: async (req, res) => sendPaged(res, await service.list(req.validated.query, scopeOf(req))),
  get: async (req, res) => ok(res, await service.get(id(req), withActor(req), scopeOf(req))),
  create: async (req, res) => created(res, await service.create(withActor(req), scopeOf(req), req.validated.body)),
  saveLines: async (req, res) => ok(res, await service.saveLines(withActor(req), scopeOf(req), id(req), req.validated.body)),
  update: async (req, res) => ok(res, await service.update(withActor(req), scopeOf(req), id(req), req.validated.body)),
  agree: async (req, res) => ok(res, await service.agree(withActor(req), scopeOf(req), id(req))),
  disagree: async (req, res) => ok(res, await service.disagree(withActor(req), scopeOf(req), id(req), req.validated.body)),
  contributions: async (req, res) => sendPaged(res, await service.contributions(req.validated.query)),
};
