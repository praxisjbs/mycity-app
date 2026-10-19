"use strict";
/**
 * What the query rules module records, and the attendance events it counts
 * (docs/guides/queries.md §6.3, §7). A late clock-in, an absent day, a missing clock-out
 * or a punch from an unknown device queues the `query-rule-evaluate` job for that person
 * and day, once per event (the job id is the event's); the query a breach raises tells
 * the employee through query.raised.
 *
 *   query_rule.saved      a rule added or changed on Rules
 *   query_rule.activated  switched on: it counts from now
 *   query_rule.paused     switched off
 *   query_rule.fired      a breach raised its query
 */
const { defineEvents } = require("../../shared/events/catalogue");
const outbox = require("../../shared/events/outbox");
const attendanceEvents = require("../attendance/attendance.events").EVENTS;
const { sourcesOf } = require("../attendance/attendance.auto-query");

const EVENTS = defineEvents("queries", {
  "query_rule.saved": { summary: "A query rule was saved" },
  "query_rule.activated": { summary: "A query rule was switched on" },
  "query_rule.paused": { summary: "A query rule was paused" },
  "query_rule.fired": { summary: "A query rule raised a query" },
});

/** The evaluation job an attendance event asks for, or null when it can set off no rule. */
function jobOf(event) {
  const sources = sourcesOf(event);
  if (!sources.length) return null;
  return { sources, employee_id: event.payload.employee_id, date: event.payload.work_date };
}

for (const key of [
  attendanceEvents.ATTENDANCE_PUNCHED,
  attendanceEvents.ATTENDANCE_DAY_CLOSED,
  attendanceEvents.ATTENDANCE_REVIEW_REQUIRED,
]) {
  outbox.register(key, `query_rules.evaluate.${key}`, async (event) => {
    const data = jobOf(event);
    if (!data) return;
    await require("../../jobs/queues").enqueue("query-rule-evaluate", event.key, data, {
      jobId: `query-rule-evaluate-${event.event_id}`,
    });
  });
}

module.exports = { EVENTS, jobOf };
