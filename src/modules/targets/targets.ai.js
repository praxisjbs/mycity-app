"use strict";
/**
 * What the assistant may read and do about scorecards and commitments: score to date and rating, and
 * a month's commitments with their states, within the asker's own `performance` scope, 25 at a time
 * (docs/guides/performance.md §9). Never a line's evidence or a review's comments.
 *
 * As cards the person confirms (docs/guides/praxis-ai.md §6.11, decisions 33 and 40): New Scorecard,
 * a line added or changed on Edit Lines, and Change Reviewer, each through the service function the
 * screen's own button calls; a scorecard is named by its person, a line by its words.
 */
const c = require("@mycity/contract");
const { defineManifest } = require("../../shared/ai/manifest");
const { quantityOf } = require("../../shared/ai/named");
const routeMap = require("../../shared/route-map");
const goals = require("../goals/goals.service");
const okrs = require("../goals/goals.okrs");
const service = require("./targets.service");
const commitments = require("./targets.commitments");

const cardLink = (id) => (routeMap.linkFor("scorecard", id) || {}).path || null;
/** The scorecard a card made or changed, read back as a line that opens it. */
const cardLine = (status) => (card) => [{ type: "scorecard", id: card.scorecard_id, label: `${card.employee.display_name}, ${card.period_name}`, status, link: cardLink(card.scorecard_id) }];
/** What a line's card names beside its scorecard: its key result and its KPI. */
const linkNames = async (values, actor, db) => [
  ...(await okrs.cardKeyResult(db, values.okr_key_result_id, actor)).filter((r) => r.label),
  ...(await require("../kpis/kpis.service").cardKpi(db, values.kpi_definition_id, actor)).filter((r) => r.label),
];
/** A line's fields, as Edit Lines shows them for one line (Team Key Results stay on the form). */
const LINE_FIELDS = ["section", "title", "measure", "target_value", "target_text", "milestone_due_on", "weight", "okr_key_result_id", "kpi_definition_id"];
const LINE_LABELS = { section: "Section", title: "Goal", measure: "Measure", target_value: "Target", target_text: "Target in Words", milestone_due_on: "Due Date", weight: "Weight", okr_key_result_id: "Key Result", kpi_definition_id: "KPI" };
/** A line's section and measure as the screen names them, matched to their codes (Yes or No is binary). */
const SECTIONS = { results: "results", kpis: "kpis", kpi: "kpis", accountability: "accountability" };
const MEASURES = { numeric: "numeric", number: "numeric", milestone: "milestone", standard: "standard", "yes or no": "binary", binary: "binary" };
const codeIn = (codes) => (value) => codes[String(value).toLowerCase().replace(/[^a-z ]+/g, " ").replace(/\s+/g, " ").trim()] || null;
/** The measures a section takes, as Edit Lines offers them. */
const MEASURE_WORDS = { results: ["Numeric", "Milestone"], kpis: ["Standard", "Yes or No"], accountability: ["Standard", "Yes or No"] };
/** The scorecard a line card is on, when the person did not say (praxis-ai.md decision 34): the drafts they may change, to tap. */
const whichDraft = { field: "scorecard_id", question: "Whose scorecard is it?", options: ({ actor, db }) => service.scorecardChoices(db, actor, actor.scope, { drafts: true }) };
const LINE_RESOLVE = {
  scorecard_id: (value, actor, db) => service.scorecardIdOf(db, value, actor, actor.scope),
  section: codeIn(SECTIONS),
  measure: codeIn(MEASURES),
  // A target and a weight as the person said them ("10 stories", "60%"): their numbers.
  target_value: (value) => quantityOf(value),
  weight: (value) => quantityOf(value),
  okr_key_result_id: (value, actor, db) => okrs.keyResultIdOf(db, value, actor),
  kpi_definition_id: (value, actor, db) => require("../kpis/kpis.service").kpiIdOf(db, value, actor),
};

/**
 * The matrix's scope probe (docs/guides/praxis-ai.md §6.17): a scorecard is drafted for someone in the
 * drafter's scope, so one for their report passes the card's re-check and one for the outsider, on
 * nobody's team, is refused; a reader of their own scope alone drafts for nobody.
 */
