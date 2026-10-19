"use strict";
/**
 * Sanctions: the HTTP edge for Queries & Sanctions · Sanctions and Chain Settings
 * (docs/guides/queries.md §5). A sanction is seen by whoever may see its query
 * (queries.visibility.js); the chain's writes need queries.configure (the routes).
 * A sanction is proposed from its query's decision and decided in its approval, never here.
 */
const { ok, created } = require("../../shared/http/respond");
const { sendPaged } = require("../../shared/http/paged");
const { scopeOf } = require("../../shared/rbac/scope");
const { withActor } = require("../../shared/events/emit");
const visibility = require("../queries/queries.visibility");
const service = require("./sanctions.service");
const chain = require("./sanctions.chain");

const id = (req) => req.validated.params.id;
const reader = (req) => visibility.readerOf(scopeOf(req), req.user);

module.exports = {
  list: async (req, res) => sendPaged(res, await service.list(req.validated.query, reader(req))),
  summary: async (req, res) => ok(res, await service.summary(reader(req))),
  get: async (req, res) => ok(res, await service.get(id(req), reader(req))),
  standing: async (req, res) => ok(res, await service.standing(reader(req), req.validated.query.employee_id)),
  listChain: async (req, res) => sendPaged(res, await chain.list(req.validated.query)),
  addStep: async (req, res) => created(res, await chain.create(withActor(req), req.validated.body)),
  updateStep: async (req, res) => ok(res, await chain.update(withActor(req), id(req), req.validated.body)),
};
