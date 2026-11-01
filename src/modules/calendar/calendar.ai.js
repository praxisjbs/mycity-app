"use strict";
/**
 * What the assistant may read of the asker's calendar: their own month (events,
 * invitations, task deadlines, approved leave), one page of 25 at a time; and, as a card the
 * person confirms (docs/guides/praxis-ai.md §6.11), an event with its attendees, created through
 * the same service function New Event's Create Event calls. Answering an invitation and changing
 * an event stay on the calendar.
 */
const c = require("@mycity/contract");
const { defineManifest } = require("../../shared/ai/manifest");
const routeMap = require("../../shared/route-map");
const service = require("./calendar.service");
const repo = require("./calendar.repo");

/** What each kind of item on the month links to, as the route map names it; a performance date by its kind. */
const CITED = {
  event: "calendar_event",
  task: "task",
  leave: "leave_request",
  check_in_due: "review",
  review_due: "review",
  key_result_due: "key_result",
  pip_review: "improvement_plan",
};

/** The people a card invites, by name; an id that is nobody's keeps its id alone, and the service refuses it. */
async function attendeeRecords(db, ids) {
  const wanted = [...new Set(ids || [])].slice(0, 25);
  const names = db ? await repo.namesOf(db, wanted) : new Map();
  return wanted.map((id) => ({ type: "employee", id, label: names.get(id) || null }));
}

/** An hour on a weekday a month ahead, as an event's start and end. */
function slotOf(dayIso, hour) {
  return { starts_at: `${dayIso}T${String(hour).padStart(2, "0")}:00:00+01:00`, ends_at: `${dayIso}T${String(hour + 1).padStart(2, "0")}:00:00+01:00`, month: dayIso.slice(0, 7) };
}

/**
 * The matrix's scope probes (docs/guides/praxis-ai.md §6.17): the month is the asker's own calendar,
 * so an event they made is on it and one the outsider made for themselves alone never is.
 */
const probe = {
  inside: async (ctx) => {
    const at = slotOf(ctx.freshDay(), 9);
    const e = await service.create(ctx.actor, { title: `Matrix meeting for ${ctx.role}`, event_type: "meeting", starts_at: at.starts_at, ends_at: at.ends_at, all_day: false, visibility: "attendees", attendee_ids: [], reminder_minutes: [] });
    return { type: "calendar_event", id: e.calendar_event_id, params: { month: at.month } };
  },
  outside: async (ctx) => {
    const at = slotOf(ctx.freshDay(), 11);
    const e = await service.create(ctx.outsider.user, { title: `Outsider's meeting, seen by ${ctx.role}`, event_type: "meeting", starts_at: at.starts_at, ends_at: at.ends_at, all_day: false, visibility: "attendees", attendee_ids: [], reminder_minutes: [] });
    return { type: "calendar_event", id: e.calendar_event_id, params: { month: at.month } };
  },
};

module.exports = defineManifest({
  module: "workspace",
  actions: [
    {
      key: "calendar.create",
      label: "Create Event",
      description: "Book a meeting or an event on my calendar: title, kind, start and end, location, who to invite",
      input: c.calendar.CalendarEventCreate,
      permission: ["workspace", "create"],
      risk: "standard",
      bulk: 25,
      // New Event's form takes a day and two clock times and joins them into starts_at and ends_at before it sends.
      form: "none: New Event's form takes a day and two clock times, joined into starts_at and ends_at as it sends",
      records: (values, _actor, db) => attendeeRecords(db, values.attendee_ids),
      // The same function Create Event calls; someone invited who is not on the staff is refused on the field (§6).
      run: (values, actor) => service.create(actor, values),
      readback: (event) => [{ type: "calendar_event", id: event.calendar_event_id, label: event.title, status: "booked", link: (routeMap.linkFor("calendar_event", event.calendar_event_id) || {}).path || null }],
      labels: { title: "Title", description: "Notes", event_type: "Kind", starts_at: "Starts", ends_at: "Ends", all_day: "All Day", location: "Location", visibility: "Visibility", attendee_ids: "Attendees", reminder_minutes: "Reminders" },
    },
  ],
  reads: [
    {
      key: "calendar.month",
      description: "What is on my calendar in a month: meetings, invitations, task deadlines and leave",
      params: c.calendar.CalendarListQuery,
      permission: ["workspace", "view"],
      run: (_client, params, actor) => service.month(actor.scope.employee_id, params),
      cite: (row) => ({ type: CITED[row.performance_kind || row.item_kind], id: row.item_id, label: row.title }),
      matrix: probe,
    },
  ],
  routes: [{ intent: "book a meeting", screen: "workspace.calendar", params: { new: "1" }, prefill: c.calendar.CalendarEventPrefill }],
});
