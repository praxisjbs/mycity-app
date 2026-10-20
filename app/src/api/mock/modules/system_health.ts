import type {
  BackgroundWork,
  CheckChange,
  DatabaseSummary,
  FaultRow,
  HealthCheck,
  JobRun,
  PerformanceCapacity,
  PerformancePoint,
  PerformanceSeries,
  PerformanceTargets,
  ProcessList,
  QueryStat,
  QueueRow,
  RouteStat,
  SchedulerRow,
  TableStat,
} from "@mycity/contract/contract.gen.ts";
import { fail, ok, paged, route } from "../core";

/**
 * System Health on the mock (packages/contract/schemas/system_health.js): a system that
 * is mostly well, with a handful of invented faults so the screen can be built and read
 * without a database behind it.
 *
 * The faults are made up. None of them names a person, which is the rule the real brief
 * keeps too, and the brief itself is not built here: the mock holds no bytes, so pressing
 * Download Brief says so rather than saving an empty file.
 */
const HOURS = (n: number) => new Date(Date.now() - n * 3_600_000).toISOString();

const CHECKS: HealthCheck[] = [
  { key: "postgres", label: "Database", state: "up", detail: "answered in 2 ms", look_at: null, latency_ms: 2, since: null },
  { key: "redis", label: "Cache and Sessions", state: "up", detail: "answered in 1 ms", look_at: null, latency_ms: 1, since: null },
  { key: "worker", label: "Worker", state: "up", detail: "last beat 12 s ago", look_at: null, latency_ms: null, since: null },
  { key: "modules", label: "Modules", state: "up", detail: "25 mounted", look_at: null, latency_ms: null, since: null },
  { key: "migrations", label: "Migrations", state: "up", detail: "at 9190_seed_system_health", look_at: null, latency_ms: null, since: null },
  { key: "numbering", label: "Numbering", state: "up", detail: "Answering", look_at: null, latency_ms: null, since: null },
  { key: "outbox", label: "Events", state: "up", detail: "3 waiting", look_at: null, latency_ms: null, since: null },
  { key: "storage", label: "File Storage", state: "up", detail: "Answering", look_at: null, latency_ms: null, since: null },
  { key: "chromium", label: "PDFs", state: "up", detail: "Answering", look_at: null, latency_ms: null, since: null },
  { key: "ffmpeg", label: "Voice and Video", state: "up", detail: "Answering", look_at: null, latency_ms: null, since: null },
  {
    key: "clamd",
    label: "Upload Scanning",
    state: "degraded",
    detail: "not connected",
    look_at: "Uploads cannot be scanned, so they are refused.",
    latency_ms: null,
    since: HOURS(3),
  },
  { key: "mail", label: "Mail", state: "up", detail: "4 of 200 this hour", look_at: null, latency_ms: null, since: null },
  { key: "ai", label: "AI", state: "up", detail: "answering: stub", look_at: null, latency_ms: null, since: null },
  { key: "disk", label: "Disk Space", state: "up", detail: "46% free, 118 GB of 252 GB", look_at: null, latency_ms: null, since: null },
  { key: "memory", label: "Memory", state: "up", detail: "28% in use, 5.1 GB of 18 GB", look_at: null, latency_ms: null, since: null },
  { key: "cpu", label: "Processor", state: "up", detail: "23.4% busy across 8 cores", look_at: null, latency_ms: null, since: null },
  { key: "database_usage", label: "Database Usage", state: "up", detail: "742 MB, 11 of 100 connections", look_at: null, latency_ms: null, since: null },
  {
    key: "schedulers",
    label: "Background Jobs",
    state: "degraded",
    detail: "1 of 19 have not run: media-reconcile, 2 not due yet",
    look_at: "A job has not run when it should have. Reminders, snapshots and clean-ups are waiting.",
    latency_ms: null,
    since: HOURS(26),
  },
];

