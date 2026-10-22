"use strict";
/**
 * KPIs: the HTTP edge for Performance · KPIs (docs/guides/performance.md §5).
 */
const { ok, created } = require("../../shared/http/respond");
const { sendPaged } = require("../../shared/http/paged");
const { withActor } = require("../../shared/events/emit");
const service = require("./kpis.service");

const id = (req) => req.validated.params.id;

module.exports = {
  list: async (req, res) => sendPaged(res, await service.list(req.validated.query)),
  summary: async (req, res) => ok(res, await service.summary(req.validated.query)),
  get: async (req, res) => ok(res, await service.get(id(req), {}, withActor(req))),
  create: async (req, res) => created(res, await service.create(withActor(req), req.validated.body)),
  update: async (req, res) => ok(res, await service.update(withActor(req), id(req), req.validated.body)),
  recordActual: async (req, res) => ok(res, await service.recordActual(withActor(req), id(req), req.validated.body)),
};
