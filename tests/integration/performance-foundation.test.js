"use strict";
/**
 * Performance foundation end to end (docs/guides/performance.md PR 1): the real migrations on a
 * throwaway database, the whole app through HTTP, every response parsed with its contract
 * (APP_ENV=test). Operations & People set up a quarter, which carries the code's rules and copies
 * them forward; only one quarter is active; the review flow's second level is the person the
 * request names and is skipped when the reviewer is the CEO; a department's head is a person or
 * a vacant seat, whose acting head is the person above it.
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/performance-foundation
 *
 * Refuses to run unless the database name ends in "_test": it drops and rebuilds the public
 * schema. Every person here is invented.
 */
const request = require("supertest");
const { config } = require("../../src/config/env");
const { pool } = require("../../src/config/db");
const { atomically } = require("../../src/shared/db/tx");
const { rebuild } = require("./helpers/schema");
const { createAdmin } = require("../../scripts/db/create-admin");
const { buildApp } = require("../../src/app");
const outbox = require("../../src/shared/events/outbox");
const workflow = require("../../src/shared/workflow/engine");
const organisation = require("../../src/modules/organisation/organisation.service");
const { scoring } = require("@mycity/contract");

const describeDb = String(config.DB_NAME || "").endsWith("_test") ? describe : describe.skip;

const q = (sql, params) => pool.query(sql, params);
const PASSWORD = "Perf-Found9Test";

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

