"use strict";
/**
 * Who Partnerships tells (docs/guides/partnerships.md §7, Appendix A PR 8): the real migrations on a
 * throwaway database, the app through HTTP, the outbox drained as the worker would. A deal moved by
 * someone else tells its owner (never the mover, never an import); Stalled tells the owner's Head of
 * Department with its blockers; a lead signed tells its owner and Operations & People; each notice
 * sits in the Partnerships category and opens where its record does.
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/partnerships-notices
 *
 * Every organisation and person is invented.
 */
const request = require("supertest");
const { config } = require("../../src/config/env");
const { pool } = require("../../src/config/db");
const { atomically } = require("../../src/shared/db/tx");
const { rebuild } = require("./helpers/schema");
const { createAdmin } = require("../../scripts/db/create-admin");

jest.mock("../../src/jobs/queues", () => ({
  enqueue: jest.fn(async () => ({ id: "1" })),
  getQueue: jest.fn(() => ({ getDelayed: async () => [] })),
  closeQueues: jest.fn(async () => undefined),
  DEFAULTS: {},
}));

const { buildApp } = require("../../src/app");
const outbox = require("../../src/shared/events/outbox");
const views = require("../../src/shared/notifications/views");

const describeDb = String(config.DB_NAME || "").endsWith("_test") ? describe : describe.skip;
const q = (sql, params) => pool.query(sql, params);
const PASSWORD = "Partnership-Notices4Told";
const PDF = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n");

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

async function drain() {
  for (let i = 0; i < 12; i += 1) {
    await q("UPDATE event_outbox SET next_attempt_at = now() WHERE status = 'pending'");
    const r = await outbox.dispatchDue({ db: pool });
    if (r.claimed === 0) return;
  }
}