const FAULTS: FaultRow[] = [
  {
    error_group_id: "f0000000-0000-4000-8000-000000000001",
    title: "TypeError: Cannot read properties of undefined (reading 'employee_id')",
    severity: "error",
    origin: "server",
    route: "POST /api/v1/leave",
    status: "open",
    assigned_to: null,
    assigned_name: null,
    first_seen_at: HOURS(30),
    last_seen_at: HOURS(1),
    last_release: "b7c2f91",
    today: 6,
    total: 23,
    people: 4,
    came_back: false,
  },
  {
    error_group_id: "f0000000-0000-4000-8000-000000000002",
    title: "error: duplicate key value violates unique constraint \"expense_number_key\"",
    severity: "error",
    origin: "server",
    route: "POST /api/v1/expenses",
    status: "handling",
    assigned_to: "00000000-0000-4000-8000-0000000000a1",
    assigned_name: "Godwin-Okoh Elisha",
    first_seen_at: HOURS(50),
    last_seen_at: HOURS(4),
    last_release: "b7c2f91",
    today: 2,
    total: 9,
    people: 2,
    came_back: true,
  },
  {
    error_group_id: "f0000000-0000-4000-8000-000000000003",
    title: "Error: SMTP command failed: 451 temporary failure",
    severity: "warning",
    origin: "worker",
    route: null,
    status: "open",
    assigned_to: null,
    assigned_name: null,
    first_seen_at: HOURS(8),
    last_seen_at: HOURS(2),
    last_release: "b7c2f91",
    today: 11,
    total: 11,
    people: 0,
    came_back: false,
  },
  {
    error_group_id: "f0000000-0000-4000-8000-000000000004",
    title: "ValidationError: Check the highlighted fields",
    severity: "notice",
    origin: "server",
    route: "POST /api/v1/people/employees",
    status: "ignored",
    assigned_to: null,
    assigned_name: null,
    first_seen_at: HOURS(200),
    last_seen_at: HOURS(26),
    last_release: "a10d4c8",
    today: 0,
    total: 48,
    people: 7,
    came_back: false,
  },
];

const ACTIVE = new Set(["open", "handling"]);

/** The worker's schedulers as the code declares them (src/jobs/schedulers), with invented runs. */
const SCHEDULE: Array<[string, string, string, string, string]> = [
  ["outbox-dispatch", "Runs the follow-on work of committed changes", "Every second", "every 1000 ms", "worker"],
  ["workflow-timeout", "Applies the time limit of approvals nobody decided", "Every 5 minutes", "every 300000 ms", "queue"],
  ["alert-ageing", "Escalates high alerts nobody cleared", "Hourly at :10", "cron 10 * * * * Africa/Lagos", "queue"],
  ["media-reconcile", "Finds files without a record and records without a file", "Daily at 02:30 (Lagos)", "cron 30 2 * * * Africa/Lagos", "queue"],
  ["import-cleanup", "Closes imports that were started and left", "Daily at 03:00 (Lagos)", "cron 0 3 * * * Africa/Lagos", "queue"],
  ["celebrations", "Birthday and work anniversary cards posted to #general", "Daily at 08:00 (Lagos)", "cron 0 8 * * * Africa/Lagos", "queue"],
  ["system-health", "Groups faults, snapshots the readiness checks", "Every 5 minutes", "every 300000 ms", "queue"],
  ["system-health-digest", "The daily System Health summary at 08:00", "Daily at 08:00 (Lagos)", "cron 0 8 * * * Africa/Lagos", "queue"],
];

const JOBS: SchedulerRow[] = SCHEDULE.map(([name, summary, cadence, set_as, runs_in], i) => {
  const late = name === "media-reconcile";
  const waiting = name === "import-cleanup" || name === "system-health-digest";
  return {
    name,
    summary,
    runs_in: runs_in as SchedulerRow["runs_in"],
    cadence,
    set_as,
    late_after: set_as.startsWith("cron") && !set_as.includes(" * * * * ") ? "26 hours" : "15 minutes",
    state: late ? "late" : waiting ? "waiting" : "on_time",
    reason: late ? "Has not run for 2 days" : waiting ? "Its first slot has not come yet" : null,
    started_at: HOURS(late ? 72 : waiting ? 2 : 72),
    last_run_at: waiting ? null : HOURS(late ? 50 : 0),
    duration_ms: waiting ? null : 40 + i * 13,
    last_ok: waiting ? null : !late,
    last_error: late ? "ENOENT: no such file or directory, scandir '/srv/mycity/prod/media/vault'" : null,
    runs: waiting ? 0 : 120 + i * 40,
    failures: late ? 3 : 0,
    last_failure_at: late ? HOURS(50) : null,
    next_run_at: runs_in === "worker" ? HOURS(0) : HOURS(-2 - i),
  };
});