const draftProbe = {
  inside: (ctx) => (ctx.actor.scope.scope === "own" || !ctx.report ? null : { type: "employee", id: ctx.report.employee_id, values: { employee_id: ctx.report.employee_id, performance_period_id: "00000000-0000-4000-8000-0000000000c1" } }),
  outside: (ctx) => ({ type: "employee", id: ctx.outsider.employee_id, values: { employee_id: ctx.outsider.employee_id, performance_period_id: "00000000-0000-4000-8000-0000000000c1" } }),
};

module.exports = defineManifest({
  module: "performance",
  actions: [
    {
      key: "scorecards.create",
      label: "Draft Scorecard",
      matrix: draftProbe,
      description: "Draft a quarter's scorecard for someone in my team, never my own: the person, the quarter, and copy from last quarter's lines or none",
      input: c.targets.ScorecardDraft,
      permission: ["performance", "create"],
      risk: "standard",
      form: "none: New Scorecard's Copy From also takes a colleague's scorecard, picked on the form; the card copies last quarter's or none",
      picks: { employee_id: "colleague" },
      // Who and which quarter, asked first when not said (decision 34): the people in the drafter's team to tap.
      asks: [
        { field: "employee_id", question: "Who is it for?", options: ({ actor, db }) => service.draftChoices(db, actor, actor.scope) },
        { field: "performance_period_id", question: "Which quarter is it for?", options: ({ db }) => goals.periodChoices(db, { open: true }) },
      ],
      resolve: {
        employee_id: (value, actor, db) => service.draftIdOf(db, value, actor, actor.scope),
        performance_period_id: (value, _actor, db) => goals.periodIdOf(db, value),
      },
      names: (values, _actor, db) => goals.cardNames(db, { employees: [values.employee_id], periods: [values.performance_period_id] }),
      check: (client, values, actor) => service.assertCardDraft(client, values.employee_id, actor, actor.scope),
      run: (values, actor) => service.create(actor, actor.scope, values),
      readback: cardLine("drafted"),
      labels: { employee_id: "Person", performance_period_id: "Quarter", copy_from: "Copy From" },
    },
    {
      key: "scorecards.add_line",
      label: "Add Line",
      description: "Add a line to a draft scorecard (named by its person): its section, goal, measure, target, due date, weight, and the key result or KPI it is scored from",
      input: c.targets.ScorecardLineAdd,
      permission: ["performance", "edit"],
      risk: "standard",
      form: "none: Edit Lines is opened on its scorecard and saves every line at once; the card names the scorecard and adds one line",
      fields: ["scorecard_id", ...LINE_FIELDS],
      resolve: LINE_RESOLVE,
      asks: [
        whichDraft,
        { field: "title", question: "What is the goal?" },
        { field: "section", question: "Which section is it in?", choices: ["Results", "KPIs", "Accountability"] },
        { field: "measure", question: "How is it measured?", options: ({ values }) => MEASURE_WORDS[codeIn(SECTIONS)(values.section || "")] || ["Numeric", "Milestone", "Standard", "Yes or No"] },
        { field: "weight", question: "What weight does it carry?", choices: ["10", "15", "20", "25"] },
      ],
      names: linkNames,
      records: (values, actor, db) => (db ? service.cardScorecard(db, values.scorecard_id, actor, actor.scope) : []),
      check: (client, values, actor) => service.assertCardEditable(client, values.scorecard_id, actor, actor.scope),
      // Save Lines' own function, every other line as it stands.
      run: (values, actor) => service.addLine(actor, actor.scope, values),
      readback: cardLine("line added"),
      labels: { scorecard_id: "Scorecard", ...LINE_LABELS },
    },
    {
      key: "scorecards.edit_line",
      label: "Save Line",
      description: "Change a line of a draft scorecard (the scorecard by its person, the line by its words): only what changes",
      input: c.targets.ScorecardLineChange,
      permission: ["performance", "edit"],
      risk: "standard",
      form: "none: Edit Lines is opened on its scorecard and saves every line at once; the card names the scorecard and the line",
      fields: ["scorecard_id", "employee_target_id", ...LINE_FIELDS],
      asks: [whichDraft, { field: "employee_target_id", question: "Which line?", options: ({ actor, db, values }) => service.scorecardLineChoices(db, values.scorecard_id, actor, actor.scope) }],
      resolve: { ...LINE_RESOLVE, employee_target_id: (value, _actor, db, values) => service.scorecardLineIdOf(db, values.scorecard_id, value) },
      names: async (values, actor, db) => [...(await service.cardLine(db, values.employee_target_id, actor, actor.scope)).filter((r) => r.label), ...(await linkNames(values, actor, db))],
      records: (values, actor, db) => (db ? service.cardScorecard(db, values.scorecard_id, actor, actor.scope) : []),
      check: (client, values, actor) => service.assertCardEditable(client, values.scorecard_id, actor, actor.scope, values.employee_target_id),
      run: (values, actor) => service.changeLine(actor, actor.scope, values),
      readback: cardLine("line saved"),
      labels: { scorecard_id: "Scorecard", employee_target_id: "Line", ...LINE_LABELS },
    },
    {
      key: "scorecards.edit",
      label: "Change Reviewer",
      description: "Change who reviews a scorecard (named by its person), with the reason; Operations & People change a reviewer, and nobody reviews themself",
      input: c.targets.ScorecardChange,
      permission: ["performance", "edit"],
      risk: "standard",
      form: "none: Change Reviewer is opened on its scorecard and never names it; the card names the scorecard",
      fields: ["scorecard_id", "reviewer_employee_id", "reviewer_reason"],
      picks: { reviewer_employee_id: "colleague" },
      // Whose scorecard, who reviews it and why, asked first when not said (decision 34).
      asks: [
        { field: "scorecard_id", question: "Whose scorecard is it?", options: ({ actor, db }) => service.scorecardChoices(db, actor, actor.scope) },
        { field: "reviewer_employee_id", question: "Who should review it?", read: "colleagues.list" },
        { field: "reviewer_reason", question: "Why change the reviewer?", when: "reviewer_employee_id" },
      ],
      resolve: { scorecard_id: (value, actor, db) => service.scorecardIdOf(db, value, actor, actor.scope) },
      names: (values, _actor, db) => goals.cardNames(db, { employees: [values.reviewer_employee_id] }),
      records: (values, actor, db) => (db ? service.cardScorecard(db, values.scorecard_id, actor, actor.scope) : []),
      check: async (client, values, actor) => {
        await service.assertCardScorecard(client, values.scorecard_id, actor, actor.scope);
      },
      // The same function Change Reviewer calls: a reviewer changes with performance.manage alone (its own rule).
      run: (values, actor) => {
        const { scorecard_id: id, ...changes } = values;
        return service.update(actor, actor.scope, id, changes);
      },
      readback: cardLine("reviewer changed"),
      labels: { scorecard_id: "Scorecard", reviewer_employee_id: "Reviewer", reviewer_reason: "Reason" },
    },
  ],
  // The forms' own schemas, each reached through a card that names its scorecard (gate 23, praxis-ai.md decision 33).
  not_offered: {
    ScorecardCreate: "via scorecards.create: New Scorecard's own form, whose Copy From also takes a colleague's scorecard; the card is ScorecardDraft",
    ScorecardLinesSave: "via scorecards.add_line: Edit Lines saves every line of its scorecard at once; the cards add or change one, ScorecardLineAdd and ScorecardLineChange",
    ScorecardEdit: "via scorecards.edit: Change Reviewer's own form, which never names its scorecard; the card is ScorecardChange",
  },
  reads: [
    {
      key: "scorecards.list",
      description: "List scorecards in my scope: person, department, reviewer, status, score to date and rating",
      params: c.targets.ScorecardListQuery,
      permission: ["performance", "view"],
      run: (_client, params, actor) => service.list(params, actor.scope),
      cite: (row) => ({ type: "scorecard", id: row.scorecard_id, label: `${row.employee.display_name}, ${row.period_name}` }),
    },
    {
      key: "commitments.list",
      description: "List a month's commitments in my scope: who, what, original date, date now and state (due, on time, late, missed, rescoped)",
      params: c.targets.CommitmentListQuery,
      permission: ["performance", "view"],
      run: (_client, params, actor) => commitments.list({ ...params, waiting_on_me: undefined }, actor.scope),
      cite: (row) => ({ type: "task", id: row.task_id, label: `${row.number} ${row.title}` }),
    },
  ],
  routes: [
    { intent: "open a scorecard", screen: "performance.targets" },
    { intent: "draft a scorecard", screen: "performance.targets", params: { new: "1" } },
  ],
});
