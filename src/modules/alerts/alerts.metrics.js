"use strict";
/**
 * The metrics an alert rule can watch (docs/guides/home.md §6 Alerts): what each reads,
 * from which module, about what, and how its value meets a rule's threshold.
 *
 * The keys, their order, and each metric's category, kind, window and default Who Can Clear
 * are the contract's (packages/contract/schemas/alerts.js HOME_ALERT_METRICS), so the New Rule
 * form and the server agree; a test holds the two equal. This file adds what only the server
 * needs:
 *
 *   subject     the type of record an alert is about
 *   owner       the module whose tables the metric reads, its milestone and its owner
 *   per_person  the metric can be read for one employee (none is, since attendance's alerts became the
 *               Attendance policy's: home.md §6)
 *   evaluate    (client, rule, { today, after, employee_id }) → { readings, next }: the subjects
 *               at or past the rule's threshold on a Lagos day, a batch at a time. `after` is the
 *               cursor the previous batch returned as `next` (null when it was the last), so a
 *               sweep reads every breach in bounded steps. Each reading is
 *               { subject: { type, id }, subject_employee_id, value, title, trigger, since }, ready
 *               for shared/alerts raise(): `value` meets the threshold as the metric's kind says,
 *               and `since` is the breach's latest evidence; a deadline's also has `due_on`, its date.
 *
 *   approval_ageing     workflow_instance: whole days a pending request has waited at its stage
 *   document_expiry     document: days left before a current document expires
 *   confirmation_due    employee: days left before an active employee's confirmation is due
 *   contract_ending     employee: days left before an active employee's contract ends
 *   partner_inactivity  the partners source adapter: whole days since an active partner's last contact
 *   budget_threshold    the budgets source adapter: the share of a running budget spent, in percent
 *   recruitment_sla     the vacancies source adapter: whole days an application has spent at its stage
 *
 * The four over M0 tables raise real alerts from M1; the last three read their milestones' tables
 * through Home's source adapters (src/modules/dashboard/sources) and find nothing until those
 * milestones are used.
 *
 * ATTENDANCE. Its thresholds are the Attendance policy's (TB, 20/10/2026; home.md §6 Alerts):
 * the attendance module counts its consequence rules and raises each breach through
 * alerts.service raisePolicyBreach, on a rule the system keeps for the policy rule (metric
 * `attendance_policy`, POLICY below). That metric is not in this registry: the sweep never reads
 * it and New Rule never offers it; categoryOf() files its alerts under attendance.
 *
 * READING OTHER MODULES' TABLES. The four over M0 tables are the one place Home reads
 * them in its own SQL rather than through the owning module's functions (home.md §4.1): each
 * entry's query reads its owner's tables (`owner` above) under that module's own conditions,
 * a batch at a time. It is coupled to them the way a source adapter is to its milestone's
 * tables: the owning module updates its entry here in the same PR when it changes what the
 * entry reads (workflow_instance and workflow_definition for the workflow engine; document's
 * is_current, scan_status and expires_on for documents; employee's status and dates for the
 * staff register), and tests/integration/home-alerts.test.js raises each from real rows.
 *
 * A breach is read against the rule's threshold in SQL, so a sweep only ever loads breaches,
 * never the organisation. Every day is a Lagos day (shared/time/lagos). Titles and triggers are
 * what a person reads on Home, Alerts: dates are day-first and money is Naira.
 */
const c = require("@mycity/contract");
const lagos = require("../../shared/time/lagos");
const { formatDate } = require("../../shared/time/day-first");
const { formatNaira } = require("../../shared/money/money");
const { stageByKey } = require("../../shared/workflow/conditions");
const partners = require("../dashboard/sources/partners.source");
const budgets = require("../dashboard/sources/budgets.source");
const vacancies = require("../dashboard/sources/vacancies.source");

/** Breaches one step of a sweep reads. A batch is how much work one step takes, never a page. */
const BATCH = 100;

/** "Ada Obi" */
const nameOf = (first, last) => `${first || ""} ${last || ""}`.trim();

/** "1 late arrival", "3 late arrivals" */
const counted = (n, word) => `${n} ${word}${Number(n) === 1 ? "" : "s"}`;

/** A threshold in whole days, rounded up: 2.5 days waiting is first reached on day 3. */
const wholeDays = (rule) => Math.max(0, Math.ceil(Number(rule.threshold)));

