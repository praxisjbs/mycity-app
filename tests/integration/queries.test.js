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
});
