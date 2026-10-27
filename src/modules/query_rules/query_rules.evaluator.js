"use strict";
/**
 * The query rule evaluator: N offences in a window raise one query (docs/guides/queries.md
 * §6.3). Runs in the worker (job `query-rule-evaluate`), after an attendance event has
 * committed (or the daily sweep of overdue tasks, or a month closed rated Below), for one person
 * and the day of that event.
 *
 * For each active rule of the triggers the event set off:
 *   1. the window is the rule's `window_days` Lagos days ending on the event's day
 *      (shared/rules/window-counter), started no earlier than the rule's activation and
 *      no earlier than the day after the last breach this rule raised a query for, so the
 *      offences behind one query never count towards the next;
 *   2. the module that owns the trigger counts the person's offences in it (attendance,
 *      tasks or reviews, each in its own `<module>.auto-query.js`);
 *   3. at the threshold (offences, or late minutes summed), one query is raised through
 *      the queries service, the counted days as its evidence, its dedup key the rule, the
 *      person and the breach day. A second delivery of the same event finds the breach
 *      already raised and does nothing.
 *
 * Each rule is its own transaction, under a lock per rule and person.
 */
const { pool } = require("../../config/db");
const { atomically } = require("../../shared/db/tx");
const { emit } = require("../../shared/events/emit");
const windowCounter = require("../../shared/rules/window-counter");
const lagos = require("../../shared/time/lagos");
const { formatDate } = require("../../shared/time/day-first");
const attendance = require("../attendance/attendance.auto-query");
const tasks = require("../tasks/tasks.auto-query");
const reviews = require("../reviews/reviews.auto-query");
const queries = require("../queries/queries.service");
const repo = require("./query_rules.repo");
const { EVENTS } = require("./query_rules.events");

/** What one offence is called in a query's details and evidence. */
const OFFENCE = Object.freeze({
  lateness: "Late arrival",
  absence: "Absent",
  missing_clock_out: "No clock-out",
  unenrolled_device: "Punch from an unregistered device",
  overdue_task: "Task overdue",
  low_performance: "Month rated Below",
});

/** The module that counts each trigger. */
const PROVIDERS = Object.freeze(
  Object.fromEntries([attendance, tasks, reviews].flatMap((p) => p.SOURCES.map((s) => [s, p]))),
);

/** Every trigger something counts now. */
const COUNTED = Object.freeze(Object.keys(PROVIDERS));

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

const later = (a, b) => (a > b ? a : b);

/** "02/10/2026, 15/10/2026 and 31/10/2026", each day once. */
function dayList(dates) {
  const days = [...new Set(dates)].map((d) => formatDate(d));
  return days.length > 1 ? `${days.slice(0, -1).join(", ")} and ${days[days.length - 1]}` : days[0];
}

/**
 * Whether the offences reach the rule, and on which day. Pure, for the tests.
 * @param {{measure: string, threshold: number}} rule
 * @param {Array<{date: string, minutes: number}>} offences  inside the window, oldest first
 * @returns {{breached: boolean, total: number, breach_date: string|null}}
 */
function reached(rule, offences) {
  const total = rule.measure === "minutes" ? offences.reduce((n, o) => n + o.minutes, 0) : offences.length;
  const breached = offences.length > 0 && total >= rule.threshold;
  return { breached, total, breach_date: breached ? offences[offences.length - 1].date : null };
}

/** The subject, details and evidence of the query a breach raises. */
function queryOf(rule, offences, total) {
  const label = OFFENCE[rule.source_event];
  const counted =
    rule.measure === "minutes"
      ? `${total} late minutes in ${rule.window_days} days`
      : `${offences.length} in ${rule.window_days} days`;
  return {
    subject: rule.name,
    details: `${label} on ${dayList(offences.map((o) => o.date))} (${counted}). Please explain.`,
    evidence: offences.map((o) => ({
      label: o.label || (rule.source_event === "lateness" ? `${label}, ${o.minutes} minutes` : label),
      date: o.date,
    })),
  };
}

/** One rule for one person as of `date`: the new query's id, or null. */
async function evaluateRule(rule, employeeId, date) {
  return tx(async (client) => {
    await repo.lockPerson(client, rule.query_rule_id, employeeId);
    const { from } = windowCounter.windowBounds({ threshold: Math.max(1, rule.threshold), window_days: rule.window_days }, date);
    const last = await repo.lastBreach(client, rule.query_rule_id, employeeId);
    const start = later(later(from, lagos.dateOf(rule.activated_at)), last ? lagos.addDays(last, 1) : from);
    if (start > date) return null;
    const offences = await PROVIDERS[rule.source_event].offences(client, {
      source: rule.source_event,
      employee_id: employeeId,
      from: start,
      to: date,
    });
    const r = reached(rule, offences);
    if (!r.breached) return null;
    const id = await queries.raiseForRule(client, {
      rule,
      employee_id: employeeId,
      ...queryOf(rule, offences, r.total),
      dedup_key: `${rule.query_rule_id}:${employeeId}:${r.breach_date}`,
    });
    if (!id) return null;
    await emit(client, {
      key: EVENTS.QUERY_RULE_FIRED,
      entity: { type: "query_rule", id: rule.query_rule_id },
      actor: null,
      payload: {
        query_rule_id: rule.query_rule_id,
        employee_query_id: id,
        employee_id: employeeId,
        breach_date: r.breach_date,
        counted: r.total,
      },
    });
    return id;
  });
}

/**
 * @param {{sources: string[], employee_id: string, date: string}} input
 * @returns {Promise<{rules: number, raised: string[]}>}
 */
async function evaluate({ sources, employee_id: employeeId, date }) {
  const wanted = sources.filter((s) => COUNTED.includes(s));
  if (!wanted.length) return { rules: 0, raised: [] };
  const rules = await repo.activeFor(pool, wanted);
  const raised = [];
  for (const rule of rules) {
    const id = await evaluateRule(rule, employeeId, date);
    if (id) raised.push(id);
  }
  return { rules: rules.length, raised };
}

module.exports = { COUNTED, evaluate, reached, queryOf, dayList };
