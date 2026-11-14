"use strict";
/**
 * Announcements (M1, docs/guides/community.md §3 step 2, §3 step 12): the record behind a
 * post in #announcements, its audience, its schedule and who has read it. Published and
 * tracked by holders of the announcements.post capability (People and the CEO).
 *
 * Read counts are visible to the poster and capability holders only (§6). An announcement's level
 * is its urgency (TB, 19/10/2026): an urgent one counts as read only once acknowledged.
 */
const { z } = require("zod");
const { uuid, text, isoDateTime, listQuery, Paged, recordId, changesBeside, nothingOn, summaryPeriod } = require("./common");
const { PersonRef } = require("./organisation");
const { NotificationUrgency } = require("./notifications");

const ANNOUNCEMENT_STATUSES = ["draft", "scheduled", "published", "archived", "cancelled"];
const AnnouncementStatus = z.enum(ANNOUNCEMENT_STATUSES);

/** Who an announcement is for: all staff, or the people of chosen departments. */
const Audience = z
  .object({
    kind: z.enum(["all", "departments"]),
    department_ids: z.array(uuid).max(50).default([]),
  })
  .strict()
  .refine((a) => a.kind === "all" || a.department_ids.length > 0, {
    message: "Choose a department",
    path: ["department_ids"],
  });

/** One announcement on the tracking tab. */
const Announcement = z
  .object({
    announcement_id: uuid,
    title: z.string(),
    body: z.string(),
    audience: Audience,
    departments: z.array(z.string()),
    status: AnnouncementStatus,
    urgency: NotificationUrgency,
    author: PersonRef.nullable(),
    publish_at: isoDateTime.nullable(),
    published_at: isoDateTime.nullable(),
    reads: z.number().int().min(0),
    audience_size: z.number().int().min(0),
  })
  .strict();

const AnnouncementListQuery = listQuery();

/**
 * The assistant's announcement summary (docs/guides/praxis-ai.md §6.13, Workspace, Knowledge Hub,
 * Community, Home and Settings): with `announcements.post` every announcement as the tab tracks it,
 * otherwise the ones the reader received; the newest stacked Read and Not Read, by urgency, by month. A
 * period (published) narrows it only when asked. Figures, never a row: never an announcement's message.
 */
const AnnouncementSummaryBy = z.enum(["announcement", "urgency", "month"]);
const AnnouncementSummaryQuery = z
  .object({
    urgency: NotificationUrgency.optional(),
    ...summaryPeriod,
    by: AnnouncementSummaryBy.default("announcement"),
  })
  .strict();

const AnnouncementPage = Paged(Announcement);

/**
 * POST /community/announcements. Without publish_at it is published now; with it, it is
 * scheduled and released at that instant, which must be in the future.
 */
const AnnouncementCreate = z
  .object({
    title: text(120),
    body: text(4000),
    audience: Audience.default({ kind: "all", department_ids: [] }),
    urgency: NotificationUrgency.default("normal"),
    publish_at: isoDateTime.optional(),
  })
  .strict();

/**
 * PUT /community/announcements/:id: change a scheduled announcement before it goes out.
 * publish_at stays required, and in the future: an edit never publishes. Without `urgency` the
 * level stays as it was.
 */
const AnnouncementUpdate = z
  .object({
    title: text(120),
    body: text(4000),
    audience: Audience,
    urgency: NotificationUrgency.optional(),
    publish_at: isoDateTime,
  })
  .strict();

/*
 * Praxis AI's cards for New Announcement and Edit Announcement (docs/guides/praxis-ai.md §6.11,
 * decision 40): the audience as a person reads it, All Staff or Departments, beside its departments,
 * which the press sends as the form's Audience. Left without a time, it is published at once.
 */
const CardAudience = z.enum(["all_staff", "departments"]);
const audienceRules = (v, ctx) => {
  if (v.audience === "departments" && !(v.department_ids || []).length)
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["department_ids"], message: "Choose a department" });
  if (v.audience === "all_staff" && (v.department_ids || []).length)
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["department_ids"], message: "All staff names none" });
};

