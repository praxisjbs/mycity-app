"use strict";
/**
 * Calendar: a person's month and the one write path for an event
 * (docs/guides/workspace.md §3 step 5, §6).
 *
 * The month is the reader's own: their events and invitations, events shared with
 * everyone, their open tasks' deadlines, their approved leave and their performance dates
 * (docs/guides/performance.md §6.18). Only the owner
 * changes or calls off an event; an attendee answers it.
 */
const { pool } = require("../../config/db");
const { atomically } = require("../../shared/db/tx");
const { AppError } = require("../../shared/errors");
const { emit } = require("../../shared/events/emit");
const { linkFor } = require("../../shared/route-map");
const lagos = require("../../shared/time/lagos");
const repo = require("./calendar.repo");
const reminders = require("../notifications/notifications.reminders");
const { EVENTS, REMINDER_KEY } = require("./calendar.events");

const iso = (v) => (v instanceof Date ? v.toISOString() : v || null);

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

const notFound = () => new AppError("NOT_FOUND", "That event does not exist", 404);

/** A month item as the contract's CalendarItem. */
function toItem(row) {
  return {
    item_kind: row.item_kind,
    item_id: row.item_id,
    title: row.title,
    starts_at: iso(row.starts_at),
    ends_at: iso(row.ends_at),
    all_day: row.all_day,
    event_type: row.event_type,
    location: row.location,
    my_response: row.my_response,
    performance_kind: row.performance_kind || null,
    link: linkFor(row.link_type, row.item_id, { self: Boolean(row.link_self) }),
  };
}

/** An event row as the contract's CalendarEvent, for the reader. */
function toEvent(row, employeeId) {
  const mine = (row.attendees || []).find((a) => a.employee && a.employee.employee_id === employeeId);
  return {
    calendar_event_id: row.calendar_event_id,
    title: row.title,
    description: row.description,
    event_type: row.event_type,
    owner: row.owner,
    starts_at: iso(row.starts_at),
    ends_at: iso(row.ends_at),
    all_day: row.all_day,
    location: row.location,
    visibility: row.visibility,
    attendees: row.attendees || [],
    my_response: mine ? mine.response : null,
    entity_type: row.entity_type,
    entity_id: row.entity_id,
    link: row.entity_type ? linkFor(row.entity_type, row.entity_id) : null,
    cancelled_at: iso(row.cancelled_at),
    reminder_minutes: row.reminder_minutes || [],
    can_edit: row.owner_employee_id === employeeId && !row.cancelled_at,
    created_at: iso(row.created_at),
  };
}

/** "Tue 20/10/2026, 10:00", for a notification. */
function whenOf(startsAt, allDay) {
  const d = new Date(startsAt);
  const day = lagos.dateOf(d);
  const dd = `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}`;
  return allDay ? dd : `${dd}, ${lagos.timeOf(d)}`;
}

/** A person's month, YYYY-MM. */
async function month(employeeId, query) {
  const first = `${query.month}-01`;
  const next = lagos.addMonths(first, 1);
  const page = await repo.month(
    pool,
    {
      employee_id: employeeId,
      from: lagos.instant(first),
      to: lagos.instant(next),
      fromDay: first,
      toDay: lagos.addDays(next, -1),
    },
    query,
  );
  return { ...page, data: page.data.map(toItem) };
}

/* ------------------------------------------------------------------ *
 * Reminders: up to three, minutes before the start, in the shared engine
 * ------------------------------------------------------------------ */

const entityOf = (id) => ({ type: "calendar_event", id });

/** The event row with its reminders' lead times, as the panel and the edit form show them. */
async function withReminders(db, row) {
  if (!row) return row;
  const pending = await reminders.pendingFor(db, { key: REMINDER_KEY, entity: entityOf(row.calendar_event_id) });
  const minutes = pending
    .map((r) => (r.payload && Number.isInteger(r.payload.minutes_before) ? r.payload.minutes_before : null))
    .filter((m) => m !== null)
    .sort((a, b) => a - b);
  return { ...row, reminder_minutes: [...new Set(minutes)] };
}

/** Make the event's reminders exactly these lead times; any whose time has passed are left out. */
async function scheduleReminders(client, id, startsAt, minutes) {
  await reminders.cancel(client, { key: REMINDER_KEY, entity: entityOf(id) });
  const now = Date.now();
  const lead = [...new Set(minutes)].sort((a, b) => a - b);
  for (const [i, m] of lead.entries()) {
    const at = new Date(new Date(startsAt).getTime() - m * 60_000);
    if (at.getTime() <= now) continue;
    await reminders.schedule(client, { key: REMINDER_KEY, entity: entityOf(id), occurrence: String(i + 1), at, payload: { minutes_before: m } });
  }
}

/** The engine's check before an event reminder fires: the event stands and has not started. */
async function reminderCheck(client, row, ctx = {}) {
  const now = ctx.now || new Date();
  const { rows } = await client.query(
    `SELECT calendar_event_id, title, owner_employee_id, starts_at, all_day, cancelled_at
       FROM calendar_event WHERE calendar_event_id = $1`,
    [row.entity_id],
  );
  const e = rows[0];
  if (!e || e.cancelled_at || new Date(e.starts_at) <= now) return null;
  const { rows: going } = await client.query(
    "SELECT employee_id FROM calendar_event_attendee WHERE calendar_event_id = $1 AND response <> 'declined' ORDER BY employee_id",
    [e.calendar_event_id],
  );
  return {
    entity: entityOf(e.calendar_event_id),
    payload: {
      calendar_event_id: e.calendar_event_id,
      title: e.title,
      owner_employee_id: e.owner_employee_id,
      attendee_ids: going.map((r) => r.employee_id),
      when: whenOf(e.starts_at, e.all_day),
    },
  };
}

