"use strict";
/**
 * M3's definition of done (MILESTONES §8), walked once from start to finish on the real
 * migrations, through HTTP, every response parsed with its contract (APP_ENV=test):
 *
 *   1. a rule is configured from the UI in two calls: "three late arrivals in thirty
 *      days raises a query";
 *   2. three late arrivals raise exactly one query, not three;
 *   3. the employee responds in ESS;
 *   4. HR upholds it, and a warning letter generates, files and sends;
 *   5. a second offence escalates to the second warning without code;
 *   6. a new step is inserted into the chain from the UI and the next case walks it;
 *   7. an approved financial consequence waits for the payroll run as a pending deduction
 *      (the inserted fourth rung is approved by Management too, as the approval says).
 *
 * The late arrivals are attendance days written as the register writes them, announced
 * by the event attendance commits with a clock-in; from that event on, everything is the
 * system's own path: the outbox, the evaluation job, the evaluator, the query, its letter.
 * A clock-in through the punch route is attendance's own suite (tests/integration/attendance).
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/queries-done
 *
 * Refuses to run unless the database name ends in "_test". Every person here is invented.
 */
const request = require("supertest");
const { config } = require("../../src/config/env");
const { pool } = require("../../src/config/db");
const { atomically } = require("../../src/shared/db/tx");
const { emit } = require("../../src/shared/events/emit");
const { rebuild } = require("./helpers/schema");
const { createAdmin } = require("../../scripts/db/create-admin");
const { buildApp } = require("../../src/app");
const outbox = require("../../src/shared/events/outbox");
const documents = require("../../src/shared/documents/generate");
const chromium = require("../../src/services/pdf/chromium");
const realtime = require("../../src/services/realtime/emitter");
const lagos = require("../../src/shared/time/lagos");
const evaluateJob = require("../../src/jobs/handlers/query-rule-evaluate");
const fines = require("../../src/modules/sanctions/sanctions.fines");

const sent = [];
jest.mock("../../src/jobs/queues", () => ({
  enqueue: jest.fn(async (queue, name, data, opts) => {
    sent.push({ queue, name, data, opts });
    return { id: String(sent.length) };
  }),
  getQueue: jest.fn(),
  closeQueues: jest.fn(async () => undefined),
  DEFAULTS: {},
}));

const describeDb = String(config.DB_NAME || "").endsWith("_test") ? describe : describe.skip;

const q = (sql, params) => pool.query(sql, params);
const PASSWORD = "Definition-Of9Done";
const today = lagos.today();
const day = (n) => lagos.addDays(today, -n);

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

/** Run the outbox until it is empty, then any evaluation jobs it queued, as the worker would. */
async function settle() {
  for (let round = 0; round < 5; round += 1) {
    for (let i = 0; i < 10; i += 1) {
      await q("UPDATE event_outbox SET next_attempt_at = now() WHERE status = 'pending'");
      if ((await outbox.dispatchDue({ db: pool })).claimed === 0) break;
    }
    const jobs = sent.filter((j) => j.queue === "query-rule-evaluate" && !j.done);
    if (!jobs.length) return;
    for (const j of jobs) {
      j.done = true;
      await evaluateJob({ data: j.data });
    }
  }
}

