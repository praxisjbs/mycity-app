"use strict";
/**
 * Expense categories: the HTTP edge for Expenses · Categories and the category pickers. Every
 * `expenses` holder reads them (New Request picks one); holders of `expenses.finance` keep them.
 */
const { ok, created } = require("../../shared/http/respond");
const { sendPaged } = require("../../shared/http/paged");
const { withActor } = require("../../shared/events/emit");
const service = require("./expense_categories.service");

module.exports = {
  list: async (req, res) => sendPaged(res, await service.list(req.validated.query)),

  create: async (req, res) => created(res, await service.create(withActor(req), req.validated.body)),

  update: async (req, res) => ok(res, await service.update(withActor(req), req.validated.params.id, req.validated.body)),

  addSuggested: async (req, res) => sendPaged(res, await service.addSuggested(withActor(req))),
};
