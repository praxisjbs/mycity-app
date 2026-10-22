"use strict";
/**
 * ⌘K for scorecards: a scorecard by its person's name or its quarter, within the reader's
 * `performance` scope (docs/guides/performance.md §9). A result opens on Performance · Scorecards.
 */
const { recordProvider } = require("../../shared/search/provider");

module.exports = recordProvider({
  type: "scorecard",
  module: "performance",
  label: "Scorecards",
  words: ["scorecard", "scorecards", "targets"],
  from: `scorecard s
    JOIN employee e ON e.employee_id = s.employee_id
    JOIN performance_period p ON p.performance_period_id = s.performance_period_id`,
  key: "s.scorecard_id",
  columns: ["e.first_name || ' ' || e.last_name", "p.name"],
  select: "s.scorecard_id AS id, p.name AS ref, btrim(e.first_name || ' ' || e.last_name) AS title, e.job_title AS sub, s.status AS status",
  order: "p.starts_on DESC, e.first_name, e.last_name",
  scope: { column: "s.employee_id" },
});
