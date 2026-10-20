"use strict";
/**
 * System Health: Settings · System Health, the one screen the IT team opens to see
 * whether the ERP is well and what is broken.
 *
 * Three things cross the wire here. The readiness checks as they stand right now
 * (the same probes GET /api/health/ready runs). The snapshots the worker takes every
 * 5 minutes, drawn as a day or a week of behaviour. And faults: every row the error
 * reporter has written, grouped on the fingerprint it already computes, with a status
 * the whole team shares.
 *
 * Counts are never stored on a group. They are aggregated from error_event for the
 * window asked for, so a late or replayed row can never double count.
 *
 * Read and changed by holders of `system_health`; the brief also needs export.
 * Nothing here carries a person's name or email: a fault leaves the building in the
 * brief, so it travels as route, stack, release and counts only.
 */
const { z } = require("zod");
const { uuid, text, isoDateTime, listQuery, Paged } = require("./common");

/** How bad, as the error reporter writes it. `notice` is a 422: counted, never alerted. */
const Severity = z.enum(["fatal", "error", "warning", "notice"]);

/** Where it happened. */
const Origin = z.enum(["server", "worker", "job", "browser"]);

/** What the team has decided about a fault. */
const FaultStatus = z.enum(["open", "handling", "fixed", "ignored"]);

/** A readiness probe's state, as src/http/health.js reports it. */
const CheckState = z.enum(["up", "degraded", "down"]);

/** The whole service, worst check wins. */
const ServiceState = z.enum(["ready", "degraded", "unavailable"]);

/* ------------------------------------------------------------------ *
 * Status
 * ------------------------------------------------------------------ */

/** One probe, named as a person reads it, with what to do when it is not up. */
const HealthCheck = z
  .object({
    key: z.string(),
    label: z.string(),
    state: CheckState,
    /** What it is doing, in a line: "answered in 3 ms", "no heartbeat in 4 minutes". */
    detail: z.string(),
    /** Where to look when it is not up. Null when it is up. */
    look_at: z.string().nullable(),
    latency_ms: z.number().int().min(0).nullable(),
  })
  .strict();

/** GET /system-health/status */
const SystemHealthStatus = z
  .object({
    state: ServiceState,
    checked_at: isoDateTime,
    release: z.string(),
    deployed_at: isoDateTime.nullable(),
    checks: z.array(HealthCheck),
    faults_open: z.number().int().min(0),
    faults_new_24h: z.number().int().min(0),
    faults_returned_24h: z.number().int().min(0),
  })
  .strict();

/* ------------------------------------------------------------------ *
 * Performance
 * ------------------------------------------------------------------ */

/** GET /system-health/performance?range=24h */
const PerformanceQuery = z.object({ range: z.enum(["24h", "7d"]).default("24h") }).strict();

/** One bucket of the chart: an hour over a day, a day over a week. */
const PerformancePoint = z
  .object({
    at: isoDateTime,
    state: ServiceState,
    faults: z.number().int().min(0),
    outbox_backlog: z.number().int().min(0),
    worker_lag_s: z.number().int().min(0).nullable(),
    /** How the app answered. Null where nothing was served in the bucket. */
    requests: z.number().int().min(0).nullable(),
    mean_ms: z.number().int().min(0).nullable(),
    error_pct: z.string().nullable(),
    /** What the server had left. Null before the resource checks existed. */
    disk_free_pct: z.number().int().min(0).max(100).nullable(),
    memory_used_pct: z.number().int().min(0).max(100).nullable(),
    cpu_load: z.string().nullable(),
    database_mb: z.number().int().min(0).nullable(),
  })
  .strict();

const PerformanceSeries = z
  .object({
    range: z.enum(["24h", "7d"]),
    points: z.array(PerformancePoint),
    /** Minutes in the window with no snapshot: the worker was not running. */
    gap_minutes: z.number().int().min(0),
    /**
     * Nothing has been recorded recently, so the chart is empty because the job is not
     * running, not because the system is quiet. The screen says which (§10).
     */
    recording: z.boolean(),
    last_snapshot_at: isoDateTime.nullable(),
    /** How much of the window every check was up, as a percentage with one place. */
    uptime_pct: z.string().regex(/^\d{1,3}\.\d$/),
  })
  .strict();

/* ------------------------------------------------------------------ *
 * Faults
 * ------------------------------------------------------------------ */

/** A fault as the list shows it. */
const FaultRow = z
  .object({
    error_group_id: uuid,
    title: z.string(),
    severity: Severity,
    origin: Origin,
    route: z.string().nullable(),
    status: FaultStatus,
    assigned_to: uuid.nullable(),
    assigned_name: z.string().nullable(),
    first_seen_at: isoDateTime,
    last_seen_at: isoDateTime,
    last_release: z.string().nullable(),
    /** In the last 24 hours, and every occurrence still kept. */
    today: z.number().int().min(0),
    total: z.number().int().min(0),
    /** Different people who hit it. Never who they are. */
    people: z.number().int().min(0),
    /** It was marked fixed and has happened again. */
    came_back: z.boolean(),
  })
  .strict();

/** One occurrence, as the fault sheet lists the latest few. */
const FaultOccurrence = z
  .object({
    occurred_at: isoDateTime,
    route: z.string().nullable(),
    origin: Origin,
    release: z.string().nullable(),
    request_id: z.string().nullable(),
    message: z.string(),
    stack: z.string().nullable(),
  })
  .strict();

