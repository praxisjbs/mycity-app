"use strict";
/**
 * ⌘K for departmental targets: a department's target for a month, found by its number, title
 * or department, among the departments of the people in the reader's `performance` scope. A
 * result opens Performance · Targets (shared/route-map.js target).
 */
const { recordProvider } = require("../../shared/search/provider");

module.exports = recordProvider({
  type: "target",
  module: "performance",
  label: "Targets",
  words: ["targets", "target", "department targets", "monthly targets"],
  from: "organisational_goal g JOIN department d ON d.department_id = g.department_id",
  key: "g.organisational_goal_id",
  columns: ["g.code", "g.title", "d.name"],
  select: "g.organisational_goal_id AS id, g.code::text AS ref, g.title AS title, d.name AS sub, g.status AS status",
  where: "g.level = 'department' AND g.status <> 'cancelled'",
  order: "g.starts_on DESC",
  scope: {
    column: "e.employee_id",
    through: "employee e WHERE e.department_id = g.department_id",
  },
});
