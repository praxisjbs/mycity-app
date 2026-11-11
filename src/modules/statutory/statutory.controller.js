"use strict";
// ai:none design: the statutory rates and PAYE bands are a structure entered whole on Configurations from figures MyCity's accountant has confirmed against current law, never drafted in the chat (praxis-ai.md decision 35)
// search:none a rate is configuration, not a record: the Configurations screen is what ⌘K finds (words statutory, paye, pension, nhf)
/**
 * Statutory rates: the HTTP edge for Configurations' Statutory Items and PAYE Bands (docs/guides/payroll.md §5). Read
 * with the `payroll` grant; entered with `payroll` edit and the `payroll.configure` capability, which the route checks.
 * Rates and bands are configuration, not a person's pay, so nothing here is masked. A run's statutory report is asked
 * for on the run (payroll.routes.js).
 */
const { ok, created, noContent } = require("../../shared/http/respond");
const { sendPaged } = require("../../shared/http/paged");
const { withActor } = require("../../shared/events/emit");
const service = require("./statutory.service");

module.exports = {
  list: async (req, res) => sendPaged(res, await service.list(req.validated.query)),

  items: async (req, res) => ok(res, await service.items()),

  save: async (req, res) => created(res, await service.save(withActor(req), req.validated.body)),

  removeChange: async (req, res) => {
    await service.removeChange(withActor(req), req.validated.params);
    return noContent(res);
  },
};
