"use strict";
/**
 * System Health without a database: the brief an AI is handed, the sentence a fault is
 * explained in, how a check reads on screen, and the channels its notices go out on.
 * The screen itself and the roll-up run against Postgres in
 * tests/integration/system-health.test.js.
 */
require("./system_health.events");
const brief = require("./system_health.brief");
const { explain } = require("./system_health.explain");
const service = require("./system_health.service");
const rollup = require("./system_health.rollup");
const categories = require("../../shared/notifications/categories");
const fanout = require("../../shared/notifications/fanout");
const c = require("@mycity/contract");

const fault = (over = {}) => ({
  error_group_id: "00000000-0000-4000-8000-000000000001",
  fingerprint: "TypeError|x|y",
  title: "TypeError: Cannot read properties of undefined",
  name: "TypeError",
  last_message: "Cannot read properties of undefined (reading 'id')",
  severity: "error",
  origin: "server",
  route: "POST /api/v1/leave",
  frame: "    at leave.service.js:40:11",
  status: "open",
  assigned_to: null,
  assigned_name: null,
  first_seen_at: "2026-10-18T09:00:00.000Z",
  last_seen_at: "2026-10-20T04:00:00.000Z",
  first_release: "aaaaaaa",
  last_release: "bbbbbbb",
  regressions: 0,
  regressed_at: null,
  today: 4,
  total: 19,
  people: 3,
  notes: [],
  ...over,
});

const occurrence = (over = {}) => ({
  occurred_at: "2026-10-20T04:00:00.000Z",
  route: "POST /api/v1/leave",
  origin: "server",
  release: "bbbbbbb",
  request_id: "req-1",
  message: "Cannot read properties of undefined (reading 'id')",
  stack: "TypeError: Cannot read properties of undefined\n    at leave.service.js:40:11",
  ...over,
});

const build = (over = {}) =>
  brief.build({
    faults: [{ group: fault(over.group), occurrences: over.occurrences || [occurrence()] }],
    downloaded_by: "Ada Obi",
    release: "bbbbbbb",
    at: new Date("2026-10-20T06:30:00.000Z"),
  });

/** The brief wraps its lines, so a phrase is looked for with its spacing flattened. */
const flat = (md) => md.replace(/\s+/g, " ");

describe("the brief an AI is handed", () => {
  test("asks for 4 to 10 clarity questions, and says to wait for the answers", () => {
    const md = flat(build());
    expect(md).toContain("Ask the owner 4 to 10 questions, then wait");
    expect(md).toContain("Four is the minimum, not the target");
    expect(md).toContain("At most 4 questions in one call");
    expect(md).toContain("Change no code until the owner has answered");
  });

  test("points the AI at this repository's own rules before it writes anything", () => {
    const md = flat(build());
    expect(md).toContain("CLAUDE.md");
    expect(md).toContain("docs/guides/system-health.md");
    expect(md).toContain("npm run ci");
    expect(md).toContain("Fixes-Faults: #1");
    expect(md).toContain("Do not merge");
  });

  test("carries what a fix needs: where, when, how often, and the stack", () => {
    const md = build();
    expect(md).toContain("POST /api/v1/leave");
    expect(md).toContain("leave.service.js:40");
    expect(md).toContain("4 in the last 24 hours, 19 still on record, hitting 3 different people");
    expect(md).toContain("build `bbbbbbb`");
  });

  test("names nobody: a fault leaves the building in this file", () => {
    const md = build({
      occurrences: [occurrence({ message: "failed for ada@mycity.test" })],
    });
    // The person who pressed is named, because they are the one asking.
    expect(md).toContain("by Ada Obi");
    // Counts say how many people, never who.
    expect(md).toContain("3 different people");
    expect(md).not.toMatch(/user_id|employee_id/);
  });

  test("says a fault came back, so the AI knows the last fix did not hold", () => {
    const md = build({ group: fault({ regressions: 2 }) });
    expect(flat(md)).toContain("Came back 2 times");
    expect(flat(md)).toContain("say what the earlier fix missed");
  });

  test("says so when an occurrence has no stack, rather than printing an empty block", () => {
    const md = build({ occurrences: [occurrence({ stack: null })] });
    expect(md).toContain("No stack was captured");
  });

  test("a message holding backticks cannot break out of its block", () => {
    const md = build({ group: fault({ last_message: "query ``` failed" }) });
    expect(md).toContain("````");
  });

  test("caps the faults in one file: more than that is not one fixing session", () => {
    const many = Array.from({ length: 40 }, () => ({ group: fault(), occurrences: [occurrence()] }));
    const md = brief.build({ faults: many, release: "bbbbbbb" });
    expect(md).toContain(`# MyCity faults to fix: ${brief.MAX_FAULTS} faults`);
    expect(md).not.toContain(`#${brief.MAX_FAULTS + 1} ·`);
  });

  test("no em dashes in anything a person reads", () => {
    expect(build()).not.toContain("—");
  });
});