describeDb("M3 definition of done", () => {
  let app;
  const people = {};
  const tokens = {};
  const ids = {};

  const as = (who) => {
    const auth = (r) => r.set("Authorization", `Bearer ${tokens[who]}`);
    return {
      get: (path) => auth(request(app).get(`/api/v1${path}`)),
      post: (path, body = {}) => auth(request(app).post(`/api/v1${path}`)).send(body),
      put: (path, body = {}) => auth(request(app).put(`/api/v1${path}`)).send(body),
    };
  };

  /** A late clock-in, as attendance records it: the day, then the committed event. */
  async function lateArrival(date, minutes) {
    const who = people.staff.employee.employee_id;
    await q(
      `INSERT INTO attendance_day (employee_id, attendance_date, status, late_minutes, first_clock_in_at)
       VALUES ($1, $2, 'late', $3, $4)`,
      [who, date, minutes, lagos.instant(date, "09:20")],
    );
    await tx((client) =>
      emit(client, {
        key: "attendance.punched",
        entity: { type: "attendance_event", id: require("node:crypto").randomUUID() },
        actor: null,
        payload: { employee_id: who, subject_employee_id: who, event_type: "clock_in", result: "accepted", work_date: date },
      }),
    );
    await settle();
  }

  const queriesOf = async () =>
    (await as("ops").get(`/queries?employee_id=${people.staff.employee.employee_id}&sort=created_at`)).body.data;

  /** HR upholds a query with a rung: proposed by Operations & People, approved by another of them. */
  async function uphold(queryId, step, extra = {}) {
    const res = await as("ops").post(`/queries/${queryId}/decision`, {
      outcome: "sanction",
      consequence_step_id: step,
      reason: "The explanation does not account for the late arrivals.",
      ...extra,
    });
    expect(res.status).toBe(200);
    const approved = await as("ops2").post(`/workflow/instances/${res.body.workflow_instance_id}/approve`, {});
    expect(approved.status).toBe(200);
    // From the fourth rung up, Management approve too (queries.consequence).
    if (approved.body.state === "pending") {
      const second = await as("mgmt").post(`/workflow/instances/${res.body.workflow_instance_id}/approve`, {});
      expect(second.status).toBe(200);
    }
    await settle();
    return (await as("ops").get(`/queries/${queryId}`)).body;
  }

  /** The employee answers in ESS. */
  const respond = (queryId) =>
    as("staff").post(`/ess/queries/${queryId}/response`, { body_html: "<p>Traffic on the Third Mainland Bridge each of those mornings.</p>" });

  beforeAll(async () => {
    jest.spyOn(realtime, "toUser").mockReturnValue(true);
    await rebuild(pool, config.DB_NAME);
    outbox.markReady();
    ({ app } = buildApp({ strict: true, accessLog: false }));
    const sample = (first, last, email, job) => ({
      first_name: first,
      last_name: last,
      work_email: email,
      phone: "08031234567",
      job_title: job,
      department_name: "Operations",
      start_date: "2026-01-05",
      employment_type: "full_time",
      work_pattern: "on_site",
    });
    const make = (key, first, last, role, job) =>
      tx(async (client) => {
        people[key] = await createAdmin(
          client,
          { employee: sample(first, last, `${key}@mycity.test`, job), role_code: role, is_ceo: false },
          PASSWORD,
          { allowAdditional: true },
        );
      });
    await make("ops", "Tunde", "Bakare", "operations_people", "Operations Lead");
    await make("ops2", "Amaka", "Nwosu", "operations_people", "People Officer");
    await make("mgmt", "Ngozi", "Eze", "management", "General Manager");
    await make("staff", "Musa", "Danjuma", "employee", "Field Officer");
    await make("other", "Zainab", "Lawal", "employee", "Field Officer");
    let ip = 0;
    for (const key of Object.keys(people)) {
      ip += 1;
      const res = await request(app)
        .post("/api/v1/auth/login")
        .set("X-Forwarded-For", `10.64.0.${ip}`)
        .send({ email: `${key}@mycity.test`, password: PASSWORD });
      expect(res.status).toBe(200);
      tokens[key] = res.body.access_token;
    }

    // MyCity's ladder and its letters, entered on the screens (A26: nothing of it is seeded).
    const letters = (await as("ops").get("/letter-templates?sort=name")).body.data;
    for (const key of ["caution-letter", "warning-letter"]) {
      const id = letters.find((t) => t.key === key).letter_template_id;
      await as("ops").put(`/letter-templates/${id}/body`, {
        body: "Dear {{ employee.first_name }}, following query {{ query_number }} this is a {{ step_name }}: {{ reason }}",
      });
      await as("ops").post(`/letter-templates/${id}/activate`);
    }
    for (const [name, letter] of [
      ["Caution", "caution-letter"],
      ["Warning", "warning-letter"],
      ["Second Warning", "warning-letter"],
    ]) {
      const res = await as("ops").post("/sanctions/chain", { name, letter_template: letter, valid_days: 365 });
      ids[name] = res.body.consequence_step_id;
    }
  });

  afterAll(async () => {
    await chromium.close();
    await require("../../src/shared/observability/error-reporter").flush();
    await pool.end();
  });

  test("1. a rule is configured in two calls: three late arrivals in thirty days raises a query", async () => {
    const rule = await as("ops").post("/query-rules", {
      name: "Repeated Lateness",
      source_event: "lateness",
      threshold: 3,
      window_days: 30,
    });
    expect(rule.status).toBe(201);
    const on = await as("ops").post(`/query-rules/${rule.body.query_rule_id}/activate`);
    expect(on.body.state).toBe("active");
    ids.rule = rule.body.query_rule_id;
    // It counts from its activation; the story below happens over the week after it.
    await q("UPDATE query_rule SET activated_at = $2 WHERE query_rule_id = $1", [ids.rule, lagos.startOfDay(day(14))]);
  });

  test("2. three late arrivals raise exactly one query, not three", async () => {
    await lateArrival(day(12), 15);
    await lateArrival(day(11), 22);
    expect(await queriesOf()).toEqual([]);
    await lateArrival(day(10), 9);
    const raised = await queriesOf();
    expect(raised.map((r) => [r.number, r.rule_name, r.status])).toEqual([["QRY-0001", "Repeated Lateness", "awaiting_response"]]);
    ids.first = raised[0].employee_query_id;

    // The same event delivered twice more raises nothing new.
    sent.filter((j) => j.queue === "query-rule-evaluate").forEach((j) => (j.done = false));
    await settle();
    expect(await queriesOf()).toHaveLength(1);
  });

  test("3. the employee responds in ESS", async () => {
    const open = await as("staff").get("/ess/queries?status=open");
    expect(open.body.data.map((r) => r.number)).toEqual(["QRY-0001"]);
    const res = await respond(ids.first);
    expect(res.body.status).toBe("under_review");
  });

  test("4. HR upholds it, and a warning letter generates, files and sends", async () => {
    const after = await uphold(ids.first, ids.Warning);
    expect(after).toMatchObject({ status: "resolved", outcome: "sanctioned" });
    expect(after.sanction).toMatchObject({ number: "SAN-0001", step_name: "Warning", status: "issued" });

    const sanction = (await as("ops").get(`/sanctions/${after.sanction.sanction_id}`)).body;
    const html = (await q("SELECT render_html FROM document WHERE document_id = $1", [sanction.letter_document_id])).rows[0];
    expect(html.render_html).toContain("this is a Warning");
    // Generates: the worker renders the PDF, numbered and locked.
    const doc = await documents.renderPending(sanction.letter_document_id, { db: pool });
    expect([doc.number, Boolean(doc.locked_at)]).toEqual(["LTR-0002", true]);
    // Files: it is Musa's document; he can open it, a colleague cannot.
    const mine = await as("staff").get(`/documents/${doc.document_id}/content`);
    expect([mine.status, mine.headers["content-type"]]).toEqual([200, "application/pdf"]);
    expect((await as("other").get(`/documents/${doc.document_id}/content`)).status).toBe(404);
    // Sends: emailed to him with the PDF attached.
    await settle();
    expect(sent.find((j) => j.name === "sanction-issued").data).toMatchObject({
      to: { email: "staff@mycity.test" },
      attachments: [{ document_id: doc.document_id }],
    });
  });

  test("5. a second offence escalates to the second warning without code", async () => {
    await lateArrival(day(8), 31);
    await lateArrival(day(7), 12);
    await lateArrival(day(6), 18);
    const second = (await queriesOf()).find((r) => r.number === "QRY-0002");
    expect(second).toBeTruthy();
    await respond(second.employee_query_id);
    const card = await as("ops").get(`/queries/${second.employee_query_id}`);
    expect(card.body.next_step.name).toBe("Second Warning");
    const after = await uphold(second.employee_query_id, card.body.next_step.consequence_step_id);
    expect(after.sanction).toMatchObject({ step_name: "Second Warning", status: "issued" });
  });

  test("6. a new step is inserted into the chain from the UI, and the next case walks it", async () => {
    const final = await as("ops").post("/sanctions/chain", {
      name: "Final Warning",
      position: 4,
      letter_template: "warning-letter",
      valid_days: 365,
    });
    expect(final.status).toBe(201);
    const chain = (await as("ops").get("/sanctions/chain?sort=position")).body.data.map((r) => r.name);
    expect(chain).toEqual(["Caution", "Warning", "Second Warning", "Final Warning"]);

    await lateArrival(day(4), 14);
    await lateArrival(day(3), 26);
    await lateArrival(day(2), 11);
    const third = (await queriesOf()).find((r) => r.number === "QRY-0003");
    await respond(third.employee_query_id);
    const card = await as("ops").get(`/queries/${third.employee_query_id}`);
    expect(card.body.next_step.name).toBe("Final Warning");
    ids.third = third.employee_query_id;
    ids.final = card.body.next_step.consequence_step_id;
  });

  test("7. an approved financial consequence waits for the payroll run as a pending deduction", async () => {
    const after = await uphold(ids.third, ids.final, { fine_amount: "25000.00" });
    expect(after.sanction).toMatchObject({ step_name: "Final Warning", status: "issued" });
    const pending = await fines.pending({ employee_id: people.staff.employee.employee_id });
    expect(pending.data.map((f) => [f.sanction_number, f.amount_ngn, f.settlement_status])).toEqual([
      [after.sanction.number, "25000.00", "pending"],
    ]);
    const mine = await as("staff").get("/ess/sanctions");
    expect(mine.body.data.map((r) => [r.step_name, r.fine && r.fine.amount_ngn])).toEqual([
      ["Final Warning", "25000.00"],
      ["Second Warning", null],
      ["Warning", null],
    ]);
  });
});
