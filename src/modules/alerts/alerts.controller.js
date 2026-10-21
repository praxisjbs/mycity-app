"use strict";
/**
 * Home · Alerts over HTTP (alerts.routes.js). Reads the request, calls the service, sends the
 * answer. Who sees which alert is decided in the service from the reader (alerts.service.js
 * readerOf), since every login holds `home` view; the routes check the capabilities.
 */
const { withActor } = require("../../shared/events/emit");
const { sendPaged } = require("../../shared/http/paged");
const { ok, created } = require("../../shared/http/respond");
const service = require("./alerts.service");

const id = (req) => req.validated.params.id;

module.exports = {
  list: async (req, res) => sendPaged(res, await service.list(req.user, req.validated.query)),
  summary: async (req, res) => ok(res, await service.summary(req.user)),
  get: async (req, res) => ok(res, await service.get(req.user, id(req))),
  clear: async (req, res) => ok(res, await service.clear(withActor(req), id(req), req.validated.body)),

  rules: async (req, res) => sendPaged(res, await service.rules(req.validated.query)),
  policyRules: async (req, res) => ok(res, await service.policyRules(req.user)),
  rule: async (req, res) => ok(res, await service.rule(id(req))),
  createRule: async (req, res) => created(res, await service.createRule(withActor(req), req.validated.body)),
  updateRule: async (req, res) => ok(res, await service.updateRule(withActor(req), id(req), req.validated.body)),
};
