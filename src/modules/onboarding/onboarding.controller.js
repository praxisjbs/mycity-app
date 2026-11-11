"use strict";
/**
 * Onboarding: the HTTP edge for Recruitment · Onboarding and its Checklist and Plans settings
 * (docs/guides/offers.md §5). Scope comes from the `recruitment` grant (the vacancy's hiring manager,
 * guide §8). The hire's own page is onboarding.public.routes.js.
 */
const { ok, created } = require("../../shared/http/respond");
const { sendPaged } = require("../../shared/http/paged");
const { scopeOf } = require("../../shared/rbac/scope");
const { withActor } = require("../../shared/events/emit");
const service = require("./onboarding.service");
const checklist = require("./onboarding.checklist");
const plans = require("./onboarding.plans");

const p = (req) => req.validated.params;

module.exports = {
  list: async (req, res) => sendPaged(res, await service.list(req.validated.query, scopeOf(req))),
  get: async (req, res) => ok(res, await service.get(p(req).id, req.user, scopeOf(req))),
  verifyItem: async (req, res) => ok(res, await service.verifyItem(withActor(req), scopeOf(req), p(req).id, p(req).item_id)),
  rejectItem: async (req, res) =>
    ok(res, await service.rejectItem(withActor(req), scopeOf(req), p(req).id, p(req).item_id, req.validated.body)),
  checkGuarantor: async (req, res) =>
    ok(res, await service.checkGuarantor(withActor(req), scopeOf(req), p(req).id, p(req).guarantor_id, req.validated.body)),
  remind: async (req, res) => ok(res, await service.remind(withActor(req), scopeOf(req), p(req).id)),

  requirements: async (req, res) => sendPaged(res, await checklist.requirements(req.validated.query)),
  createRequirement: async (req, res) => created(res, await checklist.createRequirement(withActor(req), req.validated.body)),
  editRequirement: async (req, res) => ok(res, await checklist.editRequirement(withActor(req), p(req).id, req.validated.body)),

  plans: async (req, res) => sendPaged(res, await plans.plans(req.validated.query)),
  plan: async (req, res) => ok(res, await plans.plan(p(req).id)),
  createPlan: async (req, res) => created(res, await plans.createPlan(withActor(req), req.validated.body)),
  savePlan: async (req, res) => ok(res, await plans.savePlan(withActor(req), p(req).id, req.validated.body)),
};
