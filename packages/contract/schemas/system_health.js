"use strict";
/**
 * System Health: Settings · System Health, the one screen the IT team opens to see
 * whether the ERP is well and what is broken.
 *
 * Three things cross the wire here. The readiness checks as they stand right now
 * (the same probes GET /api/health/ready runs). The snapshots the worker takes every
 * 5 minutes and the samples it takes every minute, drawn over an hour, a day, a week
 * or a month. And faults: every row the error
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
    /**
     * When it entered the state it is in, from the last 7 days of snapshots: the oldest
     * of them when it has not changed in that time. Null when no snapshot has seen this
     * state yet: it changed within the last five minutes.
     */
    since: isoDateTime.nullable(),
  })
  .strict();

/** One figure a probe reported, as a person reads it: "Free" "9%". */
const CheckFact = z.object({ label: z.string(), value: z.string() }).strict();

/** How a background job is doing (src/jobs/report.js). */
const JobState = z.enum(["on_time", "failing", "late", "waiting"]);

/** One scheduler: what the code set it to, and what it has done. */
const SchedulerRow = z
  .object({
    name: z.string(),
    summary: z.string().nullable(),
    /** `queue`: ticked by BullMQ once across processes. `worker`: a timer inside every worker. */
    runs_in: z.enum(["queue", "worker"]),
    /** In words: "Daily at 02:30 (Lagos)". */
    cadence: z.string(),
    /** As the code declared it: "cron 30 2 * * * Africa/Lagos". */
    set_as: z.string(),
    /** How long it may be silent before it is late, in words. */
    late_after: z.string(),
    state: JobState,
    reason: z.string().nullable(),
    started_at: isoDateTime.nullable(),
    last_run_at: isoDateTime.nullable(),
    duration_ms: z.number().int().min(0).nullable(),
    last_ok: z.boolean().nullable(),
    last_error: z.string().nullable(),
    runs: z.number().int().min(0),
    failures: z.number().int().min(0),
    last_failure_at: isoDateTime.nullable(),
    next_run_at: isoDateTime.nullable(),
  })
  .strict();

/** One queue the worker consumes. `failed` is every failed job still kept, not today's. */
const QueueRow = z
  .object({
    queue: z.string(),
    summary: z.string().nullable(),
    concurrency: z.number().int().min(0),
    waiting: z.number().int().min(0),
    active: z.number().int().min(0),
    delayed: z.number().int().min(0),
    failed: z.number().int().min(0),
    paused: z.number().int().min(0),
    last_failed_at: isoDateTime.nullable(),
    last_failure: z.string().nullable(),
  })
  .strict();

/**
 * GET /system-health/checks/:key: one probe run now, with everything it reported. Jobs
 * for Background Jobs and queues for Worker; null on every other check. `unread` says
 * which source could not be read, so an empty table is never mistaken for an empty system.
 */
const CheckDetail = HealthCheck.extend({
  facts: z.array(CheckFact),
  jobs: z.array(SchedulerRow).nullable(),
  queues: z.array(QueueRow).nullable(),
  unread: z.array(z.string()),
}).strict();

/** GET /system-health/checks/:key/history: newest first, 25 a page. */
const CheckHistoryQuery = listQuery({});

/** A check changing state, as the five-minute snapshots saw it. */
const CheckChange = z
  .object({
    at: isoDateTime,
    from: CheckState,
    to: CheckState,
    /** What it said on that snapshot. */
    detail: z.string(),
  })
  .strict();
const CheckChangePage = Paged(CheckChange);

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

/**
 * The window Performance draws, and the bucket each point covers: an hour by the minute,
 * a day by 15 minutes, a week by the hour, a month by the day.
 */
const PerfRange = z.enum(["hour", "day", "week", "month"]);

/** A share with up to two places, as numeric columns travel: "99.95", "0.4". */
const pct = z.string().regex(/^\d{1,3}(\.\d{1,2})?$/);

