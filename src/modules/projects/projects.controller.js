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
const { named } = require("../partners/partners.work");

const id = (req) => req.validated.params.id;

// Each project's partner is named only for a reader who sees it in Partnerships (workspace.md §6).
module.exports = {
  list: async (req, res) => sendPaged(res, await named(req.user, await service.list(req.validated.query, scopeOf(req)))),
  get: async (req, res) => ok(res, await named(req.user, await service.getFor(id(req), scopeOf(req)))),
  create: async (req, res) => created(res, await named(req.user, await service.create(withActor(req), scopeOf(req), req.validated.body))),
  edit: async (req, res) => ok(res, await named(req.user, await service.edit(withActor(req), scopeOf(req), id(req), req.validated.body))),
};
