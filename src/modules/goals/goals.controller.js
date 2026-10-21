"use strict";
/**
 * Goals: the HTTP edge for Performance · Goals (docs/guides/performance.md §5).
 * Goals are read by everyone with the `performance` grant; who may act is the service's call.
 */
const { ok, created } = require("../../shared/http/respond");
const { sendPaged } = require("../../shared/http/paged");
const { withActor } = require("../../shared/events/emit");
const service = require("./goals.service");

const id = (req) => req.validated.params.id;
const body = (req) => req.validated.body || {};

module.exports = {
  list: async (req, res) => sendPaged(res, await service.list(req.validated.query)),
  summary: async (req, res) => ok(res, await service.summary(req.validated.query)),
  get: async (req, res) => ok(res, await service.get(id(req), req.user)),
  create: async (req, res) => created(res, await service.create(withActor(req), body(req))),
  edit: async (req, res) => ok(res, await service.edit(withActor(req), id(req), body(req))),
  submit: async (req, res) => ok(res, await service.submit(withActor(req), id(req))),
  decide: async (req, res) => ok(res, await service.decide(withActor(req), id(req), body(req))),
};
