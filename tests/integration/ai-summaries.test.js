"use strict";
/**
 * Praxis AI Engine PR3 on the real migrations (docs/guides/praxis-ai.md §6.3 step 8, §6.13, §6.16; the
 * handoff's decisions 14 and 15): every summary read answers the CEO with figures and never a row; a
 * manager's figures are their team's and a member of staff is refused what their grant does not reach;
 * a series is cut to 60 points; the summary cache serves a person's second ask from Redis and never
 * another person; a read the database cuts at three seconds, and one held to the deadline on another
 * connection, answer the model "too much" and are kept as timed_out; the Overview is drawn by the server
 * from the summary's own figures; Download Excel is reserved at once, made after commit with the
 * person's rights, carries About This File, is the asker's own, refuses a summary, and stops at the cap.
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test REDIS_URL=... npx jest tests/integration/ai-summaries
 *
 * Refuses to run unless the database name ends in "_test": it drops and rebuilds the public schema.
 * No provider is reached: Gemini answers from a script; the key is invented. Every person is invented.
 */
process.env.GEMINI_API_KEY = "test-key";
const request = require("supertest");
const ExcelJS = require("exceljs");
const c = require("@mycity/contract");
const { config } = require("../../src/config/env");
const { pool } = require("../../src/config/db");
const redis = require("../../src/config/redis");
const { atomically } = require("../../src/shared/db/tx");

jest.mock("../../src/jobs/queues", () => ({
  enqueue: jest.fn(async () => ({ id: "1" })),
  getQueue: jest.fn(() => ({ getDelayed: async () => [] })),
  closeQueues: jest.fn(async () => {}),
  DEFAULTS: {},
}));

const { rebuild } = require("./helpers/schema");
const { createAdmin } = require("../../scripts/db/create-admin");
const { buildApp } = require("../../src/app");
const outbox = require("../../src/shared/events/outbox");
const settings = require("../../src/shared/integrations/settings");
const jobs = require("../../src/services/ai/jobs");
const governance = require("../../src/services/ai/governance");
const gemini = require("../../src/services/ai/vendors/gemini");
const registry = require("../../src/shared/ai/registry");
const authorise = require("../../src/shared/ai/authorise");
const { defineManifest } = require("../../src/shared/ai/manifest");
const grantsCache = require("../../src/shared/rbac/grants-cache");
const { scopeFor } = require("../../src/middleware/rbac");
const lagos = require("../../src/shared/time/lagos");
const storage = require("../../src/services/storage/storage.service");
const tasks = require("../../src/modules/tasks/tasks.service");
const audit = require("../../src/modules/audit/audit.service");
const assistantExport = require("../../src/modules/assistant/assistant.export");

const describeDb = String(config.DB_NAME || "").endsWith("_test") ? describe : describe.skip;
const q = (sql, params) => pool.query(sql, params);
const one = async (sql, params) => (await q(sql, params)).rows[0] || null;
const PASSWORD = { ceo: "Chief#Officer26", ops: "Opera!ions2026", manager: "Manage#Team2026", staff: "Staff#Member2026", other: "Other#Member2026" };

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

/** Gemini answering from a script, one reply a call, keeping what it was sent. */
function script(...replies) {
  const sent = [];
  jest.spyOn(gemini, "complete").mockImplementation(async (r) => {
    sent.push(r);
    const next = replies.shift();
    if (!next) throw new Error("the script ran out");
    return { usage: { input_tokens: 300, output_tokens: 40 }, model: r.model, ...next };
  });
  return sent;
}
const callRead = (name, args = {}, id = "call-1") => ({ text: "", toolCalls: [{ id, type: "function", function: { name, arguments: JSON.stringify(args) } }], finish_reason: "tool_calls" });
const say = (draft) => ({ text: JSON.stringify({ table: null, route: null, prefill: null, more: false, action: null, overview: null, ...draft }), toolCalls: [], finish_reason: "stop" });

