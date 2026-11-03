"use strict";
/**
 * What the assistant may read and do about reviews: their stages and scores within the asker's own
 * `performance` scope and the reviews that name them, 25 at a time (docs/guides/performance.md §9).
 * Never a check-in's actions, evidence or transcripts, a reviewer's comments, a dotted manager's
 * input, conduct or an improvement plan. reviews.summary counts the same reviews by stage, rating,
 * department or round (figures, never rows, docs/guides/praxis-ai.md §6.13).
 *
 * As cards the person confirms (praxis-ai.md §6.11, decisions 33 and 40): Open Round; a line of the
 * person's own check-in, saved to the draft; a line of a review they score; and an improvement plan
 * started or changed, the last three in the person's own words, never read from a record. Scores
 * and plans are risk `approval`, so each press asks Confirm It's You (decision 40). Each runs the
 * service function the screen's own button calls.
 */
const c = require("@mycity/contract");
const { defineManifest } = require("../../shared/ai/manifest");
const routeMap = require("../../shared/route-map");
const lagos = require("../../shared/time/lagos");
const { formatMonth } = require("../../shared/time/day-first");
const goals = require("../goals/goals.service");
const cycle = require("./reviews.cycle");
const pip = require("./reviews.pip");
const service = require("./reviews.service");

const reviewLink = (id, self = false) => (routeMap.linkFor("review", id, { self }) || {}).path || null;
/** The two months before this one, as a person reads them ("October 2026"): a round opens once its month has ended. */
const endedMonths = ({ today }) => [-1, -2].map((n) => formatMonth(lagos.addMonths(`${today.slice(0, 7)}-01`, n)));
const planLink = (id) => (routeMap.linkFor("improvement_plan", id) || {}).path || null;

/** A task named as a check-in's evidence, by its number and title, when it is on the person's board (as the Task picker lists it). */
async function evidenceTask(db, taskId, actor) {
  if (!taskId) return [];
  const scope = await require("../../middleware/rbac").scopeFor(actor, "workspace", "view");
  if (!scope) return [];
  return (await require("../tasks/tasks.service").cardRecords(db, [taskId], scope)).filter((r) => r.label);
}

