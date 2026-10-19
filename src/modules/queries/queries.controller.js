"use strict";
/**
 * Queries: the HTTP edge for Queries & Sanctions · Queries (docs/guides/queries.md §5).
 * Visibility comes from the `queries` grant and the session (queries.visibility.js),
 * never from the request. The employee's own queries are served by ESS (/ess/queries),
 * through the same service.
 */
const { ok, created } = require("../../shared/http/respond");
const { sendPaged } = require("../../shared/http/paged");
const { scopeOf } = require("../../shared/rbac/scope");
const { withActor } = require("../../shared/events/emit");
const visibility = require("./queries.visibility");
const service = require("./queries.service");

const id = (req) => req.validated.params.id;
const reader = (req) => visibility.readerOf(scopeOf(req), req.user);

module.exports = {
  list: async (req, res) => sendPaged(res, await service.list(req.validated.query, reader(req))),
  summary: async (req, res) => ok(res, await service.summary(reader(req))),
  get: async (req, res) => ok(res, await service.get(id(req), req.user, scopeOf(req))),
  raise: async (req, res) => created(res, await service.raise(withActor(req), scopeOf(req), req.validated.body)),
  remind: async (req, res) => ok(res, await service.remind(withActor(req), scopeOf(req), id(req))),
  decide: async (req, res) =>
    ok(res, await service.decide(withActor(req), scopeOf(req), id(req), req.validated.body)),
};
