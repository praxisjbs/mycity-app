"use strict";
/**
 * ⌘K for assessments (docs/guides/recruitment.md §9): an assessment found by its code or name. The
 * library is read by anyone with `recruitment` view, so it has no scope. The words people use are
 * "assessment" and "test". A result opens it on Recruitment · Assessments (shared/route-map.js
 * assessment).
 */
const { recordProvider } = require("../../shared/search/provider");

module.exports = recordProvider({
  type: "assessment",
  module: "recruitment",
  label: "Assessments",
  words: ["assessment", "assessments", "test", "tests", "brief", "case study", "psychometric"],
  from: "assessment_definition d",
  key: "d.assessment_definition_id",
  columns: ["d.code", "d.name"],
  select: "d.assessment_definition_id AS id, d.code::text AS ref, d.name AS title, d.assessment_type AS sub, CASE WHEN d.active THEN 'on' ELSE 'off' END AS status",
  order: "d.created_at DESC",
});