/** A stored workbook, opened: each sheet's name and its rows as arrays of cell text. */
async function open(documentId) {
  const doc = await one("SELECT storage_key FROM document WHERE document_id = $1", [documentId]);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await storage.get(doc.storage_key));
  const sheets = {};
  const names = [];
  wb.eachSheet((ws) => {
    const rows = [];
    ws.eachRow((row) => rows.push(row.values.slice(1).map((v) => (v instanceof Date ? v.toISOString() : String(v ?? "")))));
    sheets[ws.name] = rows;
    names.push(ws.name);
  });
  return { names, sheets };
}

/** Summaries and reads added beside the modules' for what the real ones cannot show: a count, a sleep. */
let runs = 0;
const EXTRA = defineManifest({
  module: "workspace",
  summaries: [
    {
      key: "sample.count",
      description: "A sample summary that counts how often it ran",
      params: c.common.EmptyBody,
      permission: ["workspace", "view"],
      run: async () => ({ figures: [{ key: "runs", label: "Runs", value: (runs += 1), unit: "count" }], groups: [], series: [], total: runs }),
    },
    {
      key: "sample.slow",
      description: "A sample summary whose statement takes longer than the database allows",
      params: c.common.EmptyBody,
      permission: ["workspace", "view"],
      run: async (client) => {
        await client.query("SELECT pg_sleep(4)");
        return { figures: [], groups: [], series: [], total: 0 };
      },
    },
  ],
  reads: [
    {
      key: "sample.slow_read",
      description: "A sample read whose service runs on its own pool connection for too long",
      params: c.common.PageQuery,
      permission: ["workspace", "view"],
      run: async () => {
        await pool.query("SELECT pg_sleep(5)");
        return { data: [], page: { number: 1, size: 25, total: 0, pages: 0, has_next: false } };
      },
      cite: () => null,
    },
  ],
});

