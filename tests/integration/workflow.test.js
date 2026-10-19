"use strict";
/**
 * Approvals end to end (docs/guides/foundation.md §5, §6.5, §11): the real migrations on
 * a throwaway database, the whole app through HTTP. The leave flow comes from 0499; a
 * leave request is opened through the engine, as the leave module will open one.
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/workflow
 *
 * Refuses to run unless the database name ends in "_test": it drops and rebuilds the
 * public schema. Every person here is invented.
 */
const crypto = require("node:crypto");
const fs = require("node:fs");
const nodePath = require("node:path");
const request = require("supertest");
const c = require("@mycity/contract");
const { config } = require("../../src/config/env");
const { pool } = require("../../src/config/db");
const { atomically } = require("../../src/shared/db/tx");
const { rebuild } = require("./helpers/schema");
const { createAdmin } = require("../../scripts/db/create-admin");
const { buildApp } = require("../../src/app");
const outbox = require("../../src/shared/events/outbox");
const engine = require("../../src/shared/workflow/engine");
const deliveryPlan = require("../../src/shared/delivery-plan");
const contractPlan = require("@mycity/contract/plan");

const describeDb = String(config.DB_NAME || "").endsWith("_test") ? describe : describe.skip;

const q = (sql, params) => pool.query(sql, params);
const PASSWORD = "Leave-Flow9Test";

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

async function drain() {
  for (let i = 0; i < 10; i += 1) {
    await q("UPDATE event_outbox SET next_attempt_at = now() WHERE status = 'pending'");
    const r = await outbox.dispatchDue({ db: pool });
    if (r.claimed === 0) return;
  }
}

