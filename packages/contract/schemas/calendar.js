"use strict";
/**
 * Calendar: a person's events, the invitations they answer, and the month they
 * read, which also carries their tasks' deadlines and their approved leave
 * (docs/guides/workspace.md §3 step 5, §6).
 *
 * An event is seen by its owner, its attendees, and everyone when its visibility
 * is `everyone`. Times are instants on the wire, shown in Africa/Lagos.
 */
const { z } = require("zod");
const {
  uuid,
  text,
  optionalText,
  isoDateTime,
  listQuery,
  Paged,
} = require("./common");
const { PersonRef } = require("./organisation");
const { Link } = require("./tasks");

const CalendarEventType = z.enum(["meeting", "deadline", "campaign", "event", "interview"]);
const CalendarVisibility = z.enum(["private", "attendees", "everyone"]);
const AttendeeResponse = z.enum(["pending", "accepted", "declined"]);
/** Records an event may belong to; each is a key of shared/route-map ENTITY_ROUTES. */
const CalendarEntityType = z.enum(["interview", "partner", "vacancy"]);

const Attendee = z
  .object({
    employee: PersonRef,
    response: AttendeeResponse,
  })
  .strict();

/** One event, as its panel shows it. */
const CalendarEvent = z
  .object({
    calendar_event_id: uuid,
    title: z.string(),
    description: z.string().nullable(),
    event_type: CalendarEventType,
    owner: PersonRef.nullable(),
    starts_at: isoDateTime,
    ends_at: isoDateTime,
    all_day: z.boolean(),
    location: z.string().nullable(),
    visibility: CalendarVisibility,
    attendees: z.array(Attendee).max(50),
    my_response: AttendeeResponse.nullable(),
    entity_type: CalendarEntityType.nullable(),
    entity_id: uuid.nullable(),
    link: Link.nullable(),
    cancelled_at: isoDateTime.nullable(),
    can_edit: z.boolean(),
    created_at: isoDateTime,
  })
  .strict();

/**
 * One thing on a person's month: an event, an open task's deadline, or a day of
 * their approved leave. `item_id` is the event, task or leave request.
 */
const CalendarItemKind = z.enum(["event", "task", "leave"]);
const CalendarItem = z
  .object({
    item_kind: CalendarItemKind,
    item_id: uuid,
    title: z.string(),
    starts_at: isoDateTime,
    ends_at: isoDateTime,
    all_day: z.boolean(),
    event_type: CalendarEventType.nullable(),
    location: z.string().nullable(),
    my_response: AttendeeResponse.nullable(),
    link: Link.nullable(),
  })
  .strict();
const CalendarItemPage = Paged(CalendarItem);

/** GET /calendar: one month, YYYY-MM, everything on it in start order. */
const CalendarListQuery = listQuery(
  {
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "must be a month as YYYY-MM"),
    item_kind: CalendarItemKind.optional(),
  },
  ["starts_at"],
);

const endsAfterStart = (v) => !v.starts_at || !v.ends_at || v.ends_at > v.starts_at;
const ENDS_BEFORE = { message: "Ends before it starts", path: ["ends_at"] };

/** POST /calendar */
const CalendarEventCreate = z
  .object({
    title: text(200),
    description: optionalText(2000),
    event_type: CalendarEventType.default("meeting"),
    starts_at: isoDateTime,
    ends_at: isoDateTime,
    all_day: z.boolean().default(false),
    // address:none a meeting's room or call link, not a street address
    location: optionalText(200),
    visibility: CalendarVisibility.default("attendees"),
    attendee_ids: z.array(uuid).max(50).default([]),
  })
  .strict()
  .refine(endsAfterStart, ENDS_BEFORE);

/** PATCH /calendar/:id: the owner changes it; attendees are told. */
const CalendarEventEdit = z
  .object({
    title: text(200).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    event_type: CalendarEventType.optional(),
    starts_at: isoDateTime.optional(),
    ends_at: isoDateTime.optional(),
    all_day: z.boolean().optional(),
    // address:none a meeting's room or call link, not a street address
    location: z.string().trim().max(200).nullable().optional(),
    visibility: CalendarVisibility.optional(),
    attendee_ids: z.array(uuid).max(50).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Change at least one field")
  .refine(endsAfterStart, ENDS_BEFORE);

/** POST /calendar/:id/respond: an attendee answers. */
const CalendarRespond = z
  .object({ response: z.enum(["accepted", "declined"]) })
  .strict();

/** Which table each schema is a row of (gate 6, check/contract-columns.js). */
const TABLES = {
  Attendee: {
    table: "calendar_event_attendee",
    virtual: { employee: "the person in calendar_event_attendee.employee_id" },
  },
  CalendarEvent: {
    table: "calendar_event",
    virtual: {
      owner: "the person in calendar_event.owner_employee_id",
      attendees: "calendar_event_attendee rows of the event",
      my_response: "the caller's calendar_event_attendee.response, null when not invited",
      link: "linkFor(calendar_event.entity_type, calendar_event.entity_id), never stored",
      can_edit: "the caller owns the event",
    },
  },
  CalendarItem: {
    table: null,
    reason: "one entry of a month, from calendar_event, task (its deadline) or leave_request",
  },
  CalendarItemPage: { table: null, reason: "a page of a month's entries" },
  CalendarListQuery: { table: null, reason: "the month and list controls" },
  CalendarEventCreate: {
    table: "calendar_event",
    virtual: { attendee_ids: "written to calendar_event_attendee" },
  },
  CalendarEventEdit: {
    table: "calendar_event",
    virtual: { attendee_ids: "replaces the calendar_event_attendee rows" },
  },
  CalendarRespond: { table: "calendar_event_attendee" },
};

module.exports = {
  TABLES,
  CalendarEventType,
  CalendarVisibility,
  AttendeeResponse,
  CalendarEntityType,
  CalendarItemKind,
  Attendee,
  CalendarEvent,
  CalendarItem,
  CalendarItemPage,
  CalendarListQuery,
  CalendarEventCreate,
  CalendarEventEdit,
  CalendarRespond,
};