const QUEUES: QueueRow[] = ["email-send", "pdf-render", "notification-deliver", "media-scan", "scheduled-report"].map((queue, i) => ({
  queue,
  summary: null,
  concurrency: 2,
  waiting: queue === "media-scan" ? 4 : 0,
  active: 0,
  delayed: queue === "email-send" ? 2 : 0,
  failed: queue === "media-scan" ? 6 : i,
  paused: 0,
  last_failed_at: queue === "media-scan" ? HOURS(3) : null,
  last_failure: queue === "media-scan" ? "connect ECONNREFUSED /var/run/clamav/clamd.ctl" : null,
}));

/** A week of one check flipping now and then, newest first. */
const changesOf = (c: HealthCheck): CheckChange[] =>
  c.state === "up"
    ? []
    : [
        { at: c.since ?? HOURS(1), from: "up", to: c.state, detail: c.detail },
        { at: HOURS(40), from: c.state, to: "up", detail: "Answering" },
        { at: HOURS(44), from: "up", to: c.state, detail: c.detail },
      ];

route("GET /api/v1/system-health/status", () =>
  ok({
    state: CHECKS.some((c) => c.state === "down") ? "unavailable" : CHECKS.some((c) => c.state !== "up") ? "degraded" : "ready",
    checked_at: new Date().toISOString(),
    release: "b7c2f91",
    deployed_at: HOURS(20),
    checks: CHECKS,
    faults_open: FAULTS.filter((f) => ACTIVE.has(f.status)).length,
    faults_new_24h: 2,
    faults_returned_24h: 1,
  }),
);

/* ───────────── Performance ───────────── */

/** One server the size of MyCity's: 8 cores, 18 GB of memory, a 236 GB disk. */
const GB = 1024;
const MEMORY_MB = 18 * GB;
const DISK_MB = 236 * GB;
const WINDOW: Record<string, { minutes: number; bucket: number }> = {
  hour: { minutes: 60, bucket: 1 },
  day: { minutes: 24 * 60, bucket: 15 },
  week: { minutes: 7 * 24 * 60, bucket: 60 },
  month: { minutes: 30 * 24 * 60, bucket: 24 * 60 },
};
/** Buckets start on Lagos boundaries, as the server bins them. */
const ORIGIN = Date.UTC(1999, 11, 31, 23, 0, 0);
const wave = (i: number, period: number, low: number, high: number) => low + ((Math.sin((i / period) * Math.PI * 2) + 1) / 2) * (high - low);
const two = (n: number) => String(Math.round(n * 100) / 100);

let targets: PerformanceTargets = {
  availability_pct: "99.90",
  response_p95_ms: 800,
  error_pct: "1.00",
  disk_warn_free_pct: 10,
  disk_down_free_pct: 5,
  memory_warn_pct: 90,
  memory_down_pct: 95,
  cpu_warn_pct: 85,
  cpu_down_pct: 95,
  connections_warn_pct: 80,
  connections_down_pct: 90,
  updated_at: null,
  updated_by_name: null,
};

