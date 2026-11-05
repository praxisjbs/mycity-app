"use strict";
/**
 * What the partner_pipeline module records (docs/guides/partnerships.md §7). Its event keys arrive
 * with the writes that emit them (M7 PR 2 and PR 3).
 *
 * A deal's venue is picked, never typed (F27), and kept as a place row by this module (owner
 * deal.venue). The deal keeps no copy of its line: the deal and its calendar event read it through
 * places.view, so a place named by the places-name job has nothing else to rewrite.
 */
const places = require("../../shared/places/owners");

places.owner("deal.venue", { rename: async () => {} });

module.exports = {};