describe("what a fault means, in plain words", () => {
  test.each([
    ["duplicate key value violates unique constraint", /must be unique/],
    ["column foo does not exist", /migration that has not run/],
    ["deadlock detected", /waited on each other/],
    ["ENOSPC: no space left on device", /disk is full/],
    ["Cannot read properties of undefined", /lookup found nothing/],
  ])("%s", (message, expected) => {
    expect(explain(fault({ last_message: message, title: message }))).toMatch(expected);
  });

  test("a fault nothing matches still gets a sentence, by how bad it is", () => {
    expect(explain(fault({ severity: "fatal", title: "something nobody predicted", last_message: null, name: "Error" })))
      .toMatch(/stopped dead/);
  });

  test("a worker fault says who is left waiting", () => {
    expect(explain(fault({ origin: "worker", title: "odd", last_message: null, name: "Error" })))
      .toMatch(/background job/i);
  });
});

describe("how a check reads on screen", () => {
  test("every probe the health endpoint registers has words and somewhere to look", () => {
    const { runChecks } = require("../../http/health");
    expect(typeof runChecks).toBe("function");
    for (const { key } of service.CHECKS) {
      expect(service.label(key)).not.toBe(key);
      expect(service.lookAt(key).length).toBeGreaterThan(10);
    }
  });

  test("a probe nobody wrote words for still reads as something, never as a crash", () => {
    expect(service.label("brand_new_thing")).toBe("brand new thing");
    expect(service.lookAt("brand_new_thing")).toMatch(/logs/);
  });

  test("a probe's detail says what it is doing", () => {
    expect(service.detailOf("outbox", { status: "degraded", backlog: 12 })).toContain("12 waiting");
    expect(service.detailOf("postgres", { status: "up", latency_ms: 3 })).toContain("3 ms");
    expect(service.detailOf("redis", { status: "down", error: "not connected" })).toBe("not connected");
  });

  test("the processor reads as busy, and memory as in use, once /proc can be read", () => {
    expect(service.detailOf("cpu", { status: "up", busy_pct: 23.5, load: 0.4, cores: 8 })).toBe("23.5% busy across 8 cores");
    expect(service.detailOf("cpu", { status: "up", busy_pct: null, load: 0.4, cores: 8 })).toBe("load 0.4 across 8 cores");
    expect(service.detailOf("memory", { status: "up", used_pct: 28, used_gb: 5.1, total_gb: 18 })).toBe("28% in use, 5.1 GB of 18 GB");
  });
});