route("GET /api/v1/system-health/performance", (req) => {
  const range = (["hour", "day", "week", "month"].includes(req.query.range ?? "") ? req.query.range : "day") as PerformanceSeries["range"];
  const w = WINDOW[range];
  const step = w.bucket * 60_000;
  const now = Date.now();
  const count = Math.floor(w.minutes / w.bucket);
  const last = ORIGIN + Math.floor((now - ORIGIN) / step) * step;
  const points: PerformancePoint[] = [];
  for (let i = 0; i < count; i += 1) {
    // Two buckets with nothing recorded, so the chart draws its gap.
    if (i === Math.floor(count * 0.35) || i === Math.floor(count * 0.35) + 1) continue;
    const at = last - (count - 1 - i) * step;
    const perMinute = wave(i, count / 2, 4, 42);
    points.push({
      at: new Date(at).toISOString(),
      requests: Math.round(perMinute * w.bucket),
      per_minute: two(perMinute),
      p95_ms: Math.round(wave(i, count / 3, 180, i % 17 === 0 ? 1100 : 520)),
      mean_ms: Math.round(wave(i, count / 3, 45, 140)),
      error_pct: two(i % 23 === 0 ? 1.6 : wave(i, count / 4, 0, 0.6)),
      up_pct: i === Math.floor(count * 0.7) ? "93.33" : "100",
      cpu_busy_pct: two(wave(i, count / 2, 9, 61)),
      cpu_steal_pct: two(wave(i, count / 5, 0.2, 2.4)),
      cpu_iowait_pct: two(wave(i, count / 6, 0.5, 4)),
      memory_in_use_pct: two(wave(i, count, 26, 34)),
      disk_used_pct: two(9.8 + (i / count) * 0.4),
      disk_read_kbs: Math.round(wave(i, count / 3, 40, 900)),
      disk_write_kbs: Math.round(wave(i, count / 4, 120, 1600)),
      network_in_kbs: Math.round(wave(i, count / 2, 60, 820)),
      network_out_kbs: Math.round(wave(i, count / 2, 140, 2400)),
      users_online: Math.round(wave(i, count / 2, 2, 31)),
    });
  }
  const body: PerformanceSeries = {
    range,
    bucket_minutes: w.bucket,
    from: new Date(now - w.minutes * 60_000).toISOString(),
    to: new Date(now).toISOString(),
    points,
    availability: { value: range === "hour" ? "100" : "99.93", target: targets.availability_pct, state: range === "hour" ? "met" : "met" },
    down_minutes: range === "hour" ? 0 : 1,
    response_p95: { value: "412", target: String(targets.response_p95_ms), state: 412 <= targets.response_p95_ms ? "met" : "missed" },
    response_mean_ms: 96,
    failed: { value: "0.31", target: targets.error_pct, state: "met" },
    requests: points.reduce((a, p) => a + (p.requests ?? 0), 0),
    per_minute: "23.4",
    peak_per_minute: 118,
    gap_minutes: w.bucket * 2,
    recording: true,
    last_sample_at: new Date(now - 40_000).toISOString(),
  };
  return ok(body);
});

route("GET /api/v1/system-health/capacity", () => {
  const body: PerformanceCapacity = {
    supported: true,
    sampled_at: new Date(Date.now() - 40_000).toISOString(),
    cpu: {
      cores: 8,
      model: "AMD EPYC 7543P 32-Core Processor",
      busy_pct: "23.4",
      steal_pct: "1.2",
      iowait_pct: "0.8",
      load_1m: "1.86",
      peak_pct: "71.2",
      peak_at: HOURS(3),
      state: busyLevel(23.4),
      parts: [
        { key: "production", pct: "12.1" },
        { key: "staging", pct: "2.9" },
        { key: "database", pct: "5.6" },
        { key: "redis", pct: "0.4" },
        { key: "scanner", pct: "0.6" },
        { key: "other", pct: "1.8" },
      ],
    },
    memory: {
      total_mb: MEMORY_MB,
      in_use_mb: 5222,
      cache_mb: 9626,
      free_mb: 3584,
      swap_total_mb: 2048,
      swap_used_mb: 0,
      state: "up",
      parts: [
        { key: "production", mb: 1946 },
        { key: "staging", mb: 819 },
        { key: "database", mb: 1638 },
        { key: "redis", mb: 205 },
        { key: "scanner", mb: 410 },
        { key: "other", mb: 204 },
      ],
    },
    disk: {
      total_mb: DISK_MB,
      used_mb: 24 * GB,
      free_mb: 200 * GB,
      reserved_mb: 12 * GB,
      state: "up",
      parts: [
        { key: "production_database", mb: 3174 },
        { key: "production_files", mb: 8397 },
        { key: "staging", mb: 2150 },
        { key: "backups", mb: 6298 },
        { key: "logs", mb: 1126 },
        { key: "system", mb: 3431 },
      ],
      parts_at: new Date(Date.now() - 7 * 60_000).toISOString(),
      growth_mb_per_day: 512,
      days_to_full: 400,
      read_kbs: 310,
      write_kbs: 1240,
      busy_pct: "3.2",
    },
    network: { in_kbs: 220, out_kbs: 960, month_in_mb: 14 * GB, month_out_mb: 41 * GB, connections: 46 },
    server: {
      os: "Ubuntu 24.04.1 LTS",
      kernel: "6.8.0-45-generic",
      node: "v20.19.0",
      postgres: "16.4",
      redis: "7.0.15",
      up_since: HOURS(24 * 12),
      release: "b7c2f91a4e08d3",
      deployed_at: HOURS(6),
      restart_needed: false,
      updates_waiting: 12,
      security_updates: 3,
    },
  };
  return ok(body);
});

