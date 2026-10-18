"use strict";
// ai:none the audit ledger is for the people who hold Settings over everything; the assistant does not answer from it
// search:none ledger entries are found on the Audit Log with its filters, not looked up one by one
/**
 * The Audit Log's HTTP edge: the filtered log at 25 a page, the counts above it, and
 * the export, which is emailed. Only for Settings view over everything, and the CEO.
 */
const { ok, accepted } = require("../../shared/http/respond");
const { sendPaged } = require("../../shared/http/paged");
const { scopeOf } = require("../../shared/rbac/scope");
const { withActor } = require("../../shared/events/emit");
const service = require("./audit.service");

module.exports = {
  list: async (req, res) =>
    sendPaged(
      res,
      await service.list(req.validated.query, req.user, scopeOf(req)),
    ),
  summary: async (req, res) => ok(res, await service.summary(scopeOf(req))),
  requestExport: async (req, res) =>
    accepted(
      res,
      await service.requestExport(
        req.validated.body,
        withActor(req),
        scopeOf(req),
      ),
    ),
};
