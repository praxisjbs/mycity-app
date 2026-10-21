"use strict";
/**
 * Calendar events, as Home reads them: a person's own events starting on a day, for Your Week.
 *
 * OWNED BY the `calendar` module, M2 Productivity & Performance, AJ (migration 2000).
 *
 * Home reads this table before the module that owns it is built, so this file is the one
 * place Home names it. The M2 pull request that builds `calendar` MUST, in the same PR, move
 * or replace this query with its own read, keep `tables` true to every column it names, and
 * clear `owes` as it pays each item (docs/guides/home.md §4.1, docs/DATABASE_SCHEMA.md M2
 * Owes). A unit test holds `tables` to the migrated schema and the query to `tables`.
 *
 * An event is on a person's week when they own it or are invited and have not declined,
 * and it has not been called off (docs/guides/workspace.md §6).
 */
const { pageQuery, TOTAL_COL } = require("../../../shared/http/paged");

/** The forward tables and the columns this query reads. */
const TABLES = Object.freeze({
  calendar_event: ["calendar_event_id", "title", "event_type", "owner_employee_id", "starts_at", "ends_at", "all_day", "cancelled_at"],
  calendar_event_attendee: ["calendar_event_id", "employee_id", "response"],
});

/** What M2 still owes this query. */
const OWES = Object.freeze([
  "Move this read into src/modules/calendar (a read the calendar module owns) with TB's review; " +
    "attendees, called-off events and the (owner_employee_id, starts_at) index are paid " +
    "(AJ, 19/10/2026; docs/guides/workspace.md §6).",
]);

/**
 * One page of the events on a person's week that start from `from` up to `to` (exclusive), in
 * the order they start: one day of Your Week. With `running`, also the ones that began
 * before `from` and are still running at it, so the week's first day carries an event
 * that began the week before. An event is on the day it starts only, never repeated on
 * each day it spans.
 * @param {{query: Function}} client
 * @param {{employee_id: string, from: Date, to: Date, running?: boolean}} span
 * @param {{page?: number}} query
 */
function eventsStarting(client, { employee_id: employeeId, from, to, running = false }, query) {
  return pageQuery(
    client,
    `SELECT ce.calendar_event_id, ce.title, ce.event_type, ce.starts_at, ce.ends_at, ce.all_day, ${TOTAL_COL}
       FROM calendar_event ce
      WHERE (ce.owner_employee_id = $1
             OR EXISTS (SELECT 1 FROM calendar_event_attendee a
                         WHERE a.calendar_event_id = ce.calendar_event_id AND a.employee_id = $1
                           AND a.response <> 'declined'))
        AND ce.cancelled_at IS NULL AND ce.starts_at < $3::timestamptz
        AND (ce.starts_at >= $2::timestamptz OR ($4::boolean AND ce.ends_at > $2::timestamptz))
      ORDER BY ce.starts_at, ce.calendar_event_id`,
    [employeeId, from, to, running],
    query,
  );
}

module.exports = {
  module: "calendar",
  milestone: "M2",
  owner: "AJ",
  tables: TABLES,
  owes: OWES,
  eventsStarting,
};
