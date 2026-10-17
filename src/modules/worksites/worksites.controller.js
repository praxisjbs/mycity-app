"use strict";
/**
 * Worksites: the HTTP edge for People · Worksites. The fence a punch is matched to is
 * read by the attendance service, never through these routes, so a person without the
 * `people` grant sees only their own worksite's name and radius on the clock.
 */
const { ok, created } = require("../../shared/http/respond");
const { sendPaged } = require("../../shared/http/paged");
const { scopeOf } = require("../../shared/rbac/scope");
const { withActor } = require("../../shared/events/emit");
const service = require("./worksites.service");

const id = (req) => req.validated.params.id;

module.exports = {
  list: async (req, res) => sendPaged(res, await service.list(req.validated.query)),

  get: async (req, res) => ok(res, await service.get(id(req))),

  create: async (req, res) => created(res, await service.create(withActor(req), req.validated.body)),

  update: async (req, res) => ok(res, await service.update(withActor(req), id(req), req.validated.body)),

  employees: async (req, res) =>
    sendPaged(res, await service.employees(id(req), req.validated.query, scopeOf(req))),

  assign: async (req, res) =>
    ok(res, await service.assign(withActor(req), scopeOf(req), id(req), req.validated.body)),
};
