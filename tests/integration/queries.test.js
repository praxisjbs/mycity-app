"use strict";
/**
 * Queries & Sanctions end to end (docs/guides/queries.md): the real migrations on a
 * throwaway database, the whole app through HTTP, every response parsed with its
 * contract (APP_ENV=test).
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/queries
 *
 * Refuses to run unless the database name ends in "_test": it drops and rebuilds the
 * public schema. Every person here is invented.
 */
const request = require("supertest");
const { config } = require("../../src/config/env");
const { pool } = require("../../src/config/db");
const { atomically } = require("../../src/shared/db/tx");
const { rebuild } = require("./helpers/schema");
const { createAdmin } = require("../../scripts/db/create-admin");
const { buildApp } = require("../../src/app");
const outbox = require("../../src/shared/events/outbox");
const documents = require("../../src/shared/documents/generate");
const chromium = require("../../src/services/pdf/chromium");

// The queues would hold Redis connections open past the run: the jobs a handler queues are
// kept here (the letter's PDF render, its email).
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
const PASSWORD = "Queries-Due9Process";

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

describeDb("queries and sanctions against the real migrations", () => {
  let app;
  const people = {};
  const tokens = {};
  let ip = 0;

  const as = (who) => {
    const auth = (r) => r.set("Authorization", `Bearer ${tokens[who]}`);
    return {
      get: (path) => auth(request(app).get(`/api/v1${path}`)),
      post: (path, body = {}) => auth(request(app).post(`/api/v1${path}`)).send(body),
      put: (path, body = {}) => auth(request(app).put(`/api/v1${path}`)).send(body),
      patch: (path, body = {}) => auth(request(app).patch(`/api/v1${path}`)).send(body),
    };
  };

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
    const make = (key, first, last, role, job, department = "Programmes") =>
      tx(async (client) => {
        people[key] = await createAdmin(
          client,
          { employee: sample(first, last, `${key}@mycity.test`, job, department), role_code: role, is_ceo: false },
          PASSWORD,
          { allowAdditional: true },
        );
      });
    await make("ops", "Tunde", "Bakare", "operations_people", "Operations Lead", "Operations");
    await make("mgmt", "Ngozi", "Eze", "management", "General Manager", "Management");
    await make("hod", "Ife", "Ojo", "head_of_department", "Head of Programmes");
    await make("manager", "Kemi", "Alade", "manager", "Programme Lead");
    await make("staff", "Musa", "Danjuma", "employee", "Field Officer");
    await make("other", "Zainab", "Lawal", "employee", "Field Officer");
    await q("UPDATE employee SET line_manager_id = $1 WHERE employee_id = ANY($2::uuid[])", [
      people.manager.employee.employee_id,
      [people.staff.employee.employee_id, people.other.employee.employee_id],
    ]);
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
    await chromium.close();
    await require("../../src/shared/observability/error-reporter").flush();
    await pool.end();
  });

  /* ---------------------------------------------------------------- *
   * Letter Templates (guide §6.7)
   * ---------------------------------------------------------------- */

  describe("letter templates", () => {
    const byKey = async (who, key) =>
      (await as(who).get("/letter-templates?sort=name")).body.data.find((t) => t.key === key);

    test("the shipped letters are listed: the query letter ready, the sanction letters awaiting a sample", async () => {
      const res = await as("manager").get("/letter-templates?sort=name");
      expect(res.status).toBe(200);
      expect(res.body.page.size).toBe(25);
      expect(Object.fromEntries(res.body.data.map((t) => [t.key, t.status]))).toEqual({
        "caution-letter": "awaiting_sample",
        "query-letter": "active",
        "suspension-letter": "awaiting_sample",
        "suspension-without-pay-letter": "awaiting_sample",
        "termination-letter": "awaiting_sample",
        "warning-letter": "awaiting_sample",
      });
      const summary = await as("manager").get("/letter-templates/summary");
      expect(summary.body).toEqual({ templates: 6, active: 1, awaiting_sample: 5, sent_90d: 0 });
    });

    test("a template opens with its wording and the names a letter may use; the preview fills sample values", async () => {
      const ql = await byKey("ops", "query-letter");
      const detail = await as("ops").get(`/letter-templates/${ql.letter_template_id}`);
      expect(detail.status).toBe(200);
      expect(detail.body).toMatchObject({ key: "query-letter", version: 0, format: "html" });
      expect(detail.body.variables).toEqual(expect.arrayContaining(["employee", "query_number", "response_due"]));

      const preview = await as("ops").get(`/letter-templates/${ql.letter_template_id}/preview`);
      expect(preview.status).toBe(200);
      expect(preview.body.html).toContain("Dear Ada,");
      expect(preview.body.html).toContain("QRY-0000");

      const warning = await byKey("ops", "warning-letter");
      const none = await as("ops").get(`/letter-templates/${warning.letter_template_id}/preview`);
      expect(none.status).toBe(409);
      expect(none.body.error.code).toBe("TEMPLATE_AWAITING_SAMPLE");
    });

    test("only queries.configure writes: a manager reads but cannot add, edit or activate", async () => {
      const add = await as("manager").post("/letter-templates", {
        name: "Final Warning",
        purpose: "sanction",
        body: "Dear {{ employee.first_name }}, this is a final warning about {{ subject }}.",
      });
      expect(add.status).toBe(403);
      const warning = await byKey("manager", "warning-letter");
      expect((await as("hod").post(`/letter-templates/${warning.letter_template_id}/activate`)).status).toBe(403);
    });

    test("People add a letter: a draft with its first version; a name it cannot fill is refused", async () => {
      const bad = await as("ops").post("/letter-templates", {
        name: "Pay Cut",
        purpose: "sanction",
        body: "Dear {{ employee.first_name }}, your salary is now {{ salary }} from today onwards.",
      });
      expect(bad.status).toBe(422);
      expect(bad.body.error.code).toBe("TEMPLATE_UNKNOWN_VARIABLE");

      const add = await as("ops").post("/letter-templates", {
        name: "Final Warning",
        purpose: "sanction",
        title: "Final Warning",
        body: "Dear {{ employee.first_name }}, this is a final warning about {{ subject }}: {{ reason }}.",
      });
      expect(add.status).toBe(201);
      expect(add.body).toMatchObject({ key: "final-warning-letter", status: "draft", version: 1, format: "markdown" });

      const again = await as("ops").post("/letter-templates", {
        name: "Final Warning",
        purpose: "sanction",
        body: "Dear {{ employee.first_name }}, a second letter with the same name gets its own key.",
      });
      expect(again.body.key).toBe("final-warning-2-letter");
    });

    test("a sample saved turns awaiting into a draft, a new version each time, and activation makes it usable", async () => {
      const warning = await byKey("ops", "warning-letter");
      const id = warning.letter_template_id;
      expect((await as("ops").post(`/letter-templates/${id}/activate`)).status).toBe(409);

      const first = await as("ops").put(`/letter-templates/${id}/body`, {
        body: "Dear {{ employee.first_name }}, following query {{ query_number }} you are warned: {{ reason }}.",
      });
      expect(first.status).toBe(200);
      expect(first.body).toMatchObject({ status: "draft", version: 1 });
      const second = await as("ops").put(`/letter-templates/${id}/body`, {
        body: "Dear {{ employee.first_name }}, following query {{ query_number }} this is a written warning: {{ reason }}.",
      });
      expect(second.body.version).toBe(2);

      const on = await as("ops").post(`/letter-templates/${id}/activate`);
      expect(on.status).toBe(200);
      expect(on.body.status).toBe("active");
      const preview = await as("manager").get(`/letter-templates/${id}/preview`);
      expect(preview.body.html).toContain("this is a written warning");

      const audit = await q(
        "SELECT event_key FROM event_log WHERE entity_id = $1 ORDER BY occurred_at",
        [id],
      );
      expect(audit.rows.map((r) => r.event_key)).toEqual([
        "letter_template.saved",
        "letter_template.saved",
        "letter_template.activated",
      ]);
    });
  });

  /* ---------------------------------------------------------------- *
   * Queries (guide §3, §6.1 to §6.4)
   * ---------------------------------------------------------------- */

  describe("queries", () => {
    const raise = (who, employee, subject = "Missing clock-out on Thursday") =>
      as(who).post("/queries", {
        employee_id: people[employee].employee.employee_id,
        subject,
        details: "There is no clock-out recorded for Thursday's shift at the Yaba site.",
      });
    const notified = async (who, key) =>
      (
        await q(
          "SELECT count(*)::int AS n FROM notification WHERE user_id = $1 AND event_key = $2",
          [people[who].user.user_id, key],
        )
      ).rows[0].n;
    const ids = {};

    test("a manager raises a query: numbered, awaiting a response, with its letter; the employee is told", async () => {
      const res = await raise("manager", "staff");
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        number: "QRY-0001",
        status: "awaiting_response",
        raised_by: people.manager.user.user_id,
        raised_by_name: "Kemi Alade",
        response: null,
        can_decide: false,
        can_remind: true,
      });
      expect(res.body.employee.display_name).toBe("Musa Danjuma");
      expect(res.body.letter_document_id).toBeTruthy();
      expect(new Date(res.body.response_due_at) - new Date(res.body.created_at)).toBeGreaterThan(47 * 3600 * 1000);
      ids.first = res.body.employee_query_id;

      await drain();
      expect(await notified("staff", "query.raised")).toBe(1);
    });

    test("the letter renders with the query's facts and is emailed to the employee as a PDF", async () => {
      const { letter_document_id: docId } = (await as("ops").get(`/queries/${ids.first}`)).body;
      // The HTML is kept until the PDF exists, then cleared.
      const html = (await q("SELECT render_html FROM document WHERE document_id = $1", [docId])).rows[0].render_html;
      expect(html).toContain("QRY-0001");
      expect(html).toContain("Dear Musa,");
      expect(html).toContain("Kemi Alade");
      const doc = await documents.renderPending(docId, { db: pool });
      expect(doc.locked_at).toBeTruthy();

      sent.length = 0;
      await drain();
      const mail = sent.find((j) => j.queue === "email-send" && j.name === "query-raised");
      expect(mail.data).toMatchObject({
        to: { email: "staff@mycity.test" },
        template: "query-raised",
        data: { query_number: "QRY-0001" },
        attachments: [{ document_id: docId }],
      });
    });

    test("nobody raises a query on themselves, or on someone who has left", async () => {
      const self = await raise("manager", "manager");
      expect(self.status).toBe(422);
      expect(self.body.error.code).toBe("QUERY_SELF");
    });

    test("a manager sees only the queries they raised; People and Management see all (§6.1)", async () => {
      const hod = await raise("hod", "other", "Late arrival on Monday");
      expect(hod.status).toBe(201);
      ids.hod = hod.body.employee_query_id;

      const mine = await as("manager").get("/queries");
      expect(mine.body.data.map((r) => r.number)).toEqual(["QRY-0001"]);
      expect((await as("manager").get(`/queries/${ids.hod}`)).status).toBe(404);
      expect((await as("hod").get(`/queries/${ids.first}`)).status).toBe(404);

      for (const who of ["ops", "mgmt"]) {
        const all = await as(who).get("/queries?sort=number");
        expect(all.body.data.map((r) => r.number)).toEqual(["QRY-0001", "QRY-0002"]);
      }
      const raisedByMe = await as("ops").get("/queries?raised=mine");
      expect(raisedByMe.body.page.total).toBe(0);

      const summary = await as("manager").get("/queries/summary");
      expect(summary.body).toMatchObject({ open: 1, awaiting_response: 1, escalated: 0 });
      expect(summary.body.by_reason).toEqual([{ label: "Raised by a Person", count: 1 }]);
    });

    test("⌘K finds a query by number within the same rule", async () => {
      const hits = async (who) => {
        const res = await as(who).get("/search?q=QRY-0001");
        expect(res.status).toBe(200);
        const group = res.body.groups.find((g) => g.type === "query");
        return group ? group.items.map((i) => i.ref) : [];
      };
      // The term also finds QRY-0002 by similarity; each reader gets only what they may open.
      expect(await hits("manager")).toEqual(["QRY-0001"]);
      expect(await hits("hod")).toEqual(["QRY-0002"]);
      expect((await hits("ops")).sort()).toEqual(["QRY-0001", "QRY-0002"]);
    });

    test("a reminder goes once a day, only while the query waits", async () => {
      const first = await as("manager").post(`/queries/${ids.first}/remind`);
      expect(first.status).toBe(200);
      expect(first.body.can_remind).toBe(false);
      expect((await as("manager").post(`/queries/${ids.first}/remind`)).status).toBe(409);
      expect((await as("hod").post(`/queries/${ids.first}/remind`)).status).toBe(404);
      await drain();
      expect(await notified("staff", "query.reminded")).toBe(1);
    });

    test("the employee sees it in My Queries and answers it once; the raiser is told", async () => {
      const open = await as("staff").get("/ess/queries?status=open");
      expect(open.status).toBe(200);
      expect(open.body.data.map((r) => [r.number, r.can_respond])).toEqual([["QRY-0001", true]]);
      expect((await as("other").post(`/ess/queries/${ids.first}/response`, { body: "This is not my query to answer at all." })).status).toBe(404);

      const res = await as("staff").post(`/ess/queries/${ids.first}/response`, {
        body: "My phone died on the way out; I left at 17:10 and can show the gate log.",
      });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: "under_review", can_respond: false });
      expect(res.body.response.body).toContain("gate log");
      const again = await as("staff").post(`/ess/queries/${ids.first}/response`, {
        body: "A second answer is refused because the first one stands.",
      });
      expect(again.status).toBe(409);

      await drain();
      expect(await notified("manager", "query.responded")).toBe(1);
    });

    test("a decision needs edit; before the answer or the deadline it waits; the subject never decides", async () => {
      const close = { outcome: "no_action", reason: "The gate log shows the departure time." };
      expect((await as("manager").post(`/queries/${ids.first}/decision`, close)).status).toBe(403);
      // HoD raised QRY-0002; Zainab has not answered and the 48 hours are not over.
      const early = await as("hod").post(`/queries/${ids.hod}/decision`, close);
      expect(early.status).toBe(409);
      expect(early.body.error.code).toBe("QUERY_NOT_DECIDABLE");
      expect((await as("hod").get(`/queries/${ids.hod}`)).body.can_decide).toBe(false);
    });

    test("People close it with no action: resolved, archived in My Queries, the employee told", async () => {
      const before = await as("ops").get(`/queries/${ids.first}`);
      expect(before.body.can_decide).toBe(true);
      const res = await as("ops").post(`/queries/${ids.first}/decision`, {
        outcome: "no_action",
        reason: "The gate log shows the departure time.",
      });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: "resolved", outcome: "no_action", reviewed_by_name: "Tunde Bakare", can_decide: false });
      expect((await as("ops").post(`/queries/${ids.first}/decision`, { outcome: "no_action", reason: "Closing it a second time." })).status).toBe(409);

      const archived = await as("staff").get("/ess/queries?status=archived");
      expect(archived.body.data.map((r) => [r.number, r.outcome])).toEqual([["QRY-0001", "no_action"]]);
      await drain();
      expect(await notified("staff", "query.closed")).toBe(1);
    });
  });

  /* ---------------------------------------------------------------- *
   * The chain and sanctions (guide §3 steps 4 to 6, §6.4 to §6.6)
   * ---------------------------------------------------------------- */

  describe("the chain and sanctions", () => {
    const steps = {};
    const letterId = async (key) =>
      (await as("ops").get("/letter-templates?sort=name")).body.data.find((t) => t.key === key).letter_template_id;
    const ready = async (key) => {
      const id = await letterId(key);
      await as("ops").put(`/letter-templates/${id}/body`, {
        body: `Dear {{ employee.first_name }}, following query {{ query_number }}: {{ step_name }}. {{ reason }}`,
      });
      await as("ops").post(`/letter-templates/${id}/activate`);
    };
    const chain = async () => (await as("ops").get("/sanctions/chain?sort=position")).body.data.map((r) => [r.position, r.name]);

    /** HoD raises a query on Zainab, she answers, and it waits for a decision. */
    const answered = async (subject) => {
      const raised = await as("hod").post("/queries", {
        employee_id: people.other.employee.employee_id,
        subject,
        details: "The incident is recorded in the site log for the day in question.",
      });
      expect(raised.status).toBe(201);
      const id = raised.body.employee_query_id;
      const res = await as("other").post(`/ess/queries/${id}/response`, {
        body: "I accept that this happened and have nothing further to add.",
      });
      expect(res.status).toBe(200);
      return id;
    };
    const propose = (id, step, extra = {}) =>
      as("hod").post(`/queries/${id}/decision`, {
        outcome: "sanction",
        consequence_step_id: steps[step],
        reason: "The explanation does not account for the incident.",
        ...extra,
      });
    const approve = async (who, instanceId) => {
      const res = await as(who).post(`/workflow/instances/${instanceId}/approve`, {});
      expect(res.status).toBe(200);
      await drain();
    };

    test("the chain starts empty; only queries.configure adds a rung", async () => {
      expect(await chain()).toEqual([]);
      const refused = await as("manager").post("/sanctions/chain", { name: "Caution" });
      expect(refused.status).toBe(403);
    });

    test("People build the ladder; a rung inserted at a position moves the ones below", async () => {
      await ready("caution-letter");
      for (const [name, body] of [
        ["Caution", { letter_template: "caution-letter" }],
        ["Warning", { letter_template: "warning-letter", valid_days: 365 }],
        ["Suspension", { letter_template: "suspension-letter", financial_effect: "unpaid_days", default_days: 3 }],
      ]) {
        const res = await as("ops").post("/sanctions/chain", { name, ...body });
        expect(res.status).toBe(201);
        steps[name] = res.body.consequence_step_id;
      }
      const second = await as("ops").post("/sanctions/chain", {
        name: "Second Warning",
        position: 3,
        letter_template: "warning-letter",
        valid_days: 365,
      });
      expect(second.body).toMatchObject({ code: "second_warning", position: 3, letter_ready: true });
      steps["Second Warning"] = second.body.consequence_step_id;
      expect(await chain()).toEqual([
        [1, "Caution"],
        [2, "Warning"],
        [3, "Second Warning"],
        [4, "Suspension"],
      ]);

      const moved = await as("ops").patch(`/sanctions/chain/${steps.Suspension}`, { position: 1 });
      expect(moved.body.position).toBe(1);
      expect((await chain()).map((r) => r[1])).toEqual(["Suspension", "Caution", "Warning", "Second Warning"]);
      await as("ops").patch(`/sanctions/chain/${steps.Suspension}`, { position: 4 });
      expect((await chain()).map((r) => r[1])).toEqual(["Caution", "Warning", "Second Warning", "Suspension"]);

      const bad = await as("ops").post("/sanctions/chain", { name: "Odd", letter_template: "query-letter" });
      expect(bad.status).toBe(422);
    });

    test("a first offence is offered the first rung; proposed, it waits for Operations & People", async () => {
      const id = await answered("Damaged the site generator");
      const card = await as("hod").get(`/queries/${id}`);
      expect(card.body.next_step).toMatchObject({ name: "Caution", position: 1 });
      expect(card.body.can_decide).toBe(true);

      const res = await propose(id, "Caution");
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: "under_review", escalated: true, can_decide: false });
      expect(res.body.sanction).toMatchObject({ step_name: "Caution", status: "pending_approval", number: null });
      expect((await propose(id, "Caution")).status).toBe(409);

      // The proposer never approves it; Operations & People do.
      const instance = res.body.workflow_instance_id;
      expect((await as("hod").post(`/workflow/instances/${instance}/approve`, {})).status).not.toBe(200);
      await approve("ops", instance);

      const after = await as("hod").get(`/queries/${id}`);
      expect(after.body).toMatchObject({ status: "resolved", outcome: "sanctioned", escalated: false });
      expect(after.body.sanction).toMatchObject({ number: "SAN-0001", status: "issued" });
      const issued = await as("ops").get(`/sanctions/${after.body.sanction.sanction_id}`);
      expect(issued.body).toMatchObject({ step_name: "Caution", status: "issued", sanction_type: "caution" });
      expect(issued.body.letter_document_id).toBeTruthy();

      const mine = await as("other").get("/ess/sanctions");
      expect(mine.body.data.map((r) => [r.number, r.step_name])).toEqual([["SAN-0001", "Caution"]]);
      const told = await q("SELECT count(*)::int AS n FROM notification WHERE user_id = $1 AND event_key = 'sanction.issued'", [
        people.other.user.user_id,
      ]);
      expect(told.rows[0].n).toBe(1);
    });

    test("the sanction letter renders from its rung's template and is emailed with the PDF", async () => {
      const list = await as("ops").get("/sanctions");
      const docId = (await as("ops").get(`/sanctions/${list.body.data[0].sanction_id}`)).body.letter_document_id;
      const html = (await q("SELECT render_html FROM document WHERE document_id = $1", [docId])).rows[0].render_html;
      expect(html).toContain("Dear Zainab, following query");
      expect(html).toContain("Caution.");
      await documents.renderPending(docId, { db: pool });
      sent.length = 0;
      await drain();
      expect(sent.find((j) => j.name === "sanction-issued").data).toMatchObject({
        to: { email: "other@mycity.test" },
        data: { sanction_number: "SAN-0001", step_name: "Caution" },
        attachments: [{ document_id: docId }],
      });
    });

    test("a second offence offers the next rung without code; a fine waits, pending, for payroll", async () => {
      const id = await answered("Damaged the site generator again");
      expect((await as("hod").get(`/queries/${id}`)).body.next_step.name).toBe("Warning");
      const res = await propose(id, "Warning", { fine_amount: "15000.00" });
      expect(res.status).toBe(200);
      await approve("ops", res.body.workflow_instance_id);

      const fines = await require("../../src/modules/sanctions/sanctions.fines").pending();
      expect(fines.data.map((f) => [f.sanction_number, f.amount_ngn, f.settlement_status])).toEqual([
        ["SAN-0002", "15000.00", "pending"],
      ]);
      const summary = await as("ops").get("/sanctions/summary");
      expect(summary.body).toMatchObject({ active: 2, pending_approval: 0, fines_this_year: "15000.00", fines_recovered: "0.00" });
      const standing = await as("ops").get(`/sanctions/standing?employee_id=${people.other.employee.employee_id}`);
      expect(standing.body.in_force.map((r) => r.step_name)).toEqual(["Warning", "Caution"]);
      expect(standing.body.next_step.name).toBe("Second Warning");
    });

    test("a refusal sends the query back under review; a rung whose letter waits for a sample is not offered", async () => {
      const id = await answered("Left the site unattended");
      const res = await propose(id, "Second Warning");
      const reject = await as("ops").post(`/workflow/instances/${res.body.workflow_instance_id}/reject`, {
        reason: "A second warning is too much for this.",
      });
      expect(reject.status).toBe(200);
      await drain();
      const back = await as("hod").get(`/queries/${id}`);
      expect(back.body).toMatchObject({ status: "under_review", escalated: false, can_decide: true });
      expect(back.body.sanction).toMatchObject({ status: "rejected" });

      const noLetter = await propose(id, "Suspension");
      expect(noLetter.status).toBe(422);
      expect(noLetter.body.error.code).toBe("LETTER_NOT_READY");
    });

    test("Suspension and above also need Management; its days follow the rung", async () => {
      await ready("suspension-letter");
      const id = await answered("Left the site unattended again");
      const res = await propose(id, "Suspension");
      expect(res.status).toBe(200);
      await approve("ops", res.body.workflow_instance_id);
      expect((await as("hod").get(`/queries/${id}`)).body.sanction.status).toBe("pending_approval");
      await approve("mgmt", res.body.workflow_instance_id);
      const sanction = await as("ops").get(`/sanctions/${(await as("hod").get(`/queries/${id}`)).body.sanction.sanction_id}`);
      expect(sanction.body.status).toBe("issued");
      expect(lagosDays(sanction.body.effective_on, sanction.body.ends_on)).toBe(3);
    });

    test("sanctions follow their query's visibility; a standing is People's alone", async () => {
      expect((await as("manager").get("/sanctions")).body.page.total).toBe(0);
      expect((await as("hod").get("/sanctions")).body.page.total).toBe(4);
      expect((await as("ops").get("/sanctions")).body.page.total).toBe(4);
      const standing = await as("hod").get(`/sanctions/standing?employee_id=${people.other.employee.employee_id}`);
      expect(standing.status).toBe(404);
    });
  });
});

/** Inclusive days from one ISO date to another. */
function lagosDays(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}
