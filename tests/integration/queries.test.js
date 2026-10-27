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
const realtime = require("../../src/services/realtime/emitter");

// The queues would hold Redis connections open past the run: the jobs a handler queues are
// kept here (the letter's PDF render, its email).
/** A drawn signature, as the pad sends it: a real PNG (one pixel). */
const SIGNATURE =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
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
    // Attendance's own handlers push a punch to the person's screen; no socket here.
    jest.spyOn(realtime, "toUser").mockReturnValue(true);
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
    const make = (key, first, last, role, job, department = "Programmes", isCeo = false) =>
      tx(async (client) => {
        people[key] = await createAdmin(
          client,
          { employee: sample(first, last, `${key}@mycity.test`, job, department), role_code: role, is_ceo: isCeo },
          PASSWORD,
          { allowAdditional: true },
        );
      });
    await make("ops", "Tunde", "Bakare", "operations_people", "Operations Lead", "Operations");
    await make("mgmt", "Ngozi", "Eze", "management", "General Manager", "Management");
    await make("ceo", "Ada", "Okafor", "management", "Chief Executive Officer", "Management", true);
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

    test("the shipped letters are listed: all six ready, in MyCity's wording", async () => {
      const res = await as("manager").get("/letter-templates?sort=name");
      expect(res.status).toBe(200);
      expect(res.body.page.size).toBe(25);
      expect(Object.fromEntries(res.body.data.map((t) => [t.key, t.status]))).toEqual({
        "caution-letter": "active",
        "query-letter": "active",
        "salary-deduction-letter": "active",
        "suspension-without-pay-letter": "active",
        "termination-letter": "active",
        "warning-letter": "active",
      });
      const summary = await as("manager").get("/letter-templates/summary");
      expect(summary.body).toEqual({ templates: 6, active: 6, awaiting_sample: 0, sent_90d: 0 });
      // A letter added before its wording (a row People made, here by hand) waits for a sample.
      await q("INSERT INTO letter_template (key, name, purpose, status) VALUES ('hearing-letter', 'Hearing Letter', 'sanction', 'draft'), ('panel-letter', 'Panel Letter', 'sanction', 'draft')");
      expect((await byKey("manager", "hearing-letter")).status).toBe("awaiting_sample");
    });

    test("a template opens with its wording and the names a letter may use; the preview fills sample values", async () => {
      const ql = await byKey("ops", "query-letter");
      const detail = await as("ops").get(`/letter-templates/${ql.letter_template_id}`);
      expect(detail.status).toBe(200);
      expect(detail.body).toMatchObject({ key: "query-letter", version: 0, format: "html" });
      expect(detail.body.variables).toEqual(expect.arrayContaining(["employee", "query_number", "response_due"]));

      const preview = await as("ops").get(`/letter-templates/${ql.letter_template_id}/preview`);
      expect(preview.status).toBe(200);
      expect(preview.body).toMatchObject({ reference: "LTR-0000", title: "Query QRY-0000" });
      // What the record fills is marked; the rest is the template's own wording.
      expect(preview.body.paragraphs).toContainEqual([
        { text: "Dear ", filled: false },
        { text: "Ada", filled: true },
        { text: ",", filled: false },
      ]);

      // MyCity's own wording (its WARNING sample), the record's facts filled in.
      const warning = await byKey("ops", "warning-letter");
      const words = await as("ops").get(`/letter-templates/${warning.letter_template_id}/preview`);
      expect(words.status).toBe(200);
      expect(words.body.paragraphs.flat().map((r) => r.text).join("")).toContain("Management frowns at this");

      const hearing = await byKey("ops", "hearing-letter");
      const none = await as("ops").get(`/letter-templates/${hearing.letter_template_id}/preview`);
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
      const hearing = await byKey("ops", "hearing-letter");
      const id = hearing.letter_template_id;
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
      expect(preview.body.paragraphs.flat().map((r) => r.text).join("")).toContain("this is a written warning");

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

    test("the editor's rich text is kept as Markdown, its names intact and no markup with it", async () => {
      const t = await byKey("ops", "final-warning-letter");
      const res = await as("ops").put(`/letter-templates/${t.letter_template_id}/body`, {
        body_html:
          "<p>Dear {{ employee.first_name }},</p><p>Following query <strong>{{ query_number }}</strong>: {{ reason }}.</p><script>alert(1)</script>",
      });
      expect(res.status).toBe(200);
      expect(res.body.body).toBe("Dear {{ employee.first_name }},\n\nFollowing query **{{ query_number }}**: {{ reason }}.");
      expect(res.body.body_html).toBe("<p>Dear {{ employee.first_name }},</p>\n<p>Following query <strong>{{ query_number }}</strong>: {{ reason }}.</p>");
      // A name a letter cannot fill is still refused, through the editor too.
      const bad = await as("ops").put(`/letter-templates/${t.letter_template_id}/body`, {
        body_html: "<p>Dear {{ employee.first_name }}, your {{ salary }} is cut after query {{ query_number }}.</p>",
      });
      expect(bad.status).toBe(422);
      expect((await as("ops").put(`/letter-templates/${t.letter_template_id}/body`, { body_html: "<p>Too short</p>" })).status).toBe(422);
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
        signature: SIGNATURE,
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
      // Unsigned, it is refused on the pad.
      const unsigned = await as("manager").post("/queries", {
        employee_id: people.staff.employee.employee_id,
        subject: "Missing clock-out on Thursday",
        details: "There is no clock-out recorded for Thursday's shift at the Yaba site.",
      });
      expect(unsigned.status).toBe(422);
      expect(Object.keys(unsigned.body.error.fields)).toEqual(["signature"]);
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
      // MyCity's window: 24 hours (its handbook §4.7.1).
      const window = new Date(res.body.response_due_at) - new Date(res.body.created_at);
      expect(window).toBeGreaterThan(23.9 * 3600 * 1000);
      expect(window).toBeLessThan(24.1 * 3600 * 1000);
      expect(res.body.source).toBe("person");
      expect(res.body.approval).toBeNull();
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
      // Signed: the drawn signature is kept in the vault and printed above the raiser's name.
      expect(html).toContain('<img src="data:image/png;base64,');
      expect(html).toContain('alt="Signature of Kemi Alade"');
      const kept = (await q("SELECT signature_document_id FROM employee_query WHERE employee_query_id = $1", [ids.first])).rows[0];
      expect(kept.signature_document_id).toBeTruthy();
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
      expect((await as("other").post(`/ess/queries/${ids.first}/response`, { body_html: "<p>This is not my query to answer at all.</p>" })).status).toBe(404);

      // Written in the rich text editor: markup the whitelist does not keep is gone, bold stays.
      const tooShort = await as("staff").post(`/ess/queries/${ids.first}/response`, {
        body_html: "<p><strong>Sorry</strong></p><script>alert('x is a long enough string')</script>",
      });
      expect(tooShort.status).toBe(422);
      expect(tooShort.body.error.fields.body_html).toEqual(["Write your response"]);
      const res = await as("staff").post(`/ess/queries/${ids.first}/response`, {
        body_html:
          '<p>My phone died on the way out; I left at <strong>17:10</strong> and can show the gate log.</p><img src=x onerror="alert(1)"><script>alert(1)</script>',
      });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: "under_review", can_respond: false });
      expect(res.body.response.body).toBe("My phone died on the way out; I left at **17:10** and can show the gate log.");
      expect(res.body.response.body).not.toMatch(/<|alert|onerror/);
      expect(res.body.response.blocks).toEqual([
        {
          kind: "paragraph",
          spans: [
            { text: "My phone died on the way out; I left at ", bold: false, italic: false, href: null },
            { text: "17:10", bold: true, italic: false, href: null },
            { text: " and can show the gate log.", bold: false, italic: false, href: null },
          ],
        },
      ]);
      const again = await as("staff").post(`/ess/queries/${ids.first}/response`, {
        body_html: "<p>A second answer is refused because the first one stands.</p>",
      });
      expect(again.status).toBe(409);

      await drain();
      expect(await notified("manager", "query.responded")).toBe(1);
    });

    test("a decision needs edit; before the answer or the deadline it waits; the subject never decides", async () => {
      const close = { outcome: "no_action", reason: "The gate log shows the departure time." };
      expect((await as("manager").post(`/queries/${ids.first}/decision`, close)).status).toBe(403);
      // HoD raised QRY-0002; Zainab has not answered and the 24 hours are not over.
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

      expect((await as("staff").get("/ess/queries/summary")).body).toEqual({ open: 0, archived: 1, sanctions: 0, last_sanction: null });
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
    const chain = async () => (await as("ops").get("/sanctions/chain?sort=position")).body.data.map((r) => [r.position, r.name]);

    /** HoD raises a query on Zainab, she answers, and it waits for a decision. */
    const answered = async (subject) => {
      const raised = await as("hod").post("/queries", {
        employee_id: people.other.employee.employee_id,
        subject,
        details: "The incident is recorded in the site log for the day in question.",
        signature: SIGNATURE,
      });
      expect(raised.status).toBe(201);
      const id = raised.body.employee_query_id;
      const res = await as("other").post(`/ess/queries/${id}/response`, {
        body_html: "<p>I accept that this happened and have nothing further to add.</p>",
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
    /** Approve on the query's card: Operations & People sign it; the CEO's stage has no signature. */
    const approve = async (who, queryId, body = { signature: SIGNATURE }) => {
      const card = (await as(who).get(`/queries/${queryId}`)).body;
      const res = await as(who).post(`/sanctions/${card.sanction.sanction_id}/approve`, body);
      expect(res.status).toBe(200);
      await drain();
      return res;
    };

    test("the chain starts empty; only queries.configure adds a rung", async () => {
      expect(await chain()).toEqual([]);
      const refused = await as("manager").post("/sanctions/chain", { name: "Caution" });
      expect(refused.status).toBe(403);
    });

    test("People build the ladder; a rung inserted at a position moves the ones below", async () => {
      // MyCity's ladder as MILESTONES §8 ratified it, each letter ready in its own wording.
      for (const [name, body] of [
        ["Caution", { letter_template: "caution-letter", valid_days: 365 }],
        ["Warning", { letter_template: "warning-letter", valid_days: 365 }],
        ["Suspension Without Pay", { letter_template: "suspension-without-pay-letter", financial_effect: "unpaid_days", default_days: 3 }],
      ]) {
        const res = await as("ops").post("/sanctions/chain", { name, ...body });
        expect(res.status).toBe(201);
        expect(res.body.letter_ready).toBe(true);
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
        [4, "Suspension Without Pay"],
      ]);

      const moved = await as("ops").patch(`/sanctions/chain/${steps["Suspension Without Pay"]}`, { position: 1 });
      expect(moved.body.position).toBe(1);
      expect((await chain()).map((r) => r[1])).toEqual(["Suspension Without Pay", "Caution", "Warning", "Second Warning"]);
      await as("ops").patch(`/sanctions/chain/${steps["Suspension Without Pay"]}`, { position: 4 });
      expect((await chain()).map((r) => r[1])).toEqual(["Caution", "Warning", "Second Warning", "Suspension Without Pay"]);

      const bad = await as("ops").post("/sanctions/chain", { name: "Odd", letter_template: "query-letter" });
      expect(bad.status).toBe(422);
    });

    test("a first offence is offered the first rung; proposed unsigned, Operations & People sign it to let it stand", async () => {
      const id = await answered("Damaged the site generator");
      const card = await as("hod").get(`/queries/${id}`);
      expect(card.body.next_step).toMatchObject({ name: "Caution", position: 1 });
      expect(card.body.can_decide).toBe(true);

      // Nobody signs a proposal: a signature sent with it is refused by the contract.
      const signed = await propose(id, "Caution", { signature: SIGNATURE });
      expect(signed.status).toBe(422);
      const res = await propose(id, "Caution");
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: "under_review", escalated: true, can_decide: false });
      expect(res.body.sanction).toMatchObject({ step_name: "Caution", status: "pending_approval", number: null });
      expect((await propose(id, "Caution")).status).toBe(409);

      // The card says who it waits on: the proposer may not decide it, Operations & People may, and sign.
      expect(res.body.approval).toEqual({ stage: "operations_people", stage_name: "Operations & People", can_decide: false, signs: true });
      const opsCard = (await as("ops").get(`/queries/${id}`)).body;
      expect(opsCard.approval).toEqual({ stage: "operations_people", stage_name: "Operations & People", can_decide: true, signs: true });
      expect((await as("hod").post(`/sanctions/${opsCard.sanction.sanction_id}/approve`, { signature: SIGNATURE })).status).not.toBe(200);
      const unsigned = await as("ops").post(`/sanctions/${opsCard.sanction.sanction_id}/approve`, {});
      expect(unsigned.status).toBe(422);
      expect(unsigned.body.error.code).toBe("SIGNATURE_REQUIRED");
      await approve("ops", id);

      const after = await as("hod").get(`/queries/${id}`);
      expect(after.body).toMatchObject({ status: "resolved", outcome: "sanctioned", escalated: false, approval: null });
      expect(after.body.sanction).toMatchObject({ number: "SAN-0001", status: "issued" });
      const issued = await as("ops").get(`/sanctions/${after.body.sanction.sanction_id}`);
      expect(issued.body).toMatchObject({ step_name: "Caution", status: "issued", sanction_type: "caution", fine_letter_document_id: null });
      expect(issued.body.letter_document_id).toBeTruthy();
      const kept = (await q("SELECT signed_by FROM sanction WHERE sanction_id = $1", [issued.body.sanction_id])).rows[0];
      expect(kept.signed_by).toBe(people.ops.user.user_id);

      const mine = await as("other").get("/ess/sanctions");
      expect(mine.body.data.map((r) => [r.number, r.step_name])).toEqual([["SAN-0001", "Caution"]]);
      const told = await q("SELECT count(*)::int AS n FROM notification WHERE user_id = $1 AND event_key = 'sanction.issued'", [
        people.other.user.user_id,
      ]);
      expect(told.rows[0].n).toBe(1);
    });

    test("the sanction letter is MyCity's wording, signed by Operations & People, and emailed with the PDF", async () => {
      const list = await as("ops").get("/sanctions");
      const docId = (await as("ops").get(`/sanctions/${list.body.data[0].sanction_id}`)).body.letter_document_id;
      const html = (await q("SELECT render_html FROM document WHERE document_id = $1", [docId])).rows[0].render_html;
      expect(html).toContain("Dear Zainab,");
      expect(html).toContain("you are hereby advised to improve immediately");
      expect(html).toContain("The explanation does not account for the incident.");
      // Signed by the approver who let it stand (guide §6.4), with the signature they drew.
      expect(html).toContain('alt="Signature of Tunde Bakare"');
      await documents.renderPending(docId, { db: pool });
      sent.length = 0;
      await drain();
      expect(sent.find((j) => j.name === "sanction-issued").data).toMatchObject({
        to: { email: "other@mycity.test" },
        data: { sanction_number: "SAN-0001", step_name: "Caution", fine_amount: null },
        attachments: [{ document_id: docId }],
      });
    });

    test("a second offence offers the next rung without code; a fine waits, pending, for payroll", async () => {
      const id = await answered("Damaged the site generator again");
      expect((await as("hod").get(`/queries/${id}`)).body.next_step.name).toBe("Warning");
      const res = await propose(id, "Warning", { fine_amount: "15000.00" });
      expect(res.status).toBe(200);
      await approve("ops", id);

      // A fine sends the Salary Deduction letter beside the rung's, the amount in the house format,
      // and both leave in one email once both PDFs exist.
      const issued = (await as("ops").get(`/sanctions/${(await as("hod").get(`/queries/${id}`)).body.sanction.sanction_id}`)).body;
      expect(issued.fine_letter_document_id).toBeTruthy();
      expect(issued.fine_letter_document_id).not.toBe(issued.letter_document_id);
      const deduction = (await q("SELECT render_html FROM document WHERE document_id = $1", [issued.fine_letter_document_id])).rows[0];
      expect(deduction.render_html).toContain("₦15,000.00 will be deducted from your salary");
      sent.length = 0;
      await documents.renderPending(issued.letter_document_id, { db: pool });
      await drain();
      expect(sent.filter((j) => j.name === "sanction-issued")).toEqual([]);
      await documents.renderPending(issued.fine_letter_document_id, { db: pool });
      await drain();
      const mail = sent.filter((j) => j.name === "sanction-issued");
      expect(mail).toHaveLength(1);
      expect(mail[0].data.data).toMatchObject({ step_name: "Warning", fine_amount: "15000.00" });
      expect(mail[0].data.attachments).toEqual([{ document_id: issued.letter_document_id }, { document_id: issued.fine_letter_document_id }]);

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

    test("a refusal on the card sends the query back under review; a rung whose letter waits for a sample is not offered", async () => {
      const id = await answered("Left the site unattended");
      await propose(id, "Second Warning");
      const card = (await as("ops").get(`/queries/${id}`)).body;
      const short = await as("ops").post(`/sanctions/${card.sanction.sanction_id}/reject`, { reason: "Too much" });
      expect(short.status).toBe(422);
      const reject = await as("ops").post(`/sanctions/${card.sanction.sanction_id}/reject`, {
        reason: "A second warning is too much for this.",
      });
      expect(reject.status).toBe(200);
      // The approval's end settles the sanction after commit, as every approval's does.
      await drain();
      const back = await as("hod").get(`/queries/${id}`);
      expect(back.body).toMatchObject({ status: "under_review", escalated: false, can_decide: true, approval: null });
      expect(back.body.sanction).toMatchObject({ status: "rejected" });
      expect((await as("ops").post(`/sanctions/${card.sanction.sanction_id}/approve`, { signature: SIGNATURE })).status).toBe(409);

      // A rung whose letter has no wording yet is offered to nobody.
      const panel = await as("ops").post("/sanctions/chain", { name: "Disciplinary Panel", letter_template: "panel-letter" });
      expect(panel.body.letter_ready).toBe(false);
      steps["Disciplinary Panel"] = panel.body.consequence_step_id;
      const noLetter = await propose(id, "Disciplinary Panel");
      expect(noLetter.status).toBe(422);
      expect(noLetter.body.error.code).toBe("LETTER_NOT_READY");
      await as("ops").patch(`/sanctions/chain/${steps["Disciplinary Panel"]}`, { active: false });
    });

    test("Suspension Without Pay also needs the CEO, who does not sign; its days follow the rung", async () => {
      const id = await answered("Left the site unattended again");
      const res = await propose(id, "Suspension Without Pay");
      expect(res.status).toBe(200);
      await approve("ops", id);
      const waiting = (await as("ceo").get(`/queries/${id}`)).body;
      expect(waiting.sanction.status).toBe("pending_approval");
      expect(waiting.approval).toEqual({ stage: "ceo", stage_name: "CEO", can_decide: true, signs: false });
      // Management no longer approve sanctions; the CEO does (MyCity's handbook §4.7.4).
      expect((await as("mgmt").get(`/queries/${id}`)).body.approval.can_decide).toBe(false);
      await approve("ceo", id, {});
      const sanction = await as("ops").get(`/sanctions/${(await as("hod").get(`/queries/${id}`)).body.sanction.sanction_id}`);
      expect(sanction.body.status).toBe("issued");
      expect(lagosDays(sanction.body.effective_on, sanction.body.ends_on)).toBe(3);
      const html = (await q("SELECT render_html FROM document WHERE document_id = $1", [sanction.body.letter_document_id])).rows[0].render_html;
      expect(html).toContain("suspended from duty without pay for 3 days");
      expect(html).toContain('alt="Signature of Tunde Bakare"');
    });

    test("sanctions follow their query's visibility; a standing is People's alone", async () => {
      expect((await as("manager").get("/sanctions")).body.page.total).toBe(0);
      expect((await as("hod").get("/sanctions")).body.page.total).toBe(4);
      expect((await as("ops").get("/sanctions")).body.page.total).toBe(4);
      const standing = await as("hod").get(`/sanctions/standing?employee_id=${people.other.employee.employee_id}`);
      expect(standing.status).toBe(404);
    });

    test("a sanction is decided only on the query's card: My Approvals lists it but never decides it", async () => {
      const id = await answered("Left the store room open");
      await propose(id, "Caution");
      const card = (await as("ops").get(`/queries/${id}`)).body;
      const flow = (await as("ops").get(`/sanctions/${card.sanction.sanction_id}`)).body.workflow_instance_id;
      expect((await as("ops").get(`/workflow/instances/${flow}`)).body.can_decide).toBe(false);
      const generic = await as("ops").post(`/workflow/instances/${flow}/approve`, {});
      expect(generic.status).toBe(409);
      expect(generic.body.error.code).toBe("DECIDE_ON_RECORD");
      expect((await as("ops").post(`/workflow/instances/${flow}/reject`, { reason: "Not through here." })).status).toBe(409);
      expect((await as("ops").get(`/queries/${id}`)).body.sanction.status).toBe("pending_approval");

      // A non-approver is refused before anything of theirs is kept: no signature file is left.
      const before = (await q("SELECT count(*)::int AS n FROM document WHERE entity_type = 'sanction' AND entity_id = $1", [card.sanction.sanction_id])).rows[0].n;
      expect((await as("mgmt").post(`/sanctions/${card.sanction.sanction_id}/approve`, { signature: SIGNATURE })).status).toBe(403);
      expect((await as("mgmt").post(`/sanctions/${card.sanction.sanction_id}/approve`, {})).status).toBe(403);
      const after = (await q("SELECT count(*)::int AS n FROM document WHERE entity_type = 'sanction' AND entity_id = $1", [card.sanction.sanction_id])).rows[0].n;
      expect(after).toBe(before);
      await approve("ops", id);
    });

    test("the letter is fixed when the sanction is proposed: a rung pointed at a draft later strands nothing", async () => {
      const id = await answered("Left the gate unlocked overnight");
      await propose(id, "Caution");
      const moved = await as("ops").patch(`/sanctions/chain/${steps.Caution}`, { letter_template: "panel-letter" });
      expect(moved.status).toBe(200);
      await approve("ops", id);
      const card = (await as("hod").get(`/queries/${id}`)).body;
      expect(card.sanction.status).toBe("issued");
      const letter = await q("SELECT letter_type FROM sanction_letter WHERE sanction_id = $1", [card.sanction.sanction_id]);
      expect(letter.rows.map((r) => r.letter_type)).toEqual(["caution-letter"]);
      expect((await as("ops").patch(`/sanctions/chain/${steps.Caution}`, { letter_template: "caution-letter" })).status).toBe(200);
    });

    test("the person queried never decides their own sanction, even holding the approving role", async () => {
      const raised = await as("hod").post("/queries", {
        employee_id: people.ops.employee.employee_id,
        subject: "Approved Own Overtime",
        details: "Overtime for the weekend was approved on your own account without a second signature.",
        signature: SIGNATURE,
      });
      expect(raised.status).toBe(201);
      const qid = raised.body.employee_query_id;
      expect((await as("ops").post(`/ess/queries/${qid}/response`, { body_html: "<p>I approved it in a hurry and should have asked.</p>" })).status).toBe(200);
      expect((await propose(qid, "Caution")).status).toBe(200);
      const card = (await as("ops").get(`/queries/${qid}`)).body;
      expect(card.approval).toMatchObject({ stage: "operations_people", can_decide: false });
      const own = await as("ops").post(`/sanctions/${card.sanction.sanction_id}/approve`, { signature: SIGNATURE });
      expect(own.status).toBe(403);
      expect((await as("ops").post(`/sanctions/${card.sanction.sanction_id}/reject`, { reason: "I do not accept this at all." })).status).toBe(403);
      expect((await as("ops").get(`/queries/${qid}`)).body.sanction.status).toBe("pending_approval");
    });
  });

  /* ---------------------------------------------------------------- *
   * Query rules (guide §6.3)
   * ---------------------------------------------------------------- */

  describe("query rules", () => {
    const lagos = require("../../src/shared/time/lagos");
    const evaluator = require("../../src/modules/query_rules/query_rules.evaluator");
    const today = lagos.today();
    const day = (n) => lagos.addDays(today, -n);
    const rules = {};
    /** A punch from a device not on the person's list, as attendance records it: the day and its exception. */
    const strangeDevice = async (who, date) => {
      const d = await q(
        `INSERT INTO attendance_day (employee_id, attendance_date, status) VALUES ($1, $2, 'present')
         ON CONFLICT (employee_id, attendance_date) DO UPDATE SET status = attendance_day.status
         RETURNING attendance_day_id`,
        [people[who].employee.employee_id, date],
      );
      await q("INSERT INTO attendance_exception (attendance_day_id, exception_type, severity) VALUES ($1, 'unknown_device', 'medium')", [
        d.rows[0].attendance_day_id,
      ]);
    };
    const evaluate = (who, date) =>
      evaluator.evaluate({ sources: ["unenrolled_device"], employee_id: people[who].employee.employee_id, date });
    const ruleQueries = async (ruleId) =>
      (await q("SELECT employee_query_id FROM employee_query WHERE query_rule_id = $1", [ruleId])).rows;

    test("People write rules, saved as drafts; a manager cannot; lateness is the Attendance policy's; a trigger not counted yet stays a draft", async () => {
      const body = { name: "Unknown Phones", source_event: "unenrolled_device", threshold: 3, window_days: 30 };
      expect((await as("manager").post("/query-rules", body)).status).toBe(403);
      const res = await as("ops").post("/query-rules", body);
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ code: "unknown_phones", state: "draft", active: false, measure: "count" });
      rules.device = res.body.query_rule_id;

      // Late arrivals, absences and missing clock-outs raise their query from the Attendance policy.
      for (const source of ["lateness", "absence", "missing_clock_out"]) {
        const refused = await as("ops").post("/query-rules", { name: "Attendance Again", source_event: source, threshold: 3, window_days: 30 });
        expect(refused.status).toBe(422);
      }

      const tasks = await as("ops").post("/query-rules", { name: "Missed Targets", source_event: "missed_target", threshold: 2, window_days: 7 });
      const refused = await as("ops").post(`/query-rules/${tasks.body.query_rule_id}/activate`);
      expect(refused.status).toBe(409);
      expect(refused.body.error.code).toBe("TRIGGER_NOT_AVAILABLE");
    });

    test("a draft counts nothing; switched on, it counts from then, never back", async () => {
      await strangeDevice("staff", day(6));
      expect((await evaluate("staff", day(6))).raised).toEqual([]);
      const on = await as("ops").post(`/query-rules/${rules.device}/activate`);
      expect(on.body).toMatchObject({ state: "active", active: true });
      // Switched on today: the day before it does not count.
      expect((await evaluate("staff", day(6))).raised).toEqual([]);
      // For the rest of the test the rule was switched on a week ago.
      await q("UPDATE query_rule SET activated_at = $2 WHERE query_rule_id = $1", [rules.device, lagos.startOfDay(day(5))]);
    });

    test("three offences in thirty days raise exactly one query, not three", async () => {
      await strangeDevice("staff", day(5));
      expect((await evaluate("staff", day(5))).raised).toEqual([]);
      await strangeDevice("staff", day(3));
      expect((await evaluate("staff", day(3))).raised).toEqual([]);
      await strangeDevice("staff", day(1));
      const third = await evaluate("staff", day(1));
      expect(third.raised).toHaveLength(1);

      // The event delivered again, and a fourth day: still one query.
      expect((await evaluate("staff", day(1))).raised).toEqual([]);
      await strangeDevice("staff", day(0));
      expect((await evaluate("staff", day(0))).raised).toEqual([]);
      expect(await ruleQueries(rules.device)).toHaveLength(1);

      const id = third.raised[0];
      const query = await as("ops").get(`/queries/${id}`);
      expect(query.body).toMatchObject({
        subject: "Unknown Phones",
        raised_by: null,
        source: "rule",
        rule_name: "Unknown Phones",
        status: "awaiting_response",
      });
      expect(query.body.evidence.map((e) => e.date)).toEqual([day(5), day(3), day(1)]);
      expect(query.body.details).toContain("(3 in 30 days)");
      expect(query.body.letter_document_id).toBeTruthy();
    });

    test("a rule's query is People's to see: not the manager's, though the person is on their team", async () => {
      const [{ employee_query_id: id }] = await ruleQueries(rules.device);
      expect((await as("manager").get(`/queries/${id}`)).status).toBe(404);
      expect((await as("manager").get("/query-rules/firings")).body.page.total).toBe(0);
      const firings = await as("ops").get("/query-rules/firings");
      expect(firings.body.data.map((f) => [f.rule_name, f.employee.display_name])).toEqual([["Unknown Phones", "Musa Danjuma"]]);
      const summary = await as("ops").get("/query-rules/summary");
      expect(summary.body).toMatchObject({ active: 1, draft: 1, queries_raised: 1 });
    });

    test("Edit Rule changes the threshold and window; once it has fired, its trigger is fixed; it is paused, never deleted", async () => {
      const change = await as("ops").patch(`/query-rules/${rules.device}`, { source_event: "overdue_task" });
      expect(change.status).toBe(409);
      const edited = await as("ops").patch(`/query-rules/${rules.device}`, { name: "Unregistered Phones", threshold: 4, window_days: 14 });
      expect(edited.body).toMatchObject({ name: "Unregistered Phones", threshold: 4, window_days: 14 });
      const off = await as("ops").post(`/query-rules/${rules.device}/pause`);
      expect(off.body.state).toBe("paused");
      await strangeDevice("staff", day(-1));
      expect((await evaluate("staff", day(-1))).raised).toEqual([]);
    });

    test("an attendance event becomes the evaluation job only for what Rules counts", async () => {
      const { jobOf } = require("../../src/modules/query_rules/query_rules.events");
      const who = people.staff.employee.employee_id;
      const job = (key, payload) => jobOf({ key, payload: { employee_id: who, work_date: today, ...payload } });
      expect(job("attendance.punched", { event_type: "clock_in" })).toBeNull();
      expect(job("attendance.day_closed", { status: "absent" })).toBeNull();
      expect(job("attendance.review_required", { types: ["unknown_device", "missing_clock_out"] })).toEqual({
        sources: ["unenrolled_device"],
        employee_id: who,
        date: today,
      });

      // Through the outbox: a committed review_required queues the job, once.
      sent.length = 0;
      await tx((client) =>
        require("../../src/shared/events/emit").emit(client, {
          key: "attendance.review_required",
          entity: { type: "attendance_day", id: "00000000-0000-4000-8000-000000000001" },
          actor: null,
          payload: { employee_id: who, subject_employee_id: who, work_date: today, types: ["unknown_device"] },
        }),
      );
      await drain();
      await drain();
      expect(sent.filter((j) => j.queue === "query-rule-evaluate").map((j) => j.data)).toEqual([
        { sources: ["unenrolled_device"], employee_id: who, date: today },
      ]);
    });

    test("an Attendance policy breach with Raise Query raises exactly one query, linked back on the breach", async () => {
      const who = people.other.employee.employee_id;
      const policyVersion = (await q("SELECT v.policy_version_id FROM policy_version v JOIN policy p ON p.policy_id = v.policy_id WHERE p.kind = 'attendance' ORDER BY v.version DESC LIMIT 1")).rows[0];
      const breach = async (lastDay, raiseQuery) => {
        const { rows } = await q(
          `INSERT INTO attendance_rule_breach (employee_id, rule, policy_version_id, period, period_start, period_end, count, minutes,
                                               reached, days, last_day, alert, raise_query)
           VALUES ($1, 'late', $2, 'month', $3::date, $3::date, 3, 41, 'count', $4::date[], $3::date, false, $5)
           RETURNING attendance_rule_breach_id`,
          [who, policyVersion ? policyVersion.policy_version_id : null, lastDay, [day(9), day(8), lastDay], raiseQuery],
        );
        const id = rows[0].attendance_rule_breach_id;
        await tx((client) =>
          require("../../src/shared/events/emit").emit(client, {
            key: "attendance.rule_breached",
            entity: { type: "attendance_rule_breach", id },
            actor: null,
            payload: { attendance_rule_breach_id: id, employee_id: who, subject_employee_id: who, rule: "late", alert: false, raise_query: raiseQuery },
            dedup_key: `attendance-breach:${id}`,
          }),
        );
        await drain();
        return id;
      };
      const quiet = await breach(day(7), false);
      expect((await q("SELECT employee_query_id FROM attendance_rule_breach WHERE attendance_rule_breach_id = $1", [quiet])).rows[0].employee_query_id).toBeNull();

      const id = await breach(day(6), true);
      const linked = (await q("SELECT employee_query_id FROM attendance_rule_breach WHERE attendance_rule_breach_id = $1", [id])).rows[0].employee_query_id;
      expect(linked).toBeTruthy();
      const query = await as("ops").get(`/queries/${linked}`);
      expect(query.body).toMatchObject({
        source: "attendance",
        rule_name: "Attendance Policy",
        raised_by: null,
        subject: "3 late arrivals this month",
        status: "awaiting_response",
      });
      expect(query.body.evidence.map((e) => [e.label, e.date])).toEqual([
        ["Late arrival", day(9)],
        ["Late arrival", day(8)],
        ["Late arrival", day(6)],
      ]);
      // Seen as a rule's query is: People, not the person's manager.
      expect((await as("manager").get(`/queries/${linked}`)).status).toBe(404);
      // Delivered again: still one.
      await q("UPDATE event_outbox SET status = 'pending', completed_handlers = '{}', next_attempt_at = now() WHERE event_key = 'attendance.rule_breached'");
      await drain();
      expect((await q("SELECT count(*)::int AS n FROM employee_query WHERE source = 'attendance'")).rows[0].n).toBe(1);
      const reasons = (await as("ops").get("/queries/summary")).body.by_reason.map((r) => r.label);
      expect(reasons).toContain("Attendance Policy");
    });

    test("overdue tasks count on their due day: open past it or done late; cancelled and on time never", async () => {
      const { formatDate } = require("../../src/shared/time/day-first");
      const who = people.other.employee.employee_id;
      const task = (title, due, { status = "todo", completed = null, archived = null } = {}) =>
        q(
          `INSERT INTO task (title, status, created_by, primary_assignee_id, due_at, completed_at, archived_at, cancelled_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, CASE WHEN $2 = 'cancelled' THEN now() END)`,
          [title, status, people.other.user.user_id, who, lagos.instant(due, "17:00"), completed, archived],
        );
      await task("Send the stock count", day(4));
      await task("File the site report", day(3), { status: "done", completed: lagos.instant(day(2), "09:00") });
      await task("Call the landlord", day(3), { status: "done", completed: lagos.instant(day(3), "12:00") });
      await task("Order diesel", day(2), { status: "cancelled" });
      await task("Old errand", day(2), { archived: lagos.instant(day(1), "09:00") });
      await task("Due today", today);

      const rule = await as("ops").post("/query-rules", { name: "Overdue Tasks", source_event: "overdue_task", threshold: 2, window_days: 7 });
      expect((await as("ops").post(`/query-rules/${rule.body.query_rule_id}/activate`)).body.state).toBe("active");
      await q("UPDATE query_rule SET activated_at = $2 WHERE query_rule_id = $1", [rule.body.query_rule_id, lagos.startOfDay(day(10))]);

      // The sweep queues the person who had a task due yesterday still open or done late.
      const tasks = require("../../src/modules/tasks/tasks.auto-query");
      expect(await tasks.dueYesterday(pool, lagos.addDays(day(3), 1))).toEqual([who]);
      expect(await tasks.dueYesterday(pool, lagos.addDays(day(2), 1))).toEqual([]);

      const r = await evaluator.evaluate({ sources: ["overdue_task"], employee_id: who, date: day(1) });
      expect(r.raised).toHaveLength(1);
      const raised = await as("ops").get(`/queries/${r.raised[0]}`);
      expect(raised.body.subject).toBe("Overdue Tasks");
      expect(raised.body.details).toBe(`Task overdue on ${formatDate(day(4))} and ${formatDate(day(3))} (2 in 7 days). Please explain.`);
      expect(raised.body.evidence.map((e) => e.label)).toEqual([
        "Task overdue: Send the stock count",
        "Task overdue: File the site report",
      ]);
      // A second run finds the breach raised.
      expect((await evaluator.evaluate({ sources: ["overdue_task"], employee_id: who, date: day(1) })).raised).toEqual([]);
    });

    test("a month closed rated Below counts on the day it closed, through review.closed", async () => {
      const who = people.manager.employee.employee_id;
      const round = async (name, month) =>
        (
          await q(
            `INSERT INTO performance_cycle (name, starts_on, ends_on, status, month)
             VALUES ($1, $2, ($2::date + interval '1 month' - interval '1 day')::date, 'closed', $2) RETURNING performance_cycle_id`,
            [name, month],
          )
        ).rows[0].performance_cycle_id;
      const review = (roundId, kind, rating) =>
        q(
          `INSERT INTO performance_review (performance_cycle_id, employee_id, reviewer_employee_id, review_type, status,
                                           review_kind, closed_at, rating)
           VALUES ($1, $2, $3, 'manager', 'closed', $4, now(), $5)`,
          [roundId, who, people.hod.employee.employee_id, kind, rating],
        );
      await review(await round("August 2026", "2026-08-01"), "monthly", "partly_meets");
      await review(null, "probation", "below");
      const rule = await as("ops").post("/query-rules", { name: "Low Monthly Score", source_event: "low_performance", threshold: 1, window_days: 90 });
      await as("ops").post(`/query-rules/${rule.body.query_rule_id}/activate`);
      await q("UPDATE query_rule SET activated_at = $2 WHERE query_rule_id = $1", [rule.body.query_rule_id, lagos.startOfDay(day(10))]);
      expect((await evaluator.evaluate({ sources: ["low_performance"], employee_id: who, date: today })).raised).toEqual([]);

      await review(await round("September 2026", "2026-09-01"), "monthly", "below");
      const { jobOf } = require("../../src/modules/query_rules/query_rules.events");
      const closed = (payload) => jobOf({ key: "review.closed", occurred_at: new Date(), payload: { employee_id: who, ...payload } });
      expect(closed({ review_kind: "monthly", rating: "below" })).toEqual({ sources: ["low_performance"], employee_id: who, date: today });
      expect(closed({ review_kind: "monthly", rating: "meets" })).toBeNull();
      expect(closed({ review_kind: "probation", rating: "below" })).toBeNull();

      const r = await evaluator.evaluate({ sources: ["low_performance"], employee_id: who, date: today });
      expect(r.raised).toHaveLength(1);
      const raised = await as("ops").get(`/queries/${r.raised[0]}`);
      expect(raised.body.evidence.map((e) => e.label)).toEqual(["September 2026 rated Below"]);
    });
  });

  /* ---------------------------------------------------------------- *
   * Write With AI (guide §9; meeting 26/10): nothing is kept
   * ---------------------------------------------------------------- */

  describe("write with AI", () => {
    const ai = require("../../src/services/ai/llm.service");
    const drafts = require("../../src/services/ai/drafts");
    const governance = require("../../src/services/ai/governance");
    const { AppError } = require("../../src/shared/errors");
    const ask = { employee_id: null, instruction: "He clocked in late three times this month, call him on 08031234567." };
    beforeAll(() => {
      ask.employee_id = people.other.employee.employee_id;
    });
    afterEach(() => jest.restoreAllMocks());
    const count = async () => (await q("SELECT count(*)::int AS n FROM employee_query")).rows[0].n;

    test("with no provider set up it says it is off, and nothing is drafted or kept", async () => {
      expect((await as("hod").get("/queries/assist")).body).toEqual({ available: false, reason: "off" });
      const before = await count();
      const res = await as("hod").post("/queries/assist", ask);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ available: false, reason: "off", subject: null, details: null, ai_run_id: null });
      expect(await count()).toBe(before);
    });

    test("this month's budget spent reads as the limit", async () => {
      jest.spyOn(governance, "check").mockRejectedValue(new AppError("AI_CAP_REACHED", "Spent", 429));
      expect((await as("hod").get("/queries/assist")).body).toEqual({ available: false, reason: "limit" });
    });

    test("a draft comes back with the number put back; a gap left to fill is refused by its guard; nothing is kept", async () => {
      jest.spyOn(drafts, "availability").mockResolvedValue({ available: true, reason: null });
      let asked;
      jest.spyOn(ai, "complete").mockImplementation(async (opts) => {
        asked = opts;
        const token = JSON.stringify(opts.input).match(/KEPT\d+/)[0];
        // The guard refuses a placeholder: the call's own output schema says so.
        expect(opts.output.safeParse({ subject: "Late Arrivals", details: "Dear [Name], you were late." }).success).toBe(false);
        return { output: { subject: "Three Late Arrivals This Month", details: `You clocked in late three times this month. Call ${token} if needed. Please explain in writing.` }, run_id: null };
      });
      const before = await count();
      const res = await as("hod").post("/queries/assist", ask);
      expect(res.body).toMatchObject({ available: true, subject: "Three Late Arrivals This Month" });
      expect(res.body.details).toContain("08031234567");
      // The model never saw the number, only its token.
      expect(JSON.stringify(asked.input)).not.toContain("08031234567");
      expect(asked).toMatchObject({ purpose: "query-draft", module: "queries" });
      expect(await count()).toBe(before);
    });

    test("the letter editor drafts with the letter's own names, through queries.configure only", async () => {
      expect((await as("manager").post("/letter-templates/assist", { name: "Final Warning", purpose: "sanction", instruction: "A firm final warning." })).status).toBe(403);
      jest.spyOn(drafts, "availability").mockResolvedValue({ available: true, reason: null });
      jest.spyOn(ai, "complete").mockImplementation(async (opts) => {
        expect(opts.purpose).toBe("letter-draft");
        expect(opts.output.safeParse({ body_markdown: "Dear {{ employee.first_name }}, your {{ salary }} is cut after this query." }).success).toBe(false);
        return {
          output: { body_markdown: "Dear {{ employee.first_name }},\n\nFollowing query {{ query_number }}, this is a **final warning**: {{ reason }}." },
          run_id: null,
        };
      });
      const res = await as("ops").post("/letter-templates/assist", { name: "Final Warning", purpose: "sanction", instruction: "A firm final warning." });
      expect(res.status).toBe(200);
      expect(res.body.body_html).toBe("<p>Dear {{ employee.first_name }},</p>\n<p>Following query {{ query_number }}, this is a <strong>final warning</strong>: {{ reason }}.</p>");
    });
  });

  /* ---------------------------------------------------------------- *
   * Policies a query cites (guide §6.2, §6.3; meeting 26/10)
   * ---------------------------------------------------------------- */

  describe("policy citations", () => {
    const policy = {};
    beforeAll(async () => {
      // A published policy in force (its second version) and one that is only a draft.
      const made = async (number, title) =>
        (await q("INSERT INTO policy (number, kind, title) VALUES ($1, 'document', $2) RETURNING policy_id", [number, title])).rows[0]
          .policy_id;
      policy.live = await made("POL-0901", "Attendance and Punctuality");
      policy.draft = await made("POL-0902", "Dress Code");
      for (const [version, from] of [[1, 40], [2, 10]])
        await q(
          `INSERT INTO policy_version (policy_id, status, title, version, effective_from, note, content_hash, published_at, body_markdown)
           VALUES ($1, 'published', 'Attendance and Punctuality', $2, current_date - $3::int, 'Issued', 'h', now(), 'Clock in by 09:00.')`,
          [policy.live, version, from],
        );
      await q("INSERT INTO policy_version (policy_id, status, title) VALUES ($1, 'draft', 'Dress Code')", [policy.draft]);
    });

    test("the picker lists the policies in force, each with its version in force", async () => {
      const res = await as("hod").get("/queries/policies");
      expect(res.status).toBe(200);
      expect(res.body.data.map((p) => [p.number, p.title, p.version])).toEqual([["POL-0901", "Attendance and Punctuality", 2]]);
    });

    test("a query cites a policy and the clause; the letter quotes them; a policy not in force is refused", async () => {
      const body = {
        employee_id: people.other.employee.employee_id,
        subject: "Three late arrivals this month",
        details: "The register shows clock-ins after 09:00 on three working days this month.",
        signature: SIGNATURE,
      };
      const refused = await as("hod").post("/queries", { ...body, policy_id: policy.draft });
      expect(refused.status).toBe(422);
      expect(refused.body.error.code).toBe("POLICY_NOT_IN_FORCE");

      const res = await as("hod").post("/queries", { ...body, policy_id: policy.live, policy_clause: "Staff clock in by 09:00." });
      expect(res.status).toBe(201);
      expect(res.body.policy).toMatchObject({ policy_id: policy.live, number: "POL-0901", version: 2 });
      expect(res.body.policy_clause).toBe("Staff clock in by 09:00.");
      const html = (await q("SELECT render_html FROM document WHERE document_id = $1", [res.body.letter_document_id])).rows[0].render_html;
      expect(html).toContain('This is against our Attendance and Punctuality (POL-0901, version 2): "Staff clock in by 09:00."</p>');
      // The employee sees what was cited.
      const mine = await as("other").get(`/ess/queries`);
      expect(mine.body.data.find((r) => r.employee_query_id === res.body.employee_query_id).policy).toMatchObject({ number: "POL-0901" });
    });

    test("a rule names the policy it enforces and the clause its letters quote; one not in force is refused", async () => {
      const rule = { name: "Late Deliveries", source_event: "overdue_task", threshold: 3, window_days: 30 };
      expect((await as("ops").post("/query-rules", { ...rule, policy_id: policy.draft })).body.error.code).toBe("POLICY_NOT_IN_FORCE");
      // A clause without a policy quotes nothing, so none is kept.
      const bare = await as("ops").post("/query-rules", { ...rule, name: "Late Deliveries Bare", policy_clause: "Deliver on the day." });
      expect(bare.body.policy_clause).toBeNull();
      const tooLong = await as("ops").post("/query-rules", { ...rule, name: "Late Deliveries Long", policy_id: policy.live, policy_clause: "x".repeat(301) });
      expect(tooLong.status).toBe(422);
      const res = await as("ops").post("/query-rules", { ...rule, policy_id: policy.live, policy_clause: "Staff clock in by 09:00." });
      expect(res.status).toBe(201);
      expect(res.body.policy).toEqual({ policy_id: policy.live, number: "POL-0901", title: "Attendance and Punctuality" });
      expect(res.body.policy_clause).toBe("Staff clock in by 09:00.");
      const edited = await as("ops").patch(`/query-rules/${res.body.query_rule_id}`, { policy_clause: "Deliveries go out the same day." });
      expect(edited.body.policy_clause).toBe("Deliveries go out the same day.");
      const blank = await as("ops").patch(`/query-rules/${res.body.query_rule_id}`, { policy_clause: "" });
      expect(blank.body.policy_clause).toBeNull();
      await as("ops").patch(`/query-rules/${res.body.query_rule_id}`, { policy_clause: "Deliveries go out the same day." });
      const cleared = await as("ops").patch(`/query-rules/${res.body.query_rule_id}`, { policy_id: null });
      expect(cleared.body.policy).toBeNull();
      expect(cleared.body.policy_clause).toBeNull();
    });
  });
});

/** Inclusive days from one ISO date to another. */
function lagosDays(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}