describe("who hears about a fault, and how", () => {
  const notices = () => fanout.notices().filter((n) => n.category === "system_health");

  test("every System Health notice goes to whoever holds the permission, nobody else", () => {
    const all = notices();
    expect(all.length).toBeGreaterThanOrEqual(7);
    for (const n of all) expect(n.who).toEqual(["System Health · View"]);
  });

  test("the bell and push cannot be switched off for a production fault", () => {
    expect(categories.isLocked("system_health")).toBe(true);
    expect(categories.isOn("system_health", "push", false, false, null)).toBe(true);
    expect(categories.isOn("system_health", "in_app", false, false, null)).toBe(true);
  });

  test("email is off for the category, and declared only on the 24 hour escalation", () => {
    expect(categories.defaultOn("system_health", "email")).toBe(false);
    const escalation = notices().find((n) => n.event_key === "system_health.fault_unattended");
    expect(escalation.channels).toEqual({ email: true });
    expect(categories.isOn("system_health", "email", undefined, null, true)).toBe(true);
    for (const n of notices()) {
      if (n.event_key !== "system_health.fault_unattended") expect(n.channels).toBeNull();
    }
  });

  test("a person who turns that email off still gets it on the bell and their phone", () => {
    expect(categories.isOn("system_health", "email", false, null, true)).toBe(false);
    expect(categories.isOn("system_health", "push", false, null, true)).toBe(true);
  });

  test("the CEO is never added to a permission audience", () => {
    const fanoutSource = require("node:fs").readFileSync(
      require.resolve("../../shared/notifications/fanout"),
      "utf8",
    );
    expect(fanoutSource).toContain("The CEO is not added to every permission audience");
  });
});

describe("the roll-up", () => {
  test("a title reads as the error, without repeating its own name", () => {
    expect(rollup.titleOf({ name: "TypeError", last_message: "TypeError: x is undefined" }))
      .toBe("TypeError: x is undefined");
    expect(rollup.titleOf({ name: "Error", last_message: "could not connect" }))
      .toBe("Error: could not connect");
    expect(rollup.titleOf({ name: "Error", last_message: null })).toBe("Error");
  });

  test("how long something was down reads in the units a person would say", () => {
    const now = new Date("2026-10-20T12:00:00Z");
    expect(rollup.since("2026-10-20T11:56:00Z", now)).toBe("4 minutes");
    expect(rollup.since("2026-10-20T10:00:00Z", now)).toBe("2 hours");
    expect(rollup.since("2026-10-17T12:00:00Z", now)).toBe("3 days");
  });
});

describe("the contract", () => {
  test("the fault list's filters and sorts are what the screen offers", () => {
    const q = c.system_health.FaultListQuery.parse({});
    expect(q.status).toBe("active");
    expect(() => c.system_health.FaultListQuery.parse({ sort: "today" })).not.toThrow();
    expect(() => c.system_health.FaultListQuery.parse({ page_size: 100 })).toThrow();
  });

  test("a brief asks for at least one fault and never more than the file holds", () => {
    const id = "00000000-0000-4000-8000-000000000001";
    expect(() => c.system_health.BriefRequest.parse({ error_group_ids: [] })).toThrow();
    expect(() => c.system_health.BriefRequest.parse({ error_group_ids: Array(26).fill(id) })).toThrow();
    expect(c.system_health.BriefRequest.parse({ error_group_ids: [id] }).error_group_ids).toHaveLength(1);
  });

  test("a change to a fault has to change something", () => {
    expect(() => c.system_health.FaultPatch.parse({ note: "just a note" })).toThrow();
    expect(() => c.system_health.FaultPatch.parse({ status: "fixed" })).not.toThrow();
  });
});

describe("the engine behind the screen", () => {
  const registry = require("../../jobs/registry");

  test("every System Health scheduler is one the worker actually starts", () => {
    // The first release shipped these three files unregistered, so nothing ran and the
    // Performance card read "Nothing Recorded Yet" for an hour. This is that bug.
    for (const name of ["system-health", "system-health-digest", "system-health-purge"]) {
      expect(registry.SCHEDULERS).toContain(name);
    }
  });

  test("every scheduler file on disk is started, not just mine", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const dir = path.resolve(__dirname, "../../jobs/schedulers");
    const onDisk = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".js") && fs.statSync(path.join(dir, f)).size > 0)
      .map((f) => f.replace(/\.js$/, ""));
    expect([...onDisk].sort()).toEqual([...registry.SCHEDULERS].sort());
  });

  test("each one loads, is named after its file and has a cadence", () => {
    const mine = registry.schedules().filter((x) => x.name.startsWith("system-health"));
    expect(mine.map((x) => x.name).sort()).toEqual([
      "system-health",
      "system-health-digest",
      "system-health-purge",
      "system-health-sample",
    ]);
    for (const spec of mine) {
      expect(typeof spec.run).toBe("function");
      expect(Boolean(spec.every) !== Boolean(spec.pattern)).toBe(true);
    }
  });
});

