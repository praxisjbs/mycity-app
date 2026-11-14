"use strict";
/**
 * What the assistant may read of the asker's calendar (and, as calendar.summary, the same month in
 * figures, docs/guides/praxis-ai.md §6.13): their own month (events,
 * invitations, task deadlines, approved leave), one page of 25 at a time; and, as cards the
 * person confirms (docs/guides/praxis-ai.md §6.11, decision 33), an event with its attendees,
 * created through the same service function New Event's Create Event calls, and a change to an
 * event the person made, through Edit Event's own. Answering an invitation and calling an event off
 * stay on the calendar.
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

/**
 * The people a card invites, by name (docs/guides/praxis-ai.md §1.3 decision 31): named on the card,
 * never counted as records it acts on. An id that is nobody's is left out, so the card shows the id
 * and the service refuses it at the press.
 */
async function attendeeNames(db, ids) {
  const wanted = [...new Set(ids || [])].slice(0, 50);
  if (!db || !wanted.length) return [];
  const names = await repo.namesOf(db, wanted);
  return wanted.filter((id) => names.get(id)).map((id) => ({ type: "employee", id, label: names.get(id) }));
}

/** An hour on a weekday a month ahead, as an event's start and end. */
function slotOf(dayIso, hour) {
  return { starts_at: `${dayIso}T${String(hour).padStart(2, "0")}:00:00+01:00`, ends_at: `${dayIso}T${String(hour + 1).padStart(2, "0")}:00:00+01:00`, month: dayIso.slice(0, 7) };
}

/**
 * The matrix's scope probes (docs/guides/praxis-ai.md §6.17): the month is the asker's own calendar,
 * so an event they made is on it and one the outsider made for themselves alone never is; a card
 * changing the outsider's event is refused by Edit Event's own rule.
 */
const meeting = async (who, title, at) => (await service.create(who, { title, event_type: "meeting", starts_at: at.starts_at, ends_at: at.ends_at, all_day: false, visibility: "attendees", attendee_ids: [], reminder_minutes: [] })).calendar_event_id;
const probe = {
  inside: async (ctx) => {
    const at = slotOf(ctx.freshDay(), 9);
    const id = await meeting(ctx.actor, `Matrix meeting for ${ctx.role}`, at);
    return { type: "calendar_event", id, params: { month: at.month }, values: { calendar_event_id: id, location: "Room 2" } };
  },
  outside: async (ctx) => {
    const at = slotOf(ctx.freshDay(), 11);
    const id = await meeting(ctx.outsider.user, `Outsider's meeting, seen by ${ctx.role}`, at);
    return { type: "calendar_event", id, params: { month: at.month }, values: { calendar_event_id: id, location: "Room 2" } };
  },
};

/**
 * The summary's probes: it counts this month, so the meeting is booked today rather than on the fresh day
 * weeks ahead (docs/guides/praxis-ai.md §6.17); the person's own is counted, the outsider's own never.
 */
const today = () => require("../../shared/time/lagos").today();
const summaryProbe = {
  inside: async (ctx) => ({ type: "calendar_event", id: await meeting(ctx.actor, `Matrix meeting today for ${ctx.role}`, slotOf(today(), 7)) }),
  outside: async (ctx) => ({ type: "calendar_event", id: await meeting(ctx.outsider.user, `Outsider's meeting today, seen by ${ctx.role}`, slotOf(today(), 7)) }),
};

// Connect to Partner on the card (M7, workspace.md §9): Partnerships names and finds the partner, lead and deal.
const partnerCard = require("../partners/partners.work").card;

