"use strict";
/**
 * What the partner_pipeline module records (docs/guides/partnerships.md §7). Loaded by the API
 * (through the service) and the worker.
 *
 *   deal.created          New Deal, or a lead's or partner's first deal
 *   deal.updated          Edit Deal: its terms, options, team, dates or custom values
 *   deal.stage_changed    the stage switcher, Close as Lost, Close Partner or a conversion
 *   deal.health_changed   Set Health (Stalled carries its blockers)
 *   deal.signed           a deal entered a signed meaning: a lead's converts in the same transaction
 *   deal.lost             a deal entered Closed Lost
 *   deal_return.saved     Enter Returns, a month at a time (money: partnerships.money)
 *
 * Payloads carry ids, numbers and codes, never money or a contact's details. Who is told about
 * which (the owner when someone else moved a deal, the owner's Head of Department on Stalled) is
 * declared with the module's views and notification types (§7, M7 PR 8).
 *
 * A deal's venue is picked, never typed (F27), and kept as a place row by this module (owner
 * deal.venue). The deal keeps no copy of its line: the deal and its calendar event read it through
 * places.view, so a place named by the places-name job has nothing else to rewrite.
 */
const { defineEvents } = require("../../shared/events/catalogue");
const places = require("../../shared/places/owners");

const EVENTS = defineEvents("partnerships", {
  "deal.created": { summary: "A partnership deal was opened" },
  "deal.updated": { summary: "A partnership deal was changed" },
  "deal.stage_changed": { summary: "A partnership deal moved stage" },
  "deal.health_changed": { summary: "A partnership deal's health was set" },
  "deal.signed": { summary: "A partnership deal was signed" },
  "deal.lost": { summary: "A partnership deal was closed as lost" },
  "deal_return.saved": { summary: "A month of a deal's returns was entered" },
});

places.owner("deal.venue", { rename: async () => {} });

module.exports = { EVENTS };
