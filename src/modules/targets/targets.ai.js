"use strict";
/**
 * What the assistant may read about departmental targets: a month's targets with their
 * progress and approval, one page of 25 at a time, within the asker's `performance` scope. It
 * never sets, submits or approves a target (A23); it sends the person to Set Targets.
 */
const c = require("@mycity/contract");
const { defineManifest } = require("../../shared/ai/manifest");
const service = require("./targets.service");

module.exports = defineManifest({
  module: "performance",
  reads: [
    {
      key: "targets.list",
      description: "List a month's departmental targets: department, what each rolls up to, status and progress",
      params: c.targets.TargetListQuery,
      permission: ["performance", "view"],
      run: (_client, params, actor) => service.list(params, actor.scope, actor),
      cite: (row) => ({ type: "target", id: row.organisational_goal_id, label: `${row.code || ""} ${row.title}`.trim() }),
    },
  ],
  routes: [
    { intent: "set department targets", screen: "performance.targets", params: { new: "1" }, prefill: c.targets.TargetCreate },
    { intent: "see this month's targets", screen: "performance.targets" },
  ],
});
