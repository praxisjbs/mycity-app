"use strict";
/**
 * What the query rules module records, and the events it counts (docs/guides/queries.md
 * §6.3, §7). A punch from an unknown device or a month's review closed rated Below queues the
 * `query-rule-evaluate` job for that person and day, once per event (the job id is the
 * event's); overdue tasks are queued by the daily sweep (jobs/schedulers/query-rule-sweep.js).
 *
 * An Attendance policy breach with Raise Query on (attendance.rule_breached) raises its own query
 * here, `queries.raise_from_breach` (§6.2): late arrivals, absences and missing clock-outs are
 * that policy's rules, not ours. The query a breach raises tells the employee through query.raised.
 *
 *   query_rule.saved      a rule added or changed on Rules
 *   query_rule.activated  switched on: it counts from now
 *   query_rule.paused     switched off
 *   query_rule.fired      a breach raised its query
 */
const { defineEvents } = require("../../shared/events/catalogue");
const outbox = require("../../shared/events/outbox");
const attendanceEvents = require("../attendance/attendance.events").EVENTS;
const reviewEvents = require("../reviews/reviews.events").EVENTS;
const { sourcesOf } = require("../attendance/attendance.auto-query");
const reviews = require("../reviews/reviews.auto-query");
const lagos = require("../../shared/time/lagos");

const EVENTS = defineEvents("queries", {
  "query_rule.saved": { summary: "A query rule was saved" },
  "query_rule.activated": { summary: "A query rule was switched on" },
  "query_rule.paused": { summary: "A query rule was paused" },
  "query_rule.deleted": { summary: "A query rule that never fired was deleted" },
  "query_rule.fired": { summary: "A query rule raised a query" },
});

/** The evaluation job an attendance or review event asks for, or null when it can set off no rule. */
function jobOf(event) {
  if (event.key === reviewEvents.REVIEW_CLOSED) {
    const sources = reviews.sourcesOf(event);
    // A review counts on the day it closed, which is the day its event was recorded.
    return sources.length ? { sources, employee_id: event.payload.employee_id, date: lagos.dateOf(new Date(event.occurred_at || Date.now())) } : null;
  }
  const sources = sourcesOf(event);
  if (!sources.length) return null;
  return { sources, employee_id: event.payload.employee_id, date: event.payload.work_date };
}

for (const key of [attendanceEvents.ATTENDANCE_REVIEW_REQUIRED, reviewEvents.REVIEW_CLOSED]) {
  outbox.register(key, `query_rules.evaluate.${key}`, async (event) => {
    const data = jobOf(event);
    if (!data) return;
    await require("../../jobs/queues").enqueue("query-rule-evaluate", event.key, data, {
      jobId: `query-rule-evaluate-${event.event_id}`,
    });
  });
}

/** An Attendance policy breach that asks for a query raises exactly one (queries.md §6.2). */
outbox.register(attendanceEvents.ATTENDANCE_RULE_BREACHED, "queries.raise_from_breach", async (event) => {
  const p = event.payload || {};
  if (!p.raise_query || !p.attendance_rule_breach_id) return;
  await require("../queries/queries.service").raiseFromBreach(p.attendance_rule_breach_id);
});

module.exports = { EVENTS, jobOf };
