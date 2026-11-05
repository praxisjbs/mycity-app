"use strict";
/**
 * What the partners module records (docs/guides/partnerships.md §7). Its event keys arrive with the
 * writes that emit them (M7 PR 3).
 *
 * A partner's headquarters (an area) and its region's cities are picked, never typed (F27), and kept
 * as place rows by this module (owners partner.headquarters and partner.cities). The partner keeps
 * no copy of their lines: its lists and 360 read them through places.view, so a place named by the
 * places-name job has nothing else to rewrite.
 */
const places = require("../../shared/places/owners");

places.owner("partner.headquarters", { rename: async () => {} });
places.owner("partner.cities", { rename: async () => {} });

module.exports = {};
