"use strict";
/**
 * Disbursements: the HTTP edge for Expenses · Disbursements, for holders of `expenses.finance`
 * (the CEO among them). Bank details are masked for a reader without `employee.bank`.
 */
const { pool } = require("../../config/db");
const { ok, created } = require("../../shared/http/respond");
const { sendPaged } = require("../../shared/http/paged");
const { scopeOf } = require("../../shared/rbac/scope");
const { maskForUser } = require("../../shared/rbac/field-mask");
const { withActor } = require("../../shared/events/emit");
const service = require("./disbursements.service");

module.exports = {
  list: async (req, res) => sendPaged(res, await maskForUser(pool, req.user, await service.list(req.validated.query, scopeOf(req)))),

  create: async (req, res) => created(res, await maskForUser(pool, req.user, await service.create(withActor(req), req.validated.body))),

  addReference: async (req, res) =>
    ok(res, await maskForUser(pool, req.user, await service.addReference(withActor(req), scopeOf(req), req.validated.params.id, req.validated.body))),
};