/**
 * The instant before which a fact began for its whole days to reach the threshold today:
 * something that began on the day `today - n` or earlier has lasted n whole days.
 */
const reachedBy = (today, n) => lagos.endOfDayExclusive(lagos.addDays(today, -n));

/** A deadline's last day still inside the threshold: a date on or before it has that many days left or fewer. */
const deadlineBy = (rule, today) => lagos.addDays(today, Math.floor(Number(rule.threshold)));

/** When a date came within the rule's days: a deadline breach's evidence. */
const deadlineSince = (rule, date) => lagos.startOfDay(lagos.addDays(date, -Math.floor(Number(rule.threshold))));

/** A batch's readings and the cursor for the next one: null once a batch comes back short. */
const batchOf = (rows, cursor, read) => ({
  readings: rows.map(read),
  next: rows.length === BATCH ? cursor(rows[rows.length - 1]) : null,
});

/* ------------------------------------------------------------------ *
 * Approvals (the workflow engine, M0)
 * ------------------------------------------------------------------ */

/**
 * Pending requests that have waited at their current stage for the rule's whole days or
 * more. An alert is about the record waiting (a leave request), so it opens where the
 * request does, and about the person the request is for.
 */
async function approvalAgeing(client, rule, { today, after = null }) {
  const days = wholeDays(rule);
  const { rows } = await client.query(
    `SELECT i.workflow_instance_id, i.entity_type, i.entity_id, i.subject_employee_id, i.current_stage,
            i.stage_entered_at, d.name AS definition_name, d.stages, se.first_name, se.last_name
       FROM workflow_instance i
       JOIN workflow_definition d ON d.workflow_definition_id = i.workflow_definition_id
       LEFT JOIN employee se ON se.employee_id = i.subject_employee_id
      WHERE i.state = 'pending' AND i.stage_entered_at < $1::timestamptz
        AND ($2::uuid IS NULL OR i.workflow_instance_id > $2::uuid)
      ORDER BY i.workflow_instance_id
      LIMIT $3 -- pagination:batch the requests one step of a sweep raises ageing alerts for`,
    [reachedBy(today, days), after, BATCH],
  );
  return batchOf(
    rows,
    (r) => r.workflow_instance_id,
    (r) => {
      const entered = lagos.dateOf(r.stage_entered_at);
      const waited = lagos.daysBetween(entered, today);
      const stage = stageByKey({ stages: r.stages }, r.current_stage);
      const who = nameOf(r.first_name, r.last_name);
      return {
        subject: { type: r.entity_type, id: r.entity_id },
        subject_employee_id: r.subject_employee_id,
        value: waited,
        title: `${r.definition_name}${who ? ` for ${who}` : ""}: waiting ${counted(waited, "day")}`,
        trigger: `At ${stage ? stage.name : r.current_stage} since ${formatDate(entered)}`,
        since: r.stage_entered_at,
      };
    },
  );
}

/* ------------------------------------------------------------------ *
 * Deadlines (documents and the staff register, M0)
 * ------------------------------------------------------------------ */

/**
 * A deadline reading: the days left before `date`, when it came within the rule's days, and
 * the date itself, so a person who cleared the alert dealt with that date and a changed one
 * is new evidence.
 */
const deadline = (rule, today, date) => ({
  value: lagos.daysBetween(today, date),
  since: deadlineSince(rule, date),
  due_on: date,
});

/** "Expires on 30/10/2026", or once passed "Expired on 01/10/2026". */
const dated = (today, date, coming, passed) => `${date < today ? passed : coming} on ${formatDate(date)}`;

/**
 * Current documents (the vault's current version, nothing a scan refused) expiring within
 * the rule's days, or already expired. One about an employee who has left is not raised.
 */
async function documentExpiry(client, rule, { today, after = null }) {
  const { rows } = await client.query(
    `SELECT d.document_id, d.title, d.expires_on, d.subject_employee_id, e.first_name, e.last_name
       FROM document d
       LEFT JOIN employee e ON e.employee_id = d.subject_employee_id
      WHERE d.is_current AND d.scan_status <> 'infected' AND d.expires_on IS NOT NULL
        AND d.expires_on <= $1::date
        AND (d.subject_employee_id IS NULL OR e.status = 'active')
        AND ($2::uuid IS NULL OR d.document_id > $2::uuid)
      ORDER BY d.document_id
      LIMIT $3 -- pagination:batch the documents one step of a sweep raises expiry alerts for`,
    [deadlineBy(rule, today), after, BATCH],
  );
  return batchOf(
    rows,
    (r) => r.document_id,
    (r) => {
      const who = nameOf(r.first_name, r.last_name);
      return {
        subject: { type: "document", id: r.document_id },
        subject_employee_id: r.subject_employee_id,
        ...deadline(rule, today, r.expires_on),
        title: who ? `${who}: ${r.title}` : r.title,
        trigger: dated(today, r.expires_on, "Expires", "Expired"),
      };
    },
  );
}

