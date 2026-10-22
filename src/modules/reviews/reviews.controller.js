"use strict";
/**
 * Reviews, rounds, Tidy and improvement plans: the HTTP edge for Performance · Reviews
 * (docs/guides/performance.md §5). The employee's own check-in is ESS's (ess.performance.js).
 */
const { ok, created } = require("../../shared/http/respond");
const { sendPaged } = require("../../shared/http/paged");
const { scopeOf } = require("../../shared/rbac/scope");
const { withActor } = require("../../shared/events/emit");
const { readUpload } = require("../../middleware/upload");
const cycle = require("./reviews.cycle");
const service = require("./reviews.service");
const dictation = require("./reviews.dictation");
const pip = require("./reviews.pip");

const id = (req) => req.validated.params.id;

module.exports = {
  listRounds: async (req, res) => sendPaged(res, await cycle.listRounds(req.validated.query, withActor(req), scopeOf(req))),
  createRound: async (req, res) => created(res, await cycle.createRound(withActor(req), req.validated.body)),
  closeRound: async (req, res) => ok(res, await cycle.closeRound(withActor(req), id(req))),

  list: async (req, res) => sendPaged(res, await service.list(withActor(req), req.validated.query, scopeOf(req))),
  get: async (req, res) => ok(res, await service.get(withActor(req), scopeOf(req), id(req))),
  saveScores: async (req, res) => ok(res, await service.saveScores(withActor(req), scopeOf(req), id(req), req.validated.body)),
  submit: async (req, res) => ok(res, await service.submit(withActor(req), scopeOf(req), id(req))),
  returnCheckIn: async (req, res) => ok(res, await service.returnCheckIn(withActor(req), scopeOf(req), id(req), req.validated.body)),
  scoreWithoutCheckIn: async (req, res) =>
    ok(res, await service.scoreWithoutCheckIn(withActor(req), scopeOf(req), id(req), req.validated.body)),
  withdraw: async (req, res) => ok(res, await service.withdraw(withActor(req), scopeOf(req), id(req), req.validated.body)),
  askInput: async (req, res) => ok(res, await service.askInput(withActor(req), scopeOf(req), id(req))),
  giveInput: async (req, res) => ok(res, await service.giveInput(withActor(req), scopeOf(req), id(req), req.validated.body)),
  markConduct: async (req, res) => ok(res, await service.markConduct(withActor(req), scopeOf(req), id(req), req.validated.body)),
  probationOutcome: async (req, res) =>
    ok(res, await service.setProbationOutcome(withActor(req), scopeOf(req), id(req), req.validated.body)),
  dictate: async (req, res) =>
    ok(
      res,
      await dictation.dictateReview(withActor(req), scopeOf(req), id(req), { ...req.validated.body, performance_review_item_id: req.validated.params.item_id }, readUpload(req)),
    ),
  tidy: async (req, res) => ok(res, await dictation.tidy(withActor(req), scopeOf(req), req.validated.body)),

  listPips: async (req, res) => sendPaged(res, await pip.list(req.validated.query, scopeOf(req))),
  createPip: async (req, res) => created(res, await pip.create(withActor(req), scopeOf(req), req.validated.body)),
  editPip: async (req, res) => ok(res, await pip.edit(withActor(req), scopeOf(req), id(req), req.validated.body)),
  closePip: async (req, res) => ok(res, await pip.close(withActor(req), scopeOf(req), id(req), req.validated.body)),
};