function busyLevel(busy: number): PerformanceCapacity["cpu"]["state"] {
  return busy >= targets.cpu_down_pct ? "down" : busy >= targets.cpu_warn_pct ? "degraded" : "up";
}

const ROUTES: RouteStat[] = [
  ["GET", "/api/v1/employees", 4120, 0, 12, 3, 61, 240, 1310],
  ["POST", "/api/v1/attendance/clock", 1880, 2, 41, 9, 140, 690, 2400],
  ["GET", "/api/v1/home/overview", 1510, 0, 0, 14, 210, 910, 3020],
  ["GET", "/api/v1/mailbox/threads", 1340, 1, 3, 22, 260, 1180, 4870],
  ["POST", "/api/v1/leave", 211, 4, 18, 2, 180, 640, 1900],
  ["GET", "/api/v1/notifications", 3900, 0, 0, 0, 22, 70, 410],
  ["GET", "/api/v1/community/channels/:id/messages", 2210, 0, 4, 1, 48, 160, 1050],
  ["POST", "/api/v1/expenses", 64, 1, 7, 0, 150, 420, 880],
  ["GET", "(no route)", 37, 0, 37, 0, 4, 9, 30],
].map(([method, route, requests, errors, client_errors, slow, mean_ms, p95_ms, max_ms]) => ({
  method: method as string,
  route: route as string,
  requests: requests as number,
  errors: errors as number,
  client_errors: client_errors as number,
  slow: slow as number,
  mean_ms: mean_ms as number,
  p95_ms: p95_ms as number,
  max_ms: max_ms as number,
}));

route("GET /api/v1/system-health/routes", (req) =>
  paged(ROUTES, req, {
    search: (r) => [r.route],
    filters: { range: () => true },
    sort: {
      p95_ms: (a, b) => a.p95_ms - b.p95_ms,
      requests: (a, b) => a.requests - b.requests,
      errors: (a, b) => a.errors - b.errors,
      mean_ms: (a, b) => a.mean_ms - b.mean_ms,
    },
  }),
);

route("GET /api/v1/system-health/database", () => {
  const body: DatabaseSummary = {
    version: "16.4",
    size_mb: 3174,
    growth_mb_per_day: 41,
    connections_used: 23,
    connections_max: 200,
    active: 3,
    idle: 19,
    idle_in_transaction: 1,
    waiting: 0,
    oldest_transaction_s: 2,
    cache_hit_pct: "99.62",
    deadlocks: 0,
    temp_mb: 18,
    statements: true,
  };
  return ok(body);
});

