"use strict";
// ai:none rules are configuration; the queries they raise are read through queries.ai.js
// search:none a handful of rules, listed whole on Rules, which ⌘K finds by name
/**
 * Query rules: the HTTP edge for Queries & Sanctions · Rules (docs/guides/queries.md §5).
 * Every route needs the `queries` grant; writes also need queries.configure (the routes).
 * Recent Firings keeps the visibility rule of the queries it lists.
 */
const { ok, created } = require("../../shared/http/respond");
const { sendPaged } = require("../../shared/http/paged");
const { scopeOf } = require("../../shared/rbac/scope");
const { withActor } = require("../../shared/events/emit");
const visibility = require("../queries/queries.visibility");
const service = require("./query_rules.service");

const id = (req) => req.validated.params.id;

module.exports = {
  list: async (req, res) => sendPaged(res, await service.list(req.validated.query)),
  summary: async (_req, res) => ok(res, await service.summary()),
  firings: async (req, res) =>
    sendPaged(res, await service.firings(req.validated.query, visibility.readerOf(scopeOf(req), req.user))),
  create: async (req, res) => created(res, await service.create(withActor(req), req.validated.body)),
  update: async (req, res) => ok(res, await service.update(withActor(req), id(req), req.validated.body)),
  activate: async (req, res) => ok(res, await service.activate(withActor(req), id(req))),
  pause: async (req, res) => ok(res, await service.pause(withActor(req), id(req))),
  remove: async (req, res) => {
    await service.remove(withActor(req), id(req));
    res.status(204).end();
  },
};