describeDb("Praxis AI summaries, the read timeout and Download Excel against the real migrations", () => {
  let app;
  const people = {};
  const tokens = {};
  let ipSeq = 0;
  let today;
  const nextIp = () => {
    ipSeq += 1;
    return `10.74.${Math.floor(ipSeq / 250)}.${(ipSeq % 250) + 1}`;
  };
  const as = (who) => {
    const auth = (r) => r.set("Authorization", `Bearer ${tokens[who]}`).set("X-Forwarded-For", nextIp());
    return {
      get: (path) => auth(request(app).get(`/api/v1${path}`)),
      post: (path) => auth(request(app).post(`/api/v1${path}`)),
    };
  };
  const fresh = () => {
    jobs.forget();
    governance.forgetCaps();
    settings.forget();
  };
  const ask = (who, body) => as(who).post("/ai/ask").set("Idempotency-Key", `ask-${Date.now()}-${Math.random()}`).send(body);
  const userOf = async (who) => grantsCache.getAuthUser(pool, people[who].user_id);
  const summaryOf = async (who, key, params = {}) => authorise.runSummary(pool, await userOf(who), key, params);

  beforeAll(async () => {
    await rebuild(pool, config.DB_NAME);
    outbox.markReady();
    ({ app } = buildApp({ strict: true, accessLog: false }));
    today = lagos.today();
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
      createAdmin(client, { employee: sample(first, last, email, job), role_code, is_ceo }, PASSWORD[who], { allowAdditional: true });
    await tx(async (client) => {
      people.ceo = await make(client, "ceo", "Amaka", "Eze", "ceo@mycity.test", "Chief Executive Officer", "management", true);
      people.ops = await make(client, "ops", "Ada", "Obi", "ops@mycity.test", "Operations & People Lead", "operations_people");
      people.manager = await make(client, "manager", "Kemi", "Alade", "kemi@mycity.test", "Programme Lead", "manager");
      people.staff = await make(client, "staff", "Tunde", "Ade", "tunde@mycity.test", "Field Officer", "employee");
      people.other = await make(client, "other", "Bola", "Okon", "bola@mycity.test", "Studio Officer", "employee");
    });
    await drain();
    for (const who of Object.keys(PASSWORD)) {
      const email = people[who].employee.work_email;
      const res = await request(app).post("/api/v1/auth/login").set("X-Forwarded-For", nextIp()).send({ email, password: PASSWORD[who] });
      expect([who, res.status]).toEqual([who, 200]);
      tokens[who] = res.body.access_token;
      const u = await one("SELECT u.user_id, u.employee_id FROM app_user u WHERE u.email = $1", [email]);
      people[who] = { ...people[who], ...u };
    }
    // Tunde reports to Kemi; Bola works in another department.
    await q("UPDATE employee SET line_manager_id = $1 WHERE employee_id = $2", [people.manager.employee_id, people.staff.employee_id]);
    const dept = await one("INSERT INTO department (code, name) VALUES ('FLD', 'Field Operations') RETURNING department_id");
    await q("UPDATE employee SET department_id = $1 WHERE employee_id = $2", [dept.department_id, people.other.employee_id]);
    await grantsCache.bumpTeamVersion();

    // Seventy days of attendance for Tunde (late every third day, absent every seventh), five for Bola, three for Kemi.
    const days = (employeeId, n, late, absent) =>
      Array.from({ length: n }, (_, i) => {
        const d = lagos.addDays(today, -i);
        const status = absent && i % 7 === 6 ? "absent" : late && i % 3 === 0 ? "late" : "present";
        return [employeeId, d, status, status === "late" ? 10 + i : 0, status === "absent" ? 0 : 480];
      });
    const rows = [...days(people.staff.employee_id, 70, true, true), ...days(people.other.employee_id, 5, true, false), ...days(people.manager.employee_id, 3, false, false)];
    for (const r of rows)
      await q("INSERT INTO attendance_day (employee_id, attendance_date, status, late_minutes, worked_minutes) VALUES ($1, $2, $3, $4, $5)", r);
    const day = await one("SELECT attendance_day_id FROM attendance_day WHERE employee_id = $1 AND attendance_date = $2", [people.staff.employee_id, today]);
    await q("INSERT INTO attendance_exception (attendance_day_id, exception_type, severity, status) VALUES ($1, 'missing_clock_out', 'medium', 'open')", [day.attendance_day_id]);

    // Leave this year: two approved for Tunde, one waiting for Bola.
    const type = await one("SELECT leave_type_id FROM leave_type ORDER BY code LIMIT 1");
    const year = today.slice(0, 4);
    await q("INSERT INTO leave_request (employee_id, leave_type_id, starts_on, ends_on, amount, status) VALUES ($1, $2, $3, $4, 3, 'approved'), ($1, $2, $5, $6, 2, 'approved'), ($7, $2, $8, $9, 4, 'submitted')", [
      people.staff.employee_id, type.leave_type_id, `${year}-02-02`, `${year}-02-04`, `${year}-03-09`, `${year}-03-10`, people.other.employee_id, `${year}-05-04`, `${year}-05-07`,
    ]);

    // Tasks set by the CEO: two for Tunde, one of them overdue; one for Bola.
    const ceo = await userOf("ceo");
    const scope = await scopeFor(ceo, "workspace", "create");
    const set = (to, body) => tasks.create(ceo, scope, c.tasks.TaskCreate.parse({ ...body, primary_assignee_id: to }));
    await set(people.staff.employee_id, { title: "Send the weekly report", due_on: lagos.addDays(today, -2), priority: "high" });
    await set(people.staff.employee_id, { title: "Prepare the social calendar", due_on: lagos.addDays(today, 5) });
    await set(people.other.employee_id, { title: "Design the pitch deck" });

    registry.load({ extra: [{ folder: "sample", manifest: EXTRA }] });
    fresh();
  }, 180_000);

  afterAll(async () => {
    registry.reset();
    await require("../../src/shared/observability/error-reporter").flush();
    await pool.end();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    fresh();
  });

  test("every summary answers the CEO with AiSummaryResult and never a row", async () => {
    const keys = registry.summaries().map((s) => s.key);
    expect(keys).toEqual(expect.arrayContaining(["attendance.summary", "tasks.summary", "leave.summary", "approvals.summary", "goals.summary", "reviews.summary", "employees.summary", "audit.summary"]));
    for (const key of keys.filter((k) => k !== "sample.slow")) {
      const res = await summaryOf("ceo", key);
      expect([key, res.kind, res.cached]).toEqual([key, "summary", false]);
      expect([key, c.assistant.AiSummaryResult.safeParse(res.result).success]).toEqual([key, true]);
      expect([key, "data" in res, "rows" in res.result]).toEqual([key, false, false]);
    }
  });

  test("attendance.summary: the CEO's figures are the company's, a manager's are their team's, by person ranks, and a series by day is cut to 60 points", async () => {
    const from = lagos.addDays(today, -69);
    const all = await summaryOf("ceo", "attendance.summary", { from, to: today, by: "person" });
    const f = Object.fromEntries(all.result.figures.map((x) => [x.key, x.value]));
    expect(f).toMatchObject({ days: 78, people: 3, open_exceptions: 1, exceptions: 1 });
    expect(f.late).toBe((await one("SELECT count(*)::int AS n FROM attendance_day WHERE status = 'late'")).n);
    expect(f.late_minutes).toBe((await one("SELECT sum(late_minutes)::int AS n FROM attendance_day")).n);
    expect(all.result.total).toBe(78);
    const late = all.result.groups.find((g) => g.by === "late_days");
    expect(late.label).toBe("Late days by person");
    expect(late.rows[0]).toMatchObject({ key: people.staff.employee_id, label: "Tunde Ade", count: 70 });
    expect(late.rows.map((r) => r.label)).toEqual(["Tunde Ade", "Bola Okon", "Kemi Alade"]);
    expect(all.result.groups.find((g) => g.by === "late_minutes").rows.length).toBeLessThanOrEqual(10);

    const team = await summaryOf("manager", "attendance.summary", { from, to: today, by: "person" });
    const t = Object.fromEntries(team.result.figures.map((x) => [x.key, x.value]));
    expect(t).toMatchObject({ days: 73, people: 2 });
    expect(team.result.groups[0].rows.map((r) => r.label)).toEqual(["Tunde Ade", "Kemi Alade"]);

    const byDay = await summaryOf("ceo", "attendance.summary", { from, to: today, by: "day" });
    expect(byDay.result.groups).toEqual([]);
    expect(byDay.result.series.map((s) => s.key)).toEqual(["late_days", "absent_days", "late_minutes"]);
    expect(byDay.result.series[0].points).toHaveLength(60);
    expect(byDay.result.series[0].points.at(-1).at).toBe(today);
    expect(Object.fromEntries(byDay.result.figures.map((x) => [x.key, x.value])).days).toBe(78);
  });

  test("a member of staff is neither offered nor served the people's summaries; the Audit Log's needs the whole log", async () => {
    const staff = await userOf("staff");
    // Every login holds ess and performance (own) and workspace: those summaries are offered; the people's and the log's are not.
    expect((await authorise.allowedSummaries(staff)).map((s) => s.key).sort()).toEqual(["approvals.summary", "goals.summary", "reviews.summary", "sample.count", "sample.slow", "tasks.summary"]);
    await expect(summaryOf("staff", "attendance.summary")).rejects.toMatchObject({ code: "AI_READ_FORBIDDEN" });
    await expect(summaryOf("staff", "audit.summary")).rejects.toMatchObject({ code: "AI_READ_FORBIDDEN" });
    await expect(audit.aiSummary(pool, { by: "module" }, { scope: "team", scope_ids: [] })).rejects.toMatchObject({ code: "AI_READ_FORBIDDEN" });
    const ceo = await summaryOf("ceo", "audit.summary", { by: "module" });
    const f = Object.fromEntries(ceo.result.figures.map((x) => [x.key, x.value]));
    expect(f.entries).toBeGreaterThan(0);
    expect(f.actors).toBeGreaterThan(0);
    expect(ceo.result.groups.map((g) => g.by)).toEqual(["action", "actor", "module"]);
    expect(ceo.result.groups[0].rows[0].label).not.toMatch(/\./);
    expect(ceo.result.series[0]).toMatchObject({ key: "entries", points: [{ at: today, value: f.entries }] });
  });

  test("tasks.summary: mine counts one's own, a manager's team counts their reports, the CEO's by assignee ranks people", async () => {
    const mine = await summaryOf("staff", "tasks.summary", { scope: "mine" });
    expect(Object.fromEntries(mine.result.figures.map((x) => [x.key, x.value]))).toMatchObject({ tasks: 2, open: 2, overdue: 1, people: 1 });
    expect(mine.result.groups.map((g) => g.by)).toEqual(["status", "priority", "due"]);
    expect(mine.result.groups[0].rows).toEqual([{ key: "todo", label: "To Do", value: 2, count: 2 }]);
    expect(mine.result.groups[2].rows.map((r) => r.label).sort()).toEqual(["Later", "Overdue"]);
    const team = await summaryOf("manager", "tasks.summary", { scope: "team", by: "assignee" });
    expect(Object.fromEntries(team.result.figures.map((x) => [x.key, x.value]))).toMatchObject({ tasks: 2 });
    const all = await summaryOf("ceo", "tasks.summary", { scope: "team", by: "assignee" });
    expect(all.result.groups[2]).toMatchObject({ by: "assignee", label: "Tasks by assignee" });
    expect(all.result.groups[2].rows.map((r) => [r.label, r.value])).toEqual([["Tunde Ade", 2], ["Bola Okon", 1]]);
    expect(all.result.total).toBe(3);
  });

  test("leave.summary: days approved this year by person; employees.summary: headcount by department, a manager's team only; approvals.summary answers everyone", async () => {
    const leave = await summaryOf("ceo", "leave.summary", { by: "person" });
    expect(Object.fromEntries(leave.result.figures.map((x) => [x.key, x.value]))).toMatchObject({ requests: 3, approved: 2, waiting: 1, days_approved: 5, days_waiting: 4, people: 1 });
    expect(leave.result.groups.map((g) => g.by)).toEqual(["status", "type", "person"]);
    expect(leave.result.groups[2].rows[0]).toMatchObject({ label: "Tunde Ade", value: 5, count: 2 });
    const months = await summaryOf("ceo", "leave.summary", { by: "month" });
    expect(months.result.series[0]).toMatchObject({ key: "days_approved" });
    // February and March approved; May holds only the waiting request, so its approved days are none.
    expect(months.result.series[0].points.map((p) => p.value)).toEqual([3, 2, 0]);
    expect(months.result.series[1].points.map((p) => p.value)).toEqual([1, 1, 1]);

    const head = await summaryOf("ceo", "employees.summary", {});
    expect(Object.fromEntries(head.result.figures.map((x) => [x.key, x.value]))).toMatchObject({ people: 5, active: 5, departments: 2 });
    expect(head.result.groups[0].rows.map((r) => [r.label, r.value])).toEqual([["HR & Operations", 4], ["Field Operations", 1]]);
    const team = await summaryOf("manager", "employees.summary", { by: "manager" });
    expect(Object.fromEntries(team.result.figures.map((x) => [x.key, x.value]))).toMatchObject({ people: 2 });
    expect(team.result.groups[2].rows.map((r) => r.label).sort()).toEqual(["Kemi Alade", "No line manager"]);

    const waiting = await summaryOf("staff", "approvals.summary", {});
    expect(Object.fromEntries(waiting.result.figures.map((x) => [x.key, x.value]))).toMatchObject({ waiting: 0, overdue: 0, oldest_days: 0 });
    expect(waiting.result.groups.map((g) => g.by)).toEqual(["flow", "age", "module"]);
  });

  test("the summary cache: a person's second ask within a minute is served from Redis without running the SQL; another person runs it again (§6.13)", async () => {
    await redis.initRedis();
    try {
      const r = redis.getClient();
      const stale = await r.keys(redis.rkey("ai", "summary", "*"));
      if (stale.length) await r.del(...stale);
      runs = 0;
      const first = await summaryOf("ceo", "sample.count");
      const second = await summaryOf("ceo", "sample.count");
      expect([first.cached, second.cached, runs]).toEqual([false, true, 1]);
      expect(second.result).toEqual(first.result);
      const theirs = await summaryOf("manager", "sample.count");
      expect([theirs.cached, runs]).toEqual([false, 2]);
      const ttl = await r.ttl((await r.keys(redis.rkey("ai", "summary", "*")))[0]);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(60);
    } finally {
      await redis.closeRedis();
    }
  });

  test("a summary the database cuts at three seconds, and a read held to the deadline on another connection, are AI_READ_TIMEOUT (§6.3 step 8)", async () => {
    const started = Date.now();
    await expect(summaryOf("ceo", "sample.slow")).rejects.toMatchObject({ code: "AI_READ_TIMEOUT", status: 504 });
    expect(Date.now() - started).toBeLessThan(authorise.READ_DEADLINE_MS);
    const again = Date.now();
    await expect(authorise.runRead(pool, await userOf("ceo"), "sample.slow_read", {})).rejects.toMatchObject({ code: "AI_READ_TIMEOUT" });
    expect(Date.now() - again).toBeLessThan(authorise.READ_DEADLINE_MS + 1000);
  }, 20_000);

  test("through a question, a timed-out read is kept as timed_out, the model is told too_much, and the Table cannot page it", async () => {
    const sent = script(callRead("sample__slow", {}), say({ text: "That covers too much at once. Ask about one department." }));
    const res = await ask("ceo", { question: "Count everything ever.", shows: ["pane"] });
    expect(res.status).toBe(200);
    expect(c.assistant.AiAnswer.safeParse(res.body).success).toBe(true);
    expect(res.body.reads).toEqual([{ n: 1, key: "sample.slow", kind: "summary", module_key: "workspace", params: {}, outcome: "timed_out", rows: 0, total: null, first: null, masked: [] }]);
    const told = sent[1].messages.find((m) => m.role === "tool");
    expect(JSON.parse(told.content)).toMatchObject({ read: 1, key: "sample.slow", error: "too_much" });
    expect(await one("SELECT outcome FROM ai_message_read WHERE ai_message_id = $1", [res.body.ai_message_id])).toEqual({ outcome: "timed_out" });
    expect((await as("ceo").get(`/ai/answers/${res.body.ai_message_id}/reads/1?page=1`)).status).toBe(404);
    expect((await as("ceo").post(`/ai/answers/${res.body.ai_message_id}/reads/1/export`).send({})).status).toBe(404);
  }, 20_000);

  test("Overview: the server draws the figures and the chart from the summary's own values; a title with a made-up number is dropped; no pane, no overview", async () => {
    const from = lagos.addDays(today, -69);
    const draft = { text: "Tunde was late most.", overview: { summary: "attendance.summary", figures: ["late", "days", "nope"], chart: { kind: "bar", title: "Late days by person since October", group: "late_days", series: null } } };
    script(callRead("attendance__summary", { by: "person", from, to: today }), say(draft));
    const res = await ask("ceo", { question: "Who was late most in the last ten weeks?", shows: ["pane"] });
    expect(res.status).toBe(200);
    expect(res.body.reads[0]).toMatchObject({ n: 1, key: "attendance.summary", kind: "summary", module_key: "people", outcome: "read", rows: 0 });
    expect(res.body.overview.summary).toBe("attendance.summary");
    expect(res.body.overview.figures.map((f) => f.key)).toEqual(["late", "days"]);
    expect(res.body.overview.chart).toMatchObject({ kind: "bar", title: "Late days by person since October" });
    expect(res.body.overview.chart.labels[0]).toBe("Tunde Ade");
    const late = await one("SELECT count(*)::int AS n FROM attendance_day WHERE employee_id = $1 AND status = 'late' AND attendance_date >= $2", [people.staff.employee_id, from]);
    expect(res.body.overview.chart.series[0].values[0]).toBe(late.n);
    expect(await one("SELECT metadata -> 'overview' ->> 'summary' AS s FROM ai_message WHERE ai_message_id = $1", [res.body.ai_message_id])).toEqual({ s: "attendance.summary" });

    script(callRead("attendance__summary", { by: "department" }), say({ ...draft, overview: { ...draft.overview, chart: { ...draft.overview.chart, title: "4,321 late days" } } }));
    const dropped = await ask("ceo", { question: "Late days by department?", shows: ["pane"] });
    expect(dropped.body.overview.chart.title).toBe("Late days by department");

    script(callRead("attendance__summary", { by: "department" }), say(draft));
    const none = await ask("ceo", { question: "Who was late most?" });
    expect(none.body.overview).toBeNull();
  });

  test("Download Excel: reserved at once, made after commit with the asker's rights, two sheets with About This File, the asker's own file, and cut at the cap (§6.16; decision 15)", async () => {
    const question = "List our staff with their jobs.";
    script(callRead("employees__list", {}), say({ text: "Five people.", table: { read: 1, fields: ["display_name", "job_title"], labels: ["Name", "Job"] } }));
    const asked = await ask("ops", { question, shows: ["pane"] });
    expect(asked.status).toBe(200);
    expect(asked.body.table.columns).toEqual(["Name", "Job"]);

    const res = await as("ops").post(`/ai/answers/${asked.body.ai_message_id}/reads/1/export`).send({});
    expect(res.status).toBe(202);
    const file = c.documents.ExportFile.parse(res.body);
    expect(file).toMatchObject({ status: "pending", file_name: expect.stringMatching(/^praxis-ai-employees-list-.+\.xlsx$/) });
    expect((await as("ops").get(`/exports/${file.document_id}`)).body.status).toBe("pending");
    expect(await one("SELECT doc_type, sensitivity, uploaded_by FROM document WHERE document_id = $1", [file.document_id])).toEqual({ doc_type: "ai_answer_export", sensitivity: "personal", uploaded_by: people.ops.user_id });
    expect(await one("SELECT count(*)::int AS n FROM event_log WHERE event_key = 'assistant.read_export_requested'")).toEqual({ n: 1 });

    await drain();
    const done = await as("ops").get(`/exports/${file.document_id}`);
    expect(done.body).toEqual({ ...file, status: "done" });
    expect((await as("ops").get(`/documents/${file.document_id}/content`)).status).toBe(200);
    expect((await as("staff").get(`/documents/${file.document_id}/content`)).status).toBe(404);
    expect((await as("staff").get(`/exports/${file.document_id}`)).status).toBe(404);

    const { names, sheets } = await open(file.document_id);
    expect(names).toEqual([registry.read("employees.list").description.slice(0, 31), "About This File"]);
    const rows = sheets[names[0]];
    expect(rows[0]).toEqual(["Name", "Job"]);
    expect(rows.slice(1).map((r) => r[0]).sort()).toEqual(["Ada Obi", "Amaka Eze", "Bola Okon", "Kemi Alade", "Tunde Ade"]);
    const about = Object.fromEntries(sheets["About This File"].slice(1));
    expect(about).toMatchObject({
      "Exported by": "Ada Obi",
      Question: question,
      Read: expect.stringMatching(/\(employees\.list\)$/),
      Filters: "none",
      "Rows in this file": "5",
      "Rows the read has now": "5",
      "Cut at": "Not cut: every row is here.",
      "Masked fields": expect.any(String),
    });

    // Someone else's answer has no export; a read that is not the answer's is 404.
    expect((await as("staff").post(`/ai/answers/${asked.body.ai_message_id}/reads/1/export`).send({})).status).toBe(404);
    expect((await as("ops").post(`/ai/answers/${asked.body.ai_message_id}/reads/2/export`).send({})).status).toBe(404);

    // The cap: the worker stops at the ceiling and About This File says so.
    const second = await as("ops").post(`/ai/answers/${asked.body.ai_message_id}/reads/1/export`).send({});
    expect(second.status).toBe(202);
    await assistantExport.buildReadExport(
      { payload: { document_id: second.body.document_id, requested_by: people.ops.user_id, ai_message_id: asked.body.ai_message_id, n: 1 } },
      { attempt: 1, max_attempts: 1 },
      { ceiling: 2 },
    );
    const capped = await open(second.body.document_id);
    expect(capped.sheets[capped.names[0]]).toHaveLength(3);
    expect(Object.fromEntries(capped.sheets["About This File"].slice(1))).toMatchObject({ "Rows in this file": "2", "Rows the read has now": "5", "Cut at": "The first 2 rows: narrow the question for the rest." });
  }, 30_000);
});
