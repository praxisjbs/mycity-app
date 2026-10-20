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
const performance = require("./system_health.performance");
const targets = require("./system_health.targets");

module.exports = {
  status: async (_req, res) => ok(res, await service.status()),
  check: async (req, res) => ok(res, await service.check(req.params.key)),
  history: async (req, res) => sendPaged(res, await service.history(req.params.key, req.validated.query)),
  statusBrief: async (req, res) => accepted(res, await service.requestStatusBrief(withActor(req))),
  performance: async (req, res) => ok(res, await performance.series(req.validated.query)),
  capacity: async (_req, res) => ok(res, await performance.capacity()),
  routes: async (req, res) => sendPaged(res, await performance.routes(req.validated.query)),
  database: async (_req, res) => ok(res, await performance.database()),
  tables: async (req, res) => sendPaged(res, await performance.tables(req.validated.query)),
  queries: async (req, res) => sendPaged(res, await performance.queries(req.validated.query)),
  background: async (_req, res) => ok(res, await performance.background()),
  jobs: async (req, res) => sendPaged(res, await performance.jobs(req.validated.query)),
  processes: async (_req, res) => ok(res, await performance.processes()),
  targets: async (_req, res) => ok(res, await targets.current()),
  saveTargets: async (req, res) => ok(res, await targets.save(req.validated.body, withActor(req))),
  faults: async (req, res) => sendPaged(res, await service.faults(req.validated.query)),
  fault: async (req, res) => ok(res, await service.fault(req.params.id)),
  patch: async (req, res) => ok(res, await service.patch(req.params.id, req.validated.body, withActor(req))),
  note: async (req, res) => ok(res, await service.addNote(req.params.id, req.validated.body, withActor(req))),
  bulk: async (req, res) => ok(res, await service.bulk(req.validated.body, withActor(req))),
  brief: async (req, res) => accepted(res, await service.requestBrief(req.validated.body, withActor(req))),
};
