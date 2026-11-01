"use strict";
/**
 * What the assistant may read about sanctions: the sanctions whose query the asker may
 * see (queries.visibility.js), one page of 25 at a time, and, for People with scope all,
 * one person's standing on the chain. It never proposes, approves or changes the
 * chain (A23); it sends the person to Queries or Sanctions.
 */
const c = require("@mycity/contract");
const { defineManifest } = require("../../shared/ai/manifest");
const visibility = require("../queries/queries.visibility");
const service = require("./sanctions.service");

module.exports = defineManifest({
  module: "queries",
  // Every Create schema of this module's contract, and why the assistant does not offer it (gate 23).
  not_offered: {
    ConsequenceStepCreate: "a step on the consequence chain is Settings, set on Queries, Rules",
  },
  reads: [
    {
      key: "sanctions.list",
      description: "List sanctions: who, which step of the chain, the reason, any fine, and whether it is issued or waiting for approval",
      params: c.sanctions.SanctionListQuery,
      permission: ["queries", "view"],
      run: (_client, params, actor) => service.list(params, visibility.readerOf(actor.scope, actor)),
      cite: (row) => ({ type: "sanction", id: row.sanction_id, label: `${row.step_name}, ${row.employee.display_name}` }),
    },
    {
      key: "sanctions.standing",
      description: "One person's steps on the chain still in force, and the step a new offence would be",
      params: c.sanctions.SanctionStandingQuery,
      permission: ["queries", "view"],
      run: (_client, params, actor) => service.standing(visibility.readerOf(actor.scope, actor), params.employee_id),
      cite: (row) => ({ type: "employee", id: row.employee_id, label: "Standing on the chain" }),
    },
  ],
  routes: [
    { intent: "issue a sanction", screen: "queries.queries" },
    { intent: "change the consequence chain", screen: "queries.sanctions" },
  ],
});
