"use strict";
/**
 * Performance PR 4 end to end (docs/guides/performance.md §3.4, §6.11, §6.18): the real migrations,
 * the whole app through HTTP, every response parsed with its contract (APP_ENV=test).
 *
 * Ada marks the month's priority tasks as commitments and sends them; her reviewer approves the
 * month, which fixes each original date; a later date moves the date now only; a sent month waits
 * once; Request Changes returns it with the reason; a manager who is the reviewer sends a month that
 * is approved as it is sent; a rescope goes through the same flow; a missed commitment gets its
 * Recovery task; the figures, Waiting On You and the month-end report read it all. Counts Towards
 * offers the assignee's own lines and key results; the week lists done, planned and blocked work
 * with Support Needed and Tidy With AI; the calendar carries performance dates; the reminder asks
 * whoever sent nothing.
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/performance-commitments
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
const lagos = require("../../src/shared/time/lagos");
const workingWeek = require("../../src/shared/time/working-week");
const tasks = require("../../src/modules/tasks/tasks.service");
const commitments = require("../../src/modules/targets/targets.commitments");
const reminders = require("../../src/modules/notifications/notifications.reminders");

const describeDb = String(config.DB_NAME || "").endsWith("_test") ? describe : describe.skip;

const q = (sql, params) => pool.query(sql, params);
const one = async (sql, params) => (await q(sql, params)).rows[0];
const PASSWORD = "Commit-Ments9Test";

const today = lagos.today();
const thisMonth = `${today.slice(0, 7)}-01`;
const monthKey = today.slice(0, 7);
const lastMonth = lagos.addMonths(thisMonth, -1);
const lastKey = lastMonth.slice(0, 7);
const quarterStart = `${today.slice(0, 4)}-${String(Math.floor((Number(today.slice(5, 7)) - 1) / 3) * 3 + 1).padStart(2, "0")}-01`;
/** A day in this month after today when there is one, else today. */
const laterThisMonth = lagos.monthBounds(today).last > today ? lagos.monthBounds(today).last : today;

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