/** Whether a figure met its target. `none` when the window had nothing to judge. */
const TargetState = z.enum(["met", "missed", "none"]);

/** GET /system-health/performance?range=day */
const PerformanceQuery = z.object({ range: PerfRange.default("day") }).strict();

/** One bucket of the window. Null wherever nothing was recorded in it: a gap, never zero. */
const PerformancePoint = z
  .object({
    at: isoDateTime,
    /** How the app answered (this environment's /api/ requests). */
    requests: z.number().int().min(0).nullable(),
    per_minute: pct.nullable(),
    p95_ms: z.number().int().min(0).nullable(),
    mean_ms: z.number().int().min(0).nullable(),
    error_pct: pct.nullable(),
    /** The share of the bucket's minutes in which the API answered ready. */
    up_pct: pct.nullable(),
    /** The whole server. */
    cpu_busy_pct: pct.nullable(),
    cpu_steal_pct: pct.nullable(),
    cpu_iowait_pct: pct.nullable(),
    memory_in_use_pct: pct.nullable(),
    disk_used_pct: pct.nullable(),
    disk_read_kbs: z.number().int().min(0).nullable(),
    disk_write_kbs: z.number().int().min(0).nullable(),
    network_in_kbs: z.number().int().min(0).nullable(),
    network_out_kbs: z.number().int().min(0).nullable(),
    users_online: z.number().int().min(0).nullable(),
  })
  .strict();

/** A headline figure and its target. */
const PerfFigure = z
  .object({
    value: pct.nullable(),
    target: pct,
    state: TargetState,
  })
  .strict();

const PerformanceSeries = z
  .object({
    range: PerfRange,
    bucket_minutes: z.number().int().min(1),
    from: isoDateTime,
    to: isoDateTime,
    points: z.array(PerformancePoint),
    availability: PerfFigure,
    /** Minutes the API did not answer ready, in the window. */
    down_minutes: z.number().int().min(0),
    response_p95: PerfFigure,
    response_mean_ms: z.number().int().min(0).nullable(),
    failed: PerfFigure,
    requests: z.number().int().min(0),
    per_minute: pct.nullable(),
    peak_per_minute: z.number().int().min(0).nullable(),
    /** Minutes since the first sample ever with no sample: the worker was not running. */
    gap_minutes: z.number().int().min(0),
    /** A sample in the last 3 minutes. False means the job has stopped, not that all is quiet (§6). */
    recording: z.boolean(),
    last_sample_at: isoDateTime.nullable(),
  })
  .strict();

/** What a part of the processor, memory or disk is. */
const UsePart = z.enum([
  "production",
  "staging",
  "database",
  "redis",
  "scanner",
  "other",
  "production_database",
  "production_files",
  "backups",
  "logs",
  "system",
]);

/** A share of the processor, in percent of the whole machine. */
const CpuPart = z.object({ key: UsePart, pct }).strict();

/** A share of memory or disk, in MB. */
const SizePart = z.object({ key: UsePart, mb: z.number().int().min(0) }).strict();

/** A check's state at the levels Edit Targets holds. */
const LevelState = z.enum(["up", "degraded", "down"]);

