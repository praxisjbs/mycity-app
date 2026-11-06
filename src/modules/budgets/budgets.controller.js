"use strict";
/**
 * Budgets: the HTTP edge for Expenses · Budgets (a department's year by category, Budget History)
 * and Expenses · Projects (each project's budget and spend, Set Budget).
 */
const { ok, created } = require("../../shared/http/respond");
const { sendPaged } = require("../../shared/http/paged");
const { scopeOf } = require("../../shared/rbac/scope");
const { withActor } = require("../../shared/events/emit");
const service = require("./budgets.service");

const id = (req) => req.validated.params.id;

module.exports = {
  list: async (req, res) => sendPaged(res, await service.list(req.validated.query, scopeOf(req))),
  get: async (req, res) => ok(res, await service.get(id(req), scopeOf(req))),
  create: async (req, res) => created(res, await service.create(withActor(req), req.validated.body)),
  update: async (req, res) => ok(res, await service.update(withActor(req), id(req), req.validated.body)),
  history: async (req, res) => sendPaged(res, await service.history(id(req), scopeOf(req), req.validated.query)),
  projects: async (req, res) => sendPaged(res, await service.projects(req.validated.query, scopeOf(req))),
  setProjectBudget: async (req, res) =>
    ok(res, await service.setProjectBudget(withActor(req), scopeOf(req), id(req), req.validated.body)),
};
