"use strict";
/**
 * What the leads module records (docs/guides/partnerships.md §7).
 *
 *   lead.created     New Lead, with its primary contact and its first deal
 *   lead.updated     Edit Lead; its status kept in step with its deal's stage (§6.4)
 *   lead.lost        Close as Lost, or its deal moved to Closed Lost
 *   lead.converted   its deal was signed: it became a partner in the same transaction (§6.4)
 *   lead.removed     the Partnership Tracker import that made it was reverted, nothing using it
 *
 * A lead's region cities are picked, never typed (F27), and kept as place rows by this module (owner
 * lead.cities). The lead keeps no copy of their lines: its lists and 360 read them through the place
 * rows, so a place named by the places-name job has nothing else to rewrite.
 */
const { defineEvents } = require("../../shared/events/catalogue");
const places = require("../../shared/places/owners");

const EVENTS = defineEvents("partnerships", {
  "lead.created": { summary: "A partnership lead was captured" },
  "lead.updated": { summary: "A partnership lead was changed" },
  "lead.lost": { summary: "A partnership lead was closed as lost" },
  "lead.converted": { summary: "A partnership lead became a partner" },
  "lead.removed": { summary: "A partnership lead was removed by reverting its import" },
});

places.owner("lead.cities", { rename: async () => {} });

module.exports = { EVENTS };