const MB = 1024 * 1024;
const TABLES: TableStat[] = [
  ["error_event", 182_400, 410, 290, 120, "2.1", 1],
  ["community_message", 96_210, 380, 260, 120, "0.8", 3],
  ["audit_ledger", 240_880, 352, 280, 72, null, 5],
  ["attendance_punch", 61_300, 120, 80, 40, "1.4", 2],
  ["perf_sample", 43_200, 18, 12, 6, "0.2", 1],
  ["employee", 214, 2, 1, 1, null, 9],
].map(([name, rows, total, table, index, dead, days]) => ({
  name: name as string,
  rows: rows as number,
  total_bytes: (total as number) * MB,
  table_bytes: (table as number) * MB,
  index_bytes: (index as number) * MB,
  dead_pct: dead as string | null,
  last_vacuum_at: HOURS((days as number) * 24),
}));

route("GET /api/v1/system-health/database/tables", (req) =>
  paged(TABLES, req, {
    sort: {
      total_bytes: (a, b) => a.total_bytes - b.total_bytes,
      rows: (a, b) => a.rows - b.rows,
      dead_pct: (a, b) => Number(a.dead_pct ?? 0) - Number(b.dead_pct ?? 0),
    },
  }),
);

const QUERIES: QueryStat[] = [
  ["SELECT e.employee_id, e.first_name, e.last_name, COUNT(*) OVER() AS _total FROM employee e WHERE search_fold(e.first_name) LIKE $1 ORDER BY e.last_name LIMIT $2 OFFSET $3", 8120, 48_300, "5.95", 410, 25, "21.4"],
  ["INSERT INTO perf_sample (minute, cores, cpu_busy_pct) VALUES ($1, $2, $3) ON CONFLICT (minute) DO NOTHING", 1440, 2_100, "1.46", 22, 1, "0.9"],
  ["SELECT m.* FROM community_message m WHERE m.channel_id = $1 AND m.created_at < $2 ORDER BY m.created_at DESC", 6610, 39_800, "6.02", 380, 25, "17.6"],
  ["UPDATE event_outbox SET status = $1, processed_at = now() WHERE outbox_id = $2", 22_400, 31_200, "1.39", 95, 1, "13.8"],
].map(([query, calls, total, mean, max, rows, share], i) => ({
  query_id: String(-7_200_000_000 + i * 1_000_003),
  query: query as string,
  calls: calls as number,
  total_ms: total as number,
  mean_ms: mean as string,
  max_ms: max as number,
  rows: (rows as number) * (calls as number),
  share_pct: share as string,
}));

route("GET /api/v1/system-health/database/queries", (req) =>
  paged(QUERIES, req, {
    sort: {
      total_ms: (a, b) => a.total_ms - b.total_ms,
      mean_ms: (a, b) => Number(a.mean_ms) - Number(b.mean_ms),
      calls: (a, b) => a.calls - b.calls,
    },
  }),
);

route("GET /api/v1/system-health/background", () => {
  const body: BackgroundWork = {
    queues: [
      { name: "email-send", waiting: 0, active: 1, delayed: 2, failed: 3 },
      { name: "pdf-render", waiting: 0, active: 0, delayed: 0, failed: 0 },
      { name: "notification-deliver", waiting: 4, active: 2, delayed: 0, failed: 0 },
      { name: "schedule", waiting: 0, active: 1, delayed: 26, failed: 0 },
    ],
    outbox_waiting: 3,
    outbox_oldest_s: 2,
    outbox_failed: 0,
    outbox_done_hour: 412,
    workers: 1,
  };
  return ok(body);
});

const JOB_RUNS: JobRun[] = [
  ["system-health-sample", "Every minute", 0.6, 840, 790, 2400, 4310, 0, "on_time"],
  ["system-health", "Every 5 minutes", 2, 3100, 2850, 9100, 860, 0, "on_time"],
  ["outbox-dispatch", "Every second", 0.01, 12, 9, 640, 258_000, 2, "on_time"],
  ["reminders", "Every 5 minutes", 3, 210, 190, 1800, 860, 0, "on_time"],
  ["system-health-digest", "Daily at 08:00 (Lagos)", 280, 420, 410, 700, 3, 0, "on_time"],
  ["mail-sync", "Every 2 minutes", 30, 5200, 4100, 31_000, 2150, 41, "failing"],
  ["scheduled-reports", "Hourly at :20", null, null, null, null, 0, 0, "waiting"],
].map(([name, every, ago, last, mean, max, runs, failures, state]) => ({
  name: name as string,
  summary: null,
  every: every as string,
  last_run_at: ago === null ? null : new Date(Date.now() - (ago as number) * 60_000).toISOString(),
  last_ms: last as number | null,
  mean_ms: mean as number | null,
  max_ms: max as number | null,
  runs: runs as number,
  failures: failures as number,
  state: state as JobRun["state"],
}));

