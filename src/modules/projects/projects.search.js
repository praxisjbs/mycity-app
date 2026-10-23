"use strict";
/**
 * ⌘K for projects: a project found by its number or name. Everyone with `workspace` view sees
 * every project (docs/guides/workspace.md §6 Projects), so no scope narrows it. A result opens
 * the project's page on My Workspace · Projects (shared/route-map.js project).
 */
const { recordProvider } = require("../../shared/search/provider");

module.exports = recordProvider({
  type: "project",
  module: "workspace",
  label: "Projects",
  words: ["project", "projects"],
  from: "project p",
  key: "p.project_id",
  columns: ["p.number", "p.name"],
  select: "p.project_id AS id, p.number::text AS ref, p.name AS title, NULL::text AS sub, p.status AS status",
  order: "p.created_at DESC",
});