/** GET /system-health/capacity: the server as it stands now. */
const PerformanceCapacity = z
  .object({
    /** False where there is no /proc to read (a laptop): every figure below is null or empty. */
    supported: z.boolean(),
    sampled_at: isoDateTime.nullable(),
    cpu: z
      .object({
        cores: z.number().int().min(1).nullable(),
        model: z.string().nullable(),
        busy_pct: pct.nullable(),
        steal_pct: pct.nullable(),
        iowait_pct: pct.nullable(),
        load_1m: z.string().nullable(),
        peak_pct: pct.nullable(),
        peak_at: isoDateTime.nullable(),
        state: LevelState.nullable(),
        parts: z.array(CpuPart),
      })
      .strict(),
    memory: z
      .object({
        total_mb: z.number().int().min(0).nullable(),
        in_use_mb: z.number().int().min(0).nullable(),
        cache_mb: z.number().int().min(0).nullable(),
        free_mb: z.number().int().min(0).nullable(),
        swap_total_mb: z.number().int().min(0).nullable(),
        swap_used_mb: z.number().int().min(0).nullable(),
        state: LevelState.nullable(),
        parts: z.array(SizePart),
      })
      .strict(),
    disk: z
      .object({
        total_mb: z.number().int().min(0).nullable(),
        used_mb: z.number().int().min(0).nullable(),
        free_mb: z.number().int().min(0).nullable(),
        reserved_mb: z.number().int().min(0).nullable(),
        state: LevelState.nullable(),
        parts: z.array(SizePart),
        /** When the root timer last measured the parts; null when it never has. */
        parts_at: isoDateTime.nullable(),
        growth_mb_per_day: z.number().int().nullable(),
        /** Null when the disk is not filling, or there is less than a day to go on. */
        days_to_full: z.number().int().min(0).nullable(),
        read_kbs: z.number().int().min(0).nullable(),
        write_kbs: z.number().int().min(0).nullable(),
        busy_pct: pct.nullable(),
      })
      .strict(),
    network: z
      .object({
        in_kbs: z.number().int().min(0).nullable(),
        out_kbs: z.number().int().min(0).nullable(),
        /** Since the first of this month, Lagos time. */
        month_in_mb: z.number().int().min(0).nullable(),
        month_out_mb: z.number().int().min(0).nullable(),
        connections: z.number().int().min(0).nullable(),
      })
      .strict(),
    server: z
      .object({
        os: z.string().nullable(),
        kernel: z.string().nullable(),
        node: z.string(),
        postgres: z.string().nullable(),
        redis: z.string().nullable(),
        up_since: isoDateTime.nullable(),
        release: z.string(),
        deployed_at: isoDateTime.nullable(),
        restart_needed: z.boolean().nullable(),
        updates_waiting: z.number().int().min(0).nullable(),
        security_updates: z.number().int().min(0).nullable(),
      })
      .strict(),
  })
  .strict();

/** GET /system-health/routes: each route over the window, slowest first. */
const RouteStatQuery = listQuery({ range: PerfRange.default("day") }, ["p95_ms", "requests", "errors", "mean_ms"]);

const RouteStat = z
  .object({
    method: z.string(),
    route: z.string(),
    requests: z.number().int().min(0),
    errors: z.number().int().min(0),
    client_errors: z.number().int().min(0),
    slow: z.number().int().min(0),
    mean_ms: z.number().int().min(0),
    p95_ms: z.number().int().min(0),
    max_ms: z.number().int().min(0),
  })
  .strict();
const RouteStatPage = Paged(RouteStat);

/** GET /system-health/database */
const DatabaseSummary = z
  .object({
    version: z.string(),
    size_mb: z.number().int().min(0),
    growth_mb_per_day: z.number().int().nullable(),
    connections_used: z.number().int().min(0),
    connections_max: z.number().int().min(0),
    active: z.number().int().min(0),
    idle: z.number().int().min(0),
    idle_in_transaction: z.number().int().min(0),
    waiting: z.number().int().min(0),
    oldest_transaction_s: z.number().int().min(0).nullable(),
    cache_hit_pct: pct.nullable(),
    deadlocks: z.number().int().min(0),
    temp_mb: z.number().int().min(0),
    /** pg_stat_statements is loaded and readable, so Slowest Queries has rows. */
    statements: z.boolean(),
  })
  .strict();

/** GET /system-health/database/tables */
const TableStatQuery = listQuery({}, ["total_bytes", "rows", "dead_pct"]);
const TableStat = z
  .object({
    name: z.string(),
    rows: z.number().int().min(0),
    total_bytes: z.number().int().min(0),
    table_bytes: z.number().int().min(0),
    index_bytes: z.number().int().min(0),
    dead_pct: pct.nullable(),
    last_vacuum_at: isoDateTime.nullable(),
  })
  .strict();