describeDb("partnerships: who is told (§7)", () => {
  let app;
  const people = {};
  const tokens = {};
  let ip = 0;
  let category;
  const as = (who) => {
    const auth = (r) => {
      ip += 1;
      return r.set("Authorization", `Bearer ${tokens[who]}`).set("X-Forwarded-For", `10.81.${Math.floor(ip / 250)}.${(ip % 250) + 1}`);
    };
    return {
      post: (path, body = {}) => auth(request(app).post(`/api/v1${path}`)).send(body),
      upload: (name) => auth(request(app).post("/api/v1/documents")).attach("file", PDF, { filename: name, contentType: "application/pdf" }),
    };
  };
  const emp = (who) => people[who].employee.employee_id;
  const user = (who) => people[who].user.user_id;
  const ok = (res, status = 200) => {
    expect([res.status, res.body.error]).toEqual([status, undefined]);
    return res.body;
  };
  const told = async (key) => (await q("SELECT user_id, title, body, category, priority, entity_type, entity_id FROM notification WHERE event_key = $1 ORDER BY created_at, user_id", [key])).rows;
  const newLead = async (name) =>
    ok(
      await as("staff").post("/partnerships/leads", {
        name,
        partner_category_id: category,
        region: { scope: "national" },
        owner_id: emp("staff"),
        contact: { first_name: "Uche", last_name: "Nwosu", email: `${name.toLowerCase().replace(/\W+/g, ".")}@example.test` },
        deal: { title: `${name} Partnership`, owner_id: emp("staff") },
      }),
      201,
    );

  beforeAll(async () => {
    await rebuild(pool, config.DB_NAME);
    outbox.markReady();
    ({ app } = buildApp({ strict: true, accessLog: false }));
    const sample = (first, last, email, job, department) => ({
      first_name: first, last_name: last, work_email: email, phone: "08031234567", job_title: job, department_name: department,
      start_date: "2026-01-05", employment_type: "full_time", work_pattern: "on_site",
    });
    const make = (key, first, last, role, job, department = "Growth") =>
      tx(async (client) => {
        people[key] = await createAdmin(client, { employee: sample(first, last, `${key}@mycity.test`, job, department), role_code: role }, PASSWORD, { allowAdditional: true });
      });
    await make("ops", "Tunde", "Bakare", "operations_people", "Operations Lead", "Operations");
    await make("hod", "Kemi", "Alade", "head_of_department", "Head of Growth");
    await make("staff", "Musa", "Danjuma", "employee", "Growth Officer");
    await q("UPDATE department SET head_employee_id = $1 WHERE name = 'Growth'", [emp("hod")]);
    await q("UPDATE employee SET line_manager_id = $1 WHERE employee_id = $2", [emp("hod"), emp("staff")]);
    await require("../../src/shared/rbac/grants-cache").bumpTeamVersion();
    for (const [i, [code, label, meaning]] of [
      ["prospect_identified", "Prospect Identified", "prospect"],
      ["initial_contact", "Initial Contact", "contacted"],
      ["partnership_signed", "Partnership Signed", "signed"],
      ["closed_lost", "Closed Lost", "closed_lost"],
    ].entries()) {
      await q(
        `INSERT INTO reference_value (domain, code, label, display_order, metadata) VALUES ('partnership_stage', $1, $2, $3, $4::jsonb)
         ON CONFLICT (domain, code) DO UPDATE SET label = EXCLUDED.label, display_order = EXCLUDED.display_order, metadata = EXCLUDED.metadata, active = true`,
        [code, label, (i + 1) * 10, JSON.stringify({ meaning })],
      );
    }
    await q("UPDATE reference_value SET active = false WHERE domain = 'partnership_stage' AND metadata = '{}'::jsonb");
    await drain();
    for (const key of Object.keys(people)) {
      ip += 1;
      const res = await request(app).post("/api/v1/auth/login").set("X-Forwarded-For", `10.82.0.${ip}`).send({ email: `${key}@mycity.test`, password: PASSWORD });
      expect(res.status).toBe(200);
      tokens[key] = res.body.access_token;
    }
    category = ok(await as("ops").post("/partnerships/categories", { name: "Event" }), 201).partner_category_id;
  }, 180_000);

  afterAll(async () => {
    await require("../../src/shared/observability/error-reporter").flush();
    await pool.end();
  });

  test("a deal moved by someone else tells its owner; their own move tells nobody", async () => {
    const lead = await newLead("Ojota Night Market");
    ok(await as("staff").post(`/partnerships/deals/${lead.deal.deal_id}/stage`, { stage: "initial_contact" }));
    await drain();
    expect(await told("deal.stage_changed")).toEqual([]);
    ok(await as("hod").post(`/partnerships/deals/${lead.deal.deal_id}/stage`, { stage: "prospect_identified", reason: "Their contact left, so we start again" }));
    await drain();
    expect(await told("deal.stage_changed")).toEqual([
      { user_id: user("staff"), title: "Deal Moved", body: expect.stringContaining("moved to Prospect Identified"), category: "partnerships", priority: "normal", entity_type: "partner_deal", entity_id: lead.deal.deal_id },
    ]);
  });

  test("Stalled tells the owner's Head of Department with its blockers", async () => {
    const lead = await newLead("Agege Food Week");
    ok(await as("staff").post(`/partnerships/deals/${lead.deal.deal_id}/health`, { health: "stalled", blockers: "Waiting on the venue's insurance papers" }));
    await drain();
    expect(await told("deal.health_changed")).toEqual([
      { user_id: user("hod"), title: "Deal Stalled", body: expect.stringContaining("Waiting on the venue's insurance papers"), category: "partnerships", priority: "high", entity_type: "partner_deal", entity_id: lead.deal.deal_id },
    ]);
  });

  test("a lead signed tells its owner and Operations & People, under its status on Leads", async () => {
    const lead = await newLead("Ikorodu Arts Fair");
    const copy = ok(await as("hod").upload("signed.pdf"), 201);
    ok(await as("hod").post(`/partnerships/leads/${lead.lead.lead_id}/convert`, { signed_copy_document_id: copy.document_id }));
    await drain();
    const rows = await told("lead.converted");
    expect(rows.map((r) => r.user_id).sort()).toEqual([user("ops"), user("staff")].sort());
    expect(rows[0]).toMatchObject({ title: "Lead Signed", body: expect.stringContaining("Ikorodu Arts Fair"), entity_type: "lead", entity_id: lead.lead.lead_id });
    const placed = await views.placeAll(pool, { module: "partnerships", tab: "leads", type: "lead", ids: [lead.lead.lead_id] });
    expect([...placed.values()]).toEqual(["converted"]);
  });
});
