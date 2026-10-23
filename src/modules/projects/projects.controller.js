"use strict";
/**
 * Projects: the HTTP edge for My Workspace · Projects (docs/guides/workspace.md §5).
 * Scope comes from the `workspace` grant (scopeOf), never from the request.
 */
const { ok, created } = require("../../shared/http/respond");
const { sendPaged } = require("../../shared/http/paged");
const { scopeOf } = require("../../shared/rbac/scope");
const { withActor } = require("../../shared/events/emit");
const service = require("./projects.service");

const id = (req) => req.validated.params.id;

module.exports = {
  list: async (req, res) => sendPaged(res, await service.list(req.validated.query, scopeOf(req))),
  get: async (req, res) => ok(res, await service.getFor(id(req), scopeOf(req))),
  create: async (req, res) => created(res, await service.create(withActor(req), scopeOf(req), req.validated.body)),
  edit: async (req, res) => ok(res, await service.edit(withActor(req), scopeOf(req), id(req), req.validated.body)),
};
