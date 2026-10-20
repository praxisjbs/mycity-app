"use strict";
/**
 * Settings · System Health end to end (docs/guides/system-health.md): the roll-up that
 * turns what the error reporter wrote into faults people hear about, the screen's own
 * routes, who may open them, and the Markdown brief the worker writes.
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/system-health
 *
 * Refuses to run unless the database name ends in "_test": it drops and rebuilds the
 * public schema. The faults are invented and the people are invented.
 */
const request = require("supertest");
const { config } = require("../../src/config/env");
const { pool } = require("../../src/config/db");
const { atomically } = require("../../src/shared/db/tx");

const sent = [];
jest.mock("../../src/jobs/queues", () => ({
  enqueue: jest.fn(async (queue, name, data, opts) => {
    sent.push({ queue, name, data, opts });
    return { id: String(sent.length) };
  }),
  getQueue: jest.fn(),
  closeQueues: jest.fn(async () => {}),
  DEFAULTS: {},
}));

const { rebuild } = require("./helpers/schema");
const { createAdmin } = require("../../scripts/db/create-admin");
const { buildApp } = require("../../src/app");
const outbox = require("../../src/shared/events/outbox");
const storage = require("../../src/services/storage/storage.service");
const repo = require("../../src/modules/system_health/system_health.repo");
const rollup = require("../../src/modules/system_health/system_health.rollup");
require("../../src/modules/system_health/system_health.events");

const describeDb = String(config.DB_NAME || "").endsWith("_test") ? describe : describe.skip;

const q = (sql, params) => pool.query(sql, params);

const PASSWORD = {
  ceo: "Chief#Officer26",
  ops: "Opera!ions2026",
  admin: "Admin#Pass2026x",
};

async function drain() {
  for (let i = 0; i < 10; i += 1) {
    await q("UPDATE event_outbox SET next_attempt_at = now() WHERE status = 'pending'");
    const r = await outbox.dispatchDue({ db: pool });
    if (r.claimed === 0) return;
  }
}

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

/** A fault the reporter would have written, at a chosen moment. */
function fault(over = {}) {
  return {
    occurred_at: new Date().toISOString(),
    severity: "error",
    origin: "server",
    fingerprint: "TypeError|Cannot read properties of undefined|at leave.service.js",
    name: "TypeError",
    message: "Cannot read properties of undefined (reading 'employee_id')",
    stack: "TypeError: Cannot read properties of undefined\n    at leave.service.js:40:11",
    route: "POST /api/v1/leave",
    request_id: "req-1",
    user_id: null,
    release: "b7c2f91",
    ...over,
  };
}

