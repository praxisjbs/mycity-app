"use strict";
// ai:none a stack trace is engineering detail; the assistant answering a member of staff from one would mislead them
// search:none faults are found on Settings · System Health with its filters, not by name: a fingerprint is not a word anybody types
/**
 * System Health's HTTP edge. Everything here is behind `system_health`, which only the
 * Implementation Team and the System Administrator hold.
 */
const { ok, accepted } = require("../../shared/http/respond");
const { sendPaged } = require("../../shared/http/paged");
const { withActor } = require("../../shared/events/emit");
const service = require("./system_health.service");

module.exports = {
  status: async (_req, res) => ok(res, await service.status()),
  performance: async (req, res) => ok(res, await service.performance(req.validated.query)),
  faults: async (req, res) => sendPaged(res, await service.faults(req.validated.query)),
  fault: async (req, res) => ok(res, await service.fault(req.params.id)),
  patch: async (req, res) => ok(res, await service.patch(req.params.id, req.validated.body, withActor(req))),
  note: async (req, res) => ok(res, await service.addNote(req.params.id, req.validated.body, withActor(req))),
  bulk: async (req, res) => ok(res, await service.bulk(req.validated.body, withActor(req))),
  brief: async (req, res) => accepted(res, await service.requestBrief(req.validated.body, withActor(req))),
};
