"use strict";
/**
 * What the calendar records, and who it tells (docs/guides/workspace.md §7): the people
 * invited to an event when it is made, moved or called off, and the owner when someone
 * answers, and the owner and the invited who have not declined when a reminder set on the event
 * comes due. The person who acted is never told (fanout).
 */
const { defineEvents } = require("../../shared/events/catalogue");
const { defineNotification } = require("../../shared/notifications/fanout");
const reminders = require("../notifications/notifications.reminders");
const { loginsOf } = require("../tasks/tasks.events");

const EVENTS = defineEvents("workspace", {
  "calendar_event.created": { summary: "A calendar event was added" },
  "calendar_event.changed": { summary: "A calendar event was changed" },
  "calendar_event.cancelled": { summary: "A calendar event was called off" },
  "calendar_event.answered": { summary: "Someone answered an invitation" },
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
  to: [{ users: invited }],
  title: (e) => `Changed: ${e.payload.title}`,
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
