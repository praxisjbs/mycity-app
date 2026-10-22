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
const child = (req) => req.validated.params.child_id;
const body = (req) => req.validated.body || {};

module.exports = {
  list: async (req, res) => sendPaged(res, await service.list(req.validated.query, scopeOf(req))),
  summary: async (req, res) => ok(res, await service.summary(req.validated.query, scopeOf(req))),
  get: async (req, res) => ok(res, await service.getFor(id(req), scopeOf(req))),
  create: async (req, res) => created(res, await service.create(withActor(req), scopeOf(req), body(req))),
  edit: async (req, res) => ok(res, await service.edit(withActor(req), scopeOf(req), id(req), body(req))),
  move: async (req, res) => ok(res, await service.move(withActor(req), scopeOf(req), id(req), body(req))),
  block: async (req, res) => ok(res, await service.block(withActor(req), scopeOf(req), id(req), body(req))),
  unblock: async (req, res) => ok(res, await service.unblock(withActor(req), scopeOf(req), id(req), body(req))),
  blockages: async (req, res) =>
    sendPaged(res, await service.blockageHistory(id(req), req.validated.query, scopeOf(req))),
  addStep: async (req, res) => created(res, await service.addStep(withActor(req), scopeOf(req), id(req), body(req))),
  editStep: async (req, res) =>
    ok(res, await service.editStep(withActor(req), scopeOf(req), id(req), child(req), body(req))),
  removeStep: async (req, res) => ok(res, await service.removeStep(withActor(req), scopeOf(req), id(req), child(req))),
  addWaiting: async (req, res) => ok(res, await service.addWaiting(withActor(req), scopeOf(req), id(req), body(req))),
  removeWaiting: async (req, res) =>
    ok(res, await service.removeWaiting(withActor(req), scopeOf(req), id(req), child(req))),
  overrideWaiting: async (req, res) =>
    ok(res, await service.overrideWaiting(withActor(req), scopeOf(req), id(req), child(req), body(req))),
  watch: async (req, res) => ok(res, await service.watch(withActor(req), scopeOf(req), id(req), body(req))),
  unwatch: async (req, res) => ok(res, await service.unwatch(withActor(req), scopeOf(req), id(req), child(req))),
  ping: async (req, res) => ok(res, await service.ping(withActor(req), scopeOf(req), id(req), body(req))),
  setReminders: async (req, res) =>
    ok(res, await service.setReminders(withActor(req), scopeOf(req), id(req), body(req))),
  cancel: async (req, res) => ok(res, await service.cancel(withActor(req), scopeOf(req), id(req), body(req))),
  comments: async (req, res) =>
    sendPaged(res, await service.comments(id(req), req.validated.query, scopeOf(req))),
  comment: async (req, res) =>
    created(res, await service.comment(withActor(req), scopeOf(req), id(req), body(req))),
  activity: async (req, res) =>
    sendPaged(res, await service.activity(id(req), req.validated.query, scopeOf(req))),
};
