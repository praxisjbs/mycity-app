"use strict";
/**
 * Work cards: overdue tasks, what waits on the reader's approval, the high alerts they may
 * clear, and the goal cards that wait for M2's progress rule.
 *
 *   tasks                     the tasks source adapter (M2)
 *   approvals waiting on you  the workflow module's own reads (workflow.service mine, mineCount),
 *                             the same as Need You and My Approvals
 *   open high alerts          Home's own home_alert, as the reader may clear them; the same rule
 *                             counts the open alerts beside Need You (openToClear)
 *   goals                     hidden: declared with no query until M2 says what on track means
 */
const workflow = require("../../../workflow/workflow.service");
const tasks = require("../../sources/tasks.source");
const alerts = require("../../../../shared/alerts/alerts");
const rbac = require("../../../../middleware/rbac");
const { pageQuery, orderBy, TOTAL_COL } = require("../../../../shared/http/paged");
const { scopeClause } = require("../../../../shared/rbac/scope");
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

/* ------------------------------------------------------------------ *
 * Open alerts the reader may see
 * ------------------------------------------------------------------ */

/** Days an open alert has been open before the card's caption counts it as aged. */
const AGED_DAYS = 7;
const DAY_MS = 86_400_000;

const OPEN = "a.cleared_at IS NULL";
const OPEN_HIGH = `${OPEN} AND a.severity = 'high'`;

const ALERTS_FROM = `FROM home_alert a
  JOIN home_alert_rule r ON r.home_alert_rule_id = a.home_alert_rule_id`;

/**
 * Which of the alerts `open` keeps the reader may see, as a condition on `a` and `r` that
 * appends its values to `params`, or null when they may see none. An alert is seen by
 * whoever may clear its rule's alerts (the rule's permission_key, as alerts.mayClear() reads
 * it), about a person within their scope on that grant; an alert about no one in particular
 * only with `all` scope. The CEO sees every one.
 * @param {string} [open]  the alerts asked about, a condition on `a`: the open high ones unless told
 */
async function seenWhere(client, user, params, open = OPEN_HIGH) {
  const { rows } = await client.query(`SELECT DISTINCT r.permission_key ${ALERTS_FROM} WHERE ${open}`);
  const parts = [];
  for (const { permission_key: key } of rows) {
    const [module, action] = alerts.parsePermission(key);
    const scope = await rbac.scopeFor(user, module, action);
    if (!scope) continue;
    params.push(key);
    const k = `$${params.length}`;
    const s = scopeClause(scope, { column: "a.subject_employee_id" }, params);
    parts.push(`(r.permission_key = ${k} ${s.and})`);
  }
  return parts.length ? `(${parts.join(" OR ")})` : null;
}

/** The open high alerts the reader may see, and how many of them are older than AGED_DAYS. */
async function highAlerts(client, ctx) {
  const params = [new Date(ctx.now.getTime() - AGED_DAYS * DAY_MS)];
  const seen = await seenWhere(client, ctx.user, params);
  if (!seen) return { value: 0, aged: 0 };
  const { rows } = await client.query(
    `SELECT count(*)::int AS value, count(*) FILTER (WHERE a.raised_at <= $1::timestamptz)::int AS aged
       ${ALERTS_FROM}
      WHERE ${OPEN_HIGH} AND ${seen}`,
    params,
  );
  return rows[0];
}

/**
 * How many open alerts, of any severity, the reader may clear: the alerts beside Need You's
 * requests (HomeOverview `alerts_to_clear`). The caller has checked the reader holds
 * `alerts.clear`; this counts the alerts whose rule's grant reaches them.
 * @param {{query: Function}} client
 * @param {{user_id: string, employee_id: string|null, role_ids: string[], is_ceo?: boolean}} user
 * @returns {Promise<number>}
 */
async function openToClear(client, user) {
  const params = [];
  const seen = await seenWhere(client, user, params, OPEN);
  if (!seen) return 0;
  const { rows } = await client.query(`SELECT count(*)::int AS n ${ALERTS_FROM} WHERE ${OPEN} AND ${seen}`, params);
  return rows[0].n;
}

async function highAlertsPage(client, query, ctx) {
  const params = [query.q || null];
  const seen = await seenWhere(client, ctx.user, params);
  const page = await pageQuery(
    client,
    `SELECT a.home_alert_id, a.title, a.raised_at, a.over_by, ${TOTAL_COL}
       ${ALERTS_FROM}
      WHERE ${OPEN_HIGH} AND ${seen || "false"}
        AND ($1::text IS NULL OR search_fold(a.title) LIKE '%' || search_fold($1) || '%')
      ORDER BY ${orderBy(query, { raised_at: "a.raised_at" }, "a.home_alert_id")}`,
    params,
    query,
  );
  return records(page, (r) =>
    record(
      r.home_alert_id,
      { alert: cell.text(r.title), raised: cell.time(r.raised_at), over_by: cell.number(r.over_by) },
      linkTo("home_alert", r.home_alert_id),
    ),
  );
}

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
    value: (client, g, ctx) => g.figure(() => highAlerts(client, ctx)),
    caption: (f) => (f.aged > 0 ? `${f.aged} over ${AGED_DAYS} days` : null),
    detail: {
      title: "Open High Alerts",
      columns: [
        { key: "alert", label: "Alert" },
        { key: "raised", label: "Raised", phone: true },
        { key: "over_by", label: "Over By", numeric: true, phone: true },
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
    status: "hidden",
    until: "M2",
    pickable: true,
    tone: null,
    source: "goals",
  },
  {
    id: "my_targets_on_track",
    domain: "work",
    label: "My Targets",
    unit: "pair",
    module: "ess",
    capability: null,
    sensitive_field: null,
    status: "hidden",
    until: "M2",
    pickable: true,
    tone: null,
    source: "goals",
  },
];

module.exports = { ENTRIES, AGED_DAYS, openToClear };