describe("a minute of traffic", () => {
  const stats = require("../../shared/observability/request-stats");

  afterEach(() => stats.__reset());

  test("counts requests, failures and slow ones into one row a minute", async () => {
    const written = [];
    stats.__reset({ query: (_sql, params) => (written.push(params), Promise.resolve()) });
    stats.record(120, 200);
    stats.record(1500, 200);
    stats.record(40, 503);
    stats.record(10, 404);
    await stats.flush();
    expect(written).toHaveLength(1);
    const [, requests, errors, clientErrors, slow, totalMs, maxMs] = written[0];
    expect({ requests, errors, clientErrors, slow, totalMs, maxMs }).toEqual({
      requests: 4,
      errors: 1,
      clientErrors: 1,
      slow: 1,
      totalMs: 1670,
      maxMs: 1500,
    });
  });

  test("each minute carries its latency buckets, so a percentile adds across processes", async () => {
    const written = [];
    stats.__reset({ query: (sql, params) => (written.push({ sql, params }), Promise.resolve()) });
    stats.record(20, 200); // at most 25 ms
    stats.record(25, 200); // a bound belongs to its own bucket
    stats.record(790, 200); // at most 800 ms, the target's default
    stats.record(12000, 200); // past the last bound
    await stats.flush();
    const buckets = written[0].params[7];
    expect(buckets).toHaveLength(stats.BOUNDS_MS.length + 1);
    expect(buckets[0]).toBe(2);
    expect(buckets[stats.BOUNDS_MS.indexOf(800)]).toBe(1);
    expect(buckets[stats.BOUNDS_MS.length]).toBe(1);
    expect(written[0].sql).toMatch(/unnest\(request_stat\.buckets, EXCLUDED\.buckets\)/);
  });

  test("a route is counted a quarter hour at a time, under the route as declared", async () => {
    const written = [];
    stats.__reset({ query: (sql, params) => (written.push({ sql, params }), Promise.resolve()) });
    stats.record(120, 200, { method: "GET", route: "/api/v1/system-health/faults/:id" });
    stats.record(300, 500, { method: "GET", route: "/api/v1/system-health/faults/:id" });
    stats.record(5, 404, { method: "GET", route: undefined });
    await stats.flush();
    const routes = written.filter((w) => /INSERT INTO route_stat/.test(w.sql)).map((w) => w.params);
    expect(routes).toHaveLength(2);
    const faults = routes.find((p) => p[2] === "/api/v1/system-health/faults/:id");
    expect(faults.slice(3, 9)).toEqual([2, 1, 0, 0, 420, 300]);
    expect(new Date(faults[0]).getTime() % stats.ROUTE_BUCKET_MS).toBe(0);
    expect(routes.find((p) => p[2] === "(no route)")).toBeTruthy();
  });

  test("a write that fails loses the minute rather than the process", async () => {
    stats.__reset({ query: () => Promise.reject(new Error("no table yet")) });
    stats.record(10, 200);
    await expect(stats.flush()).resolves.toBe(0);
  });

  test("recording never throws, whatever it is handed", () => {
    stats.__reset({ query: () => Promise.resolve() });
    expect(() => stats.record(undefined, undefined)).not.toThrow();
    expect(() => stats.record(NaN, 200)).not.toThrow();
  });
});

