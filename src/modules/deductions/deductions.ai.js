"use strict";
/**
 * What the assistant may do about deductions (docs/guides/payroll.md §9). Payroll registers no AI job of its
 * own: it adds no model call.
 *
 * The one route so far: "record a salary advance" opens Payroll · Deductions on Record Advance, where the
 * person presses it. The reads (`deductions.list`, `deductions.mine`), the summary and the cards that run the
 * service functions the screen's buttons call (`deductions.accept`, `deductions.waive`, `advances.record`) come
 * with M6 PR 6, which owns every card of M6 beyond the one gate 23 asked for earlier (`payroll_runs.create`).
 */
const { defineManifest } = require("../../shared/ai/manifest");

module.exports = defineManifest({
  module: "payroll",
  not_offered: {},
  routes: [{ intent: "record a salary advance", screen: "payroll.deductions", params: { action: "advance" } }],
});