/**
 * Active employees whose date in `column` falls within the rule's days, or has passed,
 * under the staff register's own condition (organisation.repo.js counts()).
 */
function employeeDeadline(column, condition, { title, coming, passed }) {
  return async function evaluate(client, rule, { today, after = null }) {
    const { rows } = await client.query(
      `SELECT e.employee_id, e.first_name, e.last_name, e.${column} AS due_on
         FROM employee e
        WHERE e.status = 'active' AND ${condition} AND e.${column} <= $1::date
          AND ($2::uuid IS NULL OR e.employee_id > $2::uuid)
        ORDER BY e.employee_id
        LIMIT $3 -- pagination:batch the people one step of a sweep raises a deadline alert for`,
      [deadlineBy(rule, today), after, BATCH],
    );
    return batchOf(
      rows,
      (r) => r.employee_id,
      (r) => ({
        subject: { type: "employee", id: r.employee_id },
        subject_employee_id: r.employee_id,
        ...deadline(rule, today, r.due_on),
        title: `${nameOf(r.first_name, r.last_name)}: ${title}`,
        trigger: dated(today, r.due_on, coming, passed),
      }),
    );
  };
}

const confirmationDue = employeeDeadline(
  "confirmation_due_on",
  "e.confirmed_on IS NULL AND e.confirmation_due_on IS NOT NULL",
  { title: "confirmation due", coming: "Due", passed: "Was due" },
);

const contractEnding = employeeDeadline("contract_ends_on", "e.contract_ends_on IS NOT NULL", {
  title: "contract ending",
  coming: "Ends",
  passed: "Ended",
});

/* ------------------------------------------------------------------ *
 * Later milestones, through Home's source adapters
 * ------------------------------------------------------------------ */

const ownerOf = (adapter) => Object.freeze({ module: adapter.module, milestone: adapter.milestone, by: adapter.owner });

/** Active partners with no contact for the rule's whole days or more. About no one in particular. */
async function partnerInactivity(client, rule, { today, after = null }) {
  const rows = await partners.quietBatch(client, { before: reachedBy(today, wholeDays(rule)), after, size: BATCH });
  return batchOf(
    rows,
    (r) => r.partner_id,
    (r) => {
      const last = lagos.dateOf(r.last_contact_at);
      const quiet = lagos.daysBetween(last, today);
      return {
        subject: { type: "partner", id: r.partner_id },
        subject_employee_id: null,
        value: quiet,
        title: `${r.name}: no contact in ${counted(quiet, "day")}`,
        trigger: `Last contact on ${formatDate(last)}`,
        since: r.last_contact_at,
      };
    },
  );
}

/** Running Naira budgets with the rule's percentage spent or more, once each period. About no one in particular. */
async function budgetThreshold(client, rule, { today, after = null }) {
  const rows = await budgets.spentBatch(client, { today, percent: rule.threshold, after, size: BATCH });
  return batchOf(
    rows,
    (r) => r.budget_id,
    (r) => ({
      subject: { type: "budget", id: r.budget_id },
      subject_employee_id: null,
      value: r.used,
      title: `${r.name}: ${r.used.replace(/\.?0+$/, "")}% spent`,
      trigger: `${formatNaira(r.spent)} of ${formatNaira(r.allocated)}`,
      since: lagos.startOfDay(r.starts_on),
    }),
  );
}

/** Applications in progress at one stage for the rule's whole days or more. About a candidate, not an employee. */
async function recruitmentSla(client, rule, { today, after = null }) {
  const rows = await vacancies.stalledBatch(client, { before: reachedBy(today, wholeDays(rule)), after, size: BATCH });
  return batchOf(
    rows,
    (r) => r.application_id,
    (r) => {
      const entered = lagos.dateOf(r.current_stage_entered_at);
      const days = lagos.daysBetween(entered, today);
      return {
        subject: { type: "application", id: r.application_id },
        subject_employee_id: null,
        value: days,
        title: `${nameOf(r.first_name, r.last_name)}, ${r.vacancy}: ${counted(days, "day")} at ${r.stage}`,
        trigger: `At ${r.stage} since ${formatDate(entered)}`,
        since: r.current_stage_entered_at,
      };
    },
  );
}

