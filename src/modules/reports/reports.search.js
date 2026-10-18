"use strict";
/**
 * ⌘K for Home, Reports (docs/guides/home.md §9):
 *
 *   Reports       a report the reader may see, by its name: their own, those they receive,
 *                 and shared ones whose source they may open. A result opens the report on
 *                 the Reports tab.
 *   Report Runs   a file the reader received, or of a report they own, by its number or its
 *                 report's name. A result opens it on the Reports tab (shared/route-map.js:
 *                 `?run=`, since `?id=` on the tab is a report).
 *
 * Every login holds `home` view, the only check the search service makes, so both decide per
 * person through the tab's own reads (reports.service.js), and find nothing for a reader
 * without `home.reports`. Each is a page of 25, as every list.
 */
const routeMap = require("../../shared/route-map");
const { SOURCES } = require("./reports.sources");
const service = require("./reports.service");

const reports = Object.freeze({
  type: "home_report",
  module: "home",
  label: "Reports",
  words: ["report", "reports", "attendance report", "scheduled report"],
  scoped: false,
  columns: [],
  async search(client, { term, page = 1, user }) {
    const found = await service.searchReports(client, user, { term, page });
    return {
      page: found.page,
      items: found.data.map((r) => ({
        id: r.saved_report_id,
        type: "home_report",
        ref: null,
        title: r.name,
        sub: SOURCES[r.report_key].label,
        status: !r.report_schedule_id ? "on_demand" : r.active ? "scheduled" : "paused",
        link: routeMap.linkFor("home_report", r.saved_report_id).path,
      })),
    };
  },
});

const runs = Object.freeze({
  type: "home_report_run",
  module: "home",
  label: "Report Runs",
  words: ["report run", "report file", "report runs"],
  scoped: false,
  columns: [],
  async search(client, { term, page = 1, user }) {
    const found = await service.searchRuns(client, user, { term, page });
    return {
      page: found.page,
      items: found.data.map((r) => ({
        id: r.home_report_run_id,
        type: "home_report_run",
        ref: r.number,
        title: r.report_name,
        sub: r.recipient_name,
        status: r.status,
        link: routeMap.linkFor("home_report_run", r.home_report_run_id).path,
      })),
    };
  },
});

module.exports = [reports, runs];
