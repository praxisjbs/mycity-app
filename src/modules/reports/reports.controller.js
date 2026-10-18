"use strict";
/**
 * Home · Reports over HTTP (reports.routes.js). Reads the request, calls the service, sends
 * the answer. Who sees which report and run is decided in the service from the reader, since
 * every login holds `home` view; the routes check the capability. Run Now answers 202: the
 * run is made, and its file follows in the worker.
 */
const { withActor } = require("../../shared/events/emit");
const { sendPaged } = require("../../shared/http/paged");
const { ok, created, accepted } = require("../../shared/http/respond");
const service = require("./reports.service");

const id = (req) => req.validated.params.id;

module.exports = {
  list: async (req, res) => sendPaged(res, await service.list(req.user, req.validated.query)),
  summary: async (req, res) => ok(res, await service.summary(req.user)),
  get: async (req, res) => ok(res, await service.get(req.user, id(req))),
  create: async (req, res) => created(res, await service.create(withActor(req), req.validated.body)),
  update: async (req, res) => ok(res, await service.update(withActor(req), id(req), req.validated.body)),
  setActive: async (req, res) => ok(res, await service.setActive(withActor(req), id(req), req.validated.body)),
  archive: async (req, res) => ok(res, await service.archive(withActor(req), id(req))),
  runNow: async (req, res) => accepted(res, await service.runNow(withActor(req), id(req), req.validated.body)),
  runs: async (req, res) => sendPaged(res, await service.runs(req.user, req.validated.query)),
  getRun: async (req, res) => ok(res, await service.getRun(req.user, id(req))),
};
