"use strict";
/**
 * What the assistant may read and do about goals: the OKR tree (a function's or the company's objectives
 * and key results with their latest status and score), what a key result rolls up to, 25 at a
 * time, and a quarter's Performance Analytics in the asker's scope, scores and counts only
 * (docs/guides/performance.md §8, §9). It reads only what the asker reads on Goals (§6.23): their
 * department's, what is shared with them, the key results they own; the whole plan for the CEO and Management.
 *
 * goals.summary counts the quarter (docs/guides/praxis-ai.md §6.13): key results by status, the
 * scores by function and month, the ratings at the latest closed round; figures, never rows, within
 * the same reach and scope as Analytics.
 *
 * As cards the person confirms (praxis-ai.md §6.11, decisions 33 and 40), every form of Goals: a
 * quarter set up and changed, an organisational goal recorded, changed and shared, a company
 * objective shared, an objective and a key result set and changed, Request To Unbind and Change
 * Target, each through the service function the screen's own button calls, held to the capability
 * its route holds. A record named by its words is matched among the person's own (goals.service,
 * goals.okrs). It never reports a month or confirms a score: those stay on Goals.
 */
const c = require("@mycity/contract");
const { defineManifest } = require("../../shared/ai/manifest");
const routeMap = require("../../shared/route-map");
const lagos = require("../../shared/time/lagos");
const { formatMonth } = require("../../shared/time/day-first");
const { quantityOf } = require("../../shared/ai/named");
const okrs = require("./goals.okrs");
const analytics = require("./goals.analytics");
const service = require("./goals.service");
const share = require("./goals.share");

const goalsLink = () => routeMap.screenPath("performance", "goals");
const linkOf = (type, id) => (routeMap.linkFor(type, id) || {}).path || goalsLink();
/** The people a key result card holds, by name. */
const owners = (values, db) => service.cardNames(db, { employees: [values.accountable_employee_id, values.co_accountable_employee_id] });
/**
 * The questions Performance's cards ask when the person did not say (praxis-ai.md decision 34),
 * each with the person's own records to tap, matched by the resolvers below.
 */
const whichQuarter = (question = "Which quarter?") => ({ field: "performance_period_id", question, options: ({ db }) => service.periodChoices(db, { open: true }) });
const whichGoal = { field: "organisational_goal_id", question: "Which goal?", options: ({ actor, db }) => service.goalChoices(db, actor) };
/** Share With, and the departments only for a share with chosen departments, matched by name. */
const shareAsks = [
  { field: "audience", question: "Who should see it?", choices: ["All Staff", "Departments"] },
  { field: "department_ids", question: "Which departments?", when: { field: "audience", not: ["all_staff"] }, options: ({ db }) => service.departmentChoices(db) },
];
const byDepartment = (value, _actor, db) => service.departmentIdOf(db, value);
/** This plan year and the next, as a person names them. */
const planYears = ({ today }) => [today.slice(0, 4), String(Number(today.slice(0, 4)) + 1)];
/** This month and the next, as a person reads them ("November 2026"). */
const monthsFrom = ({ today }) => [0, 1].map((n) => formatMonth(lagos.addMonths(`${today.slice(0, 7)}-01`, n)));

/** Share Goal's and Share Objective's audience as the form sends it. */
const shareBody = (values) => ({ audience: values.audience === "all_staff" ? "all" : "departments", department_ids: values.department_ids || [] });
/** Set Key Result's and Save Key Result's fields, as the form shows them (Feeds and Scored From stay on it). */
const KEY_RESULT_FIELDS = ["statement", "measure", "target_value", "unit", "target_text", "starts_on", "finishes_on", "kr_type", "accountable_employee_id", "co_accountable_employee_id", "direction", "baseline_text", "accountable_note"];
const KEY_RESULT_LABELS = {
  statement: "Key Result",
  measure: "Measure",
  target_value: "Target",
  unit: "Unit",
  target_text: "Target in Words",
  starts_on: "Start",
  finishes_on: "Finish",
  kr_type: "Type",
  accountable_employee_id: "Owner",
  co_accountable_employee_id: "Co-Owner",
  direction: "Direction",
  baseline_text: "Baseline",
  accountable_note: "Owner Note",
};