const TableStatPage = Paged(TableStat);

/** GET /system-health/database/queries: pg_stat_statements, this environment's role only. */
const QueryStatQuery = listQuery({}, ["total_ms", "mean_ms", "calls"]);
const QueryStat = z
  .object({
    query_id: z.string(),
    /** Normalised by Postgres: every value is $1, $2, never the data. Cut at 400 characters. */
    query: z.string(),
    calls: z.number().int().min(0),
    total_ms: z.number().int().min(0),
    mean_ms: z.string(),
    max_ms: z.number().int().min(0),
    rows: z.number().int().min(0),
    share_pct: pct,
  })
  .strict();
const QueryStatPage = Paged(QueryStat);

/** GET /system-health/background */
const QueueStat = z
  .object({
    name: z.string(),
    waiting: z.number().int().min(0),
    active: z.number().int().min(0),
    delayed: z.number().int().min(0),
    failed: z.number().int().min(0),
  })
  .strict();

const BackgroundWork = z
  .object({
    /** Null when Redis did not answer. */
    queues: z.array(QueueStat).nullable(),
    outbox_waiting: z.number().int().min(0),
    outbox_oldest_s: z.number().int().min(0).nullable(),
    outbox_failed: z.number().int().min(0),
    outbox_done_hour: z.number().int().min(0),
    workers: z.number().int().min(0).nullable(),
  })
  .strict();

/** GET /system-health/background/jobs: every scheduler and how its runs have gone. */
const JobRunQuery = listQuery({}, ["name", "last_ms", "failures"]);
const JobRun = z
  .object({
    name: z.string(),
    summary: z.string().nullable(),
    /** "Every 5 minutes", "Daily at 08:00 (Lagos)": jobs/report.js cadenceOf. */
    every: z.string(),
    last_run_at: isoDateTime.nullable(),
    last_ms: z.number().int().min(0).nullable(),
    mean_ms: z.number().int().min(0).nullable(),
    max_ms: z.number().int().min(0).nullable(),
    runs: z.number().int().min(0),
    failures: z.number().int().min(0),
    /** jobs/report.js's judgement, the one Status reads: waiting is a job before its first slot. */
    state: z.enum(["on_time", "failing", "late", "waiting"]),
  })
  .strict();
const JobRunPage = Paged(JobRun);

/** GET /system-health/processes */
const ProcessRow = z
  .object({
    instance: z.string(),
    role: z.enum(["api", "worker"]),
    host: z.string(),
    pid: z.number().int().min(0),
    release: z.string().nullable(),
    started_at: isoDateTime,
    last_beat_at: isoDateTime,
    memory_mb: z.number().int().min(0).nullable(),
    heap_mb: z.number().int().min(0).nullable(),
    loop_delay_ms: z.number().int().min(0).nullable(),
    cpu_pct: pct.nullable(),
    sockets: z.number().int().min(0).nullable(),
  })
  .strict();

const ProcessList = z
  .object({
    people_online: z.number().int().min(0),
    sockets: z.number().int().min(0),
    processes: z.array(ProcessRow),
    api_starts_7d: z.number().int().min(0),
    worker_starts_7d: z.number().int().min(0),
  })
  .strict();

/** GET and PUT /system-health/targets: what Performance is judged against, and the levels Status alarms at. */
/** A whole percentage or millisecond figure, with errors short enough for the field (at most 4 words). */
const between = (lo, hi) =>
  z.number({ invalid_type_error: "Enter a number" }).int("Whole numbers only").min(lo, `At least ${lo}`).max(hi, `At most ${hi}`);