async function getFor(id, employeeId) {
  const row = await repo.getFor(pool, id, employeeId);
  if (!row) throw notFound();
  return toEvent(await withReminders(pool, row), employeeId);
}

async function checkAttendees(client, ids, ownerId) {
  const wanted = [...new Set(ids)].filter((x) => x !== ownerId);
  const active = await repo.activeOf(client, wanted);
  if (active.length !== wanted.length) {
    throw new AppError("VALIDATION_FAILED", "Someone invited is not on the staff", 422, {
      attendee_ids: ["Not on the staff"],
    });
  }
  return wanted;
}

const payloadOf = (row, attendeeIds) => ({
  calendar_event_id: row.calendar_event_id,
  title: row.title,
  owner_employee_id: row.owner_employee_id,
  attendee_ids: attendeeIds,
  when: whenOf(row.starts_at, row.all_day),
});

async function create(actor, body) {
  if (!actor.employee_id) throw new AppError("FORBIDDEN", "Only an employee has a calendar", 403);
  return tx(async (client) => {
    const attendees = await checkAttendees(client, body.attendee_ids || [], actor.employee_id);
    const id = await repo.insert(client, {
      title: body.title,
      description: body.description || null,
      event_type: body.event_type,
      owner_employee_id: actor.employee_id,
      starts_at: body.starts_at,
      ends_at: body.ends_at,
      all_day: body.all_day,
      location: body.location || null,
      visibility: body.visibility,
      created_by: actor.user_id,
    });
    await repo.setAttendees(client, id, attendees);
    await scheduleReminders(client, id, body.starts_at, body.reminder_minutes || []);
    const row = await withReminders(client, await repo.getFor(client, id, actor.employee_id));
    await emit(client, {
      key: EVENTS.CALENDAR_EVENT_CREATED,
      entity: { type: "calendar_event", id },
      actor,
      after: toEvent(row, actor.employee_id),
      payload: payloadOf(row, attendees),
    });
    return toEvent(row, actor.employee_id);
  });
}

/** The owner's event, locked, or 404 / 403. */
async function owned(client, id, employeeId) {
  const row = await repo.lock(client, id);
  if (!row) throw notFound();
  const visible = await repo.getFor(client, id, employeeId);
  if (!visible) throw notFound();
  if (row.owner_employee_id !== employeeId)
    throw new AppError("FORBIDDEN", "Only the person who made this event can change it", 403);
  if (row.cancelled_at) throw new AppError("EVENT_CANCELLED", "This event was called off", 409);
  return visible;
}

async function edit(actor, id, body) {
  return tx(async (client) => {
    const before = await owned(client, id, actor.employee_id);
    const starts = body.starts_at || iso(before.starts_at);
    const ends = body.ends_at || iso(before.ends_at);
    if (new Date(ends) <= new Date(starts)) {
      throw new AppError("VALIDATION_FAILED", "Ends before it starts", 422, { ends_at: ["Ends before it starts"] });
    }
    const changes = {};
    for (const k of ["title", "description", "event_type", "starts_at", "ends_at", "all_day", "location", "visibility"])
      if (k in body) changes[k] = body[k];
    await repo.update(client, id, changes);
    if (body.attendee_ids)
      await repo.setAttendees(client, id, await checkAttendees(client, body.attendee_ids, actor.employee_id));
    // New lead times replace the old; a move keeps the lead times and moves their times with it.
    if (body.reminder_minutes || body.starts_at) {
      const lead = body.reminder_minutes || (await withReminders(client, before)).reminder_minutes;
      await scheduleReminders(client, id, starts, lead);
    }
    const after = await withReminders(client, await repo.getFor(client, id, actor.employee_id));
    await emit(client, {
      key: EVENTS.CALENDAR_EVENT_CHANGED,
      entity: { type: "calendar_event", id },
      actor,
      before: toEvent(before, actor.employee_id),
      after: toEvent(after, actor.employee_id),
      payload: payloadOf(after, await repo.attendeeIds(client, id)),
    });
    return toEvent(after, actor.employee_id);
  });
}

async function cancel(actor, id) {
  return tx(async (client) => {
    const before = await owned(client, id, actor.employee_id);
    await repo.update(client, id, { cancelled_at: new Date() });
    await reminders.cancel(client, { key: REMINDER_KEY, entity: entityOf(id) });
    const after = await repo.getFor(client, id, actor.employee_id);
    await emit(client, {
      key: EVENTS.CALENDAR_EVENT_CANCELLED,
      entity: { type: "calendar_event", id },
      actor,
      before: { cancelled_at: null },
      after: { cancelled_at: iso(after.cancelled_at) },
      payload: payloadOf(before, await repo.attendeeIds(client, id)),
    });
    return toEvent(after, actor.employee_id);
  });
}

async function respond(actor, id, { response }) {
  return tx(async (client) => {
    const row = await repo.getFor(client, id, actor.employee_id);
    if (!row) throw notFound();
    if (row.cancelled_at) throw new AppError("EVENT_CANCELLED", "This event was called off", 409);
    if (!(await repo.respond(client, id, actor.employee_id, response))) {
      throw new AppError("NOT_INVITED", "You are not invited to this event", 409);
    }
    const after = await withReminders(client, await repo.getFor(client, id, actor.employee_id));
    await emit(client, {
      key: EVENTS.CALENDAR_EVENT_ANSWERED,
      entity: { type: "calendar_event", id },
      actor,
      payload: {
        calendar_event_id: id,
        title: row.title,
        owner_employee_id: row.owner_employee_id,
        response,
        attendee_name: actor.display_name || null,
      },
    });
    return toEvent(after, actor.employee_id);
  });
}

module.exports = { toItem, month, getFor, create, edit, cancel, respond, reminderCheck };
