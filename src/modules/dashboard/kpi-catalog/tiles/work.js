"use strict";
/**
 * Work cards: overdue tasks, what waits on the reader's approval, the high alerts they may
 * clear, and the quarter's goals and the reader's own scorecard.
 *
 *   tasks                     the tasks source adapter (M2)
 *   approvals waiting on you  the workflow module's own reads (workflow.service mine, mineCount),
 *                             the same as Need You and My Approvals
 *   open high alerts          Home, Alerts' own reads (alerts.service highOpen, highPage): the
 *                             alerts the reader may see, by the one rule the Alerts tab, the alerts
 *                             beside Need You and ⌘K use
 *   goals on track            the goals source adapter (M2): the quarter's key results whose latest
 *                             month is On Track or Done, of all of them (docs/guides/performance.md §6.21)
 *   my scorecard              the goals source adapter: the reader's lines at or above Meets, of
 *                             their scored lines
 */
const workflow = require("../../../workflow/workflow.service");
const alerts = require("../../../alerts/alerts.service");
const tasks = require("../../sources/tasks.source");
const goals = require("../../sources/goals.source");
const visibility = require("../../../goals/goals.visibility");
const { cell, linkTo, record, records } = require("../shared");

const PRIORITY = Object.freeze({ low: "Low", normal: "Normal", high: "High", urgent: "Urgent" });

/** A task behind a card. My Overdue Tasks leaves out whose it is: it is the reader's. */
const taskRecord = ({ assignee = true } = {}) => (r) =>
  record(
    r.task_id,
    {
      task: cell.text(r.title),
      ...(assignee ? { assignee: cell.person(r.assignee) } : {}),
      due: cell.time(r.due_at),
      priority: cell.text(PRIORITY[r.priority] || r.priority),
    },
    linkTo("task", r.task_id),
  );

/** Days an open alert has been open before the card's caption counts it as aged: the Alerts tab's Overdue. */
const AGED_DAYS = alerts.OVERDUE_DAYS;

/**
 * The open high alerts the reader may see, the longest open first: the records behind Open High
 * Alerts. Over By is text in the Alerts tab's words ("+1", "12 days left", Due Today, Expired),
 * so a deadline's days left never shows as a bare signed number.
 */
async function highAlertsPage(client, query, ctx) {
  return records(await alerts.highPage(client, ctx.user, query), (r) =>
    record(
      r.home_alert_id,
      { alert: cell.text(r.title), raised: cell.time(r.raised_at), over_by: cell.text(r.over_by_text) },
      linkTo("home_alert", r.home_alert_id),
    ),
  );
}

/** A key result's latest status, in the Goals tab's words and tones. */
const KR_STATUS = Object.freeze({
  on_track: ["ok", "On Track"],
  done: ["ok", "Done"],
  at_risk: ["warn", "At Risk"],
  off_track: ["err", "Off Track"],
  missed: ["err", "Missed"],
  not_started: ["neutral", "Not Started"],
  awaiting_report: ["neutral", "Awaiting Report"],
});

/** The chips over Goals On Track: each status, in the adapter's order. */
const KR_GROUPS = goals.KR_GROUPS.map((value) => ({ value, label: KR_STATUS[value][1] }));

const SECTION = Object.freeze({ results: "Results", kpis: "KPIs", accountability: "Accountability" });

/** A score from 0 to 1 as people read it, two places. */
const score = (s) => (s === null || s === undefined ? null : Number(s).toFixed(2));

/* ------------------------------------------------------------------ *
 * The cards
 * ------------------------------------------------------------------ */

