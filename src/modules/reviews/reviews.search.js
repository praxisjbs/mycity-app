"use strict";
/**
 * ⌘K for reviews: a review by its person's name or its month, within the reader's `performance`
 * scope (docs/guides/performance.md §9). A result opens on Performance · Reviews; a person's own
 * opens on My Performance. Improvement plans are not searched: one is reached from its review.
 */
const { recordProvider } = require("../../shared/search/provider");

module.exports = recordProvider({
  type: "review",
  module: "performance",
  label: "Reviews",
  words: ["review", "reviews", "appraisal", "check-in", "check in"],
  from: `performance_review pr
    JOIN employee e ON e.employee_id = pr.employee_id
    LEFT JOIN performance_cycle c ON c.performance_cycle_id = pr.performance_cycle_id`,
  key: "pr.performance_review_id",
  where: "(pr.scorecard_id IS NOT NULL OR pr.review_kind = 'probation')",
  columns: ["e.first_name || ' ' || e.last_name", "c.name"],
  select:
    "pr.performance_review_id AS id, COALESCE(c.name, 'Probation') AS ref, btrim(e.first_name || ' ' || e.last_name) AS title, e.job_title AS sub, pr.status AS status",
  order: "c.month DESC NULLS FIRST, e.first_name, e.last_name",
  scope: { column: "pr.employee_id" },
});
