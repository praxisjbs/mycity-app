"use strict";
/**
 * What the assistant may read about SOPs (docs/guides/knowledge.md §9):
 *
 *   sops.list   the SOPs the asker may read, by department and words: published ones for everyone,
 *               and a writer's drafts and archived ones when asked for by state, as the screen lists them
 *   sops.read   one SOP's version in force with its steps, who does each and the screen it happens on;
 *               cited with its version
 *
 * Every list is a page of 25 through the same service as the screen. No action: an SOP is written
 * whole on its own screen, every step in view, and published to its department from there; the
 * assistant sends a writer to Knowledge Hub · SOPs (`design:` below, praxis-ai.md decision 35).
 */
const c = require("@mycity/contract");
const routeMap = require("../../shared/route-map");
const { defineManifest } = require("../../shared/ai/manifest");
const service = require("./knowledge.service");

const linkOf = (id) => (routeMap.linkFor("sop", id) || {}).path || null;

module.exports = defineManifest({
  module: "knowledge",
  not_offered: {
    SopCreate: "design: an SOP is started for its department on Knowledge Hub, SOPs, where its draft is written whole with every step in view",
    SopDraftSave: "design: a draft's purpose, roles and numbered steps, each with its screen and file, are written together on the SOP's own editor",
  },
  reads: [
    {
      key: "sops.list",
      description: "List the department procedures (SOPs) I may read, by department and words, with their versions",
      params: c.knowledge.SopListQuery,
      permission: ["knowledge", "view"],
      run: (_client, params, actor) => service.list(actor, params),
      cite: (row) => ({ type: "sop", id: row.sop_id, label: `${row.number} ${row.title}`, link: linkOf(row.sop_id) }),
    },
    {
      key: "sops.read",
      summary: "none: one record",
      description: "Read one department procedure (SOP) in force: its purpose, scope, roles and numbered steps with who does each",
      params: c.common.IdParams,
      permission: ["knowledge", "view"],
      // One record, as a read with an id and no page returns it (shared/ai/authorise.js).
      run: (_client, params, actor) => service.inForce(actor, params.id),
      cite: (row) => ({ type: "sop", id: row.sop_id, label: `${row.number} ${row.title}, Version ${row.version}`, link: linkOf(row.sop_id) }),
    },
  ],
  routes: [
    { intent: "read a department's procedure (SOP)", screen: "knowledge.sops" },
    { intent: "write, change or publish an SOP", screen: "knowledge.sops" },
    { intent: "start a new SOP", screen: "knowledge.sops", params: { action: "new" } },
  ],
});
