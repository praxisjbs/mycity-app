"use strict";
/**
 * What the calendar records, and who it tells (docs/guides/workspace.md §7): the people
 * invited to an event when it is made, changed (its time, title, place or details) or called
 * off; someone added to an event hears an invitation, and someone taken off hears that; the
 * owner when someone answers; and the owner and the invited who have not declined when a
 * reminder set on the event comes due. The person who acted is never told (fanout).
 *
 * Invitations by email (§6): each attendee with a work email, never the owner, gets the event as
 * an .ics with system mail when they are invited, when it changes in a way they would notice, and
 * a cancellation when it is called off or they are taken off. The messages go through
 * `email-send`, which holds them while system mail is paused and sends them on Resume.
 */
const c = require("@mycity/contract");
const { config } = require("../../config/env");
const { defineEvents } = require("../../shared/events/catalogue");
const outbox = require("../../shared/events/outbox");
const { defineNotification } = require("../../shared/notifications/fanout");
const { defineVariables } = require("../../shared/templates/variables");
const { linkFor } = require("../../shared/route-map");
const queues = require("../../jobs/queues");
const ics = require("../../services/calendar/ics");
const reminders = require("../notifications/notifications.reminders");
const { loginsOf } = require("../tasks/tasks.events");

const EVENTS = defineEvents("workspace", {
  "calendar_event.created": { summary: "A calendar event was added" },
  "calendar_event.changed": { summary: "A calendar event was changed" },
  "calendar_event.cancelled": { summary: "A calendar event was called off" },
  "calendar_event.answered": { summary: "Someone answered an invitation" },
  "calendar_event.invited": { summary: "Someone was added to an event" },
  "calendar_event.uninvited": { summary: "Someone was taken off an event" },
  "calendar_event.reminder_due": { summary: "An event is about to start" },
});

/** The reminder engine's key for an event's reminders (up to three, before it starts). */
const REMINDER_KEY = "calendar_event_reminder";

const invited = (e, client) => loginsOf(client, e.payload.attendee_ids || []);
const owner = (e, client) => loginsOf(client, [e.payload.owner_employee_id]);

defineNotification(EVENTS.CALENDAR_EVENT_CREATED, {
  to: [{ users: invited }],
  title: (e) => `Invitation: ${e.payload.title}`,
  body: (e) => e.payload.when || "",
});

defineNotification(EVENTS.CALENDAR_EVENT_CHANGED, {
  to: [{ users: (e, client) => (e.payload.noticed === false ? [] : invited(e, client)) }],
  title: (e) => `Changed: ${e.payload.title}`,
  body: (e) => e.payload.when || "",
});

defineNotification(EVENTS.CALENDAR_EVENT_INVITED, {
  to: [{ users: invited }],
  title: (e) => `Invitation: ${e.payload.title}`,
  body: (e) => e.payload.when || "",
});

defineNotification(EVENTS.CALENDAR_EVENT_UNINVITED, {
  to: [{ users: invited }],
  title: (e) => `No longer invited: ${e.payload.title}`,
  body: (e) => e.payload.when || "",
});

defineNotification(EVENTS.CALENDAR_EVENT_CANCELLED, {
  to: [{ users: invited }],
  title: (e) => `Called off: ${e.payload.title}`,
});

defineNotification(EVENTS.CALENDAR_EVENT_ANSWERED, {
  to: [{ users: owner }],
  title: (e) => `${e.payload.attendee_name || "Someone"} ${e.payload.response === "accepted" ? "accepted" : "declined"}`,
  body: (e) => e.payload.title,
});

defineNotification(EVENTS.CALENDAR_EVENT_REMINDER_DUE, {
  to: [{ users: (e, client) => loginsOf(client, [e.payload.owner_employee_id, ...(e.payload.attendee_ids || [])]) }],
  title: (e) => `Starting soon: ${e.payload.title}`,
  body: (e) => e.payload.when || "",
  include_actor: true,
});

defineVariables("email", "calendar-invite", c.calendar.CalendarInviteEmailVars);

/** What each event sends the people it names: an invitation (REQUEST) or a cancellation (CANCEL). */
const INVITATIONS = {
  [EVENTS.CALENDAR_EVENT_CREATED]: { method: "REQUEST", heading: "Invitation" },
  [EVENTS.CALENDAR_EVENT_INVITED]: { method: "REQUEST", heading: "Invitation" },
  [EVENTS.CALENDAR_EVENT_CHANGED]: { method: "REQUEST", heading: "Updated" },
  [EVENTS.CALENDAR_EVENT_CANCELLED]: { method: "CANCEL", heading: "Called Off" },
  [EVENTS.CALENDAR_EVENT_UNINVITED]: { method: "CANCEL", heading: "Called Off" },
};

/** One email a person, with the event as it stands now, so a late send never carries an old time. */
async function sendInvitations(event) {
  const { method, heading } = INVITATIONS[event.key];
  const p = event.payload || {};
  if (p.noticed === false) return;
  const { pool } = require("../../config/db");
  const repo = require("./calendar.repo");
  const { whenOf } = require("./calendar.service");
  const ev = await repo.invitation(pool, p.calendar_event_id);
  // Called off since: the cancellation is the message that counts.
  if (!ev || (method === "REQUEST" && ev.cancelled_at)) return;
  const people = await repo.mailable(pool, p.attendee_ids || []);
  const link = linkFor("calendar_event", ev.calendar_event_id);
  for (const person of people) {
    const invite = {
      uid: `calendar-event-${ev.calendar_event_id}@mycityapp.io`,
      sequence: ev.ics_sequence || 0,
      start: ev.starts_at,
      end: ev.ends_at,
      summary: ev.title,
      description: ev.description || "",
      location: ev.location || "",
      organizer: { name: ev.owner_name || "MyCity App", email: ev.owner_email || "no-reply@mycityapp.io" },
      attendees: [{ name: person.name, email: person.email }],
      method,
    };
    await queues.enqueue(
      "email-send",
      "calendar-invite",
      {
        to: { name: person.name, email: person.email },
        recipient: { first_name: person.first_name, email: person.email },
        template: "calendar-invite",
        data: {
          heading,
          title: ev.title,
          organiser: ev.owner_name || "MyCity App",
          when: whenOf(ev.starts_at, ev.all_day),
          location: ev.location || null,
          called_off: method === "CANCEL",
          link_url: link ? new URL(link.path, config.STAFF_ORIGIN).href : config.STAFF_ORIGIN,
        },
        attachments: [ics.attachment(invite, method === "CANCEL" ? "cancel.ics" : "invite.ics")],
      },
      { jobId: `calendar-invite-${event.event_id}-${person.employee_id}` },
    );
  }
}

for (const key of Object.keys(INVITATIONS)) outbox.register(key, "calendar.invitations", sendInvitations);

/*
 * An event's reminder: to its owner and everyone invited who has not declined, while the event
 * still stands and has not started. The service is required when the engine calls it.
 */
reminders.defineReminder(REMINDER_KEY, {
  event: EVENTS.CALENDAR_EVENT_REMINDER_DUE,
  module: "workspace",
  check: (client, row, ctx) => require("./calendar.service").reminderCheck(client, row, ctx),
});

module.exports = { EVENTS, REMINDER_KEY };
