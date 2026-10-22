"use strict";
/**
 * Goals: the HTTP edge for Performance · Goals (docs/guides/performance.md §5). PR 1 serves the
 * quarters and their rules; PR 2 adds organisational goals, the OKR tree, Report Month, plans and
 * target changes.
 */
// ai:none the assistant's reads (goals.okrs, goals.trace) arrive with the OKR tree in Performance PR 2; a quarter alone answers nothing a person asks
const { ok, created } = require("../../shared/http/respond");
const { sendPaged } = require("../../shared/http/paged");
const { withActor } = require("../../shared/events/emit");
const service = require("./goals.service");

const id = (req) => req.validated.params.id;

module.exports = {
  periods: async (req, res) => sendPaged(res, await service.listPeriods(req.validated.query)),

  currentPeriod: async (req, res) => ok(res, await service.currentPeriod()),

  period: async (req, res) => ok(res, await service.getPeriod(id(req))),

  createPeriod: async (req, res) => created(res, await service.createPeriod(withActor(req), req.validated.body)),

  updatePeriod: async (req, res) => ok(res, await service.updatePeriod(withActor(req), id(req), req.validated.body)),
};
