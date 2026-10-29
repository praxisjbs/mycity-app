"use strict";
/**
 * Approvals: the HTTP edge. My Approvals and one request are the caller's own
 * (`self`): the service decides from the request who may read or move it. Settings,
 * Approvals is the `settings` grant's.
 */
const { ok, created } = require("../../shared/http/respond");
const { sendPaged } = require("../../shared/http/paged");
const { withActor } = require("../../shared/events/emit");
const service = require("./workflow.service");

const id = (req) => req.validated.params.id;
const reason = (req) => (req.validated.body && req.validated.body.reason) || null;

module.exports = {
  mine: async (req, res) => sendPaged(res, await service.mine(req.user, req.validated.query)),
  mineCount: async (req, res) => ok(res, await service.mineCount(req.user)),
  instance: async (req, res) => ok(res, await service.getInstance(req.user, id(req))),
  approve: async (req, res) => ok(res, await service.decide(withActor(req), id(req), "approve", reason(req))),
  reject: async (req, res) => ok(res, await service.decide(withActor(req), id(req), "reject", reason(req))),
  requestChanges: async (req, res) =>
    ok(res, await service.decide(withActor(req), id(req), "request_changes", reason(req))),
  withdraw: async (req, res) => ok(res, await service.withdraw(withActor(req), id(req), reason(req))),
  reassign: async (req, res) => ok(res, await service.reassign(withActor(req), id(req), req.validated.body)),

  flows: async (req, res) => sendPaged(res, await service.listFlows(req.validated.query)),
  flowsSummary: async (_req, res) => ok(res, await service.summary()),
  createFlow: async (req, res) => created(res, await service.createFlow(withActor(req), req.validated.body)),
  saveSteps: async (req, res) => ok(res, await service.saveSteps(withActor(req), id(req), req.validated.body)),
};
