"use strict";
/**
 * Tasks: the HTTP edge for My Workspace · Tasks (docs/guides/workspace.md §5).
 * Scope comes from the `workspace` grant (scopeOf), never from the request.
 */
const { ok, created } = require("../../shared/http/respond");
const { sendPaged } = require("../../shared/http/paged");
const { scopeOf } = require("../../shared/rbac/scope");
const { withActor } = require("../../shared/events/emit");
const service = require("./tasks.service");

const id = (req) => req.validated.params.id;
const body = (req) => req.validated.body || {};

module.exports = {
  list: async (req, res) => sendPaged(res, await service.list(req.validated.query, scopeOf(req))),
  summary: async (req, res) => ok(res, await service.summary(req.validated.query, scopeOf(req))),
  get: async (req, res) => ok(res, await service.getFor(id(req), scopeOf(req), withActor(req))),
  countsTowards: async (req, res) => sendPaged(res, await service.countsTowards(req.validated.query, scopeOf(req))),
  create: async (req, res) => created(res, await service.create(withActor(req), scopeOf(req), body(req))),
  edit: async (req, res) => ok(res, await service.edit(withActor(req), scopeOf(req), id(req), body(req))),
  move: async (req, res) => ok(res, await service.move(withActor(req), scopeOf(req), id(req), body(req))),
  block: async (req, res) => ok(res, await service.block(withActor(req), scopeOf(req), id(req), body(req))),
  unblock: async (req, res) => ok(res, await service.unblock(withActor(req), scopeOf(req), id(req))),
  cancel: async (req, res) => ok(res, await service.cancel(withActor(req), scopeOf(req), id(req), body(req))),
  comments: async (req, res) =>
    sendPaged(res, await service.comments(id(req), req.validated.query, scopeOf(req))),
  comment: async (req, res) =>
    created(res, await service.comment(withActor(req), scopeOf(req), id(req), body(req))),
  activity: async (req, res) =>
    sendPaged(res, await service.activity(id(req), req.validated.query, scopeOf(req))),
};
