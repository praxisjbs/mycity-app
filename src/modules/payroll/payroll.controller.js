"use strict";
/**
 * Payroll runs: the HTTP edge for Payroll · Payroll Runs (docs/guides/payroll.md §5). Every route is behind
 * the `payroll` grant; the salary-derived amounts (`gross_pay`, `total_deductions`, `net_pay`, `employer_cost`,
 * `pay_amount`) are masked for a reader without `employee.salary`, so they reach the screen as Restricted.
 * A run is approved, sent back or rejected in its approval (/workflow/instances/:id/approve, request-changes,
 * reject), never here.
 */
const { pool } = require("../../config/db");
const { ok, created, accepted, noContent } = require("../../shared/http/respond");
const { sendPaged } = require("../../shared/http/paged");
const { maskForUser } = require("../../shared/rbac/field-mask");
const { withActor } = require("../../shared/events/emit");
const payslips = require("../payslips/payslips.service");
const statutory = require("../statutory/statutory.service");
const service = require("./payroll.service");

const id = (req) => req.validated.params.id;
const body = (req) => req.validated.body || {};
const masked = (req, data) => maskForUser(pool, req.user, data);

module.exports = {
  list: async (req, res) => sendPaged(res, await masked(req, await service.listRuns(req.user, req.validated.query))),

  summary: async (req, res) => ok(res, await masked(req, await service.summary(req.user))),

  get: async (req, res) => ok(res, await masked(req, await service.getRun(req.user, id(req)))),

  create: async (req, res) => created(res, await masked(req, await service.createRun(withActor(req), body(req)))),

  compute: async (req, res) => ok(res, await masked(req, await service.computeRun(withActor(req), id(req)))),

  problems: async (req, res) => sendPaged(res, await service.problems(id(req), req.validated.query)),

  submit: async (req, res) => ok(res, await masked(req, await service.submitRun(withActor(req), id(req), body(req)))),

  markPaid: async (req, res) => ok(res, await masked(req, await service.markPaid(withActor(req), id(req), body(req)))),

  exclude: async (req, res) => ok(res, await masked(req, await service.excludePerson(withActor(req), id(req), body(req)))),

  include: async (req, res) => ok(res, await masked(req, await service.includePerson(withActor(req), id(req), body(req)))),

  adjustments: async (req, res) => sendPaged(res, await masked(req, await service.adjustments(id(req), req.validated.query))),

  addAdjustment: async (req, res) => created(res, await masked(req, await service.addAdjustment(withActor(req), id(req), body(req)))),

  removeAdjustment: async (req, res) => {
    await service.removeAdjustment(withActor(req), id(req), req.validated.params.adjustment_id);
    return noContent(res);
  },

  emailPayslips: async (req, res) => accepted(res, await payslips.requestEmailAll(withActor(req), id(req), body(req))),

  payslipsExport: async (req, res) => {
    await payslips.assertMayPrint(req.user, null);
    return accepted(res, await payslips.requestRunExport(withActor(req), id(req)));
  },

  statutoryReport: async (req, res) => {
    await statutory.assertMayReadReport(req.user);
    return accepted(res, await statutory.requestReport(withActor(req), id(req)));
  },

  settings: async (req, res) => ok(res, await service.getSettings()),

  changeSettings: async (req, res) => ok(res, await service.changeSettings(withActor(req), body(req))),

  discard: async (req, res) => {
    await service.discardRun(withActor(req), id(req));
    return noContent(res);
  },
};
