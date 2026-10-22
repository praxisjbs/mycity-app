"use strict";
/**
 * Scorecards and commitments: the HTTP edge for Performance · Scorecards and its Commitments view
 * (docs/guides/performance.md §5).
 */
const { ok, created, accepted } = require("../../shared/http/respond");
const { sendPaged } = require("../../shared/http/paged");
const { scopeOf } = require("../../shared/rbac/scope");
const { withActor } = require("../../shared/events/emit");
const service = require("./targets.service");
const commitments = require("./targets.commitments");

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
  commitments: async (req, res) => sendPaged(res, await commitments.list(req.validated.query, scopeOf(req), withActor(req))),
  commitmentSummary: async (req, res) => ok(res, await commitments.summary(req.validated.query, scopeOf(req))),
  commitmentSets: async (req, res) => sendPaged(res, await commitments.sets(req.validated.query, scopeOf(req), withActor(req))),
  submitCommitments: async (req, res) => ok(res, await commitments.submit(withActor(req), scopeOf(req), req.validated.params)),
  commitmentReport: async (req, res) => accepted(res, await commitments.requestReport(withActor(req), scopeOf(req), req.validated.body)),
  rescope: async (req, res) => ok(res, await commitments.rescope(withActor(req), scopeOf(req), id(req), req.validated.body)),
  recovery: async (req, res) => created(res, await commitments.recovery(withActor(req), scopeOf(req), id(req), req.validated.body)),
};
