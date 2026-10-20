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
