"use strict";
/**
 * What the assistant may read and do about sanctions: the sanctions whose query the asker may
 * see (queries.visibility.js), one page of 25 at a time, and, for People with scope all,
 * one person's standing on the chain; and, as cards the person confirms (docs/guides/praxis-ai.md
 * §6.11, decision 33), Chain Settings' Add Step and a step's change (Move Up, Move Down, Retire,
 * Restore, and its name, letter, effect and days), through the chain's own functions, for a holder
 * of `queries.configure` as the routes hold it. It never proposes or approves a sanction (A23).
 */
const c = require("@mycity/contract");
const { defineManifest } = require("../../shared/ai/manifest");
const routeMap = require("../../shared/route-map");
const templates = require("../templates/templates.service");
const visibility = require("../queries/queries.visibility");
const chain = require("./sanctions.chain");
const service = require("./sanctions.service");

const CONFIGURE = "queries.configure";
/** A sanction letter written by its name is the active letter's key, as Add Step's Letter list offers it. */
const letterKeyOf = (value, _actor, db) => templates.keyOf(db, value, "sanction");
const stepLine = (status) => (step) => [{ type: "consequence_step", id: step.consequence_step_id, label: step.name, status, link: routeMap.screenPath("queries", "sanctions") }];
const LABELS = { name: "Name", position: "Position", letter_template: "Letter", financial_effect: "Financial Effect", default_days: "Days", valid_days: "In Force For", evidence_required: "Evidence Required" };

module.exports = defineManifest({
  module: "queries",
  actions: [
    {
      key: "chain.add_step",
      label: "Add Step",
      description: "Add a step to the consequence chain: its name, its place on the ladder, its letter, its financial effect, its days and how long it stays in force",
      input: c.sanctions.ConsequenceStepCreate,
      permission: ["queries", "create"],
      // As the route: POST /sanctions/chain asks requireCapability("queries.configure").
      capability: CONFIGURE,
      risk: "standard",
      form: "none: Add Step's form validates field by field and sends numbers from its boxes; the card is its own request",
      fields: ["name", "position", "letter_template", "financial_effect", "default_days", "valid_days", "evidence_required"],
      resolve: { letter_template: letterKeyOf },
      asks: [{ field: "name", question: "What is the step called?" }],
      // The same function Add Step calls: the steps below move down, its code made from its name.
      run: (values, actor) => chain.create(actor, values),
      readback: stepLine("added"),
      labels: LABELS,
    },
    {
      key: "chain.edit_step",
      label: "Save Step",
      description: "Change a step of the consequence chain: move it (its position), rename it, change its letter, effect or days, or retire it (active false) or restore it; only what changes",
      input: c.sanctions.ConsequenceStepChange,
      permission: ["queries", "edit"],
      capability: CONFIGURE,
      risk: "standard",
      form: "none: Move Up, Move Down, Retire and Restore are buttons on a step of Chain Settings; the card names the step",
      fields: ["consequence_step_id", "name", "position", "letter_template", "financial_effect", "default_days", "valid_days", "evidence_required", "active"],
      resolve: { consequence_step_id: (value, _actor, db) => chain.idOf(db, value), letter_template: letterKeyOf },
      asks: [{ field: "consequence_step_id", question: "Which step?", options: ({ db }) => chain.stepNames(db) }],
      records: (values, _actor, db) => chain.cardStep(db, values.consequence_step_id),
      check: (client, values) => chain.assertCardStep(client, values.consequence_step_id),
      run: (values, actor) => {
        const { consequence_step_id: id, ...changes } = values;
        return chain.update(actor, id, changes);
      },
      readback: stepLine("saved"),
      labels: { consequence_step_id: "Step", ...LABELS, active: "In Use" },
    },
  ],
  // Chain Settings' own requests, reached through the cards (gate 23, praxis-ai.md decision 33).
  not_offered: {
    ConsequenceStepUpdate: "via chain.edit_step: a step's own change (Move Up, Move Down, Retire, Restore), which never names its step; the card is ConsequenceStepChange",
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