const writeFault = (f) =>
  q(
    `INSERT INTO error_event (occurred_at, severity, origin, fingerprint, name, message, stack, route, request_id, user_id, release)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [f.occurred_at, f.severity, f.origin, f.fingerprint, f.name, f.message, f.stack, f.route, f.request_id, f.user_id, f.release],
  );

describeDb("System Health against the real migrations", () => {
  let app;
  const people = {};
  const tokens = {};

  let ipSeq = 0;
  const nextIp = () => {
    ipSeq += 1;
    return `10.60.${Math.floor(ipSeq / 250)}.${(ipSeq % 250) + 1}`;
  };
  const as = (who) => {
    const auth = (r) => r.set("Authorization", `Bearer ${tokens[who]}`).set("X-Forwarded-For", nextIp());
    return {
      get: (path) => auth(request(app).get(`/api/v1${path}`)),
      post: (path) => auth(request(app).post(`/api/v1${path}`)),
      patch: (path) => auth(request(app).patch(`/api/v1${path}`)),
      put: (path) => auth(request(app).put(`/api/v1${path}`)),
    };
  };

  beforeAll(async () => {
    await rebuild(pool, config.DB_NAME);
    outbox.markReady();
    ({ app } = buildApp({ strict: true, accessLog: false }));

    const sample = (first, last, email, job) => ({
      first_name: first,
      last_name: last,
      work_email: email,
      phone: "08031234567",
      job_title: job,
      department_name: "HR & Operations",
      start_date: "2026-01-05",
      employment_type: "full_time",
      work_pattern: "remote",
    });
    const make = (client, who, first, last, email, job, role_code, is_ceo = false) =>
      createAdmin(client, { employee: sample(first, last, email, job), role_code, is_ceo }, PASSWORD[who], {
        allowAdditional: true,
      });
    await tx(async (client) => {
      people.ceo = await make(client, "ceo", "Amaka", "Eze", "ceo@mycity.test", "Chief Executive Officer", "management", true);
      people.ops = await make(client, "ops", "Ada", "Obi", "ops@mycity.test", "Operations & People Lead", "operations_people");
      people.admin = await make(client, "admin", "Femi", "Bello", "femi@mycity.test", "Systems Officer", "administrator");
    });
    await drain();
    for (const [who, email] of [["ceo", "ceo@mycity.test"], ["ops", "ops@mycity.test"], ["admin", "femi@mycity.test"]]) {
      const res = await request(app).post("/api/v1/auth/login").set("X-Forwarded-For", nextIp()).send({ email, password: PASSWORD[who] });
      expect(res.status).toBe(200);
      tokens[who] = res.body.access_token;
    }
  });

  afterAll(async () => {
    await require("../../src/shared/observability/error-reporter").flush();
    await pool.end();
  });

  /* ------------------------------------------------------------------ */

  describe("who may open it", () => {
    test("the System Administrator may, and Operations & People may not", async () => {
      expect((await as("admin").get("/system-health/status")).status).toBe(200);
      expect((await as("ops").get("/system-health/status")).status).toBe(403);
      expect((await as("ops").get("/system-health/faults")).status).toBe(403);
    });

    test("the CEO passes every check, so she can look if she wants to", async () => {
      expect((await as("ceo").get("/system-health/status")).status).toBe(200);
    });
  });

  describe("the roll-up", () => {
    test("groups what the reporter wrote, with the counts read from the events", async () => {
      await writeFault(fault());
      await writeFault(fault({ request_id: "req-2" }));
      await writeFault(fault({ fingerprint: "Error|SMTP refused|at mail", name: "Error", message: "SMTP command failed", origin: "worker", route: null, severity: "warning" }));
      const done = await rollup.rollupFaults();
      expect(done.groups).toBe(2);
      expect(done.new).toBe(2);

      const res = await as("admin").get("/system-health/faults");
      expect(res.status).toBe(200);
      expect(res.body.page.total).toBe(2);
      const leave = res.body.data.find((f) => f.route === "POST /api/v1/leave");
      expect(leave).toEqual(
        expect.objectContaining({ severity: "error", origin: "server", status: "open", today: 2, total: 2, came_back: false }),
      );
    });

    test("running it again changes nothing: the same fault is one group", async () => {
      const before = await as("admin").get("/system-health/faults");
      const done = await rollup.rollupFaults();
      expect(done.new).toBe(0);
      const after = await as("admin").get("/system-health/faults");
      expect(after.body.page.total).toBe(before.body.page.total);
    });

    test("a new fault is told to whoever holds System Health, and to nobody else", async () => {
      await drain();
      const { rows } = await q(
        `SELECT u.user_id, e.work_email FROM notification n
           JOIN app_user u ON u.user_id = n.user_id
           JOIN employee e ON e.employee_id = u.employee_id
          WHERE n.event_key = 'system_health.fault_new'`,
      );
      const told = rows.map((r) => r.work_email);
      expect(told).toContain("femi@mycity.test");
      expect(told).not.toContain("ops@mycity.test");
      expect(told).not.toContain("ceo@mycity.test");
    });

    test("every System Health notice reaches the bell and the phone, and only the escalation reaches email", async () => {
      const { rows } = await q(
        `SELECT DISTINCT channels FROM notification WHERE event_key = 'system_health.fault_new'`,
      );
      expect(rows[0].channels.sort()).toEqual(["in_app", "push"]);
    });
  });

  describe("a fault the team acts on", () => {
    let id;

    beforeAll(async () => {
      const res = await as("admin").get("/system-health/faults");
      id = res.body.data.find((f) => f.route === "POST /api/v1/leave").error_group_id;
    });

    test("one fault carries its occurrences, its 14 days and what it probably means", async () => {
      const res = await as("admin").get(`/system-health/faults/${id}`);
      expect(res.status).toBe(200);
      expect(res.body.plainly).toMatch(/lookup found nothing/);
      expect(res.body.occurrences).toHaveLength(2);
      expect(res.body.occurrences[0].stack).toContain("leave.service.js");
      expect(res.body.daily).toHaveLength(14);
    });

    test("marking it fixed records who and when, and a note goes with it", async () => {
      const res = await as("admin").patch(`/system-health/faults/${id}`).send({ status: "fixed", note: "Guarded the lookup" });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("fixed");
      expect(res.body.notes.map((n) => n.body)).toContain("Guarded the lookup");
      // Who moved it is kept for the record, though no screen shows it.
      const row = (await q("SELECT status_changed_by, status_changed_at FROM error_group WHERE error_group_id = $1", [id])).rows[0];
      expect(row.status_changed_by).toBe(people.admin.user.user_id);
      expect(row.status_changed_at).not.toBeNull();
    });

    test("it happening again opens it, counts the return, and tells the team", async () => {
      await writeFault(fault({ request_id: "req-3" }));
      const done = await rollup.rollupFaults();
      expect(done.returned).toBe(1);
      const res = await as("admin").get(`/system-health/faults/${id}`);
      expect(res.body.status).toBe("open");
      expect(res.body.regressions).toBe(1);
      expect(res.body.came_back).toBe(true);
      expect(res.body.notes.map((n) => n.body)).toContain(
        "It happened again after it was marked fixed, so it is open again.",
      );
      await drain();
      const { rows } = await q("SELECT count(*)::int AS n FROM notification WHERE event_key = 'system_health.fault_returned'");
      expect(rows[0].n).toBeGreaterThan(0);
    });

    test("a fault marked ignored never comes back on its own", async () => {
      await as("admin").patch(`/system-health/faults/${id}`).send({ status: "ignored" });
      await writeFault(fault({ request_id: "req-4" }));
      const done = await rollup.rollupFaults();
      expect(done.returned).toBe(0);
      expect((await repo.get(pool, id)).status).toBe("ignored");
      await as("admin").patch(`/system-health/faults/${id}`).send({ status: "open" });
    });

    test("the list filters by status and severity", async () => {
      const ignored = await as("admin").get("/system-health/faults?status=ignored");
      expect(ignored.body.page.total).toBe(0);
      const warnings = await as("admin").get("/system-health/faults?severity=warning");
      expect(warnings.body.data.every((f) => f.severity === "warning")).toBe(true);
    });
  });

  describe("the brief", () => {
    let ids;

    test("downloading it hands back a pending file and takes the faults on", async () => {
      const list = await as("admin").get("/system-health/faults");
      ids = list.body.data.map((f) => f.error_group_id);
      const res = await as("admin").post("/system-health/briefs").send({ error_group_ids: ids });
      expect(res.status).toBe(202);
      expect(res.body).toEqual({
        document_id: expect.any(String),
        file_name: expect.stringMatching(/^mycity-faults-.+\.md$/),
        status: "pending",
      });
      const after = await as("admin").get("/system-health/faults");
      for (const f of after.body.data) {
        expect(["handling", "ignored"]).toContain(f.status);
        expect(f.assigned_to).toBe(people.admin.user.user_id);
      }
    });

    test("the worker writes the Markdown, and the file is there to download", async () => {
      await drain();
      const doc = await q("SELECT * FROM document WHERE doc_type = 'system_health_brief' ORDER BY created_at DESC LIMIT 1");
      expect(doc.rows[0].render_status).toBe("done");
      expect(doc.rows[0].mime).toBe("text/markdown");
      const bytes = await storage.get(doc.rows[0].storage_key);
      const md = bytes.toString("utf8");
      const flat = md.replace(/\s+/g, " ");

      expect(flat).toContain("Ask the owner 4 to 10 questions, then wait");
      expect(flat).toContain("Four is the minimum, not the target");
      expect(flat).toContain("Change no code until the owner has answered");
      expect(md).toContain("Fixes-Faults:");
      expect(md).toContain("leave.service.js");
      expect(md).toContain("POST /api/v1/leave");
      // It leaves the building, so it names nobody it was not downloaded by.
      expect(md).not.toContain("ops@mycity.test");
      expect(md).not.toContain("ceo@mycity.test");
      expect(md).toContain("Femi Bello");
    });

    test("the person who asked downloads it; nobody else does", async () => {
      const doc = await q("SELECT document_id FROM document WHERE doc_type = 'system_health_brief' ORDER BY created_at DESC LIMIT 1");
      const docId = doc.rows[0].document_id;
      expect((await as("admin").get(`/exports/${docId}`)).status).toBe(200);
      expect((await as("ops").get(`/exports/${docId}`)).status).toBe(404);
    });

    test("a brief asks for at least one fault and at most what the file holds", async () => {
      expect((await as("admin").post("/system-health/briefs").send({ error_group_ids: [] })).status).toBe(422);
      const many = Array.from({ length: 26 }, () => ids[0]);
      expect((await as("admin").post("/system-health/briefs").send({ error_group_ids: many })).status).toBe(422);
    });
  });

  /* ------------------------------------------------------------------ */

  describe("performance", () => {
    const sampler = require("../../src/modules/system_health/system_health.sample");
    const targets = require("../../src/modules/system_health/system_health.targets");
    const stats = require("../../src/shared/observability/request-stats");

    /** A minute of the server, `ago` minutes back, as the sampler would have written it. */
    const sample = (ago, over = {}) =>
      repo.addSample(pool, {
        minute: new Date(Math.floor(Date.now() / 60_000) * 60_000 - ago * 60_000),
        cores: 8,
        cpu_busy_pct: 20,
        cpu_steal_pct: 1,
        cpu_iowait_pct: 2,
        memory_total_mb: 18432,
        memory_in_use_mb: 5100,
        memory_cache_mb: 9800,
        memory_free_mb: 3532,
        disk_total_mb: 241000,
        disk_used_mb: 24000,
        disk_free_mb: 205000,
        disk_read_kb: 600,
        disk_written_kb: 1200,
        network_in_kb: 6000,
        network_out_kb: 3000,
        tcp_connections: 40,
        production_cpu_pct: 12,
        production_memory_mb: 1900,
        staging_cpu_pct: 3,
        staging_memory_mb: 800,
        database_cpu_pct: 4,
        database_memory_mb: 1600,
        redis_cpu_pct: 0.5,
        redis_memory_mb: 200,
        api_up: true,
        users_online: 6,
        ...over,
      });

    beforeEach(async () => {
      await q("DELETE FROM perf_sample");
      await q("DELETE FROM request_stat");
      await q("DELETE FROM route_stat");
      await q("DELETE FROM process_beat");
      stats.__reset();
      sampler.__reset();
      targets.__reset();
    });

    test("only System Health's holders may read it, and only edit may change the targets", async () => {
      for (const path of ["/performance", "/capacity", "/routes", "/database", "/database/tables", "/background", "/processes", "/targets"]) {
        expect((await as("ops").get(`/system-health${path}`)).status).toBe(403);
      }
      expect((await as("ops").put("/system-health/targets").send(targets.DEFAULTS)).status).toBe(403);
    });

    test("an empty window says nothing is recording, rather than looking like good news", async () => {
      const dead = await as("admin").get("/system-health/performance?range=hour");
      expect(dead.status).toBe(200);
      expect(dead.body.recording).toBe(false);
      expect(dead.body.last_sample_at).toBeNull();
      expect(dead.body.availability.state).toBe("none");
      // A server with no sample yet has no gap to report either.
      expect(dead.body.gap_minutes).toBe(0);

      // The sampler runs: no API answers on this port, so the minute is a minute down.
      const r = await sampler.sample({ wait: 0, port: 1 });
      expect(r).toEqual(expect.objectContaining({ written: 1, held: 0, api_up: false }));
      const live = await as("admin").get("/system-health/performance?range=hour");
      expect(live.body.recording).toBe(true);
      expect(live.body.down_minutes).toBe(1);
      expect(live.body.availability).toEqual({ value: "0", target: "99.90", state: "missed" });
    });

    test("availability counts the minutes the API answered, and a new server is not a day of gaps", async () => {
      for (let ago = 0; ago < 10; ago += 1) await sample(ago, { api_up: ago !== 4 });
      const res = await as("admin").get("/system-health/performance?range=day");
      expect(res.status).toBe(200);
      expect(res.body.availability.value).toBe("90");
      expect(res.body.availability.state).toBe("missed");
      expect(res.body.down_minutes).toBe(1);
      expect(res.body.gap_minutes).toBe(0);
      expect(res.body.bucket_minutes).toBe(15);
      const point = res.body.points[res.body.points.length - 1];
      expect(point.cpu_busy_pct).toBe("20");
      expect(point.disk_read_kbs).toBe(10);
      expect(Number(point.memory_in_use_pct)).toBeCloseTo(27.67, 1);
    });

    test("a minute nobody sampled since the first sample is a gap, never a minute up or down", async () => {
      await sample(30);
      await sample(0);
      const res = await as("admin").get("/system-health/performance?range=hour");
      expect(res.body.availability.value).toBe("100");
      expect(res.body.gap_minutes).toBeGreaterThanOrEqual(28);
      expect(res.body.points.filter((p) => p.cpu_busy_pct !== null)).toHaveLength(2);
    });

    test("response time is read at the 95th percentile from the buckets, and failures are 500s only", async () => {
      for (let i = 0; i < 95; i += 1) stats.record(40, 200, { method: "GET", route: "/api/v1/employees" });
      for (let i = 0; i < 4; i += 1) stats.record(900, 200, { method: "POST", route: "/api/v1/leave" });
      stats.record(4000, 500, { method: "POST", route: "/api/v1/leave" });
      stats.record(5, 404, { method: "GET", route: "(no route)" });
      await stats.flush();
      await sample(0);

      const res = await as("admin").get("/system-health/performance?range=hour");
      expect(res.body.requests).toBe(101);
      expect(Number(res.body.failed.value)).toBeCloseTo(0.99, 2);
      expect(res.body.failed.state).toBe("met");
      // 96 of 101 took at most 50 ms (95 at 40, one 404 at 5): the 95th percentile is 50.
      expect(res.body.response_p95).toEqual({ value: "50", target: "800", state: "met" });
      expect(res.body.response_mean_ms).toBe(Math.round((95 * 40 + 4 * 900 + 4000 + 5) / 101));
      expect(res.body.peak_per_minute).toBe(101);

      const routes = await as("admin").get("/system-health/routes?range=hour");
      expect(routes.status).toBe(200);
      expect(routes.body.data[0]).toEqual(
        expect.objectContaining({ method: "POST", route: "/api/v1/leave", requests: 5, errors: 1, slow: 1, max_ms: 4000 }),
      );
      expect(routes.body.data[0].p95_ms).toBeGreaterThan(1000);
      const busiest = await as("admin").get("/system-health/routes?range=hour&sort=-requests");
      expect(busiest.body.data[0].route).toBe("/api/v1/employees");
      expect(busiest.body.data.map((r) => r.route)).toContain("(no route)");
      expect((await as("admin").get("/system-health/routes?range=year")).status).toBe(422);
    });

    test("the server's capacity is in real units, split by service, and judged at the targets' levels", async () => {
      await sample(1);
      await sample(0, { cpu_busy_pct: 90 });
      const res = await as("admin").get("/system-health/capacity");
      expect(res.status).toBe(200);
      const { cpu, memory, disk, network, server } = res.body;
      expect(res.body.supported).toBe(true);
      expect(cpu.busy_pct).toBe("90");
      expect(cpu.state).toBe("degraded");
      expect(cpu.peak_pct).toBe("90");
      expect(cpu.parts.map((p) => p.key)).toEqual(["production", "staging", "database", "redis", "other"]);
      expect(memory).toEqual(expect.objectContaining({ total_mb: 18432, in_use_mb: 5100, cache_mb: 9800, free_mb: 3532, state: "up" }));
      expect(memory.parts.find((p) => p.key === "other").mb).toBe(5100 - 1900 - 800 - 1600 - 200);
      expect(disk).toEqual(expect.objectContaining({ total_mb: 241000, used_mb: 24000, free_mb: 205000, reserved_mb: 12000, state: "up" }));
      // Less than a day of samples: no forecast rather than a wild one.
      expect(disk.days_to_full).toBeNull();
      expect(disk.read_kbs).toBe(10);
      expect(network.in_kbs).toBe(100);
      expect(network.connections).toBe(40);
      expect(server.node).toBe(process.version);
      expect(server.postgres).toMatch(/^\d+/);
    });

    test("the disk's growth over a week says when it will be full", async () => {
      // 48 hours of hourly samples growing 500 MB a day.
      for (let h = 48; h >= 0; h -= 1) {
        await sample(h * 60, { disk_used_mb: 24000 - Math.round((h * 500) / 24), disk_free_mb: 100000 + Math.round((h * 500) / 24) });
      }
      const res = await as("admin").get("/system-health/capacity");
      expect(res.body.disk.growth_mb_per_day).toBeGreaterThanOrEqual(495);
      expect(res.body.disk.growth_mb_per_day).toBeLessThanOrEqual(505);
      expect(res.body.disk.days_to_full).toBe(Math.floor(100000 / res.body.disk.growth_mb_per_day));
    });

    test("the targets start at the defaults, save whole, are audited, and refuse levels out of order", async () => {
      const first = await as("admin").get("/system-health/targets");
      expect(first.body).toEqual(expect.objectContaining({ availability_pct: "99.90", response_p95_ms: 800, error_pct: "1.00", updated_at: null }));

      const wrong = await as("admin").put("/system-health/targets").send({ ...targets.DEFAULTS, memory_down_pct: 80 });
      expect(wrong.status).toBe(422);
      expect(JSON.stringify(wrong.body)).toMatch(/memory_down_pct/);

      const body = { ...targets.DEFAULTS, availability_pct: "99.5", response_p95_ms: 1000, cpu_warn_pct: 70, cpu_down_pct: 90 };
      const saved = await as("admin").put("/system-health/targets").send(body);
      expect(saved.status).toBe(200);
      expect(saved.body).toEqual(expect.objectContaining({ availability_pct: "99.50", response_p95_ms: 1000, cpu_warn_pct: 70 }));
      expect(saved.body.updated_by_name).toBe("Femi Bello");
      const { rows } = await q(
        "SELECT before, after FROM audit_ledger WHERE entity_type = 'performance_target' ORDER BY occurred_at DESC LIMIT 1",
      );
      expect(rows[0].before.response_p95_ms).toBe(800);
      expect(rows[0].after.response_p95_ms).toBe(1000);

      // Status's checks read the new levels, and Performance judges against them.
      expect((await targets.levels()).cpu_warn_pct).toBe(70);
      await sample(0, { cpu_busy_pct: 75 });
      expect((await as("admin").get("/system-health/capacity")).body.cpu.state).toBe("degraded");
      await as("admin").put("/system-health/targets").send(targets.DEFAULTS);
    });

    test("the database says its size, connections and cache, and slow SQL is off until the server preloads it", async () => {
      const db = await as("admin").get("/system-health/database");
      expect(db.status).toBe(200);
      expect(db.body.size_mb).toBeGreaterThan(0);
      expect(db.body.connections_used).toBeGreaterThan(0);
      expect(db.body.connections_max).toBeGreaterThan(0);
      expect(typeof db.body.statements).toBe("boolean");

      const tables = await as("admin").get("/system-health/database/tables");
      expect(tables.status).toBe(200);
      expect(tables.body.page.size).toBe(25);
      expect(tables.body.data.length).toBeGreaterThan(0);
      const sizes = tables.body.data.map((t) => t.total_bytes);
      expect([...sizes].sort((a, b) => b - a)).toEqual(sizes);

      const statements = await as("admin").get("/system-health/database/queries");
      expect(statements.status).toBe(200);
      if (!db.body.statements) expect(statements.body.data).toEqual([]);
    });

    test("background work lists every scheduler, with the ones that never ran saying so", async () => {
      await q("DELETE FROM schedule_run");
      await q("INSERT INTO schedule_run (name, last_run_at, duration_ms, ok, runs, failures, total_ms, max_ms) VALUES ('system-health', now(), 40, true, 4, 0, 200, 90)");
      const work = await as("admin").get("/system-health/background");
      expect(work.status).toBe(200);
      expect(work.body.outbox_waiting).toEqual(expect.any(Number));

      const jobs = await as("admin").get("/system-health/background/jobs");
      expect(jobs.status).toBe(200);
      expect(jobs.body.page.total).toBe(require("../../src/jobs/registry").SCHEDULERS.length);
      const all = [];
      for (let page = 1; page <= jobs.body.page.pages; page += 1) {
        all.push(...(await as("admin").get(`/system-health/background/jobs?page=${page}`)).body.data);
      }
      const health = all.find((j) => j.name === "system-health");
      expect(health).toEqual(expect.objectContaining({ every: "Every 5 minutes", last_ms: 40, mean_ms: 50, max_ms: 90, state: "on_time" }));
      expect(all.find((j) => j.name === "system-health-digest")).toEqual(expect.objectContaining({ every: "Daily at 08:00", state: "never", runs: 0 }));
    });

    test("processes show who is online and count the starts of the week", async () => {
      await q(
        `INSERT INTO process_beat (instance, role, host, pid, started_at, last_beat_at, memory_mb, heap_mb, loop_delay_ms, cpu_pct, sockets, users_online)
         VALUES ('api:h:1:1', 'api', 'h', 1, now() - interval '2 days', now(), 310, 120, 12, 3.5, 9, 6),
                ('api:h:2:2', 'api', 'h', 2, now() - interval '3 days', now() - interval '2 days', 300, 110, 10, 2, 0, 0),
                ('worker:h:3:3', 'worker', 'h', 3, now() - interval '1 day', now(), 520, 200, 30, 8, NULL, NULL)`,
      );
      const res = await as("admin").get("/system-health/processes");
      expect(res.status).toBe(200);
      expect(res.body.people_online).toBe(6);
      expect(res.body.sockets).toBe(9);
      expect(res.body.processes.map((p) => p.role).sort()).toEqual(["api", "worker"]);
      expect(res.body.api_starts_7d).toBe(2);
      expect(res.body.worker_starts_7d).toBe(1);
      expect(await repo.usersOnline(pool)).toBe(6);
    });

    test("a beat is written by the process itself, and a restart is a new row", async () => {
      const beat = require("../../src/shared/observability/process-beat");
      const stop = beat.start({ role: "worker" });
      await stop.beat();
      await stop.beat();
      await stop();
      const { rows } = await q("SELECT role, pid, memory_mb FROM process_beat");
      expect(rows).toEqual([expect.objectContaining({ role: "worker", pid: process.pid })]);
      expect(rows[0].memory_mb).toBeGreaterThan(0);
    });
  });

  describe("snapshots, escalation and keeping", () => {
    test("the resources a person asks about first are checked and recorded", async () => {
      const res = await as("admin").get("/system-health/status");
      const by = Object.fromEntries(res.body.checks.map((c) => [c.key, c]));
      for (const key of ["disk", "memory", "cpu", "database_usage", "schedulers"]) {
        expect(by[key]).toBeDefined();
        // Each one reads as words, not as its key.
        expect(by[key].label).not.toBe(key);
        expect(by[key].detail.length).toBeGreaterThan(3);
      }
      expect(by.disk.detail).toMatch(/free/);
      expect(by.database_usage.detail).toMatch(/connections/);

      await rollup.snapshot();
      const row = await repo.lastSnapshot(pool);
      expect(row.disk_free_pct).not.toBeNull();
      expect(row.memory_used_pct).not.toBeNull();
      expect(row.database_mb).not.toBeNull();
    });

    test("a scheduler that has never run is reported, not passed over", async () => {
      await q("DELETE FROM schedule_run");
      const res = await as("admin").get("/system-health/status");
      const schedulers = res.body.checks.find((c) => c.key === "schedulers");
      expect(schedulers.state).toBe("degraded");
      expect(schedulers.detail).toMatch(/have not run/);

      // A job that has run is not reported.
      await q(
        `INSERT INTO schedule_run (name, last_run_at, ok, runs) 
         SELECT x, now(), true, 1 FROM unnest($1::text[]) AS x`,
        [require("../../src/jobs/registry").SCHEDULERS],
      );
      const after = await as("admin").get("/system-health/status");
      expect(after.body.checks.find((c) => c.key === "schedulers").state).toBe("up");
    });

    test("response time and the share that failed come from the minutes the API wrote", async () => {
      const stats = require("../../src/shared/observability/request-stats");
      stats.__reset();
      stats.record(100, 200);
      stats.record(300, 200);
      stats.record(50, 500);
      await stats.flush();
      await rollup.snapshot();
      const row = await repo.lastSnapshot(pool);
      expect(Number(row.requests)).toBe(3);
      expect(Number(row.mean_ms)).toBe(150);
      expect(Number(row.error_pct)).toBeCloseTo(33.33, 1);
      stats.__reset();
    });

    test("a snapshot records every check", async () => {
      const first = await rollup.snapshot();
      expect(["ready", "degraded", "unavailable"]).toContain(first.state);
      const last = await repo.lastSnapshot(pool);
      expect(Object.keys(last.checks)).toContain("postgres");
    });

    test("a fault open a day with nobody on it reaches email, once a day", async () => {
      await q(
        `UPDATE error_group SET status = 'open', assigned_to = NULL, escalated_at = NULL,
                first_seen_at = now() - interval '30 hours'
          WHERE severity IN ('fatal', 'error')`,
      );
      expect(await rollup.escalate()).toBeGreaterThan(0);
      await drain();
      const { rows } = await q(
        "SELECT channels FROM notification WHERE event_key = 'system_health.fault_unattended' LIMIT 1",
      );
      expect(rows[0].channels.sort()).toEqual(["email", "in_app", "push"]);
      // Already told today: it waits a day before it says so again.
      expect(await rollup.escalate()).toBe(0);
    });

    test("the digest goes out whether or not anything is wrong", async () => {
      const figures = await rollup.digest();
      expect(figures).toEqual(expect.objectContaining({ open: expect.any(Number), checks_down: expect.any(Number) }));
      await drain();
      const { rows } = await q("SELECT count(*)::int AS n FROM notification WHERE event_key = 'system_health.digest'");
      expect(rows[0].n).toBeGreaterThan(0);
    });

    test("occurrences go after 90 days and snapshots after 30; the fault itself stays", async () => {
      await writeFault(fault({ fingerprint: "Old|gone|x", occurred_at: new Date(Date.now() - 100 * 86_400_000).toISOString() }));
      await q("UPDATE health_snapshot SET taken_at = now() - interval '40 days'");
      const before = (await q("SELECT count(*)::int AS n FROM error_group")).rows[0].n;
      await q("INSERT INTO request_stat (minute, requests) VALUES (now() - interval '40 days', 5)");
      await q("INSERT INTO perf_sample (minute, api_up) VALUES (date_trunc('minute', now() - interval '40 days'), true)");
      await q("INSERT INTO route_stat (bucket, method, route, requests) VALUES (now() - interval '40 days', 'GET', '/old', 1)");
      await q(
        `INSERT INTO process_beat (instance, role, host, pid, started_at, last_beat_at)
         VALUES ('api:old:1:1', 'api', 'old', 1, now() - interval '41 days', now() - interval '40 days')`,
      );
      const done = await repo.purge(pool);
      expect(done.events).toBeGreaterThan(0);
      expect(done.snapshots).toBeGreaterThan(0);
      expect(done.minutes).toBeGreaterThan(0);
      expect(done.samples).toBe(1);
      expect(done.routes).toBe(1);
      expect(done.beats).toBe(1);
      expect((await q("SELECT count(*)::int AS n FROM error_group")).rows[0].n).toBe(before);
    });
  });
});