const AnnouncementPost = z
  .object({
    title: text(120),
    body: text(4000),
    audience: CardAudience.default("all_staff"),
    department_ids: z.array(uuid).max(50).default([]),
    urgency: NotificationUrgency.default("normal"),
    publish_at: isoDateTime.optional(),
  })
  .strict()
  .superRefine(audienceRules);

/** A scheduled announcement changed as a card: the announcement beside only what changes. */
const AnnouncementChange = z
  .object({
    announcement_id: recordId("announcement"),
    title: text(120).optional(),
    body: text(4000).optional(),
    audience: CardAudience.optional(),
    department_ids: z.array(uuid).max(50).optional(),
    urgency: NotificationUrgency.optional(),
    publish_at: isoDateTime.optional(),
  })
  .strict()
  .refine(changesBeside(["announcement_id"]), nothingOn("announcement_id"))
  .superRefine((v, ctx) => (v.audience ? audienceRules(v, ctx) : undefined));

/** GET /community/announcements/:id/reads: one person in the audience. */
const AnnouncementReader = z
  .object({
    person: PersonRef,
    read_at: isoDateTime.nullable(),
    acknowledged_at: isoDateTime.nullable(),
  })
  .strict();
const AnnouncementReadQuery = listQuery({ read: z.enum(["read", "not_read"]).optional() });
const AnnouncementReadPage = Paged(AnnouncementReader);

/** GET /community/announcements/stats: the tab's figures, over every announcement. */
const AnnouncementStats = z
  .object({
    published: z.number().int().min(0),
    scheduled: z.number().int().min(0),
    average_read: z.number().int().min(0).max(100),
    audience: z.number().int().min(0),
    this_month: z.number().int().min(0),
  })
  .strict();

/** POST /community/announcements/:id/remind. */
const RemindResult = z.object({ reminded: z.number().int().min(0) }).strict();

const TABLES = {
  Announcement: {
    table: "announcement",
    virtual: {
      departments: "the names of the audience's departments, from department",
      author: "who posted it, from published_by",
      reads: "how many of the audience have opened it (acknowledged it, when urgent), from announcement_read",
    },
  },
  AnnouncementListQuery: { table: null, reason: "list controls for the tracking tab" },
  AnnouncementSummaryQuery: { table: null, reason: "the filters, period and grouping of the assistant's announcement summary; figures, never a row" },
  AnnouncementPage: { table: null, reason: "a page of announcements" },
  AnnouncementCreate: { table: "announcement" },
  AnnouncementUpdate: { table: "announcement" },
  AnnouncementPost: {
    table: "announcement",
    virtual: { department_ids: "the departments of announcement.audience (jsonb) when it is for departments" },
  },
  AnnouncementChange: {
    table: "announcement",
    virtual: { department_ids: "the departments of announcement.audience (jsonb) when it is for departments" },
  },
  AnnouncementReader: {
    table: "announcement_read",
    virtual: { person: "the reader's employee, as a PersonRef with their photo_url" },
  },
  AnnouncementReadQuery: { table: null, reason: "list controls and the read filter" },
  AnnouncementReadPage: { table: null, reason: "a page of the audience with their read marks" },
  RemindResult: { table: null, reason: "how many people were reminded" },
  AnnouncementStats: { table: null, reason: "counts over announcement and the active staff, for the tracking tab" },
  Audience: { table: null, reason: "the value of announcement.audience (jsonb)" },
};

module.exports = {
  TABLES,
  ANNOUNCEMENT_STATUSES,
  AnnouncementStatus,
  Audience,
  Announcement,
  AnnouncementListQuery,
  AnnouncementSummaryBy,
  AnnouncementSummaryQuery,
  AnnouncementPage,
  AnnouncementCreate,
  AnnouncementUpdate,
  AnnouncementPost,
  AnnouncementChange,
  AnnouncementReader,
  AnnouncementReadQuery,
  AnnouncementReadPage,
  RemindResult,
  AnnouncementStats,
};