const targetFields = {
  availability_pct: z
    .string()
    .regex(/^\d{2}(\.\d{1,2})?$/, "Not a percentage")
    .refine((v) => Number(v) >= 90 && Number(v) <= 99.99, "Between 90 and 99.99"),
  response_p95_ms: between(100, 10000),
  error_pct: z
    .string()
    .regex(/^\d{1,2}(\.\d{1,2})?$/, "Not a percentage")
    .refine((v) => Number(v) >= 0.1 && Number(v) <= 20, "Between 0.1 and 20"),
  disk_warn_free_pct: between(2, 50),
  disk_down_free_pct: between(1, 49),
  memory_warn_pct: between(50, 98),
  memory_down_pct: between(51, 99),
  cpu_warn_pct: between(50, 98),
  cpu_down_pct: between(51, 100),
  connections_warn_pct: between(50, 95),
  connections_down_pct: between(51, 99),
};

/** Each down level is beyond its warning level, or a check would go down before it warned. */
const levelsInOrder = (v, ctx) => {
  const pairs = [
    ["disk_down_free_pct", v.disk_down_free_pct < v.disk_warn_free_pct, "Below the warning"],
    ["memory_down_pct", v.memory_down_pct > v.memory_warn_pct, "Above the warning"],
    ["cpu_down_pct", v.cpu_down_pct > v.cpu_warn_pct, "Above the warning"],
    ["connections_down_pct", v.connections_down_pct > v.connections_warn_pct, "Above the warning"],
  ];
  for (const [key, fine, message] of pairs) {
    if (!fine) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message });
  }
};

const PerformanceTargetsUpdate = z.object(targetFields).strict().superRefine(levelsInOrder);

