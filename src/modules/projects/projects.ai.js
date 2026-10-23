"use strict";
/**
 * What the assistant may read of projects: the list, one page of 25 at a time, with the open and
 * done tasks in each the asker can see. It never starts or changes one (A23); it sends the person
 * to New Project.
 */
const c = require("@mycity/contract");
const { defineManifest } = require("../../shared/ai/manifest");
const service = require("./projects.service");

module.exports = defineManifest({
  module: "workspace",
  reads: [
    {
      key: "projects.list",
      description: "The projects, active or completed, with how many of their tasks are open and done",
      params: c.projects.ProjectListQuery,
      permission: ["workspace", "view"],
      run: (_client, params, actor) => service.list(params, actor.scope),
      cite: (row) => ({ type: "project", id: row.project_id, label: row.name }),
    },
  ],
  routes: [{ intent: "start a project", screen: "workspace.projects", params: { new: "1" }, prefill: c.projects.ProjectPrefill }],
});
