"use strict";
/**
 * ⌘K for goals: an organisational, annual or monthly goal (departmental targets are targets.search.js), found
 * by its number, title or strategic theme. Goals are seen by every holder of `performance`
 * view, as on the screen, so the provider has no scope column. A result opens Performance ·
 * Goals (shared/route-map.js goal).
 */
const { recordProvider } = require("../../shared/search/provider");

module.exports = recordProvider({
  type: "goal",
  module: "performance",
  label: "Goals",
  words: ["goals", "goal", "targets", "objectives", "strategy"],
  from: "organisational_goal g",
  key: "g.organisational_goal_id",
  columns: ["g.code", "g.title", "g.strategic_theme"],
  select:
    "g.organisational_goal_id AS id, g.code::text AS ref, g.title AS title, g.strategic_theme AS sub, g.status AS status",
  where: "g.level <> 'department' AND g.status <> 'cancelled'",
  order: "g.starts_on DESC",
});