route("GET /api/v1/system-health/background/jobs", (req) =>
  paged(JOB_RUNS, req, {
    sort: {
      name: (a, b) => a.name.localeCompare(b.name),
      last_ms: (a, b) => (a.last_ms ?? 0) - (b.last_ms ?? 0),
      failures: (a, b) => a.failures - b.failures,
    },
  }),
);

route("GET /api/v1/system-health/processes", () => {
  const body: ProcessList = {
    people_online: 14,
    sockets: 19,
    processes: [
      {
        instance: "api:mycity-1:41822:1",
        role: "api",
        host: "mycity-1",
        pid: 41822,
        release: "b7c2f91a4e08d3",
        started_at: HOURS(6),
        last_beat_at: new Date(Date.now() - 20_000).toISOString(),
        memory_mb: 312,
        heap_mb: 141,
        loop_delay_ms: 11,
        cpu_pct: "3.4",
        sockets: 19,
      },
      {
        instance: "worker:mycity-1:41830:1",
        role: "worker",
        host: "mycity-1",
        pid: 41830,
        release: "b7c2f91a4e08d3",
        started_at: HOURS(6),
        last_beat_at: new Date(Date.now() - 35_000).toISOString(),
        memory_mb: 538,
        heap_mb: 196,
        loop_delay_ms: 24,
        cpu_pct: "6.1",
        sockets: null,
      },
    ],
    api_starts_7d: 3,
    worker_starts_7d: 3,
  };
  return ok(body);
});

route("GET /api/v1/system-health/targets", () => ok(targets));

route("PUT /api/v1/system-health/targets", (req) => {
  targets = { ...targets, ...(req.body as Partial<PerformanceTargets>), updated_at: new Date().toISOString(), updated_by_name: "You" };
  targets.availability_pct = Number(targets.availability_pct).toFixed(2);
  targets.error_pct = Number(targets.error_pct).toFixed(2);
  return ok(targets);
});

route("GET /api/v1/system-health/faults", (req) =>
  paged(FAULTS, req, {
    search: (f) => [f.title, f.route ?? ""],
    filters: {
      status: (f, v) => (v === "active" ? ACTIVE.has(f.status) : f.status === v),
      severity: (f, v) => f.severity === v,
      origin: (f, v) => f.origin === v,
    },
    sort: {
      last_seen_at: (a, b) => b.last_seen_at.localeCompare(a.last_seen_at),
      first_seen_at: (a, b) => b.first_seen_at.localeCompare(a.first_seen_at),
      today: (a, b) => b.today - a.today,
    },
  }),
);

const PLAINLY: Record<string, string> = {
  "f0000000-0000-4000-8000-000000000001": "The code used something that was not there, often because a lookup found nothing and the code did not check.",
  "f0000000-0000-4000-8000-000000000002": "The database refused a second copy of something that must be unique. Usually two presses, or a number allocated twice.",
  "f0000000-0000-4000-8000-000000000003": "An email could not be handed to the mail server.",
  "f0000000-0000-4000-8000-000000000004": "What was sent did not match the contract. If people are hitting this, the screen is letting them send it.",
};

