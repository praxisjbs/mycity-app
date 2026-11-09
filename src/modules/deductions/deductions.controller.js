"use strict";
/**
 * Deductions: the HTTP edge for Payroll · Deductions (docs/guides/payroll.md §5). Every route is behind the
 * `payroll` grant; the salary-derived amounts (`pay_amount`) are masked for a reader without
 * `employee.salary`, so they reach the screen as Restricted. A fine is accepted, waived or released and an
 * advance recorded or cancelled by someone with `payroll` edit (create for Record Advance), never their own.
 */
const { pool } = require("../../config/db");
const { ok, created } = require("../../shared/http/respond");
const { sendPaged } = require("../../shared/http/paged");
const { maskForUser } = require("../../shared/rbac/field-mask");
const { withActor } = require("../../shared/events/emit");
const service = require("./deductions.service");

const masked = (req, data) => maskForUser(pool, req.user, data);
const body = (req) => req.validated.body || {};
const id = (req) => req.validated.params.id;
const fineId = (req) => req.validated.params.sanction_fine_id;

module.exports = {
  list: async (req, res) => sendPaged(res, await masked(req, await service.list(req.user, req.validated.query))),

  summary: async (req, res) => ok(res, await masked(req, await service.summary())),

  accept: async (req, res) => ok(res, await masked(req, await service.acceptFine(withActor(req), fineId(req), body(req)))),

  waive: async (req, res) => ok(res, await masked(req, await service.waiveFine(withActor(req), fineId(req), body(req)))),

  release: async (req, res) => ok(res, await masked(req, await service.releaseFine(withActor(req), id(req), body(req)))),

  record: async (req, res) => created(res, await masked(req, await service.recordAdvance(withActor(req), body(req)))),

  cancel: async (req, res) => ok(res, await masked(req, await service.cancelAdvance(withActor(req), id(req), body(req)))),
};
