"use strict";
/**
 * What the leads module records (docs/guides/partnerships.md §7). Its event keys arrive with the
 * writes that emit them (M7 PR 3).
 *
 * A lead's region cities are picked, never typed (F27), and kept as place rows by this module (owner
 * lead.cities). The lead keeps no copy of their lines: its lists and 360 read them through
 * places.view, so a place named by the places-name job has nothing else to rewrite.
 */
const places = require("../../shared/places/owners");

places.owner("lead.cities", { rename: async () => {} });

module.exports = {};