/** A note the team left on a fault. */
const FaultNote = z
  .object({
    error_group_note_id: uuid,
    body: z.string(),
    author_user_id: uuid.nullable(),
    author_name: z.string().nullable(),
    created_at: isoDateTime,
  })
  .strict();

/** GET /system-health/faults */
const FaultListQuery = listQuery(
  {
    status: z.enum(["active", "open", "handling", "fixed", "ignored", "all"]).default("active"),
    severity: Severity.optional(),
    origin: Origin.optional(),
  },
  ["last_seen_at", "today", "first_seen_at"],
);
const FaultPage = Paged(FaultRow);

/** GET /system-health/faults/:id */
const FaultDetail = FaultRow.extend({
  name: z.string(),
  last_message: z.string().nullable(),
  frame: z.string().nullable(),
  first_release: z.string().nullable(),
  regressions: z.number().int().min(0),
  /** What it probably means, in a sentence somebody who is not an engineer can act on. */
  plainly: z.string(),
  /** The last 14 days, oldest first, one count a day. */
  daily: z.array(z.object({ day: z.string(), events: z.number().int().min(0) }).strict()),
  occurrences: z.array(FaultOccurrence),
  notes: z.array(FaultNote),
}).strict();

/** PATCH /system-health/faults/:id: status, who holds it, or both. */
const FaultPatch = z
  .object({
    status: FaultStatus.optional(),
    assigned_to: uuid.nullable().optional(),
    note: text(2000).optional(),
  })
  .strict()
  .refine((v) => v.status !== undefined || v.assigned_to !== undefined, "Change a status or an owner");

const FaultNoteCreate = z.object({ body: text(2000) }).strict();

/** POST /system-health/faults/bulk */
const FaultBulkStatus = z
  .object({
    error_group_ids: z.array(uuid).min(1).max(50),
    status: z.enum(["fixed", "ignored", "open"]),
  })
  .strict();

const FaultBulkResult = z.object({ changed: z.number().int().min(0) }).strict();

/**
 * POST /system-health/briefs: the ticked faults as one Markdown file, with the
 * instructions an AI needs to fix them. Answered as documents ExportFile and
 * downloaded on the device that pressed, like every other export.
 */
const BriefRequest = z.object({ error_group_ids: z.array(uuid).min(1).max(25) }).strict();

/** Which table each schema is a row of (gate 6, check/contract-columns.js). */
const TABLES = {
  HealthCheck: { table: null, reason: "one readiness probe, run in process by src/http/health.js" },
  SystemHealthStatus: { table: null, reason: "the readiness probes and fault counts, neither of them stored" },
  PerformanceQuery: { table: null, reason: "which window the chart draws" },
  PerformancePoint: {
    table: "health_snapshot",
    virtual: {
      at: "the hour or day the snapshots in it were bucketed into",
      state: "the worst status of the snapshots in the bucket",
      faults: "the highest faults_open in the bucket",
      requests: "the requests summed over the bucket",
      mean_ms: "the mean of each snapshot's own mean",
      error_pct: "the highest error_pct in the bucket",
      cpu_load: "the highest cpu_load in the bucket",
    },
  },
  PerformanceSeries: { table: null, reason: "a window of bucketed snapshots" },
  FaultRow: {
    table: "error_group",
    virtual: {
      assigned_name: "the holder's display name, from app_user",
      today: "events in the last 24 hours, counted from error_event",
      total: "every occurrence still kept, counted from error_event",
      people: "how many different people hit it, counted from error_event",
      came_back: "regressed_at is set and the status is open again",
    },
  },
  FaultOccurrence: { table: "error_event" },
  FaultNote: { table: "error_group_note", virtual: { author_name: "the author's display name, from app_user" } },
  FaultDetail: {
    table: "error_group",
    virtual: {
      plainly: "what the fault means, matched from its message by system_health.explain.js",
      daily: "the last 14 days of counts from error_event",
      occurrences: "the latest error_event rows of this group",
      notes: "its error_group_note rows",
      assigned_name: "the holder's display name, from app_user",
      today: "events in the last 24 hours, counted from error_event",
      total: "every occurrence still kept, counted from error_event",
      people: "how many different people hit it, counted from error_event",
      came_back: "regressed_at is set and the status is open again",
    },
  },
  FaultListQuery: { table: null, reason: "list controls and the fault list's filters" },
  FaultPage: { table: null, reason: "a page of faults" },
  FaultPatch: { table: null, reason: "a status and an owner for one fault, with an optional note that becomes an error_group_note" },
  FaultNoteCreate: { table: "error_group_note" },
  FaultBulkStatus: { table: null, reason: "one status for several faults at once" },
  FaultBulkResult: { table: null, reason: "how many faults the bulk change moved" },
  BriefRequest: { table: null, reason: "the ticked faults, carried to the worker that writes the brief" },
};

module.exports = {
  TABLES,
  Severity,
  Origin,
  FaultStatus,
  CheckState,
  ServiceState,
  HealthCheck,
  SystemHealthStatus,
  PerformanceQuery,
  PerformancePoint,
  PerformanceSeries,
  FaultRow,
  FaultOccurrence,
  FaultNote,
  FaultListQuery,
  FaultPage,
  FaultDetail,
  FaultPatch,
  FaultNoteCreate,
  FaultBulkStatus,
  FaultBulkResult,
  BriefRequest,
};
