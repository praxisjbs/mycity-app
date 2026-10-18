"use strict";
/**
 * What the assistant may read on Home, Reports, and where it sends a person
 * (docs/guides/home.md §9; A23: it reads, it never writes).
 *
 *   reports.mine   the reports the asker owns or receives, a page of 25 by name, with each
 *                  one's schedule and status; an empty page without `home.reports`
 *   runs.mine      the files the asker received, newest first, a page of 25: which are done,
 *                  waiting, failed or skipped; an empty page without `home.reports`
 *
 * Every login holds `home` view, which is all the assistant checks, so each read asks what
 * the Reports tab asks (reports.service.js): the capability, then the reports the asker may
 * see. Building, scheduling, running and archiving a report are the person's own acts on the
 * tab; the assistant sends them there.
 */
const c = require("@mycity/contract");
const { defineManifest } = require("../../shared/ai/manifest");
const service = require("./reports.service");

module.exports = defineManifest({
  module: "home",
  reads: [
    {
      key: "reports.mine",
      description: "List the reports I own or receive, with each one's schedule, formats and recipients",
      params: c.reports.HomeReportQuery,
      permission: ["home", "view"],
      run: (client, params, actor) => service.forAssistant(client, actor, params),
      cite: (row) => ({ type: "home_report", id: row.saved_report_id, label: row.name }),
    },
    {
      key: "runs.mine",
      description: "List the report files I received, newest first, and whether each is done, waiting, failed or skipped",
      params: c.reports.HomeReportRunQuery,
      permission: ["home", "view"],
      run: (client, params, actor) => service.runsForAssistant(client, actor, params),
      cite: (row) => ({ type: "home_report_run", id: row.home_report_run_id, label: row.number }),
    },
  ],
  routes: [
    { intent: "open a report", screen: "home.reports" },
    { intent: "build, schedule or run a report", screen: "home.reports" },
    { intent: "see the report files sent to me", screen: "home.reports" },
  ],
});
