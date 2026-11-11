"use strict";
/**
 * Expense requests: the HTTP edge for ESS · My Requests (/expenses/mine, the caller's own) and
 * Expenses · Approvals and the lists (/expenses, within the caller's `expenses` scope). Bank
 * details are masked for a reader without `employee.bank`, never on the requester's own request.
 */
const { pool } = require("../../config/db");
const { ok, created } = require("../../shared/http/respond");
const { sendPaged } = require("../../shared/http/paged");
const { scopeOf } = require("../../shared/rbac/scope");
const { maskForUser } = require("../../shared/rbac/field-mask");
const { withActor } = require("../../shared/events/emit");
const service = require("./expenses.service");
const assist = require("./expenses.receipt-ai");

const id = (req) => req.validated.params.id;
const body = (req) => req.validated.body || {};
const me = (req) => req.user.employee_id;

module.exports = {
  mine: async (req, res) => sendPaged(res, await service.listMine(me(req), req.validated.query)),

  banks: async (req, res) => sendPaged(res, await service.banks(req.validated.query)),

  mineSummary: async (req, res) => ok(res, await service.mineSummary(me(req))),

  create: async (req, res) => created(res, await service.create(withActor(req), body(req))),

  update: async (req, res) => ok(res, await service.update(withActor(req), id(req), body(req))),

  submit: async (req, res) => ok(res, await service.submit(withActor(req), id(req))),

  cancel: async (req, res) => ok(res, await service.cancelOwn(withActor(req), id(req), body(req))),

  list: async (req, res) => sendPaged(res, await service.list(req.validated.query, scopeOf(req), req.user)),

  approvals: async (req, res) => sendPaged(res, await service.approvals(req.user, req.validated.query)),

  approvalsSummary: async (req, res) => ok(res, await service.approvalsSummary(req.user)),

  get: async (req, res) => {
    const { own, request } = await service.getFor(req.user, scopeOf(req), id(req));
    return ok(res, own ? request : await maskForUser(pool, req.user, request));
  },

  readInvoice: async (req, res) => ok(res, await assist.readInvoice(req.user, body(req))),

  suggestCategory: async (req, res) => ok(res, await assist.suggestCategory(req.user, body(req))),

  history: async (req, res) => sendPaged(res, await service.history(req.user, scopeOf(req), id(req), req.validated.query)),

  checkDuplicate: async (req, res) => ok(res, await service.checkDuplicate(req.user, scopeOf(req), id(req))),

  withdraw: async (req, res) =>
    ok(res, await maskForUser(pool, req.user, await service.withdraw(withActor(req), scopeOf(req), id(req), body(req)))),
};