route("GET /api/v1/system-health/faults/:id", (req) => {
  const f = FAULTS.find((x) => x.error_group_id === req.params.id);
  if (!f) return fail(404, "NOT_FOUND", "Not found");
  return ok({
    ...f,
    name: f.title.split(":")[0],
    last_message: f.title,
    frame: f.origin === "worker" ? "    at system-mail.service.js:88:9" : "    at leave.service.js:40:11",
    first_release: "a10d4c8",
    regressions: f.came_back ? 1 : 0,
    plainly: PLAINLY[f.error_group_id] ?? "Something failed, and what the person was doing may not have happened.",
    daily: Array.from({ length: 14 }, (_, i) => ({
      day: new Date(Date.now() - (13 - i) * 86_400_000).toISOString().slice(0, 10),
      events: (i * 2) % 5,
    })),
    occurrences: [
      {
        occurred_at: f.last_seen_at,
        route: f.route,
        origin: f.origin,
        release: f.last_release,
        request_id: "mock-req-1",
        message: f.title,
        stack: `${f.title}\n    at leave.service.js:40:11\n    at async route.js:88:5`,
      },
    ],
    notes: f.came_back
      ? [
          {
            error_group_note_id: "n0000000-0000-4000-8000-000000000001",
            body: "It happened again after it was marked fixed, so it is open again.",
            author_user_id: null,
            author_name: null,
            created_at: HOURS(5),
          },
        ]
      : [],
  });
});

route("PATCH /api/v1/system-health/faults/:id", (req) => {
  const f = FAULTS.find((x) => x.error_group_id === req.params.id);
  if (!f) return fail(404, "NOT_FOUND", "Not found");
  if (req.body.status) f.status = req.body.status as FaultRow["status"];
  return ok({ ...f, name: f.title, last_message: f.title, frame: null, first_release: "a10d4c8", regressions: 0, plainly: PLAINLY[f.error_group_id] ?? "", daily: [], occurrences: [], notes: [] });
});

route("POST /api/v1/system-health/faults/:id/notes", (req) =>
  ok({
    error_group_note_id: "n0000000-0000-4000-8000-000000000009",
    body: String(req.body.body ?? ""),
    author_user_id: null,
    author_name: "You",
    created_at: new Date().toISOString(),
  }),
);

route("POST /api/v1/system-health/faults/bulk", (req) => {
  const ids = (req.body.error_group_ids as string[]) ?? [];
  let changed = 0;
  for (const f of FAULTS) {
    if (ids.includes(f.error_group_id) && f.status !== req.body.status) {
      f.status = req.body.status as FaultRow["status"];
      changed += 1;
    }
  }
  return ok({ changed });
});

route("POST /api/v1/system-health/briefs", (req) => {
  const ids = (req.body.error_group_ids as string[]) ?? [];
  for (const f of FAULTS) if (ids.includes(f.error_group_id) && f.status === "open") f.status = "handling";
  return { status: 202, body: { document_id: "d0000000-0000-4000-8000-000000000001", file_name: "mycity-faults.md", status: "done" } };
});

route("GET /api/v1/system-health/checks/:key", (req) => {
  const c = CHECKS.find((x) => x.key === req.params.key);
  if (!c) return fail(404, "NOT_FOUND", "Not found");
  return ok({
    ...c,
    facts: [
      { label: "Answered In", value: `${c.latency_ms ?? 3} ms` },
      ...(c.key === "disk" ? [{ label: "Free", value: "46%" }, { label: "Measured At", value: "/srv/mycity/prod/media" }] : []),
      ...(c.key === "schedulers" ? [{ label: "Jobs", value: "19" }, { label: "Late", value: "media-reconcile" }] : []),
    ],
    jobs: c.key === "schedulers" ? JOBS : null,
    queues: c.key === "worker" ? QUEUES : null,
    unread: [],
  });
});

route("GET /api/v1/system-health/checks/:key/history", (req) => {
  const c = CHECKS.find((x) => x.key === req.params.key);
  if (!c) return fail(404, "NOT_FOUND", "Not found");
  return paged(changesOf(c), req, {});
});

route("POST /api/v1/system-health/status-briefs", () => ({
  status: 202,
  body: { document_id: "d0000000-0000-4000-8000-000000000002", file_name: "mycity-status.md", status: "done" },
}));