describe("saying when nothing is recording", () => {
  test("a window with no recent sample is not the same as a quiet system", () => {
    // The whole point: "Nothing Recorded Yet" read like good news while the job was dead.
    // Three one-minute samples missed, not one, before the screen says the job has stopped.
    expect(require("./system_health.performance").RECORDING_WITHIN_MS).toBe(3 * 60_000);
  });
});

describe("the Status brief", () => {
  const statusBrief = require("./system_health.status-brief");
  const NOW = new Date("2026-10-20T12:00:00.000Z");
  const job = (over = {}) => ({
    name: "media-reconcile",
    summary: "Finds files without a record",
    runs_in: "queue",
    cadence: "Daily at 02:30 (Lagos)",
    set_as: "cron 30 2 * * * Africa/Lagos",
    late_after: "26 hours",
    state: "on_time",
    reason: null,
    started_at: "2026-10-01T00:00:00.000Z",
    last_run_at: "2026-10-20T01:30:00.000Z",
    duration_ms: 120,
    last_ok: true,
    last_error: null,
    runs: 19,
    failures: 0,
    last_failure_at: null,
    next_run_at: "2026-10-21T01:30:00.000Z",
    ...over,
  });
  const input = (over = {}) => ({
    now: NOW,
    config: { APP_ENV: "production", PORT: 7000, DB_NAME: "mycity_prod", MEDIA_ROOT: "/srv/mycity/prod/media", REDIS_URL: "redis://:x@127.0.0.1:6379/0", STAFF_ORIGIN: "https://hub.mycityapp.io" },
    release: "abc1234",
    deployed_at: "2026-10-20T09:00:00.000Z",
    state: "degraded",
    checks: [
      { key: "postgres", label: "Database", state: "up", detail: "answered in 3 ms", look_at: null, since: "2026-10-13T12:00:00.000Z", facts: [] },
      {
        key: "schedulers",
        label: "Background Jobs",
        state: "degraded",
        detail: "1 of 19 have not run: outbox-dispatch",
        look_at: service.lookAt("schedulers"),
        since: "2026-10-20T10:05:00.000Z",
        facts: [{ label: "Late", value: "outbox-dispatch" }],
      },
      { key: "disk", label: "Disk Space", state: "down", detail: "3% free, 7 GB of 240 GB", look_at: service.lookAt("disk"), since: null, facts: [{ label: "Free", value: "3%" }] },
    ],
    api: null,
    jobs: {
      jobs: [
        job({ name: "outbox-dispatch", runs_in: "worker", set_as: "every 1000 ms", cadence: "Every second", state: "late", reason: "Has not run for 2 hours", last_ok: false, last_error: "ENOSPC: no space left on device", last_failure_at: "2026-10-20T10:00:00.000Z" }),
        job(),
      ],
      db_error: null,
      queue_error: null,
    },
    queues: { queues: [{ queue: "email-send", summary: null, concurrency: 3, waiting: 40, active: 0, delayed: 0, failed: 2, paused: 0, last_failed_at: "2026-10-20T10:00:00.000Z", last_failure: "ENOSPC" }], error: null },
    changes: { rows: [{ at: "2026-10-20T10:00:00.000Z", key: "disk", label: "Disk Space", from: "degraded", to: "down", detail: "3% free" }], total: 1 },
    last24: { uptime_pct: "91.0", gap_minutes: 0, recording: true, last_snapshot_at: "2026-10-20T11:55:00.000Z", points: [] },
    faults: { rows: [{ title: "Error: ENOSPC: no space left on device", severity: "error", origin: "worker", route: null, today: 12, total: 30, last_seen_at: "2026-10-20T11:50:00.000Z", status: "open", came_back: false }], total: 1 },
    host: null,
    unread: [],
    made: { how: "screen", by: "Ada Obi" },
    ...over,
  });

  test("problems first, worst first, each with what it means and read-only commands for this server", () => {
    const md = statusBrief.build(input());
    expect(md.split("\n")[0]).toBe("# MyCity system status, production: 2 problems: Background Jobs, Disk Space");
    const wrong = md.slice(md.indexOf("## What is wrong"), md.indexOf("## Every check"));
    // Down before degraded.
    expect(wrong.indexOf("### 1 · Disk Space: down")).toBeGreaterThan(-1);
    expect(wrong.indexOf("### 2 · Background Jobs: degraded, since 2026-10-20 10:05 UTC (2 hours)")).toBeGreaterThan(-1);
    expect(wrong).toContain("sudo du -xh --max-depth=2 /srv/mycity");
    expect(wrong).toContain('sudo -u postgres psql -d mycity_prod -c "SELECT name, last_run_at');
    expect(wrong).toContain("ENOSPC: no space left on device");
    expect(wrong).toContain("| `outbox-dispatch` | `every 1000 ms` | Every second |");
  });

  test("its instructions: understand, ask, read-only evidence, changes only with a yes, a pull request for code, a guided walk", () => {
    const text = statusBrief.build(input()).replace(/\s+/g, " ");
    expect(text).toContain("Understand it before you do anything");
    expect(text).toContain("Fix the first domino, not the last");
    expect(text).toContain("Propose no fix yet");
    expect(text).toContain("Ask the owner 4 to 10 questions, then wait");
    expect(text).toContain("Run no command that changes anything, and change no code, until the owner has answered");
    expect(text).toContain("each in its own numbered fenced block headed **Read-only**");
    expect(text).toContain("paste back what they print");
    expect(text).toContain("Never `cat` a `.env`");
    expect(text).toContain("headed **Changes the server**, with what it changes, what could go wrong, how to undo it");
    expect(text).toContain("run nothing in it until the owner says yes");
    expect(text).toContain("never run a migration by hand");
    expect(text).toContain("never edit a file under `/srv/mycity/prod/current`");
    expect(text).toContain("A bug in the code is fixed in the code");
    expect(text).toContain("Open a draft pull request to `main` and drive it green");
    expect(text).toContain("walk the owner through by hand");
    expect(text).toContain("Prove it is well");
  });

  test("the server's names are this environment's", () => {
    const md = statusBrief.build(input());
    for (const s of ["`mycity-api-prod`", "`mycity-worker-prod`", "`mycity-health-watch-prod.timer`", "`/srv/mycity/prod/shared/.env`", "`mycity_prod`", "`http://localhost:7000`", "database 0"]) {
      expect(md).toContain(s);
    }
    const stg = statusBrief.build(input({ config: { APP_ENV: "staging", PORT: 7100, DB_NAME: "mycity_stg", REDIS_URL: "redis://127.0.0.1:6379/1" } }));
    expect(stg).toContain("`mycity-worker-stg`");
    expect(stg).not.toContain("mycity-worker-prod");
  });

  test("every scheduler with what it was set to, every queue, the changes, the faults as one line each", () => {
    const md = statusBrief.build(input());
    expect(md).toContain("## Background jobs");
    expect(md).toContain("| `media-reconcile` | Finds files without a record | `cron 30 2 * * * Africa/Lagos` | Daily at 02:30 (Lagos) | queue | 26 hours |");
    expect(md).toContain("| `email-send` | 40 | 0 | 0 | 2 |");
    expect(md).toContain("| 2026-10-20 10:00 UTC | Disk Space | Degraded | Down |");
    expect(md).toContain("| Error: ENOSPC: no space left on device | Error | Worker | 12 | 30 |");
    expect(md).toContain("Faults brief");
  });

  test("it says what it could not read, and where it came from", () => {
    const md = statusBrief.build(input({ unread: ["Queues: Redis is not connected"], api: { answering: false, error: "ECONNREFUSED" }, made: { how: "watch" } }));
    expect(md).toContain("## What could not be read");
    expect(md).toContain("- Queues: Redis is not connected");
    expect(md).toContain("**API:** not answering (ECONNREFUSED)");
    expect(md).toContain("Mailed by the server's health watch (`mycity-health-watch-prod.timer`)");
  });

  test("a since nobody knows is not claimed", () => {
    const md = statusBrief.build(input({ last24: { uptime_pct: "0.0", gap_minutes: 1440, recording: false, last_snapshot_at: null, points: [] } }));
    expect(md).toContain("### 1 · Disk Space: down, since not known: nothing has been recorded recently");
    const recording = statusBrief.build(input());
    expect(recording).toContain("### 1 · Disk Space: down, changed within the last 5 minutes");
  });

  test("nothing down is said plainly; no em dash, no stack, no secret", () => {
    const md = statusBrief.build(input({ checks: [input().checks[0]], state: "ready" }));
    expect(md.split("\n")[0]).toBe("# MyCity system status, production: nothing down");
    expect(md).toContain("Every check is up.");
    const all = statusBrief.build(input());
    expect(all).not.toContain("—");
    expect(all).not.toMatch(/redis:\/\/:x@/);
  });
});

