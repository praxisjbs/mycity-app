"use strict";
/**
 * Announcements (M1, docs/guides/community.md §3 step 2, §3 step 12): the record behind a
 * post in #announcements, its audience, its schedule and who has read it. Published and
 * tracked by holders of the announcements.post capability (People and the CEO).
 *
 * Read counts are visible to the poster and capability holders only (§6).
 */
const { z } = require("zod");
const { uuid, text, isoDateTime, listQuery, Paged } = require("./common");
const { PersonRef } = require("./organisation");

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
    author: PersonRef.nullable(),
    publish_at: isoDateTime.nullable(),
    published_at: isoDateTime.nullable(),
    reads: z.number().int().min(0),
    audience_size: z.number().int().min(0),
  })
  .strict();

const AnnouncementListQuery = listQuery();
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
    publish_at: isoDateTime.optional(),
  })
  .strict();

/**
 * PUT /community/announcements/:id: change a scheduled announcement before it goes out.
 * publish_at stays required, and in the future: an edit never publishes.
 */
const AnnouncementUpdate = z
  .object({
    title: text(120),
    body: text(4000),
    audience: Audience,
    publish_at: isoDateTime,
  })
  .strict();

/** GET /community/announcements/:id/reads: one person in the audience. */
const AnnouncementReader = z
  .object({ person: PersonRef, read_at: isoDateTime.nullable() })
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
      reads: "how many of the audience have opened it, from announcement_read",
    },
  },
  AnnouncementListQuery: { table: null, reason: "list controls for the tracking tab" },
  AnnouncementPage: { table: null, reason: "a page of announcements" },
  AnnouncementCreate: { table: "announcement" },
  AnnouncementUpdate: { table: "announcement" },
  AnnouncementReader: {
    table: "announcement_read",
    virtual: { person: "the reader's employee, as a PersonRef" },
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
  AnnouncementPage,
  AnnouncementCreate,
  AnnouncementUpdate,
  AnnouncementReader,
  AnnouncementReadQuery,
  AnnouncementReadPage,
  RemindResult,
  AnnouncementStats,
};
