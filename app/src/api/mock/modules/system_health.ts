import type { FaultRow, HealthCheck } from "@mycity/contract/contract.gen.ts";
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
  { key: "postgres", label: "Database", state: "up", detail: "answered in 2 ms", look_at: null, latency_ms: 2 },
  { key: "redis", label: "Cache and Sessions", state: "up", detail: "answered in 1 ms", look_at: null, latency_ms: 1 },
  { key: "worker", label: "Worker", state: "up", detail: "last beat 12 s ago", look_at: null, latency_ms: null },
  { key: "modules", label: "Modules", state: "up", detail: "25 mounted", look_at: null, latency_ms: null },
  { key: "migrations", label: "Migrations", state: "up", detail: "at 9190_seed_system_health", look_at: null, latency_ms: null },
  { key: "numbering", label: "Numbering", state: "up", detail: "Answering", look_at: null, latency_ms: null },
  { key: "outbox", label: "Events", state: "up", detail: "3 waiting", look_at: null, latency_ms: null },
  { key: "storage", label: "File Storage", state: "up", detail: "Answering", look_at: null, latency_ms: null },
  { key: "chromium", label: "PDFs", state: "up", detail: "Answering", look_at: null, latency_ms: null },
  { key: "ffmpeg", label: "Voice and Video", state: "up", detail: "Answering", look_at: null, latency_ms: null },
  {
    key: "clamd",
    label: "Upload Scanning",
    state: "degraded",
    detail: "not connected",
    look_at: "Uploads cannot be scanned, so they are refused.",
    latency_ms: null,
  },
  { key: "mail", label: "Mail", state: "up", detail: "4 of 200 this hour", look_at: null, latency_ms: null },
  { key: "ai", label: "AI", state: "up", detail: "answering: stub", look_at: null, latency_ms: null },
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
  }));
  return ok({ range, points, gap_minutes: range === "7d" ? 25 : 0, uptime_pct: range === "7d" ? "98.6" : "95.8" });
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