describe("the Faults brief's state header", () => {
  test("the system now, and at each occurrence", () => {
    const md = brief.build({
      faults: [
        {
          group: fault(),
          occurrences: [
            { ...occurrence(), system: { taken_at: "2026-10-20T04:00:00.000Z", not_up: [{ label: "Database", state: "down", detail: "connect ECONNREFUSED" }] } },
            { ...occurrence({ occurred_at: "2026-10-19T04:00:00.000Z" }), system: null },
          ],
        },
      ],
      release: "bbbbbbb",
      at: new Date("2026-10-20T06:30:00.000Z"),
      system: { taken_at: "2026-10-20T06:25:00.000Z", not_up: [] },
    });
    expect(md).toContain("## The system when this was downloaded");
    expect(md).toContain("Every check was up at the snapshot of 2026-10-20 06:25 UTC.");
    expect(md).toContain("_System then:_ **Database** down (connect ECONNREFUSED) (snapshot of 2026-10-20 04:00 UTC).");
    expect(md).toContain("_System then:_ no snapshot within 10 minutes of it");
    expect(md.replace(/\s+/g, " ")).toContain("is a symptom of that, not a bug of its own");
  });

  test("no recent snapshot is a finding of its own; left out, the header is not written", () => {
    expect(brief.build({ faults: [{ group: fault(), occurrences: [occurrence()] }], system: null })).toContain(
      "No snapshot in the last 11 minutes",
    );
    expect(build()).not.toContain("## The system when this was downloaded");
  });
});

