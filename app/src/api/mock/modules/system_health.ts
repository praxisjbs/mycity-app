import type { CheckChange, FaultRow, HealthCheck, QueueRow, SchedulerRow } from "@mycity/contract/contract.gen.ts";
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
  { key: "memory", label: "Memory", state: "up", detail: "58% used, 9.1 GB of 15.7 GB", look_at: null, latency_ms: null, since: null },
  { key: "cpu", label: "Processor", state: "up", detail: "load 0.62 across 4 cores", look_at: null, latency_ms: null, since: null },
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

route("GET /api/v1/system-health/performance", (req) => {
  const range = req.query.range === "7d" ? "7d" : "24h";
  const steps = range === "7d" ? 7 : 24;
  const hours = range === "7d" ? 24 : 1;
  const points = Array.from({ length: steps }, (_, i) => ({
    at: HOURS((steps - i) * hours),
    state: i === steps - 3 ? "degraded" : "ready",
    faults: 2 + ((i * 3) % 4),
    outbox_backlog: (i * 2) % 7,
    worker_lag_s: 5 + (i % 4),
    requests: 400 + ((i * 137) % 900),
    mean_ms: 60 + ((i * 29) % 180),
    error_pct: ((i * 7) % 40 === 0 ? 2.4 : 0.3).toFixed(2),
    disk_free_pct: 46 - Math.floor(i / 4),
    memory_used_pct: 55 + ((i * 3) % 18),
    cpu_load: (0.4 + ((i * 11) % 90) / 100).toFixed(2),
    database_mb: 740 + i * 2,
  }));
  return ok({
    range,
    points,
    gap_minutes: range === "7d" ? 25 : 0,
    recording: true,
    last_snapshot_at: HOURS(0),
    uptime_pct: range === "7d" ? "98.6" : "95.8",
  });
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