describeDb("approvals against the real migrations", () => {
  let app;
  const people = {};
  const tokens = {};
  let ipSeq = 0;

  const as = (who) => ({
    get: (path) => request(app).get(`/api/v1${path}`).set("Authorization", `Bearer ${tokens[who]}`),
    post: (path, body = {}) => request(app).post(`/api/v1${path}`).set("Authorization", `Bearer ${tokens[who]}`).send(body),
    put: (path, body = {}) => request(app).put(`/api/v1${path}`).set("Authorization", `Bearer ${tokens[who]}`).send(body),
  });

  /** A leave request as the leave module will open one: the subject asks, on their own behalf. */
  function openLeave(subject, days) {
    return tx((client) =>
      engine.openInstance(client, {
        definition_key: "leave.approval",
        entity: { type: "leave_request", id: crypto.randomUUID() },
        subject_employee_id: people[subject].employee.employee_id,
        context: { days },
        actor: people[subject].user,
      }),
    );
  }

  const flowsOf = async (who) => (await as(who).get("/settings/approvals")).body.data;

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
      department_name: "Programmes",
      start_date: "2026-01-05",
      employment_type: "full_time",
      work_pattern: "on_site",
    });
    const make = (key, first, last, role, job, isCeo = false) =>
      tx(async (client) => {
        people[key] = await createAdmin(
          client,
          { employee: sample(first, last, `${key}@mycity.test`, job), role_code: role, is_ceo: isCeo },
          PASSWORD,
          { allowAdditional: true },
        );
      });
    await make("ceo", "Ifeoma", "Nwankwo", "management", "Chief Executive Officer", true);
    await make("ops", "Tunde", "Bakare", "operations_people", "Operations Lead");
    await make("manager", "Kemi", "Alade", "manager", "Programme Lead");
    await make("manager2", "Sola", "Ojo", "manager", "Field Lead");
    await make("admin", "Chidi", "Obi", "administrator", "Systems Officer");
    await make("staff", "Musa", "Danjuma", "employee", "Field Officer");
    await make("other", "Zainab", "Lawal", "employee", "Field Officer");
    await q("UPDATE employee SET line_manager_id = $1 WHERE employee_id = $2", [
      people.manager.employee.employee_id,
      people.staff.employee.employee_id,
    ]);
    await drain();

    for (const key of Object.keys(people)) {
      ipSeq += 1;
      const res = await request(app)
        .post("/api/v1/auth/login")
        .set("X-Forwarded-For", `10.60.0.${ipSeq}`)
        .send({ email: `${key}@mycity.test`, password: PASSWORD });
      expect(res.status).toBe(200);
      tokens[key] = res.body.access_token;
    }
  });

  afterAll(async () => {
    await require("../../src/shared/observability/error-reporter").flush();
    await pool.end();
  });

  test("signed out, every route answers 401", async () => {
    expect((await request(app).get("/api/v1/workflow/mine")).status).toBe(401);
    expect((await request(app).get("/api/v1/settings/approvals")).status).toBe(401);
  });

  test("0499 seeds the leave flow: the line manager, then Operations & People over 5 days", async () => {
    const res = await as("ops").get("/settings/approvals");
    expect(res.status).toBe(200);
    expect(c.workflow.ApprovalFlowPage.parse(res.body).page.size).toBe(25);
    const leave = res.body.data.find((f) => f.key === "leave.approval");
    expect(leave).toMatchObject({
      version: 1,
      module_key: "people",
      name: "Leave Request",
      context_types: { days: "number" },
      problems: [],
      open_requests: 0,
    });
    expect(leave.stages.map((s) => [s.name, s.approvers.map((a) => a.label), s.condition])).toEqual([
      ["Line Manager", ["Line Manager"], []],
      ["Operations & People", ["Operations & People"], [{ field: "days", op: ">", value: 5 }]],
    ]);
    const summary = await as("ops").get("/settings/approvals/summary");
    expect(summary.status).toBe(200);
    expect(summary.body.flows).toBe(res.body.page.total);
  });

  test("a flow stored before the rules is listed with what is wrong with it", async () => {
    // 3099 seeded one (employee_consequence) and 3190 switched it off; this stores its shape again.
    await pool.query(
      `INSERT INTO workflow_definition (key, version, module_key, name, context_types, stages, active)
       VALUES ('test_legacy', 1, 'queries', 'Legacy Flow', '{}'::jsonb,
               '[{"key":"manager_review","approver":{"role":"manager"},"sla_hours":48}]'::jsonb, true)
       ON CONFLICT (key, version) DO NOTHING`,
    );
    const legacy = (await flowsOf("ops")).find((f) => f.key === "test_legacy");
    expect(legacy.problems.length).toBeGreaterThan(0);
    // Each problem names its stage and says the rule in words, never the engine's keys.
    for (const p of legacy.problems) expect(p).not.toMatch(/sla_hours|snake_case|uuid|on_timeout|stage \d+ \(/);
    expect((await as("ops").get("/settings/approvals/summary")).body.needs_fixing).toBeGreaterThanOrEqual(1);
  });

  test("Settings, Approvals is the settings grant's", async () => {
    expect((await as("staff").get("/settings/approvals")).status).toBe(403);
    expect((await as("manager").get("/settings/approvals/summary")).status).toBe(403);
    expect((await as("admin").get("/settings/approvals")).status).toBe(200);
  });

  test("three days: the line manager decides alone, and the requester is told", async () => {
    const opened = await openLeave("staff", 3);
    const id = opened.workflow_instance_id;

    const mine = await as("manager").get("/workflow/mine");
    expect(mine.status).toBe(200);
    const row = mine.body.data.find((r) => r.workflow_instance_id === id);
    expect(row).toMatchObject({
      definition_name: "Leave Request",
      stage_name: "Line Manager",
      subject_name: "Musa Danjuma",
      opened_by_name: "Musa Danjuma",
      context: { days: 3 },
      overdue: false,
    });
    expect(row.link).toBe(`/people?tab=leave&id=${opened.entity_id}`);
    expect((await as("manager").get("/workflow/mine/count")).body).toEqual({ waiting: 1, overdue: 0 });
    expect((await as("ops").get("/workflow/mine")).body.data.map((r) => r.workflow_instance_id)).not.toContain(id);

    const seen = await as("staff").get(`/workflow/instances/${id}`);
    expect(seen.status).toBe(200);
    expect(seen.body).toMatchObject({ state: "pending", can_decide: false, can_withdraw: true, can_reassign: false });
    expect(seen.body.link).toBe(`/ess?tab=my-leave&id=${opened.entity_id}`);
    expect(seen.body.route.map((s) => [s.name, s.state])).toEqual([
      ["Line Manager", "now"],
      ["Operations & People", "skipped"],
    ]);
    expect(seen.body.route[0].approvers).toEqual([
      { type: "employee", value: people.manager.employee.employee_id, label: "Kemi Alade" },
    ]);

    const approved = await as("manager").post(`/workflow/instances/${id}/approve`, { reason: "Enjoy the break" });
    expect(approved.status).toBe(200);
    expect(approved.body.state).toBe("approved");
    expect(approved.body.decisions).toEqual([
      expect.objectContaining({ decision: "approve", stage_name: "Line Manager", actor_name: "Kemi Alade", reason: "Enjoy the break" }),
    ]);
    expect((await as("manager").get("/workflow/mine/count")).body.waiting).toBe(0);

    await drain();
    const { rows } = await q("SELECT title FROM notification WHERE user_id = $1 AND entity_id = $2", [
      people.staff.user.user_id,
      opened.entity_id,
    ]);
    expect(rows.map((r) => r.title)).toContain("Leave Request: Approved");
  });

  test("seven days: Operations & People decide after the line manager", async () => {
    const { workflow_instance_id: id } = await openLeave("staff", 7);
    const first = await as("manager").post(`/workflow/instances/${id}/approve`, {});
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ state: "pending", stage_name: "Operations & People" });
    expect((await as("manager").get("/workflow/mine")).body.data.map((r) => r.workflow_instance_id)).not.toContain(id);
    expect((await as("ops").get("/workflow/mine")).body.data.map((r) => r.workflow_instance_id)).toContain(id);
    const done = await as("ops").post(`/workflow/instances/${id}/approve`, {});
    expect(done.body.state).toBe("approved");
    expect(done.body.route.map((s) => s.state)).toEqual(["done", "done"]);
  });

  test("rejecting and sending back need a reason; sending back returns to the first stage", async () => {
    const { workflow_instance_id: id } = await openLeave("staff", 7);
    expect((await as("manager").post(`/workflow/instances/${id}/reject`, {})).status).toBe(422);
    expect((await as("manager").post(`/workflow/instances/${id}/request-changes`, { reason: " " })).status).toBe(422);

    await as("manager").post(`/workflow/instances/${id}/approve`, {});
    const back = await as("ops").post(`/workflow/instances/${id}/request-changes`, { reason: "Split it across two months" });
    expect(back.status).toBe(200);
    expect(back.body).toMatchObject({ state: "pending", current_stage: "line_manager" });

    const rejected = await as("manager").post(`/workflow/instances/${id}/reject`, { reason: "The team is short that week" });
    expect(rejected.body.state).toBe("rejected");
    expect(rejected.body.decisions.map((d) => d.decision)).toEqual(["approve", "request_changes", "reject"]);
    expect(rejected.body.route.map((s) => s.state)).toEqual(["stopped", "skipped"]);
    expect((await as("manager").post(`/workflow/instances/${id}/approve`, {})).status).toBe(409);
  });

  test("only the requester withdraws, and a stranger cannot even see the request", async () => {
    const { workflow_instance_id: id } = await openLeave("staff", 2);
    expect((await as("other").get(`/workflow/instances/${id}`)).status).toBe(404);
    expect((await as("other").post(`/workflow/instances/${id}/withdraw`, {})).status).toBe(404);
    expect((await as("manager").post(`/workflow/instances/${id}/withdraw`, {})).status).toBe(403);
    expect((await as("staff").post(`/workflow/instances/${id}/approve`, {})).status).toBe(403);
    const gone = await as("staff").post(`/workflow/instances/${id}/withdraw`, { reason: "Plans changed" });
    expect(gone.status).toBe(200);
    expect(gone.body).toMatchObject({ state: "cancelled", can_withdraw: false });
    expect((await as("ops").get(`/workflow/instances/${id}`)).status).toBe(200);
    expect((await as("ops").get(`/workflow/instances/${crypto.randomUUID()}`)).status).toBe(404);
  });

  test("an edit saves a new version; an open request keeps the one it started on", async () => {
    const before = await openLeave("staff", 7);
    const leave = (await flowsOf("ops")).find((f) => f.key === "leave.approval");
    const stages = leave.stages.map((s) => ({
      key: s.key,
      name: s.name,
      approvers: s.approvers.map((a) => (a.value === null ? { type: a.type } : { type: a.type, value: a.value })),
      condition: s.key === "operations_people" ? [{ field: "days", op: ">", value: 10 }] : s.condition,
      sla_hours: s.sla_hours,
      on_timeout: s.on_timeout,
      on_approve: s.on_approve,
      on_reject: s.on_reject,
    }));

    expect((await as("staff").put(`/settings/approvals/${leave.workflow_definition_id}/steps`, { stages })).status).toBe(403);
    const bad = await as("ops").put(`/settings/approvals/${leave.workflow_definition_id}/steps`, {
      stages: [{ ...stages[0], approvers: [{ type: "role", value: "no_such_role" }] }],
    });
    expect(bad.status).toBe(422);
    expect(bad.body.error.message).toBe("Fix the stages first");
    expect(bad.body.error.fields.stages).toEqual([`${stages[0].name}: a role it names no longer exists`]);

    const saved = await as("ops").put(`/settings/approvals/${leave.workflow_definition_id}/steps`, { stages });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ key: "leave.approval", version: 2, open_requests: 1 });
    expect(saved.body.stages[1].condition).toEqual([{ field: "days", op: ">", value: 10 }]);
    expect((await as("ops").put(`/settings/approvals/${leave.workflow_definition_id}/steps`, { stages })).status).toBe(409);

    // Opened on version 1: still goes to Operations & People after the line manager.
    const old = await as("manager").post(`/workflow/instances/${before.workflow_instance_id}/approve`, {});
    expect(old.body).toMatchObject({ version: 1, state: "pending", stage_name: "Operations & People" });

    // Opened on version 2: seven days is no longer over the limit.
    const fresh = await openLeave("staff", 7);
    const decided = await as("manager").post(`/workflow/instances/${fresh.workflow_instance_id}/approve`, {});
    expect(decided.body).toMatchObject({ version: 2, state: "approved" });

    const { rows } = await q(
      "SELECT payload FROM event_log WHERE event_key = 'workflow.definition_saved' ORDER BY created_at DESC LIMIT 1",
    );
    expect(rows[0].payload).toMatchObject({ key: "leave.approval", from_version: 1, version: 2 });
  });

  test("Operations & People reassign a waiting stage to someone who approves these", async () => {
    const { workflow_instance_id: id } = await openLeave("staff", 3);
    const to = (who) => ({ user_id: people[who].user.user_id, reason: "Kemi is on leave this week" });
    expect((await as("manager").post(`/workflow/instances/${id}/reassign`, to("manager2"))).status).toBe(403);
    expect((await as("ops").post(`/workflow/instances/${id}/reassign`, to("admin"))).status).toBe(422);
    expect((await as("ops").post(`/workflow/instances/${id}/reassign`, to("staff"))).status).toBe(422);

    const moved = await as("ops").post(`/workflow/instances/${id}/reassign`, to("manager2"));
    expect(moved.status).toBe(200);
    expect(moved.body.route[0].approvers).toEqual([{ type: "user", value: people.manager2.user.user_id, label: "Sola Ojo" }]);
    expect(moved.body.decisions.at(-1)).toMatchObject({ decision: "reassign", actor_name: "Tunde Bakare" });
    expect((await as("manager").get("/workflow/mine")).body.data.map((r) => r.workflow_instance_id)).not.toContain(id);
    expect((await as("manager").post(`/workflow/instances/${id}/approve`, {})).status).toBe(403);

    await drain();
    const { rows } = await q("SELECT title FROM notification WHERE user_id = $1 AND event_key = 'workflow.reassigned'", [
      people.manager2.user.user_id,
    ]);
    expect(rows.map((r) => r.title)).toEqual(["Approval needed: Leave Request"]);
    const done = await as("manager2").post(`/workflow/instances/${id}/approve`, {});
    expect(done.body.state).toBe("approved");
  });

  test("a request past its time limit counts as overdue", async () => {
    const { workflow_instance_id: id } = await openLeave("staff", 1);
    await q("UPDATE workflow_instance SET stage_due_at = now() - interval '1 hour' WHERE workflow_instance_id = $1", [id]);
    expect((await as("manager").get("/workflow/mine/count")).body).toEqual({ waiting: 1, overdue: 1 });
    const row = (await as("manager").get("/workflow/mine")).body.data.find((r) => r.workflow_instance_id === id);
    expect(row.overdue).toBe(true);
    expect((await as("ops").get("/settings/approvals/summary")).body.overdue).toBeGreaterThanOrEqual(1);
  });

  test("the CEO approves anywhere, even a stage that names someone else", async () => {
    const { workflow_instance_id: id } = await openLeave("staff", 2);
    expect((await as("ceo").get("/workflow/mine")).body.data.map((r) => r.workflow_instance_id)).not.toContain(id);
    const seen = await as("ceo").get(`/workflow/instances/${id}`);
    expect(seen.body).toMatchObject({ can_decide: true, can_reassign: true });
    expect((await as("ceo").post(`/workflow/instances/${id}/approve`, {})).body.state).toBe("approved");
  });

  test("a request about a record whose screen has not shipped waits in nobody's Need You (QA DEF-01)", async () => {
    const { workflow_instance_id: id } = await openLeave("staff", 1);
    // As a request about an expense would read, before Expenses has its API on staging.
    await q("UPDATE workflow_instance SET entity_type = 'expense' WHERE workflow_instance_id = $1", [id]);
    const listed = async () => (await as("manager").get("/workflow/mine")).body.data.map((r) => r.workflow_instance_id);
    const counted = async () => (await as("manager").get("/workflow/mine/count")).body.waiting;
    const waiting = await counted();
    expect(await listed()).toContain(id);
    const docs = contractPlan.readPlan((rel) => fs.readFileSync(nodePath.join(__dirname, "../..", rel), "utf8"));
    deliveryPlan.use({ plan: docs, rule: "staging" });
    try {
      expect(await listed()).not.toContain(id);
      expect(await counted()).toBe(waiting - 1);
    } finally {
      deliveryPlan.use();
    }
    expect(await listed()).toContain(id);
  });
});