describe("a check's figures", () => {
  test("labelled with units, lists joined, nested objects left out, scrubbed", () => {
    const facts = service.factsOf({
      status: "degraded",
      free_pct: 8,
      total_gb: 240.1,
      path: "/srv/mycity/prod/media",
      late: ["a", "b"],
      waiting: [],
      nested: { x: 1 },
      error: "connect postgres://mycity:hunter2@db:5432",
    });
    expect(facts).toEqual([
      { label: "Free", value: "8%" },
      { label: "Total", value: "240.1 GB" },
      { label: "Measured At", value: "/srv/mycity/prod/media" },
      { label: "Late", value: "a, b" },
      { label: "Not Due Yet", value: "None" },
      { label: "Error", value: "connect postgres://<credentials>@db:5432" },
    ]);
  });

  test("Background Jobs names the late, the failing and the ones not due yet", () => {
    expect(service.detailOf("schedulers", { status: "degraded", schedulers: 19, late: ["a", "b", "c", "d"], failing: ["e"], waiting: ["f"] })).toBe(
      "4 of 19 have not run: a, b, c and 1 more, 1 failing: e, 1 not due yet",
    );
    expect(service.detailOf("schedulers", { status: "up", schedulers: 19, late: [], failing: [], waiting: ["f", "g"] })).toBe(
      "all 17 on time, 2 not due yet",
    );
  });

  test("the new shapes are in the contract", () => {
    for (const name of ["CheckDetail", "CheckChangePage", "SchedulerRow", "QueueRow", "CheckHistoryQuery"]) {
      expect(c.system_health[name]).toBeDefined();
    }
  });
});