const PerformanceTargets = z
  .object({
    ...targetFields,
    availability_pct: pct,
    error_pct: pct,
    /** Null while the defaults are in force. */
    updated_at: isoDateTime.nullable(),
    updated_by_name: z.string().nullable(),
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

/*
 * POST /system-health/status-briefs takes common EmptyBody: the whole system, as the
 * API sees it at the press, written by the worker into an ExportFile like the faults'.
 */

/** Which table each schema is a row of (gate 6, check/contract-columns.js). */
const TABLES = {
  HealthCheck: { table: null, reason: "one readiness probe, run in process by src/http/health.js" },
  CheckFact: { table: null, reason: "one figure a readiness probe reported, labelled" },
  SchedulerRow: {
    table: "schedule_run",
    virtual: {
      summary: "what the scheduler does, from its defineSchedule() file",
      runs_in: "whether the schedule queue or the worker's own timer runs it, from its file",
      cadence: "its every or pattern, in words",
      set_as: "its every or pattern, as declared",
      late_after: "how long it may be silent, from jobs/report.js",
      state: "on time, failing, late or waiting, judged by jobs/report.js",
      reason: "why it is in that state",
      started_at: "created_at: when the worker first started it",
      last_ok: "ok",
      last_error: "note, scrubbed, when the last run failed",
      next_run_at: "the schedule queue's next tick, or the last run plus its interval",
    },
  },
  QueueRow: { table: null, reason: "a BullMQ queue's counts, read from Redis" },
  CheckDetail: { table: null, reason: "one readiness probe run now, with the jobs or queues behind it" },
  CheckHistoryQuery: { table: null, reason: "list controls for a check's history" },
  CheckChange: {
    table: "health_snapshot",
    virtual: {
      at: "taken_at of the snapshot where the state changed",
      from: "the check's status on the snapshot before, from checks",
      to: "the check's status on this snapshot, from checks",
      detail: "what the check said on this snapshot, in words",
    },
  },
  CheckChangePage: { table: null, reason: "a page of a check's changes" },
  SystemHealthStatus: { table: null, reason: "the readiness probes and fault counts, neither of them stored" },
  PerformanceQuery: { table: null, reason: "which window Performance draws" },
  PerformancePoint: {
    table: "perf_sample",
    virtual: {
      at: "the minute, quarter hour, hour or day the samples in it were bucketed into",
      requests: "the /api/ requests in the bucket, summed from request_stat",
      per_minute: "requests over the bucket's minutes",
      p95_ms: "the 95th percentile worked from request_stat's latency buckets",
      mean_ms: "total time over requests, from request_stat",
      error_pct: "answers of 500 or more over requests, from request_stat",
      up_pct: "the share of the bucket's samples with api_up",
      memory_in_use_pct: "memory_in_use_mb over memory_total_mb",
      disk_used_pct: "disk_used_mb over disk_total_mb",
      disk_read_kbs: "disk_read_kb per second over the bucket",
      disk_write_kbs: "disk_written_kb per second over the bucket",
      network_in_kbs: "network_in_kb per second over the bucket",
      network_out_kbs: "network_out_kb per second over the bucket",
    },
  },
  PerfFigure: { table: null, reason: "a headline figure worked out over the window, and its target" },
  PerformanceSeries: { table: null, reason: "a window of bucketed samples and the figures worked from them" },
  CpuPart: { table: null, reason: "one service's share of the processor, from perf_sample's <group>_cpu_pct" },
  SizePart: { table: null, reason: "one part of memory or disk, from perf_sample or the root timer's file" },
  PerformanceCapacity: { table: null, reason: "the latest perf_sample, the root timer's file and the process's own facts" },
  RouteStatQuery: { table: null, reason: "list controls and the window" },
  RouteStat: {
    table: "route_stat",
    virtual: {
      mean_ms: "total_ms over requests for the window",
      p95_ms: "the 95th percentile worked from the summed buckets",
    },
  },
  RouteStatPage: { table: null, reason: "a page of routes" },
  DatabaseSummary: { table: null, reason: "read from pg_stat_database, pg_stat_activity and pg_settings, nothing stored" },
  TableStatQuery: { table: null, reason: "list controls" },
  TableStat: { table: null, reason: "one table, from pg_stat_user_tables and the size functions" },
  TableStatPage: { table: null, reason: "a page of tables" },
  QueryStatQuery: { table: null, reason: "list controls" },
  QueryStat: { table: null, reason: "one normalised statement, from pg_stat_statements" },
  QueryStatPage: { table: null, reason: "a page of statements" },
  QueueStat: { table: null, reason: "one BullMQ queue's counts, read from Redis" },
  BackgroundWork: { table: null, reason: "the queues, the event_outbox counts and the worker heartbeats" },
  JobRunQuery: { table: null, reason: "list controls" },
  JobRun: {
    table: "schedule_run",
    virtual: {
      summary: "the scheduler's own summary, from jobs/schedulers",
      every: "its interval or cron, in words",
      last_ms: "duration_ms of the last run",
      mean_ms: "total_ms over runs",
      state: "on time, late or failing, judged as the schedulers check judges it",
    },
  },
  JobRunPage: { table: null, reason: "a page of schedulers" },
  ProcessRow: { table: "process_beat" },
  ProcessList: { table: null, reason: "the live process_beat rows and the starts this week" },
  PerformanceTargets: {
    table: "performance_target",
    virtual: { updated_by_name: "the person who last saved, from app_user" },
  },
  PerformanceTargetsUpdate: { table: "performance_target" },
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
  CheckFact,
  JobState,
  SchedulerRow,
  QueueRow,
  CheckDetail,
  CheckHistoryQuery,
  CheckChange,
  CheckChangePage,
  SystemHealthStatus,
  PerfRange,
  TargetState,
  PerformanceQuery,
  PerformancePoint,
  PerfFigure,
  PerformanceSeries,
  UsePart,
  CpuPart,
  SizePart,
  LevelState,
  PerformanceCapacity,
  RouteStatQuery,
  RouteStat,
  RouteStatPage,
  DatabaseSummary,
  TableStatQuery,
  TableStat,
  TableStatPage,
  QueryStatQuery,
  QueryStat,
  QueryStatPage,
  QueueStat,
  BackgroundWork,
  JobRunQuery,
  JobRun,
  JobRunPage,
  ProcessRow,
  ProcessList,
  PerformanceTargets,
  PerformanceTargetsUpdate,
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
