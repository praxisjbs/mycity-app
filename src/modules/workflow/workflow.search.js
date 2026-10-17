"use strict";
/**
 * ⌘K: an approval flow by its name, for whoever reads Settings, Approvals. A result
 * opens the screen on that flow. Only the active version of each flow is found.
 */
const { recordProvider } = require("../../shared/search/provider");

module.exports = recordProvider({
  type: "workflow_definition",
  module: "settings",
  label: "Approval Flows",
  words: ["flow", "approval flow", "approval route"],
  from: "workflow_definition d",
  key: "d.workflow_definition_id",
  columns: ["d.name", "d.key"],
  select: "d.workflow_definition_id AS id, d.key::text AS ref, d.name AS title, 'Version ' || d.version AS sub",
  where: "d.active",
});
