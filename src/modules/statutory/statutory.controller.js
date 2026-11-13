"use strict";
// ai:none design: the statutory rates and PAYE bands are a structure entered whole on Configurations from figures MyCity's accountant has confirmed against current law, never drafted in the chat (praxis-ai.md decision 35)
// search:none a rate is configuration, not a record: the Configurations screen is what ⌘K finds (words statutory, paye, pension, nhf)
/**
 * Statutory rates: the HTTP edge for Configurations' Statutory Items and PAYE Bands, and a person's Pay to Date in their
 * sheet under Pay Components (docs/guides/payroll.md §5). Read with the `payroll` grant; entered with `payroll` edit and
 * the `payroll.configure` capability, which the route checks. Rates and bands are configuration, not a person's pay, so
 * they are not masked; a Pay to Date is a person's pay and tax, masked as the salary is (`taxable_pay`, `tax_paid`). A
 * run's statutory report is asked for on the run (payroll.routes.js).
 */
const { pool } = require("../../config/db");
const { ok, created, noContent } = require("../../shared/http/respond");
const { sendPaged } = require("../../shared/http/paged");
const { maskForUser } = require("../../shared/rbac/field-mask");
const { withActor } = require("../../shared/events/emit");
const service = require("./statutory.service");

const masked = (req, data) => maskForUser(pool, req.user, data);

module.exports = {
  payToDate: async (req, res) =>
    sendPaged(res, await masked(req, await service.payToDate(req.validated.params.employee_id, req.validated.query))),

  savePayToDate: async (req, res) =>
    ok(res, await masked(req, await service.savePayToDate(withActor(req), req.validated.params, req.validated.body))),

  removePayToDate: async (req, res) => {
    await service.removePayToDate(withActor(req), req.validated.params);
    return noContent(res);
  },

  list: async (req, res) => sendPaged(res, await service.list(req.validated.query)),

  items: async (req, res) => ok(res, await service.items()),

  save: async (req, res) => created(res, await service.save(withActor(req), req.validated.body)),

  removeChange: async (req, res) => {
    await service.removeChange(withActor(req), req.validated.params);
    return noContent(res);
  },
};
