"use strict";
/**
 * Goals: the HTTP edge for Performance · Goals (docs/guides/performance.md §5): quarters,
 * organisational goals, the OKR tree, Report Month and Confirm Score, plans and target changes;
 * and Performance · Analytics (§6.21).
 */
const { ok, created, accepted, noContent } = require("../../shared/http/respond");
const { sendPaged } = require("../../shared/http/paged");
const { scopeOf } = require("../../shared/rbac/scope");
const { withActor } = require("../../shared/events/emit");
const service = require("./goals.service");
const okrs = require("./goals.okrs");
const analytics = require("./goals.analytics");

const id = (req) => req.validated.params.id;

module.exports = {
  periods: async (req, res) => sendPaged(res, await service.listPeriods(req.validated.query)),
  currentPeriod: async (req, res) => ok(res, await service.currentPeriod()),
  period: async (req, res) => ok(res, await service.getPeriod(id(req))),
  createPeriod: async (req, res) => created(res, await service.createPeriod(withActor(req), req.validated.body)),
  updatePeriod: async (req, res) => ok(res, await service.updatePeriod(withActor(req), id(req), req.validated.body)),

  goals: async (req, res) => sendPaged(res, await service.listGoals(req.validated.query)),
  goal: async (req, res) => ok(res, await service.getGoal(id(req))),
  createGoal: async (req, res) => created(res, await service.createGoal(withActor(req), req.validated.body)),
  updateGoal: async (req, res) => ok(res, await service.updateGoal(withActor(req), id(req), req.validated.body)),

  okrs: async (req, res) => sendPaged(res, await okrs.listOkrs(req.validated.query)),
  okrSummary: async (req, res) => ok(res, await okrs.okrSummary(req.validated.query)),
  createObjective: async (req, res) => created(res, await okrs.createObjective(withActor(req), req.validated.body)),
  updateObjective: async (req, res) => ok(res, await okrs.updateObjective(withActor(req), id(req), req.validated.body)),
  deleteObjective: async (req, res) => {
    await okrs.deleteObjective(withActor(req), id(req));
    return noContent(res);
  },
  createKeyResult: async (req, res) => created(res, await okrs.createKeyResult(withActor(req), req.validated.body)),
  keyResult: async (req, res) => ok(res, await okrs.getKeyResultDetail(id(req), withActor(req))),
  updateKeyResult: async (req, res) => ok(res, await okrs.updateKeyResult(withActor(req), id(req), req.validated.body)),
  deleteKeyResult: async (req, res) => {
    await okrs.deleteKeyResult(withActor(req), id(req));
    return noContent(res);
  },
  trace: async (req, res) => ok(res, await okrs.trace(id(req))),
  report: async (req, res) => ok(res, await okrs.reportMonth(withActor(req), req.validated.body)),
  confirm: async (req, res) => ok(res, await okrs.confirmScore(withActor(req), id(req), req.validated.body)),

  plans: async (req, res) => sendPaged(res, await service.listPlans(req.validated.query)),
  plan: async (req, res) => ok(res, await service.planDetail(id(req), withActor(req), scopeOf(req))),
  submitPlan: async (req, res) => ok(res, await service.submitPlan(withActor(req), id(req), scopeOf(req))),

  changes: async (req, res) => sendPaged(res, await service.listChanges(req.validated.query)),
  requestChange: async (req, res) => created(res, await service.requestChange(withActor(req), scopeOf(req), req.validated.body)),

  analytics: async (req, res) => ok(res, await analytics.figures(req.validated.query, scopeOf(req))),
  analyticsPeople: async (req, res) => sendPaged(res, await analytics.people(req.validated.query, scopeOf(req))),
  exportAnalyticsPeople: async (req, res) => accepted(res, await analytics.requestExport(withActor(req), req.validated.body)),
};