const ENTRIES = [
  {
    id: "tasks_overdue",
    domain: "work",
    label: "Overdue Tasks",
    unit: "count",
    module: "workspace",
    capability: null,
    sensitive_field: null,
    status: "live",
    pickable: true,
    tone: "warn",
    source: "tasks",
    value: (client, g, ctx) => g.count(() => tasks.overdueCount(client, { now: ctx.now }, ctx.scope("workspace"))),
    detail: {
      title: "Overdue Tasks",
      columns: [
        { key: "task", label: "Task" },
        { key: "assignee", label: "Assignee", phone: true },
        { key: "due", label: "Due", phone: true },
        { key: "priority", label: "Priority" },
      ],
      groups: [],
      list: async (client, query, ctx) =>
        records(await tasks.overduePage(client, { now: ctx.now }, ctx.scope("workspace"), query), taskRecord()),
    },
  },
  {
    id: "my_tasks_overdue",
    domain: "work",
    label: "My Overdue Tasks",
    unit: "count",
    module: "ess",
    capability: null,
    sensitive_field: null,
    status: "live",
    pickable: true,
    tone: "warn",
    source: "tasks",
    value: (client, g, ctx) => g.count(() => tasks.overdueCount(client, { now: ctx.now }, ctx.scope("ess"))),
    detail: {
      title: "My Overdue Tasks",
      columns: [
        { key: "task", label: "Task" },
        { key: "due", label: "Due", phone: true },
        { key: "priority", label: "Priority", phone: true },
      ],
      groups: [],
      list: async (client, query, ctx) =>
        records(
          await tasks.overduePage(client, { now: ctx.now }, ctx.scope("ess"), query),
          taskRecord({ assignee: false }),
        ),
    },
  },
  {
    id: "approvals_awaiting_you",
    domain: "work",
    label: "Awaiting Your Approval",
    unit: "count",
    module: "home",
    capability: null,
    sensitive_field: null,
    status: "live",
    pickable: true,
    tone: null,
    source: "workflow",
    value: (client, g, ctx) =>
      g.figure(async () => {
        const n = await workflow.mineCount(ctx.user);
        return { value: n.waiting, overdue: n.overdue };
      }),
    caption: (f) => (f.overdue > 0 ? `${f.overdue} overdue` : null),
    detail: {
      title: "Awaiting Your Approval",
      columns: [
        { key: "request", label: "Request" },
        { key: "person", label: "Person", phone: true },
        { key: "stage", label: "Stage" },
        { key: "waiting_since", label: "Waiting Since", phone: true },
        { key: "due", label: "Due" },
      ],
      groups: [],
      list: async (client, query, ctx) =>
        records(await workflow.mine(ctx.user, { page: query.page, q: query.q }, client), (r) =>
          record(
            r.workflow_instance_id,
            {
              request: cell.text(r.definition_name),
              person: cell.text(r.subject_name || r.opened_by_name),
              stage: cell.text(r.stage_name),
              waiting_since: cell.time(r.stage_entered_at),
              due: cell.time(r.stage_due_at),
            },
            r.link,
          ),
        ),
    },
  },
  {
    id: "alerts_high_open",
    domain: "work",
    label: "Open High Alerts",
    unit: "count",
    module: "home",
    capability: "alerts.clear",
    sensitive_field: null,
    status: "live",
    pickable: true,
    tone: "err",
    source: "alerts",
    value: (client, g, ctx) => g.figure(() => alerts.highOpen(client, ctx.user, { now: ctx.now })),
    caption: (f) => (f.aged > 0 ? `${f.aged} over ${AGED_DAYS} days` : null),
    detail: {
      title: "Open High Alerts",
      columns: [
        { key: "alert", label: "Alert" },
        { key: "raised", label: "Raised", phone: true },
        { key: "over_by", label: "Over By", phone: true },
      ],
      groups: [],
      list: highAlertsPage,
    },
  },
  {
    id: "goals_on_track",
    domain: "work",
    label: "Goals On Track",
    unit: "pair",
    module: "performance",
    capability: null,
    sensitive_field: null,
    status: "live",
    pickable: true,
    tone: null,
    source: "goals",
    value: (client, g, ctx) =>
      g.ratio(async () => goals.keyResultsOnTrack(client, { today: ctx.today }, await visibility.readerOf(client, ctx.user))),
    detail: {
      title: "Goals On Track",
      summary: (f) => `${f.value} of ${f.denominator} key results on track or done`,
      columns: [
        { key: "key_result", label: "Key Result" },
        { key: "status", label: "Status", phone: true },
        { key: "score", label: "Score", numeric: true, phone: true },
        { key: "owner", label: "Owner" },
      ],
      groups: KR_GROUPS,
      list: async (client, query, ctx) =>
        records(await goals.keyResultsPage(client, { today: ctx.today, group: query.group }, query, await visibility.readerOf(client, ctx.user)), (r) => {
          const [tone, text] = KR_STATUS[r.status || "awaiting_report"];
          return record(
            r.okr_key_result_id,
            {
              key_result: cell.text(`${r.code} ${r.statement}`),
              status: cell.pill(tone, text),
              score: cell.text(score(r.score)),
              owner: cell.person(r.accountable),
            },
            linkTo("key_result", r.okr_key_result_id),
          );
        }),
    },
  },
  {
    id: "my_targets_on_track",
    domain: "work",
    label: "My Scorecard",
    unit: "pair",
    module: "ess",
    capability: null,
    sensitive_field: null,
    status: "live",
    pickable: true,
    tone: null,
    source: "goals",
    value: (client, g, ctx) =>
      g.ratio(() => goals.scorecardFigure(client, { employee_id: ctx.scope("ess").employee_id || ctx.user.employee_id, today: ctx.today })),
    caption: (f) => (f.groups.behind > 0 ? `${f.groups.behind} behind` : null),
    detail: {
      title: "My Scorecard",
      summary: (f) => `${f.value} of ${f.denominator} scored lines at Meets or above`,
      columns: [
        { key: "line", label: "Line" },
        { key: "section", label: "Section" },
        { key: "score", label: "Score", numeric: true, phone: true },
        { key: "weight", label: "Weight", numeric: true, phone: true },
      ],
      groups: [
        { value: "on_track", label: "On Track" },
        { value: "behind", label: "Behind" },
        { value: "not_scored", label: "Not Scored" },
      ],
      list: async (client, query, ctx) =>
        records(
          await goals.scorecardLinesPage(
            client,
            { employee_id: ctx.scope("ess").employee_id || ctx.user.employee_id, today: ctx.today, group: query.group },
            query,
          ),
          (r) =>
            record(
              r.employee_target_id,
              {
                line: cell.text(r.title),
                section: cell.text(SECTION[r.section] || r.section),
                score: r.score === null ? cell.pill("neutral", "Not Scored") : cell.pill(r.on_track ? "ok" : "warn", score(r.score)),
                weight: cell.text(r.weight === null ? null : `${r.weight}%`),
              },
              linkTo("target", r.employee_target_id, { self: true }),
            ),
        ),
    },
  },
];

module.exports = { ENTRIES, AGED_DAYS };