module.exports = defineManifest({
  module: "performance",
  actions: [
    {
      key: "rounds.open",
      label: "Open Round",
      description: "Open a month's review round by hand, once the month has ended: the quarter and the month",
      input: c.reviews.RoundCreate,
      permission: ["performance", "create"],
      capability: "performance.manage",
      risk: "standard",
      // The quarter and the month, asked first when not said (praxis-ai.md decision 34).
      asks: [
        { field: "performance_period_id", question: "Which quarter?", options: ({ db }) => goals.periodChoices(db, { open: true }) },
        { field: "month", question: "Which month is it for?", choices: endedMonths },
      ],
      resolve: {
        performance_period_id: (value, _actor, db) => goals.periodIdOf(db, value),
        month: (value) => cycle.monthOf(value),
      },
      names: (values, _actor, db) => goals.cardNames(db, { periods: [values.performance_period_id] }),
      run: (values, actor) => cycle.createRound(actor, values),
      readback: (r) => [{ type: "performance_cycle", id: r.performance_cycle_id, label: r.name, status: "opened", link: routeMap.screenPath("performance", "reviews") }],
      labels: { performance_period_id: "Quarter", month: "Month" },
    },
    {
      key: "reviews.score",
      label: "Save Score",
      description: "Score one line of a review I review (by its person; the line by its words): final score, reason when it differs, comment, and a corrective action with owner and due date",
      input: c.reviews.ReviewScoreChange,
      // The route asks `performance` view and the service the reviewer; an action's grant is never view.
      permission: ["performance", "edit"],
      risk: "approval",
      form: "none: Score Review holds every line of its review and never names the review; the card names the review and one line",
      picks: { corrective_owner_id: "colleague" },
      // Whose review and which line, the reviews waiting on the person to tap; an action's words when
      // it names an owner, and its due day when it is written (decision 34).
      asks: [
        { field: "performance_review_id", question: "Whose review is it?", options: ({ actor, db }) => service.reviewChoices(db, actor, actor.scope) },
        { field: "performance_review_item_id", question: "Which line?", options: ({ actor, db, values }) => service.reviewItemChoices(db, values.performance_review_id, actor, actor.scope) },
        { field: "corrective_title", question: "What is the corrective action?", when: "corrective_owner_id" },
        { field: "corrective_due_on", question: "When is the action due?", when: "corrective_title", choices: ["Next Friday", "In Two Weeks"] },
      ],
      resolve: {
        performance_review_id: (value, actor, db) => service.reviewIdOf(db, value, actor, actor.scope),
        performance_review_item_id: (value, _actor, db, values) => service.reviewItemIdOf(db, values.performance_review_id, value),
      },
      names: async (values, actor, db) => [
        ...(await service.cardItem(db, values.performance_review_id, values.performance_review_item_id, actor, actor.scope)),
        ...(await goals.cardNames(db, { employees: [values.corrective_owner_id] })),
      ],
      records: (values, actor, db) => (db ? service.cardReview(db, values.performance_review_id, actor, actor.scope) : []),
      check: (client, values, actor) => service.assertCardScore(client, values, actor, actor.scope),
      // Save Scores' own function, every other line and action as it stands.
      run: (values, actor) => service.saveScore(actor, actor.scope, values),
      readback: (r) => [{ type: "review", id: r.performance_review_id, label: `${r.employee.display_name}, ${r.round_name || "Probation"}`, status: "score saved", link: reviewLink(r.performance_review_id) }],
      labels: {
        performance_review_id: "Review",
        performance_review_item_id: "Line",
        score: "Final Score",
        override_reason: "Reason",
        comment: "Comment",
        corrective_title: "Corrective Action",
        corrective_owner_id: "Owner",
        corrective_due_on: "Due Date",
      },
    },
    {
      key: "check_ins.save",
      label: "Save Check-In",
      description: "Fill one line of my open check-in (the line by its words): actual, day delivered, action, my score and reason, and a link, source or task as evidence; saved to the draft",
      input: c.reviews.CheckInLineChange,
      // My Performance's route is the person's own (self); the card is held to ESS as Request Leave's is.
      permission: ["ess", "create"],
      risk: "standard",
      form: "none: My Performance's check-in holds every line at once and is the person's own; the card names one line, and a file and Submit Check-In stay on the screen",
      picks: { evidence_task_id: "task" },
      asks: [{ field: "performance_review_item_id", question: "Which line is it?", options: ({ actor, db }) => service.checkInItemChoices(db, actor) }],
      resolve: { performance_review_item_id: (value, actor, db) => service.checkInItemIdOf(db, value, actor) },
      names: async (values, actor, db) => [...(await service.cardCheckInLine(db, values.performance_review_item_id, actor)), ...(await evidenceTask(db, values.evidence_task_id, actor))],
      records: (values, actor, db) => (db ? service.cardCheckIn(db, values.performance_review_item_id, actor) : []),
      check: (client, values, actor) => service.assertCardCheckIn(client, values.performance_review_item_id, actor),
      // Save Draft's own function, with this line alone: every other line stays as it is.
      run: (values, actor) => service.saveCheckInLine(actor, values),
      readback: (r) => [{ type: "review", id: r.performance_review_id, label: `My check-in, ${r.round_name || "Probation"}`, status: "saved to the draft", link: reviewLink(r.performance_review_id, true) }],
      labels: {
        performance_review_item_id: "Line",
        actual_value: "Actual",
        actual_text: "Actual in Words",
        achieved_on: "Delivered On",
        action_text: "Action",
        self_score: "Your Score",
        self_reason: "Reason",
        evidence_url: "Link",
        evidence_note: "Source",
        evidence_task_id: "Task",
      },
    },
    {
      key: "pips.start",
      label: "Start PIP",
      description: "Start an improvement plan from a closed review rated Below (by its person): start, end and review dates, summary, and lines in words, else the lines scored under target",
      input: c.reviews.PipStart,
      permission: ["performance", "create"],
      capability: "performance.manage",
      risk: "approval",
      form: "none: Start PIP is opened on its review and never names it, and its lines are filled from the review; the card names the review",
      asks: [
        { field: "performance_review_id", question: "Whose review is it from?", options: ({ actor, db }) => service.reviewChoices(db, actor, actor.scope, { status: "closed", rating: "below" }) },
        { field: "starts_on", question: "When does the plan start?", choices: ["Today", "Next Monday"] },
      ],
      resolve: { performance_review_id: (value, actor, db) => service.reviewIdOf(db, value, actor, actor.scope, { status: "closed", rating: "below" }) },
      records: (values, actor, db) => (db ? service.cardReview(db, values.performance_review_id, actor, actor.scope) : []),
      run: (values, actor) => pip.startFromCard(actor, actor.scope, values),
      readback: (p) => [{ type: "improvement_plan", id: p.improvement_plan_id, label: `${p.employee.display_name}'s plan`, status: "started", link: planLink(p.improvement_plan_id) }],
      labels: { performance_review_id: "Review", starts_on: "Starts On", ends_on: "Ends On", review_on: "Review On", summary: "Summary", lines: "Lines" },
    },
    {
      key: "pips.edit",
      label: "Save PIP",
      description: "Change a running improvement plan (named by its person): its end or review date, its summary, or its lines in words, which replace them; only what changes",
      input: c.reviews.PipChange,
      permission: ["performance", "edit"],
      capability: "performance.manage",
      risk: "approval",
      form: "none: an improvement plan is changed on its review and its form never names it; the card names the plan",
      asks: [{ field: "improvement_plan_id", question: "Whose plan is it?", options: ({ actor, db }) => pip.planChoices(db, actor.scope) }],
      resolve: { improvement_plan_id: (value, actor, db) => pip.idOf(db, value, actor.scope) },
      records: (values, actor, db) => (db ? pip.cardRecords(db, values.improvement_plan_id, actor.scope) : []),
      check: (client, values, actor) => pip.assertCardPip(client, values.improvement_plan_id, actor.scope),
      run: (values, actor) => pip.changeFromCard(actor, actor.scope, values),
      readback: (p) => [{ type: "improvement_plan", id: p.improvement_plan_id, label: `${p.employee.display_name}'s plan`, status: "saved", link: planLink(p.improvement_plan_id) }],
      labels: { improvement_plan_id: "Plan", ends_on: "Ends On", review_on: "Review On", summary: "Summary", lines: "Lines" },
    },
  ],
  // The forms' own schemas, each reached through a card that names its record (gate 23, praxis-ai.md decisions 33 and 40).
  not_offered: {
    ReviewScoresSave: "via reviews.score: Score Review saves every line of its review at once; the card saves one, ReviewScoreChange",
    ReviewCheckInSave: "via check_ins.save: Save Draft saves every line of the check-in at once; the card saves one, CheckInLineChange",
    ReviewCheckInItemSave: "via check_ins.save: one line of Save Draft, its evidence a link, a source or a task; the card is CheckInLineChange",
    PipCreate: "via pips.start: Start PIP's own form, which never names its review; the card is PipStart",
    PipEdit: "via pips.edit: an improvement plan's change, which never names its plan; the card is PipChange",
  },
  summaries: [
    {
      key: "reviews.summary",
      description: "Review counts in my scope: at check-in, with reviewers, second level, with HR, closed, withdrawn, waiting on me, by stage, rating, department or round",
      params: c.reviews.ReviewSummaryQuery,
      permission: ["performance", "view"],
      run: (client, params, actor) => service.aiSummary(client, params, actor, actor.scope),
    },
  ],
  reads: [
    {
      key: "reviews.list",
      description: "List reviews in my scope: person, reviewer, month, stage, due date, score and rating",
      params: c.reviews.ReviewListQuery,
      permission: ["performance", "view"],
      run: (_client, params, actor) => service.list(actor, params, actor.scope),
      cite: (row) => ({ type: "review", id: row.performance_review_id, label: `${row.employee.display_name}, ${row.round_name || "Probation"}` }),
    },
  ],
  routes: [
    { intent: "open a review", screen: "performance.reviews" },
    { intent: "do my check-in", screen: "ess.my-performance", params: { check_in: "1" } },
  ],
});