const eventLink = (id) => (routeMap.linkFor("calendar_event", id) || {}).path || null;

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
      // New Event's form takes a day and two clock times and joins them into starts_at and ends_at before it sends.
      form: "none: New Event's form takes a day and two clock times, joined into starts_at and ends_at as it sends",
      fields: ["title", "starts_at", "ends_at", "all_day", "attendee_ids", "event_type", "location", "visibility", "description", "reminder_minutes", ...partnerCard.fields],
      picks: { attendee_ids: "colleague", ...partnerCard.picks },
      // One event is made, so the verb counts nothing; the people invited are named, never counted.
      names: async (values, actor, db) => [...(await attendeeNames(db, values.attendee_ids)), ...(await partnerCard.names(values, actor, db))],
      asks: [
        { field: "title", question: "What is the meeting about?" },
        { field: "starts_at", question: "When is it?" },
        { field: "ends_at", question: "How long is it?", choices: ["30 Minutes", "1 Hour", "2 Hours"] },
        { field: "attendee_ids", question: "Who should come?", choices: ["Just Me"], none: true },
      ],
      resolve: partnerCard.resolve,
      // The same function Create Event calls; someone invited who is not on the staff is refused on the field (§6).
      run: (values, actor) => service.create(actor, values),
      readback: (event) => [{ type: "calendar_event", id: event.calendar_event_id, label: event.title, status: "booked", link: eventLink(event.calendar_event_id) }],
      labels: { title: "Title", description: "Notes", event_type: "Kind", starts_at: "Starts", ends_at: "Ends", all_day: "All Day", location: "Location", visibility: "Visibility", attendee_ids: "Attendees", reminder_minutes: "Reminders", ...partnerCard.labels },
    },
    {
      key: "calendar.edit",
      label: "Save Event",
      matrix: probe,
      description: "Change an event I made: move it, retitle it, change who comes, where or its reminders; only what changes; attendee_ids replaces who is invited",
      input: c.calendar.CalendarEventChange,
      permission: ["workspace", "edit"],
      risk: "standard",
      form: "none: Edit Event's form takes a day and two clock times, joined into starts_at and ends_at as it sends, and changes the event open; the card names it",
      fields: ["calendar_event_id", "title", "starts_at", "ends_at", "all_day", "attendee_ids", "event_type", "location", "visibility", "description", "reminder_minutes", ...partnerCard.fields],
      picks: { attendee_ids: "colleague", ...partnerCard.picks },
      // Which event, when the person did not say (praxis-ai.md decision 34): their events from today, matched by title.
      asks: [{ field: "calendar_event_id", question: "Which event is it?", options: ({ actor }) => service.eventChoices(actor.employee_id) }],
      resolve: { calendar_event_id: (value, actor) => service.eventIdOf(actor.employee_id, value), ...partnerCard.resolve },
      // The event is what the press changes; the people invited are named, never counted.
      names: async (values, actor, db) => [...(await attendeeNames(db, values.attendee_ids)), ...(await partnerCard.names(values, actor, db))],
      records: (values, actor, db) => (db ? service.cardRecords(db, values.calendar_event_id, actor.employee_id) : values.calendar_event_id ? [{ type: "calendar_event", id: values.calendar_event_id }] : []),
      check: (client, values, actor) => service.assertCardEvent(client, values.calendar_event_id, actor.employee_id),
      // The same function Save Event calls; someone invited who is not on the staff is refused on the field (§6).
      run: (values, actor) => {
        const { calendar_event_id: id, ...changes } = values;
        return service.edit(actor, id, changes);
      },
      readback: (event) => [{ type: "calendar_event", id: event.calendar_event_id, label: event.title, status: "saved", link: eventLink(event.calendar_event_id) }],
      labels: { calendar_event_id: "Event", title: "Title", description: "Notes", event_type: "Kind", starts_at: "Starts", ends_at: "Ends", all_day: "All Day", location: "Location", visibility: "Visibility", attendee_ids: "Attendees", reminder_minutes: "Reminders", ...partnerCard.labels },
    },
  ],
  // Edit Event's own form, reached through the card that names its event (gate 23, praxis-ai.md decision 33).
  not_offered: {
    CalendarEventEdit: "via calendar.edit: Edit Event's own form, which never names its event; the card is CalendarEventChange",
  },
  summaries: [
    {
      key: "calendar.summary",
      description: "My calendar month in figures: meetings and their hours, invitations waiting, task deadlines, leave days, performance dates; by kind or week",
      params: c.calendar.CalendarSummaryQuery,
      permission: ["workspace", "view"],
      run: (client, params, actor) => service.aiSummary(client, params, actor),
      matrix: summaryProbe,
    },
  ],
  reads: [
    {
      key: "calendar.month",
      summary: "calendar.summary",
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
