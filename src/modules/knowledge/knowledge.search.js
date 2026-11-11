"use strict";
/**
 * ⌘K for SOPs (docs/guides/knowledge.md §9): an SOP by its number or title, opening Knowledge Hub ·
 * SOPs `?id=`. Everyone finds the active SOPs with a version in force; a writer of a department (its
 * head, or `sops.manage`) also finds that department's SOPs still being drafted. An archived SOP is
 * found by nobody (§6.3). New SOP is ⌘K's action (shared/search/actions.js).
 */
const { recordProvider } = require("../../shared/search/provider");
const service = require("./knowledge.service");

module.exports = recordProvider({
  type: "sop",
  module: "knowledge",
  label: "SOPs",
  words: ["sop", "sops", "procedure", "procedures"],
  from: "sop s JOIN department d ON d.department_id = s.department_id",
  key: "s.sop_id",
  columns: ["s.number", "s.title"],
  select: "s.sop_id AS id, s.number::text AS ref, s.title AS title, d.name AS sub, NULL::text AS status",
  where: "s.status = 'active'",
  order: "s.title",
  reach: (client, user) => service.reachOf(client, user),
  readable: (reach, params) => {
    const published = "EXISTS (SELECT 1 FROM sop_version pv WHERE pv.sop_id = s.sop_id AND pv.status = 'published')";
    if (reach.all) return "TRUE";
    if (!reach.departments.length) return published;
    params.push(reach.departments);
    return `(${published} OR s.department_id = ANY($${params.length}::uuid[]))`;
  },
});