module.exports = defineManifest({
  module: "performance",
  actions: [
    {
      key: "quarters.create",
      label: "Set Up Quarter",
      description: "Set up a quarter: its first day (1 January, April, July or October), its name and Planning or Active; its scoring rules are the last quarter's",
      input: c.goals.PeriodCreate,
      permission: ["performance", "create"],
      capability: "performance.manage",
      risk: "standard",
      // Set Up Quarter's first step; the rules' steps start as the last quarter's and are changed on Goals.
      fields: ["starts_on", "name", "status"],
      asks: [{ field: "starts_on", question: "Which quarter does it start?" }],
      run: (values, actor) => service.createPeriod(actor, values),
      readback: (p) => [{ type: "performance_period", id: p.performance_period_id, label: p.name, status: "set up", link: goalsLink() }],
      labels: { starts_on: "Starts", name: "Name", status: "Status" },
    },
    {
      key: "quarters.edit",
      label: "Save Quarter",
      description: "Change a quarter's name or move it on to Active or Closed: the quarter by its name (Q4 2026) or this, next or last quarter; only what changes",
      input: c.goals.PeriodChange,
      permission: ["performance", "edit"],
      capability: "performance.manage",
      risk: "standard",
      form: "none: Edit Quarter is opened on its quarter and never names it, and its rules sit on steps of their own; the card names the quarter",
      fields: ["performance_period_id", "name", "status"],
      asks: [whichQuarter()],
      resolve: { performance_period_id: (value, _actor, db) => service.periodIdOf(db, value) },
      records: (values, _actor, db) => (db ? service.cardPeriod(db, values.performance_period_id) : []),
      check: (client, values) => service.assertCardPeriod(client, values.performance_period_id),
      run: (values, actor) => {
        const { performance_period_id: id, ...changes } = values;
        return service.updatePeriod(actor, id, changes);
      },
      readback: (p) => [{ type: "performance_period", id: p.performance_period_id, label: p.name, status: "saved", link: goalsLink() }],
      labels: { performance_period_id: "Quarter", name: "Name", status: "Status" },
    },
    {
      key: "goals.create",
      label: "Record Goal",
      description: "Record an organisational goal for a plan year: the goal, its strategic theme, success measure and baseline; its ID is given",
      input: c.goals.OrganisationalGoalCreate,
      permission: ["performance", "create"],
      capability: "goals.organisation",
      risk: "standard",
      // New Goal's own fields; the quarters' targets are written on Edit Goal.
      fields: ["title", "strategic_theme", "success_measure", "baseline", "plan_year_starts_on"],
      resolve: { plan_year_starts_on: (value) => service.planYearOf(value) },
      asks: [
        { field: "title", question: "What is the goal?" },
        { field: "plan_year_starts_on", question: "Which plan year is it for?", choices: planYears },
      ],
      run: (values, actor) => service.createGoal(actor, values),
      readback: (g) => [{ type: "organisational_goal", id: g.organisational_goal_id, label: `${g.code || ""} ${g.title}`.trim(), status: "recorded", link: linkOf("organisational_goal", g.organisational_goal_id) }],
      labels: { title: "Goal", strategic_theme: "Strategic Theme", success_measure: "Success Measure", baseline: "Baseline", plan_year_starts_on: "Plan Year" },
    },
    {
      key: "goals.edit",
      label: "Save Goal",
      description: "Change an organisational goal (its ID such as ORG-2026-03, or its words): its title, its description, or one quarter's target in words; only what changes",
      input: c.goals.OrganisationalGoalChange,
      permission: ["performance", "edit"],
      capability: "goals.organisation",
      risk: "standard",
      form: "none: Edit Goal is opened on its goal's sheet and never names it; the card names the goal and the quarter whose target it writes",
      fields: ["organisational_goal_id", "title", "detail", "performance_period_id", "target_text"],
      // A quarter's target is written for a quarter: asked only with one (the schema's Name the quarter).
      asks: [whichGoal, { ...whichQuarter("Which quarter's target is it?"), when: "target_text" }],
      resolve: {
        organisational_goal_id: (value, actor, db) => service.goalIdOf(db, value, actor),
        performance_period_id: (value, _actor, db) => service.periodIdOf(db, value),
      },
      names: (values, _actor, db) => service.cardNames(db, { periods: [values.performance_period_id] }),
      records: (values, actor, db) => (db ? service.cardGoal(db, values.organisational_goal_id, actor) : []),
      check: (client, values) => service.assertCardGoal(client, values.organisational_goal_id, values.performance_period_id),
      run: (values, actor) => service.changeGoal(actor, values),
      readback: (g) => [{ type: "organisational_goal", id: g.organisational_goal_id, label: `${g.code || ""} ${g.title}`.trim(), status: "saved", link: linkOf("organisational_goal", g.organisational_goal_id) }],
      labels: { organisational_goal_id: "Goal", title: "Title", detail: "Description", performance_period_id: "Quarter", target_text: "Target" },
    },
    {
      key: "goals.share",
      label: "Share Goal",
      description: "Share an organisational goal with all staff (audience all_staff) or chosen departments, who read it and cannot change it",
      input: c.goals.GoalShareChange,
      permission: ["performance", "edit"],
      capability: "goals.organisation",
      risk: "standard",
      form: "none: Share Goal is opened on its goal and never names it; the card names the goal",
      picks: { department_ids: "department" },
      asks: [whichGoal, ...shareAsks],
      resolve: { organisational_goal_id: (value, actor, db) => service.goalIdOf(db, value, actor), department_ids: byDepartment },
      names: (values, _actor, db) => service.cardNames(db, { departments: values.department_ids }),
      records: (values, actor, db) => (db ? service.cardGoal(db, values.organisational_goal_id, actor) : []),
      check: (client, values) => share.assertCardItem(client, "goal", values.organisational_goal_id),
      run: (values, actor) => share.saveGoal(actor, values.organisational_goal_id, shareBody(values)),
      readback: (s) => [{ type: "organisational_goal", id: s.organisational_goal_id, label: "Goal shared", status: "shared", link: linkOf("organisational_goal", s.organisational_goal_id) }],
      labels: { organisational_goal_id: "Goal", audience: "Share With", department_ids: "Departments" },
    },
    {
      key: "objectives.share",
      label: "Share Objective",
      description: "Share a company objective (its code or words) with all staff (audience all_staff) or chosen departments; a function's objective is never shared",
      input: c.goals.ObjectiveShareChange,
      permission: ["performance", "edit"],
      capability: "goals.company",
      risk: "standard",
      form: "none: Share Objective is opened on its objective and never names it; the card names the objective",
      picks: { department_ids: "department" },
      asks: [{ field: "okr_objective_id", question: "Which objective?", options: ({ actor, db }) => okrs.objectiveChoices(db, actor, { company: true }) }, ...shareAsks],
      resolve: { okr_objective_id: (value, actor, db) => okrs.objectiveIdOf(db, value, actor), department_ids: byDepartment },
      names: (values, _actor, db) => service.cardNames(db, { departments: values.department_ids }),
      records: (values, actor, db) => (db ? okrs.cardObjective(db, values.okr_objective_id, actor) : []),
      check: (client, values) => share.assertCardItem(client, "objective", values.okr_objective_id),
      run: (values, actor) => share.saveObjective(actor, values.okr_objective_id, shareBody(values)),
      readback: (s) => [{ type: "objective", id: s.okr_objective_id, label: "Objective shared", status: "shared", link: linkOf("objective", s.okr_objective_id) }],
      labels: { okr_objective_id: "Objective", audience: "Share With", department_ids: "Departments" },
    },
    {
      key: "objectives.create",
      label: "Set Objective",
      description: "Set an objective in a quarter's plan: the quarter, the function (none for a company objective), the objective and the organisational goal it serves",
      input: c.goals.ObjectiveCreate,
      permission: ["performance", "create"],
      // As the route: POST /performance/objectives asks requireAnyCapability(["goals.company", "goals.function"]).
      capabilities: ["goals.company", "goals.function"],
      risk: "standard",
      fields: ["performance_period_id", "department_id", "title", "organisational_goal_id"],
      picks: { department_id: "department" },
      resolve: {
        performance_period_id: (value, _actor, db) => service.periodIdOf(db, value),
        department_id: (value, _actor, db) => service.departmentIdOf(db, value),
        organisational_goal_id: (value, actor, db) => service.goalIdOf(db, value, actor),
      },
      asks: [{ field: "title", question: "What is the objective?" }, whichQuarter("Which quarter is it for?")],
      names: async (values, actor, db) => [
        ...(await service.cardNames(db, { periods: [values.performance_period_id], departments: [values.department_id] })),
        ...(await service.cardGoal(db, values.organisational_goal_id, actor)).filter((r) => r.label),
      ],
      // The same function Set Objective calls: whoever sets that function's goals, its plan open (§6.3).
      run: (values, actor) => okrs.createObjective(actor, values),
      readback: (o) => [{ type: "objective", id: o.okr_objective_id, label: `${o.code} ${o.title}`, status: "set", link: linkOf("objective", o.okr_objective_id) }],
      labels: { performance_period_id: "Quarter", department_id: "Function", title: "Objective", organisational_goal_id: "Organisational Goal" },
    },
    {
      key: "objectives.edit",
      label: "Save Objective",
      description: "Change an objective (its code such as BM-O2, or its words) while its plan is open: its words or the organisational goal it serves; only what changes",
      input: c.goals.ObjectiveChange,
      permission: ["performance", "edit"],
      capabilities: ["goals.company", "goals.function"],
      risk: "standard",
      form: "none: Edit Objective is opened on its objective and never names it; the card names the objective",
      fields: ["okr_objective_id", "title", "organisational_goal_id"],
      asks: [{ field: "okr_objective_id", question: "Which objective?", options: ({ actor, db }) => okrs.objectiveChoices(db, actor, { editable: true }) }],
      resolve: {
        okr_objective_id: (value, actor, db) => okrs.objectiveIdOf(db, value, actor),
        organisational_goal_id: (value, actor, db) => service.goalIdOf(db, value, actor),
      },
      names: async (values, actor, db) => (await service.cardGoal(db, values.organisational_goal_id, actor)).filter((r) => r.label),
      records: (values, actor, db) => (db ? okrs.cardObjective(db, values.okr_objective_id, actor) : []),
      check: (client, values, actor) => okrs.assertCardObjective(client, values.okr_objective_id, actor),
      run: (values, actor) => {
        const { okr_objective_id: id, ...changes } = values;
        return okrs.updateObjective(actor, id, changes);
      },
      readback: (o) => [{ type: "objective", id: o.okr_objective_id, label: `${o.code} ${o.title}`, status: "saved", link: linkOf("objective", o.okr_objective_id) }],
      labels: { okr_objective_id: "Objective", title: "Objective Words", organisational_goal_id: "Organisational Goal" },
    },
    {
      key: "key_results.create",
      label: "Set Key Result",
      description: "Set a key result on an objective (its code or words): the statement, measure, target, unit, dates, type, owner and co-owner; at most four to an objective",
      input: c.goals.KeyResultCreate,
      permission: ["performance", "create"],
      capabilities: ["goals.company", "goals.function"],
      risk: "standard",
      fields: ["okr_objective_id", ...KEY_RESULT_FIELDS],
      picks: { accountable_employee_id: "colleague", co_accountable_employee_id: "colleague" },
      resolve: { okr_objective_id: (value, actor, db) => okrs.objectiveIdOf(db, value, actor), target_value: (value) => quantityOf(value) },
      asks: [
        { field: "statement", question: "What is the key result?" },
        { field: "okr_objective_id", question: "Which objective is it for?", options: ({ actor, db }) => okrs.objectiveChoices(db, actor, { editable: true }) },
      ],
      names: async (values, actor, db) => [...(await owners(values, db)), ...(await okrs.cardObjective(db, values.okr_objective_id, actor)).filter((r) => r.label)],
      run: (values, actor) => okrs.createKeyResult(actor, values),
      readback: (k) => [{ type: "key_result", id: k.okr_key_result_id, label: `${k.code} ${k.statement}`, status: "set", link: linkOf("key_result", k.okr_key_result_id) }],
      labels: { okr_objective_id: "Objective", ...KEY_RESULT_LABELS },
    },
    {
      key: "key_results.edit",
      label: "Save Key Result",
      description: "Change a key result (its code such as BM-KR2.1, or its words) while its plan is open: any field of Edit Key Result; only what changes",
      input: c.goals.KeyResultChange,
      permission: ["performance", "edit"],
      risk: "standard",
      form: "none: Edit Key Result is opened on its key result's panel and never names it; the card names the key result",
      fields: ["okr_key_result_id", ...KEY_RESULT_FIELDS],
      picks: { accountable_employee_id: "colleague", co_accountable_employee_id: "colleague" },
      // The key results of a plan still open to change: a binding one's target changes through Change Target.
      asks: [{ field: "okr_key_result_id", question: "Which key result?", options: ({ actor, db }) => okrs.keyResultChoices(db, actor, { editable: true }) }],
      resolve: { okr_key_result_id: (value, actor, db) => okrs.keyResultIdOf(db, value, actor), target_value: (value) => quantityOf(value) },
      names: (values, _actor, db) => owners(values, db),
      records: (values, actor, db) => (db ? okrs.cardKeyResult(db, values.okr_key_result_id, actor) : []),
      check: (client, values, actor) => okrs.assertCardKeyResult(client, values.okr_key_result_id, actor),
      run: (values, actor) => {
        const { okr_key_result_id: id, ...changes } = values;
        return okrs.updateKeyResult(actor, id, changes);
      },
      readback: (k) => [{ type: "key_result", id: k.okr_key_result_id, label: `${k.code} ${k.statement}`, status: "saved", link: linkOf("key_result", k.okr_key_result_id) }],
      labels: { okr_key_result_id: "Key Result", ...KEY_RESULT_LABELS, statement: "Statement" },
    },
    {
      key: "plans.unbind",
      label: "Request To Unbind",
      description: "Ask the CEO to unbind a binding plan of this quarter, named by its function (or the company), with the reason",
      input: c.goals.PlanUnbindRequest,
      permission: ["performance", "create"],
      capabilities: ["goals.company", "goals.function"],
      risk: "standard",
      form: "none: Request To Unbind is asked from the plan it sits on and never names it; the card names the plan",
      resolve: { performance_plan_id: (value, actor, db) => service.planIdOf(db, value, actor) },
      asks: [
        { field: "performance_plan_id", question: "Which plan?", options: ({ actor, db }) => service.planChoices(db, actor) },
        { field: "reason", question: "Why should it be unbound?" },
      ],
      records: (values, _actor, db) => (db ? service.cardPlan(db, values.performance_plan_id) : []),
      check: async (client, values, actor) => {
        await service.assertUnbindable(client, actor, values.performance_plan_id);
      },
      run: (values, actor) => service.requestUnbind(actor, values.performance_plan_id, { reason: values.reason }),
      readback: (u) => [{ type: "plan_unbind", id: u.plan_unbind_id, label: "Unbind requested", status: "sent to the CEO", link: linkOf("plan_unbind", u.plan_unbind_id) }],
      labels: { performance_plan_id: "Plan", reason: "Reason" },
    },
    {
      key: "target_changes.request",
      label: "Change Target",
      description:
        "Ask the CEO to change a binding target: a key result (its code) or a scorecard line (as Ada Obi: Stories published), the new target, its words, the month it applies from and why",
      input: c.goals.TargetChangeCreate,
      permission: ["performance", "edit"],
      risk: "standard",
      resolve: {
        okr_key_result_id: (value, actor, db) => okrs.keyResultIdOf(db, value, actor),
        employee_target_id: (value, actor, db) => require("../targets/targets.service").lineIdOf(db, value, actor, actor.scope),
        // A month named by its words ("next month", "December 2026") as its first day.
        from_month: (value) => require("../reviews/reviews.cycle").monthOf(value),
        // The new target as the person said it ("40 stories"): its number.
        to_value: (value) => quantityOf(value),
      },
      asks: [
        { field: "reason", question: "Why change the target?" },
        { field: "from_month", question: "From which month?", choices: monthsFrom },
      ],
      records: (values, actor, db) => (db ? service.cardChangeRecords(db, values, actor, actor.scope) : []),
      // requestChange's own rules, run again at the press: a live target, the right person, nothing waiting.
      check: async (client, values, actor) => {
        await service.assertChangeable(client, actor, values);
      },
      run: (values, actor) => service.requestChange(actor, actor.scope, values),
      readback: (t) => [{ type: "target_change", id: t.target_change_id, label: "Target change", status: "sent to the CEO", link: linkOf("target_change", t.target_change_id) }],
      labels: { okr_key_result_id: "Key Result", employee_target_id: "Line", to_value: "New Target", to_text: "Target in Words", from_month: "From Month", reason: "Reason" },
    },
  ],
  // The forms' own schemas, each reached through the card that names its record (gate 23, praxis-ai.md decision 33).
  not_offered: {
    PeriodEdit: "via quarters.edit: Edit Quarter's own form, which never names its quarter; the card is PeriodChange",
    OrganisationalGoalEdit: "via goals.edit: Edit Goal's own form, which never names its goal; the card is OrganisationalGoalChange",
    GoalShareSave: "via goals.share: Share Goal's and Share Objective's own form, which never names what it shares; the cards are GoalShareChange and ObjectiveShareChange",
    ObjectiveEdit: "via objectives.edit: Edit Objective's own form, which never names its objective; the card is ObjectiveChange",
    KeyResultEdit: "via key_results.edit: Edit Key Result's own form, which never names its key result; the card is KeyResultChange",
    PlanUnbindCreate: "via plans.unbind: Request To Unbind's own form, which never names its plan; the card is PlanUnbindRequest",
  },
  summaries: [
    {
      key: "goals.summary",
      description: "A quarter's performance figures: key results by status, the company's and each function's score by month, ratings at the latest closed round",
      params: c.goals.PerformanceSummaryQuery,
      permission: ["performance", "view"],
      run: (client, params, actor) => analytics.aiSummary(params, actor.scope, { db: client, actor }),
    },
  ],
  reads: [
    {
      key: "goals.okrs",
      summary: "goals.summary",
      description: "List a quarter's objectives with their key results, owners, latest status and score; the company's or a function's",
      params: c.goals.OkrListQuery,
      permission: ["performance", "view"],
      run: (_client, params, actor) => okrs.listOkrs(params, actor),
      cite: (row) => ({ type: "objective", id: row.okr_objective_id, label: `${row.code} ${row.title}` }),
    },
    {
      key: "goals.trace",
      summary: "none: one key result's chain",
      description: "What a key result rolls up to: the company key result, the objective and the organisational goal",
      params: c.goals.TraceQuery,
      permission: ["performance", "view"],
      run: async (_client, params, actor) => {
        const t = await okrs.trace(params.okr_key_result_id, actor);
        return { data: t.steps, page: { number: 1, size: 25, total: t.steps.length, pages: 1, has_next: false } };
      },
      cite: (row) => ({ type: row.kind === "organisational_goal" ? "organisational_goal" : row.kind === "objective" ? "objective" : "key_result", id: row.id, label: `${row.code || ""} ${row.title}`.trim() }),
    },
    {
      key: "goals.analytics",
      summary: "goals.summary",
      description:
        "A quarter's analytics: function scores by month, key results by status, ratings, on-time check-ins, reviews and commitments, self against final",
      params: c.goals.PerformanceAnalyticsQuery,
      permission: ["performance", "view"],
      run: (client, params, actor) => analytics.figures(params, actor.scope, { db: client, actor }),
      // Aggregates: nothing to open. The people behind them are scorecards.list (targets.ai.js).
      cite: () => null,
    },
  ],
  routes: [
    { intent: "see the quarter's OKRs", screen: "performance.goals" },
    { intent: "report the month", screen: "performance.goals", params: { report: "1" } },
    { intent: "see performance analytics", screen: "performance.analytics" },
  ],
});
