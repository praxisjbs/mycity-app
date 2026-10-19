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
});