describeDb("performance commitments, the week and the calendar against the real migrations", () => {
  let app;
  const people = {};
  const tokens = {};
  const ids = {};
  let ip = 0;

  const as = (who) => ({
    get: (path) => request(app).get(`/api/v1${path}`).set("Authorization", `Bearer ${tokens[who]}`),
    post: (path, body = {}) => request(app).post(`/api/v1${path}`).set("Authorization", `Bearer ${tokens[who]}`).send(body),
    put: (path, body = {}) => request(app).put(`/api/v1${path}`).set("Authorization", `Bearer ${tokens[who]}`).send(body),
    patch: (path, body = {}) => request(app).patch(`/api/v1${path}`).set("Authorization", `Bearer ${tokens[who]}`).send(body),
  });
  const emp = (who) => people[who].employee.employee_id;
  const commitment = (title, extra = {}) => ({
    title,
    is_commitment: true,
    acceptance_criteria: "Signed off by the head",
    commitment_month: thisMonth,
    due_on: laterThisMonth,
    ...extra,
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
    await make("ops", "Ngozi", "Eze", "operations_people", "Operations & People Lead", "People & Culture");
    await make("head", "Tolu", "Ade", "head_of_department", "Head, Brand", "Branding & Marketing");
    await make("ada", "Ada", "Nwosu", "employee", "Social Media Manager", "Branding & Marketing");
    await make("musa", "Musa", "Danjuma", "employee", "Graphics Associate", "Branding & Marketing");
    await make("outsider", "Bisi", "Lawal", "employee", "Content Associate", "Technology & Back-office Ops");
    await q("UPDATE employee SET line_manager_id = $1 WHERE employee_id = ANY($2::uuid[])", [emp("head"), [emp("ada"), emp("musa")]]);
    await q("UPDATE employee SET line_manager_id = $1 WHERE employee_id = ANY($2::uuid[])", [emp("ceo"), [emp("head"), emp("ops"), emp("outsider")]]);
    ids.bm = (await one("SELECT department_id FROM department WHERE name = 'Branding & Marketing'")).department_id;
    ids.gm = (await one("SELECT department_id FROM department WHERE name = 'General Management'")).department_id;
    await q("UPDATE department SET code = 'BM', head_employee_id = $2 WHERE department_id = $1", [ids.bm, emp("head")]);
    await q("UPDATE department SET code = 'GM', head_employee_id = $2 WHERE department_id = $1", [ids.gm, emp("ceo")]);
    await require("../../src/shared/rbac/grants-cache").bumpTeamVersion();
    await drain();
    for (const key of Object.keys(people)) {
      ip += 1;
      const res = await request(app)
        .post("/api/v1/auth/login")
        .set("X-Forwarded-For", `10.65.0.${ip}`)
        .send({ email: `${key}@mycity.test`, password: PASSWORD });
      expect(res.status).toBe(200);
      tokens[key] = res.body.access_token;
    }
    // The quarter, a binding plan with one key result the head owns, and Ada's binding scorecard
    // with a line measured in tasks (PR 2 builds these through its screens; here they are rows).
    const period = await as("ops").post("/performance/periods", { starts_on: quarterStart });
    expect(period.status).toBe(201);
    ids.period = period.body.performance_period_id;
    ids.plan = (
      await one(
        `INSERT INTO performance_plan (performance_period_id, department_id, status, binding_at)
         VALUES ($1, $2, 'binding', now()) RETURNING performance_plan_id`,
        [ids.period, ids.bm],
      )
    ).performance_plan_id;
    ids.objective = (
      await one(
        `INSERT INTO okr_objective (performance_period_id, performance_plan_id, department_id, code, title)
         VALUES ($1, $2, $3, 'BM-O1', 'Be the app residents open first') RETURNING okr_objective_id`,
        [ids.period, ids.plan, ids.bm],
      )
    ).okr_objective_id;
    ids.kr = (
      await one(
        `INSERT INTO okr_key_result (okr_objective_id, code, statement, accountable_employee_id, finishes_on)
         VALUES ($1, 'BM-KR1.1', 'Grow monthly active users to 64,000', $2, $3) RETURNING okr_key_result_id`,
        [ids.objective, emp("head"), today],
      )
    ).okr_key_result_id;
    ids.card = (
      await one(
        `INSERT INTO scorecard (performance_period_id, employee_id, department_id, reviewer_employee_id, status)
         VALUES ($1, $2, $3, $4, 'binding') RETURNING scorecard_id`,
        [ids.period, emp("ada"), ids.bm, emp("head")],
      )
    ).scorecard_id;
    ids.line = (
      await one(
        `INSERT INTO employee_target (scorecard_id, employee_id, title, weight, section, source, measure, position)
         VALUES ($1, $2, 'Publish 12 city stories', 20, 'results', 'tasks', 'numeric', 1) RETURNING employee_target_id`,
        [ids.card, emp("ada")],
      )
    ).employee_target_id;
  });

  afterAll(async () => {
    await require("../../src/shared/observability/error-reporter").flush();
    await pool.end();
  });

  test("a commitment needs its criteria, its month and a due date in that month", async () => {
    const noCriteria = await as("ada").post("/tasks", commitment("Launch the Lekki guide", { acceptance_criteria: undefined }));
    expect(noCriteria.status).toBe(422);
    expect(noCriteria.body.error.fields.acceptance_criteria).toBeDefined();
    const wrongMonth = await as("ada").post("/tasks", commitment("Launch the Lekki guide", { due_on: lagos.addMonths(thisMonth, 1) }));
    expect(wrongMonth.status).toBe(422);
    expect(wrongMonth.body.error.fields.due_on).toEqual(["Not in that month"]);
    const ok = await as("ada").post("/tasks", commitment("Launch the Lekki guide"));
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ is_commitment: true, commitment_month: thisMonth, commitment_state: "awaiting_approval", original_due_at: null });
    ids.c1 = ok.body.task_id;
    const second = await as("ada").post("/tasks", commitment("Film three Yaba shorts"));
    ids.c2 = second.body.task_id;
    // A task her manager set becomes a commitment when Ada marks it.
    const set = await as("head").post("/tasks", { title: "Brief the Ikeja photographer", primary_assignee_id: emp("ada"), due_on: laterThisMonth });
    expect(set.status).toBe(201);
    const marked = await as("ada").patch(`/tasks/${set.body.task_id}`, {
      is_commitment: true,
      acceptance_criteria: "Brief sent and confirmed",
      commitment_month: thisMonth,
    });
    expect(marked.status).toBe(200);
    expect(marked.body.is_commitment).toBe(true);
    ids.c3 = set.body.task_id;
    const listed = await as("ada").get(`/tasks?is_commitment=true&commitment_month=${thisMonth}`);
    expect(listed.body.data.map((t) => t.task_id).sort()).toEqual([ids.c1, ids.c2, ids.c3].sort());
  });

  test("Send Commitments puts the month in Ada's set and waits on her reviewer; a second send waits", async () => {
    expect((await as("outsider").post(`/performance/commitments/sets/${emp("ada")}/${monthKey}/submit`)).status).toBe(403);
    const sent = await as("ada").post(`/performance/commitments/sets/${emp("ada")}/${monthKey}/submit`);
    expect(sent.status).toBe(200);
    expect(sent.body).toMatchObject({ status: "submitted", task_count: 3, employee: expect.objectContaining({ employee_id: emp("ada") }) });
    ids.set = sent.body.commitment_set_id;
    ids.setInstance = sent.body.workflow_instance_id;
    const again = await as("ada").post(`/performance/commitments/sets/${emp("ada")}/${monthKey}/submit`);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("COMMITMENTS_WAITING");
    const waiting = await as("head").get(`/performance/commitments/sets?waiting_on_me=true&month=${monthKey}`);
    expect(waiting.body.data.map((s) => s.commitment_set_id)).toEqual([ids.set]);
    expect((await as("ada").get("/performance/commitments/sets?waiting_on_me=true")).body.data).toEqual([]);
    const rows = await as("head").get(`/performance/commitments?month=${monthKey}&waiting_on_me=true`);
    expect(rows.body.page.total).toBe(3);
    // The State filter reads as the pills: sent and waiting, not sent, returned; awaiting_approval is every unapproved one.
    const byState = async (state) => (await as("head").get(`/performance/commitments?month=${monthKey}&state=${state}`)).body.page.total;
    expect(await byState("sent")).toBe(3);
    expect(await byState("not_sent")).toBe(0);
    expect(await byState("returned")).toBe(0);
    expect(await byState("awaiting_approval")).toBe(3);
    expect((await as("ada").post(`/workflow/instances/${ids.setInstance}/approve`, {})).status).toBe(403);
  });

  test("Approve Month fixes each original date; a later date moves the date now only; the mark is fixed", async () => {
    expect((await as("head").post(`/workflow/instances/${ids.setInstance}/approve`, {})).status).toBe(200);
    await drain();
    const set = await one("SELECT status, approved_at FROM commitment_set WHERE commitment_set_id = $1", [ids.set]);
    expect(set.status).toBe("approved");
    const t = await as("ada").get(`/tasks/${ids.c1}`);
    expect(t.body).toMatchObject({ commitment_state: "due", set_status: "approved", can_rescope: true, can_cancel: false });
    expect(t.body.original_due_at).toBe(t.body.due_at);
    const original = t.body.original_due_at;
    const later = lagos.addDays(laterThisMonth, 3);
    const moved = await as("ada").patch(`/tasks/${ids.c1}`, { due_on: later });
    expect(moved.status).toBe(200);
    expect(moved.body.original_due_at).toBe(original);
    expect(moved.body.due_at).not.toBe(original);
    const unmark = await as("ada").patch(`/tasks/${ids.c1}`, { is_commitment: false });
    expect(unmark.status).toBe(409);
    expect(unmark.body.error.code).toBe("COMMITMENT_APPROVED");
    const cancel = await as("ada").post(`/tasks/${ids.c1}/cancel`, { cancel_reason: "No longer needed" });
    expect(cancel.status).toBe(409);
    const notice = await one(
      "SELECT count(*)::int AS n FROM event_log WHERE event_key = 'commitments.approved' AND entity_id = $1",
      [ids.set],
    );
    expect(notice.n).toBe(1);
  });

  test("a commitment done by the end of its original day is on time; the figures count it", async () => {
    expect((await as("ada").post(`/tasks/${ids.c2}/move`, { status: "done" })).status).toBe(200);
    const done = await as("ada").get(`/tasks/${ids.c2}`);
    expect(done.body.commitment_state).toBe("on_time");
    const summary = await as("head").get(`/performance/commitments/summary?month=${monthKey}`);
    expect(summary.status).toBe(200);
    expect(summary.body).toMatchObject({ month: thisMonth, commitments: 3, on_time: 1, due: 2, awaiting_approval: 0 });
    expect(await commitments.monthFigures(pool, emp("ada"), thisMonth)).toEqual({ due: 3, delivered_on_time: 1 });
    // Ada sees her own; the outsider sees none of them.
    expect((await as("ada").get(`/performance/commitments?month=${monthKey}`)).body.page.total).toBe(3);
    expect((await as("outsider").get(`/performance/commitments?month=${monthKey}`)).body.page.total).toBe(0);
    const onTime = await as("head").get(`/performance/commitments?month=${monthKey}&state=on_time`);
    expect(onTime.body.data.map((c) => c.task_id)).toEqual([ids.c2]);
  });

  test("a manager who is the reviewer sends a month that is approved as it is sent", async () => {
    const c = await as("head").post("/tasks", commitment("Redraw the Abuja map", { primary_assignee_id: emp("musa") }));
    expect(c.status).toBe(201);
    const sent = await as("head").post(`/performance/commitments/sets/${emp("musa")}/${monthKey}/submit`);
    expect(sent.status).toBe(200);
    expect(sent.body.status).toBe("approved");
    const t = await as("musa").get(`/tasks/${c.body.task_id}`);
    expect(t.body.original_due_at).not.toBeNull();
    expect(t.body.commitment_state).toBe("due");
  });

  test("Request Changes returns a month with its reason; it is sent again", async () => {
    const c = await as("ada").post("/tasks", commitment("Draft the December calendar", { commitment_month: lastMonth, due_on: lagos.addDays(lastMonth, 9) }));
    expect(c.status).toBe(201);
    ids.past = c.body.task_id;
    const sent = await as("ada").post(`/performance/commitments/sets/${emp("ada")}/${lastKey}/submit`);
    expect(sent.status).toBe(200);
    expect((await as("head").post(`/workflow/instances/${sent.body.workflow_instance_id}/reject`, { reason: "Add the Abuja launch" })).status).toBe(200);
    await drain();
    const mine = await as("ada").get(`/performance/commitments/sets?month=${lastKey}`);
    expect(mine.body.data[0]).toMatchObject({ status: "returned", returned_reason: "Add the Abuja launch" });
    const back = await as("ada").get(`/tasks/${ids.past}`);
    expect(back.body).toMatchObject({ commitment_state: "awaiting_approval", set_status: "returned" });
    const returned = await as("head").get(`/performance/commitments?month=${lastKey}&state=returned`);
    expect(returned.body.data.map((row) => row.task_id)).toContain(ids.past);
    expect((await as("head").get(`/performance/commitments?month=${lastKey}&state=sent`)).body.data.map((row) => row.task_id)).not.toContain(ids.past);
    const again = await as("ada").post(`/performance/commitments/sets/${emp("ada")}/${lastKey}/submit`);
    expect(again.status).toBe(200);
    expect(again.body.workflow_instance_id).not.toBe(sent.body.workflow_instance_id);
    expect((await as("head").post(`/workflow/instances/${again.body.workflow_instance_id}/approve`, {})).status).toBe(200);
    await drain();
  });

  test("a missed commitment gets one Recovery task, owned and dated", async () => {
    const missed = await as("head").get(`/tasks/${ids.past}`);
    expect(missed.body).toMatchObject({ commitment_state: "missed", can_set_recovery: true, recovery: null });
    expect((await as("head").post(`/performance/commitments/${ids.c3}/recovery`, { primary_assignee_id: emp("ada"), due_on: today })).status).toBe(409);
    const due = lagos.addDays(today, 5);
    const rec = await as("head").post(`/performance/commitments/${ids.past}/recovery`, { primary_assignee_id: emp("ada"), due_on: due });
    expect(rec.status).toBe(201);
    expect(rec.body).toMatchObject({ state: "missed", recovery: expect.objectContaining({ assignee: expect.objectContaining({ employee_id: emp("ada") }) }) });
    const twice = await as("head").post(`/performance/commitments/${ids.past}/recovery`, { primary_assignee_id: emp("ada"), due_on: due });
    expect(twice.status).toBe(409);
    expect(twice.body.error.code).toBe("RECOVERY_SET");
    const task = await one("SELECT title, entity_type, entity_id FROM task WHERE task_id = $1", [rec.body.recovery.task_id]);
    expect(task).toMatchObject({ entity_type: "task", entity_id: ids.past });
    expect(task.title).toMatch(/^Recovery: /);
    const panel = await as("ada").get(`/tasks/${ids.past}`);
    expect(panel.body).toMatchObject({ can_set_recovery: false, recovery: expect.objectContaining({ task_id: rec.body.recovery.task_id }) });
  });

  test("a rescope goes through the same flow and leaves the on-time count", async () => {
    expect((await as("ada").post(`/performance/commitments/${ids.c2}/rescope`, { reason: "Done already" })).status).toBe(409);
    const asked = await as("ada").post(`/performance/commitments/${ids.c3}/rescope`, { reason: "The photographer left Lagos" });
    expect(asked.status).toBe(200);
    expect(asked.body).toMatchObject({ rescope_pending: true, rescope_reason: "The photographer left Lagos", state: "due" });
    const panel = await as("head").get(`/tasks/${ids.c3}`);
    expect(panel.body.rescope).toMatchObject({ can_decide: true });
    expect((await as("ada").get(`/tasks/${ids.c3}`)).body.rescope).toMatchObject({ can_decide: false });
    expect((await as("head").post(`/workflow/instances/${panel.body.rescope.workflow_instance_id}/approve`, {})).status).toBe(200);
    await drain();
    const after = await as("ada").get(`/tasks/${ids.c3}`);
    expect(after.body).toMatchObject({ commitment_state: "rescoped", rescope: null, can_rescope: false });
    expect(await commitments.monthFigures(pool, emp("ada"), thisMonth)).toEqual({ due: 2, delivered_on_time: 1 });
  });

  test("Export Report makes the month-end delivery report in the worker", async () => {
    const res = await as("head").post("/performance/commitments/report", { month: monthKey });
    expect(res.status).toBe(202);
    expect(res.body.status).toBe("pending");
    await drain();
    const doc = await one("SELECT render_status, bytes FROM document WHERE document_id = $1", [res.body.document_id]);
    expect(doc.render_status).toBe("done");
    expect(Number(doc.bytes)).toBeGreaterThan(0);
    expect((await as("ada").post("/performance/commitments/report", { month: monthKey })).status).toBe(403);
  });

  test("Counts Towards offers the assignee's own lines and key results, and names what a task counts towards", async () => {
    const mine = await as("ada").get(`/tasks/counts-towards?month=${thisMonth}`);
    expect(mine.status).toBe(200);
    expect(mine.body.data).toEqual([expect.objectContaining({ kind: "line", employee_target_id: ids.line, title: "Publish 12 city stories" })]);
    const heads = await as("head").get(`/tasks/counts-towards?month=${thisMonth}`);
    expect(heads.body.data).toEqual([expect.objectContaining({ kind: "key_result", okr_key_result_id: ids.kr })]);
    expect((await as("head").get(`/tasks/counts-towards?assignee_id=${emp("ada")}`)).body.page.total).toBe(1);
    expect((await as("ada").get(`/tasks/counts-towards?assignee_id=${emp("musa")}`)).status).toBe(422);
    const wrong = await as("head").post("/tasks", { title: "Story for Musa", primary_assignee_id: emp("musa"), employee_target_id: ids.line });
    expect(wrong.status).toBe(422);
    expect(wrong.body.error.fields.employee_target_id).toEqual(["Not one of their lines"]);
    const story = await as("ada").post("/tasks", { title: "Write the Surulere story", employee_target_id: ids.line });
    expect(story.status).toBe(201);
    expect(story.body.counts_towards).toMatchObject({ kind: "line", employee_target_id: ids.line, link: expect.objectContaining({ tab: "targets" }) });
    const kr = await as("head").post("/tasks", { title: "Plan the user drive", entity_type: "key_result", entity_id: ids.kr });
    expect(kr.body.counts_towards).toMatchObject({ kind: "key_result", okr_key_result_id: ids.kr, title: "BM-KR1.1 Grow monthly active users to 64,000" });
    expect((await as("ada").post(`/tasks/${story.body.task_id}/move`, { status: "done" })).status).toBe(200);
    expect(await tasks.doneTowards(pool, ids.line, thisMonth)).toBe(1);
    expect(await tasks.doneTowards(pool, ids.line, lastMonth)).toBe(0);
    const event = await one(
      "SELECT payload FROM event_log WHERE event_key = 'task.completed' AND entity_id = $1",
      [story.body.task_id],
    );
    expect(event.payload).toMatchObject({ employee_target_id: ids.line, month: thisMonth });
  });

  test("My Week lists done, planned and blocked work; Support Needed is Ada's own; her manager reads it", async () => {
    const monday = lagos.addDays(today, 1 - lagos.weekday(today));
    const nextWeek = lagos.addDays(monday, 8);
    const planned = await as("ada").post("/tasks", { title: "Shoot the Yaba market", due_on: nextWeek });
    expect(planned.status).toBe(201);
    const stuck = await as("ada").post("/tasks", { title: "Book the drone pilot" });
    await as("ada").post(`/tasks/${stuck.body.task_id}/block`, { blocked_reason: "Waiting on the permit" });
    const week = await as("ada").get("/workspace/week");
    expect(week.status).toBe(200);
    expect(week.body.week_starts_on).toBe(monday);
    expect(week.body.done.data.map((t) => t.title)).toEqual(expect.arrayContaining(["Film three Yaba shorts", "Write the Surulere story"]));
    expect(week.body.planned.data.map((t) => t.title)).toContain("Shoot the Yaba market");
    expect(week.body.blocked.data.map((t) => t.title)).toEqual(["Book the drone pilot"]);
    const saved = await as("ada").put("/workspace/week", { week_starts_on: monday, support_needed: "A second camera for Friday" });
    expect(saved.status).toBe(200);
    expect(saved.body.support_needed).toBe("A second camera for Friday");
    expect((await as("head").get(`/workspace/week?employee_id=${emp("ada")}`)).body.support_needed).toBe("A second camera for Friday");
    expect((await as("musa").get(`/workspace/week?employee_id=${emp("ada")}`)).status).toBe(404);
    expect((await as("ada").put("/workspace/week", { week_starts_on: lagos.addDays(monday, 1) })).status).toBe(422);
    const team = await as("head").get("/workspace/team-weeks");
    expect(team.status).toBe(200);
    const row = team.body.data.find((r) => r.employee.employee_id === emp("ada"));
    expect(row).toMatchObject({ blocked: 1, planned: expect.any(Number), support_needed: "A second camera for Friday" });
    expect(team.body.data.map((r) => r.employee.employee_id)).not.toContain(emp("head"));
    expect((await as("ada").get("/workspace/team-weeks")).body.data).toEqual([]);
  });

  test("Tidy With AI suggests a summary and saves nothing; only the person's own run is kept", async () => {
    const monday = lagos.addDays(today, 1 - lagos.weekday(today));
    const tidy = await as("ada").post("/workspace/week/tidy", { kind: "week", text: "need a second camera friday" });
    expect(tidy.status).toBe(200);
    expect(tidy.body.original).toBe("need a second camera friday");
    if (tidy.body.available) {
      expect(tidy.body.tidied).toEqual(expect.any(String));
      const run = await one("SELECT purpose FROM ai_run WHERE run_id = $1", [tidy.body.ai_run_id]);
      expect(run.purpose).toBe("week-summary");
      expect((await as("musa").put("/workspace/week", { week_starts_on: monday, summary_text: "x", ai_run_id: tidy.body.ai_run_id })).status).toBe(422);
      const kept = await as("ada").put("/workspace/week", { week_starts_on: monday, summary_text: tidy.body.tidied, ai_run_id: tidy.body.ai_run_id });
      expect(kept.status).toBe(200);
      expect(kept.body).toMatchObject({ summary_text: tidy.body.tidied, support_needed: "A second camera for Friday" });
    } else {
      expect(tidy.body).toMatchObject({ tidied: null, ai_run_id: null });
    }
    expect((await as("ada").post("/workspace/week/tidy", { kind: "check_in", text: "x" })).status).toBe(422);
  });

  test("the calendar carries each reader's own performance dates", async () => {
    const cycle = await one(
      `INSERT INTO performance_cycle (name, starts_on, ends_on, check_in_due_on, head_check_in_due_on, review_due_on, performance_period_id)
       VALUES ('This month', $1, $2, $3, $3, $3, $4) RETURNING performance_cycle_id`,
      [thisMonth, lagos.monthBounds(today).last, today, ids.period],
    );
    const own = await one(
      `INSERT INTO performance_review (performance_cycle_id, employee_id, reviewer_employee_id, review_type, status, scorecard_id)
       VALUES ($1, $2, $3, 'manager', 'check_in', $4) RETURNING performance_review_id`,
      [cycle.performance_cycle_id, emp("ada"), emp("head"), ids.card],
    );
    await q(
      `INSERT INTO performance_review (performance_cycle_id, employee_id, reviewer_employee_id, review_type, status)
       VALUES ($1, $2, $3, 'manager', 'with_reviewer')`,
      [cycle.performance_cycle_id, emp("musa"), emp("head")],
    );
    await q(
      `INSERT INTO improvement_plan (employee_id, performance_review_id, starts_on, ends_on, review_on, created_by)
       VALUES ($1, $2, $3, $3, $3, $4)`,
      [emp("ada"), own.performance_review_id, today, people.ops.user.user_id],
    );
    const kinds = async (who) =>
      (await as(who).get(`/calendar?month=${monthKey}&item_kind=performance`)).body.data.map((i) => [i.performance_kind, i.link && i.link.module]);
    expect(await kinds("ada")).toEqual(expect.arrayContaining([["check_in_due", "ess"], ["pip_review", "ess"]]));
    expect(await kinds("ada")).toHaveLength(2);
    const heads = await kinds("head");
    expect(heads).toEqual(expect.arrayContaining([["review_due", "performance"], ["key_result_due", "performance"], ["pip_review", "performance"]]));
    expect(heads.map((k) => k[0])).not.toContain("check_in_due");
    const item = (await as("ada").get(`/calendar?month=${monthKey}&item_kind=performance`)).body.data[0];
    expect(item).toMatchObject({ item_kind: "performance", all_day: true });
  });

  test("the reminder asks whoever has sent nothing for the month, once", async () => {
    // The daily digest shares the tick and is not what this asks about.
    await q("INSERT INTO notification_reminder_rule (reminder_key, enabled) VALUES ('digest', false)");
    const cal = await workingWeek.loadCalendar(pool);
    const second = workingWeek.nthBusinessDay(monthKey, 2, cal);
    await reminders.tick({ db: pool, now: lagos.instant(second, "10:00") });
    await reminders.tick({ db: pool, now: lagos.instant(second, "10:10") });
    const asked = await q(
      `SELECT entity_id FROM reminder WHERE reminder_key = 'commitments_due' AND occurrence = $1 ORDER BY entity_id`,
      [monthKey],
    );
    const askedIds = asked.rows.map((r) => r.entity_id);
    expect(askedIds).toEqual(expect.arrayContaining([emp("outsider"), emp("head")]));
    expect(askedIds).not.toContain(emp("ada"));
    expect(askedIds).not.toContain(emp("musa"));
    const fired = await one(
      "SELECT count(*)::int AS n FROM event_log WHERE event_key = 'commitments.due' AND entity_id = $1",
      [emp("outsider")],
    );
    expect(fired.n).toBe(1);
  });
});