describeDb("performance foundation against the real migrations", () => {
  let app;
  const people = {};
  const tokens = {};
  let ip = 0;

  const as = (who) => ({
    get: (path) => request(app).get(`/api/v1${path}`).set("Authorization", `Bearer ${tokens[who]}`),
    post: (path, body = {}) =>
      request(app).post(`/api/v1${path}`).set("Authorization", `Bearer ${tokens[who]}`).send(body),
    patch: (path, body = {}) =>
      request(app).patch(`/api/v1${path}`).set("Authorization", `Bearer ${tokens[who]}`).send(body),
  });
  const emp = (who) => people[who].employee.employee_id;
  const actor = (who) => ({
    user_id: people[who].user.user_id,
    employee_id: emp(who),
    role_ids: [people[who].role.role_id],
    is_ceo: who === "ceo",
  });

  beforeAll(async () => {
    await rebuild(pool, config.DB_NAME);
    outbox.markReady();
    ({ app } = buildApp({ strict: true, accessLog: false }));

    const sample = (first, last, email, job, department) => ({
      first_name: first,
      last_name: last,
      work_email: email,
      phone: "08031234567",
      job_title: job,
      department_name: department,
      start_date: "2026-01-05",
      employment_type: "full_time",
      work_pattern: "on_site",
    });
    const make = (key, first, last, role, job, department, isCeo = false) =>
      tx(async (client) => {
        people[key] = await createAdmin(
          client,
          { employee: sample(first, last, `${key}@mycity.test`, job, department), role_code: role, is_ceo: isCeo },
          PASSWORD,
          { allowAdditional: true },
        );
      });
    await make("ceo", "Amaka", "Obi", "management", "Chief Executive Officer", "General Management", true);
    await make("pm", "Kunle", "Bello", "management", "Program Manager", "General Management");
    await make("ops", "Ngozi", "Eze", "operations_people", "Operations & People Lead", "People & Culture");
    await make("head", "Tolu", "Ade", "head_of_department", "Head, Brand", "Branding & Marketing");
    await make("staff", "Musa", "Danjuma", "employee", "Graphics Associate", "Branding & Marketing");
    await q("UPDATE employee SET line_manager_id = $1 WHERE employee_id = $2", [emp("head"), emp("staff")]);
    await q("UPDATE employee SET line_manager_id = $1 WHERE employee_id = ANY($2::uuid[])", [emp("pm"), [emp("head"), emp("ops")]]);
    await q("UPDATE employee SET line_manager_id = $1 WHERE employee_id = $2", [emp("ceo"), emp("pm")]);
    await require("../../src/shared/rbac/grants-cache").bumpTeamVersion();
    await drain();

    for (const key of Object.keys(people)) {
      ip += 1;
      const res = await request(app)
        .post("/api/v1/auth/login")
        .set("X-Forwarded-For", `10.63.0.${ip}`)
        .send({ email: `${key}@mycity.test`, password: PASSWORD });
      expect(res.status).toBe(200);
      tokens[key] = res.body.access_token;
    }
  });

  afterAll(async () => {
    await require("../../src/shared/observability/error-reporter").flush();
    await pool.end();
  });

  describe("capabilities (§8)", () => {
    test("each role holds its defaults; the CEO holds every one", async () => {
      const caps = async (who) => (await as(who).get("/auth/me")).body.capabilities;
      expect(await caps("ops")).toEqual(expect.arrayContaining(["goals.function", "performance.manage"]));
      expect(await caps("ops")).not.toContain("goals.company");
      expect(await caps("pm")).toEqual(expect.arrayContaining(["goals.company", "goals.function"]));
      expect(await caps("pm")).not.toContain("performance.manage");
      expect(await caps("head")).toEqual(expect.arrayContaining(["goals.function"]));
      expect(await caps("staff")).not.toContain("goals.function");
      expect(await caps("ceo")).toEqual(expect.arrayContaining(["goals.organisation", "goals.confirm", "performance.manage"]));
    });
  });

  describe("quarters and their rules (§5, §6.2)", () => {
    const ids = {};

    test("no quarter yet: current is a 404", async () => {
      const res = await as("staff").get("/performance/periods/current");
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("NO_QUARTER");
    });

    test("only performance.manage sets up a quarter", async () => {
      const res = await as("head").post("/performance/periods", { starts_on: "2026-10-01" });
      expect(res.status).toBe(403);
    });

    test("Q4 2026: named, ended and planned from its first day, carrying the code's rules", async () => {
      const res = await as("ops").post("/performance/periods", { starts_on: "2026-10-01", targets_lock_on: "2026-10-31" });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        name: "Q4 2026",
        starts_on: "2026-10-01",
        ends_on: "2026-12-31",
        plan_year_starts_on: "2026-01-01",
        targets_lock_on: "2026-10-31",
        status: "planning",
        months: ["2026-10-01", "2026-11-01", "2026-12-01"],
      });
      expect(res.body.rules).toEqual(JSON.parse(JSON.stringify(scoring.DEFAULT_RULES)));
      ids.q4 = res.body.performance_period_id;
      const again = await as("ops").post("/performance/periods", { starts_on: "2026-10-01" });
      expect(again.status).toBe(409);
      expect(again.body.error.code).toBe("PERIOD_EXISTS");
    });

    test("a day outside the quarter and a start that is not a quarter's are refused", async () => {
      expect((await as("ops").post("/performance/periods", { starts_on: "2026-11-01" })).status).toBe(422);
      const res = await as("ops").patch(`/performance/periods/${ids.q4}`, { targets_lock_on: "2027-01-05" });
      expect(res.status).toBe(422);
      expect(res.body.error.fields.targets_lock_on).toBeDefined();
    });

    test("rules that do not hold together are refused; a change to this quarter's rules is kept", async () => {
      const bad = JSON.parse(JSON.stringify(scoring.DEFAULT_RULES));
      bad.sections.results = 70;
      expect((await as("ops").patch(`/performance/periods/${ids.q4}`, { rules: bad })).status).toBe(422);
      const rules = JSON.parse(JSON.stringify(scoring.DEFAULT_RULES));
      rules.due_business_days.review = 6;
      const res = await as("ops").patch(`/performance/periods/${ids.q4}`, { rules, status: "active" });
      expect(res.status).toBe(200);
      expect(res.body.rules.due_business_days.review).toBe(6);
      expect(res.body.status).toBe("active");
      const current = await as("staff").get("/performance/periods/current");
      expect(current.body.performance_period_id).toBe(ids.q4);
    });

    test("the next quarter copies the last one's rules; one quarter is active at a time; none goes back", async () => {
      const res = await as("ops").post("/performance/periods", { starts_on: "2027-01-01" });
      expect(res.status).toBe(201);
      expect(res.body.name).toBe("Q1 2027");
      expect(res.body.plan_year_starts_on).toBe("2027-01-01");
      expect(res.body.rules.due_business_days.review).toBe(6);
      ids.q1 = res.body.performance_period_id;
      const two = await as("ops").patch(`/performance/periods/${ids.q1}`, { status: "active" });
      expect(two.status).toBe(409);
      expect(two.body.error.code).toBe("PERIOD_ACTIVE_EXISTS");
      const back = await as("ops").patch(`/performance/periods/${ids.q4}`, { status: "planning" });
      expect(back.status).toBe(409);
      expect(back.body.error.code).toBe("PERIOD_STATUS");
    });

    test("the list pages at 25, the latest first, and records each save", async () => {
      const res = await as("staff").get("/performance/periods");
      expect(res.status).toBe(200);
      expect(res.body.data.map((p) => p.name)).toEqual(["Q1 2027", "Q4 2026"]);
      expect(res.body.page_size ?? 25).toBe(25);
      const audit = await q(
        "SELECT action FROM audit_ledger WHERE entity_type = 'performance_period' AND entity_id = $1 ORDER BY created_at",
        [ids.q4],
      );
      expect(audit.rows.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("the review flow's second level (§6.12, §6.13)", () => {
    const open = (context, reviewee = "staff") =>
      tx((c) =>
        workflow.openInstance(c, {
          definition_key: "performance.review",
          entity: { type: "performance_review", id: `00000000-0000-4000-8000-${String(Math.floor(Math.random() * 1e12)).padStart(12, "0")}` },
          subject_employee_id: emp(reviewee),
          context,
          actor: actor("head"),
          exclude_employee_ids: [emp(reviewee)],
        }),
      );
    const act = (id, who, decision) => tx((c) => workflow.act(c, { instance_id: id, actor: actor(who), decision }));

    test("the reviewer's own manager first, by name, then Operations & People", async () => {
      const inst = await open({ second_level_employee_id: emp("pm"), reviewer_is_ceo: false });
      expect(inst.current_stage).toBe("second_level");
      expect(inst.stage_approvers).toEqual([{ type: "employee", value: emp("pm"), via: "employee_in_context" }]);
      await expect(act(inst.workflow_instance_id, "ops", "approve")).rejects.toMatchObject({ status: 403 });
      const mid = await act(inst.workflow_instance_id, "pm", "approve");
      expect(mid.current_stage).toBe("operations_people");
      const done = await act(inst.workflow_instance_id, "ops", "approve");
      expect(done.state).toBe("approved");
    });

    test("no second level when the reviewer is the CEO, or nobody is named", async () => {
      const ceoReviews = await open({ reviewer_is_ceo: true, second_level_employee_id: emp("pm") }, "pm");
      expect(ceoReviews.current_stage).toBe("operations_people");
      const nobody = await open({ reviewer_is_ceo: false });
      expect(nobody.current_stage).toBe("operations_people");
    });

    test("nobody decides their own review: Operations & People's own goes to the CEO", async () => {
      const own = await open({ reviewer_is_ceo: false, second_level_employee_id: emp("ceo") }, "ops");
      const mid = await act(own.workflow_instance_id, "ceo", "approve");
      expect(mid.current_stage).toBe("operations_people");
      await expect(act(own.workflow_instance_id, "ops", "approve")).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
      expect((await act(own.workflow_instance_id, "ceo", "approve")).state).toBe("approved");
    });
  });

  describe("a department's head (§6.20)", () => {
    test("a person, or a vacant seat whose acting head is the person above it", async () => {
      const dept = (await as("ops").get("/departments?q=Branding")).body.data[0];
      expect(dept.head).toBeNull();
      expect(dept.acting_head).toBeNull();

      const asHead = await as("ops").patch(`/departments/${dept.department_id}`, { head_employee_id: emp("head") });
      expect(asHead.status).toBe(200);
      expect(asHead.body.head).toMatchObject({ employee_id: emp("head"), vacant: false });
      expect(asHead.body.acting_head.employee_id).toBe(emp("head"));

      const seat = await tx((c) =>
        organisation.createSeat(c, { title: "Head, Growth", department_id: dept.department_id, line_manager_id: emp("pm") }, null),
      );
      const asSeat = await as("ops").patch(`/departments/${dept.department_id}`, { head_seat_id: seat.org_seat_id });
      expect(asSeat.status).toBe(200);
      expect(asSeat.body.head_employee_id).toBeNull();
      expect(asSeat.body.head).toMatchObject({ org_seat_id: seat.org_seat_id, vacant: true, display_name: "Head, Growth" });
      expect(asSeat.body.acting_head.employee_id).toBe(emp("pm"));
      expect(await organisation.headOf(pool, dept.department_id)).toBe(emp("pm"));

      const both = await as("ops").patch(`/departments/${dept.department_id}`, {
        head_employee_id: emp("head"),
        head_seat_id: seat.org_seat_id,
      });
      expect(both.status).toBe(422);
    });
  });
});
