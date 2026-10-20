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

  describe("snapshots, escalation and keeping", () => {
    test("a snapshot records every check and the figures the chart draws", async () => {
      const first = await rollup.snapshot();
      expect(["ready", "degraded", "unavailable"]).toContain(first.state);
      const last = await repo.lastSnapshot(pool);
      expect(Object.keys(last.checks)).toContain("postgres");

      const res = await as("admin").get("/system-health/performance?range=24h");
      expect(res.status).toBe(200);
      expect(res.body.range).toBe("24h");
      expect(res.body.points.length).toBeGreaterThan(0);
      expect(res.body.uptime_pct).toMatch(/^\d{1,3}\.\d$/);
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
      const done = await repo.purge(pool);
      expect(done.events).toBeGreaterThan(0);
      expect(done.snapshots).toBeGreaterThan(0);
      expect((await q("SELECT count(*)::int AS n FROM error_group")).rows[0].n).toBe(before);
    });
  });
});