/* ------------------------------------------------------------------ *
 * The registry
 * ------------------------------------------------------------------ */

const SERVER = {
  approval_ageing: {
    subject: "the record awaiting approval",
    owner: { module: "workflow", milestone: "M0", by: "GE" },
    per_person: false,
    evaluate: approvalAgeing,
  },
  document_expiry: {
    subject: "document",
    owner: { module: "documents", milestone: "M0", by: "GE" },
    per_person: false,
    evaluate: documentExpiry,
  },
  confirmation_due: {
    subject: "employee",
    owner: { module: "organisation", milestone: "M0", by: "GE" },
    per_person: false,
    evaluate: confirmationDue,
  },
  contract_ending: {
    subject: "employee",
    owner: { module: "organisation", milestone: "M0", by: "GE" },
    per_person: false,
    evaluate: contractEnding,
  },
  partner_inactivity: { subject: "partner", owner: ownerOf(partners), per_person: false, evaluate: partnerInactivity },
  budget_threshold: { subject: "budget", owner: ownerOf(budgets), per_person: false, evaluate: budgetThreshold },
  recruitment_sla: { subject: "application", owner: ownerOf(vacancies), per_person: false, evaluate: recruitmentSla },
};

/** key → the contract's entry with the server's: frozen, in the contract's order. */
const METRICS = Object.freeze(
  Object.fromEntries(
    Object.entries(c.alerts.HOME_ALERT_METRICS).map(([key, shared]) => [
      key,
      Object.freeze({ key, ...shared, ...SERVER[key] }),
    ]),
  ),
);

/** Refuse a registry that drifted from the contract, when this file loads. */
function check() {
  const problems = [];
  const keys = Object.keys(c.alerts.HOME_ALERT_METRICS);
  for (const key of Object.keys(SERVER)) if (!keys.includes(key)) problems.push(`"${key}" is not a contract metric`);
  for (const key of keys) {
    const m = METRICS[key];
    if (typeof m.evaluate !== "function") problems.push(`${key}: no evaluate()`);
    if (!m.subject || !m.owner || !m.owner.module || !/^M\d+$/.test(m.owner.milestone))
      problems.push(`${key}: name its subject and the module and milestone that own its tables`);
    if (m.per_person && m.subject !== "employee") problems.push(`${key}: only a metric about employees reads one person`);
  }
  if (problems.length) throw new Error(`alerts.metrics:\n  ${problems.join("\n  ")}`);
}
check();

/** The metric a rule watches, or null for a rule kept from before the list (and the policy's). */
const metricOf = (key) => (Object.prototype.hasOwnProperty.call(METRICS, key) ? METRICS[key] : null);

/**
 * The rules the system keeps for the Attendance policy's consequence rules (home.md §6 Alerts):
 * their metric, their category, and how each is named and raised. One breach is one alert.
 */
const POLICY = Object.freeze({
  metric: c.alerts.HOME_ALERT_POLICY_METRIC,
  category: "attendance",
  rules: c.alerts.HOME_ALERT_POLICY_RULES,
  names: Object.freeze({
    late_rule: "Late Arrivals",
    early_rule: "Early Departure",
    absence_rule: "Absence",
    forgotten_rule: "Forgotten Clock-Outs",
    location_rule: "Location Flags",
  }),
  threshold: "1",
  severity: "medium",
  permission_key: "people.approve",
});

/** Is this the metric of a rule the system keeps for the Attendance policy? */
const isPolicy = (key) => key === POLICY.metric;

/** A metric's category: the registry's, attendance for the policy's, null for one kept from before. */
const categoryOf = (key) => (isPolicy(key) ? POLICY.category : metricOf(key) ? metricOf(key).category : null);

/** The metrics in a category, for the category filters (the policy's among attendance's). */
const metricsIn = (category) => [
  ...Object.values(METRICS).filter((m) => m.category === category).map((m) => m.key),
  ...(category === POLICY.category ? [POLICY.metric] : []),
];

module.exports = { METRICS, BATCH, POLICY, metricOf, isPolicy, categoryOf, metricsIn };
