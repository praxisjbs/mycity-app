"use strict";
/**
 * ⌘K for reviews: a review found by the person reviewed or its cycle, among the people in the
 * reader's `performance` scope; one row per person and cycle, the manager review where there is
 * one. A result opens Performance · Reviews (shared/route-map.js review).
 */
const { recordProvider } = require("../../shared/search/provider");

module.exports = recordProvider({
  type: "review",
  module: "performance",
  label: "Reviews",
  words: ["review", "reviews", "appraisal", "performance review"],
  from: "performance_review r JOIN performance_cycle c ON c.performance_cycle_id = r.performance_cycle_id JOIN employee e ON e.employee_id = r.employee_id",
  key: "r.performance_review_id",
  columns: ["e.first_name", "e.last_name", "c.name"],
  select:
    "r.performance_review_id AS id, c.name AS ref, btrim(e.first_name || ' ' || e.last_name) AS title, r.review_type AS sub, r.status AS status",
  where: "r.review_type <> 'self'",
  order: "c.starts_on DESC",
  scope: { column: "r.employee_id" },
});
