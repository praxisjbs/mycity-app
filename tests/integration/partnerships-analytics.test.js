"use strict";
/**
 * Partnerships · Analytics end to end (docs/guides/partnerships.md §6.18, Appendix A PR 8): the real
 * migrations on a throwaway database, the app through HTTP, every response parsed with its contract
 * (APP_ENV=test). A fixed set of leads, meetings, a proposal, signings and returns, dated into one
 * custom period and around it; the eight measures per lead owner counted against it; scope; returns
 * only with `partnerships.money`; the rating only where Performance shows it; the assistant's two
 * summaries; the analytics export reserved.
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/partnerships-analytics
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
const c = require("@mycity/contract");

const describeDb = String(config.DB_NAME || "").endsWith("_test") ? describe : describe.skip;
const q = (sql, params) => pool.query(sql, params);
const PASSWORD = "Analytics-Monthly8Sheet";
const PERIOD = "period=custom&from=2026-03-01&to=2026-05-31";

const STAGES = [
  ["prospect_identified", "Prospect Identified", "prospect"],
  ["initial_contact", "Initial Contact", "contacted"],
  ["proposal_sent", "Proposal Sent", "proposal"],
  ["partnership_signed", "Partnership Signed", "signed"],
  ["active_partnership", "Active Partnership", "active"],
  ["closed_lost", "Closed Lost", "closed_lost"],
  ["on_hold", "On Hold", "on_hold"],
];

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

describeDb("partnerships: analytics (§6.18)", () => {
  let app;
  const people = {};
  const tokens = {};
  const cat = {};
  let ip = 0;
  const nextIp = () => {
    ip += 1;
    return `10.77.${Math.floor(ip / 250)}.${(ip % 250) + 1}`;
  };
  const as = (who) => {
    const auth = (r) => r.set("Authorization", `Bearer ${tokens[who]}`).set("X-Forwarded-For", nextIp());
    return {
      get: (path) => auth(request(app).get(`/api/v1${path}`)),
      post: (path, body = {}) => auth(request(app).post(`/api/v1${path}`)).send(body),
      patch: (path, body = {}) => auth(request(app).patch(`/api/v1${path}`)).send(body),
      put: (path, body = {}) => auth(request(app).put(`/api/v1${path}`)).send(body),
    };
  };
  const emp = (who) => people[who].employee.employee_id;
  const ok = (res, status = 200) => {
    expect([res.status, res.body.error]).toEqual([status, undefined]);
    return res.body;
  };
  const lead = async (who, name, category, identified, extra = {}) =>
    ok(
      await as(who).post("/partnerships/leads", {
        name,
        partner_category_id: category,
        region: { scope: "national" },
        owner_id: emp(who),
        identified_on: identified,
        contact: { first_name: "Ife", last_name: "Okon", email: `${name.toLowerCase().replace(/\W+/g, ".")}@example.test` },
        deal: { title: `${name} Deal`, owner_id: emp(who), estimated_value: "1000000.00", ...extra },
      }),
      201,
    );
  const rowOf = (body, who) => body.by_owner.find((r) => r.owner && r.owner.employee_id === emp(who));

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
    await make("other", "Zainab", "Lawal", "employee", "Brand Officer", "Marketing");
    await q("UPDATE department SET head_employee_id = $1 WHERE name = 'Growth'", [emp("hod")]);
    await q("UPDATE employee SET line_manager_id = $1 WHERE employee_id = $2", [emp("hod"), emp("staff")]);
    await require("../../src/shared/rbac/grants-cache").bumpTeamVersion();
    for (const [i, [code, label, meaning]] of STAGES.entries()) {
      await q(
        `INSERT INTO reference_value (domain, code, label, display_order, metadata) VALUES ('partnership_stage', $1, $2, $3, $4::jsonb)
         ON CONFLICT (domain, code) DO UPDATE SET label = EXCLUDED.label, display_order = EXCLUDED.display_order, metadata = EXCLUDED.metadata, active = true`,
        [code, label, (i + 1) * 10, JSON.stringify({ meaning })],
      );
    }
    await q("UPDATE reference_value SET active = false WHERE domain = 'partnership_stage' AND metadata = '{}'::jsonb");
    await drain();
    for (const key of Object.keys(people)) {
      const res = await request(app).post("/api/v1/auth/login").set("X-Forwarded-For", nextIp()).send({ email: `${key}@mycity.test`, password: PASSWORD });
      expect(res.status).toBe(200);
      tokens[key] = res.body.access_token;
    }
    cat.event = ok(await as("ops").post("/partnerships/categories", { name: "Event", default_commission_pct: "8" }), 201).partner_category_id;
    cat.vendor = ok(await as("ops").post("/partnerships/categories", { name: "Vendor", counts_as_vendor: true }), 201).partner_category_id;

    // Musa: two prospects in the period (one a vendor), one after it; a meeting and a call; a proposal sent;
    // a partner signed in April with a month of returns.
    const a = await lead("staff", "Lekki Food Fair", cat.event, "2026-03-10");
    await lead("staff", "Yaba Stalls", cat.vendor, "2026-04-02");
    await lead("staff", "Ajah Night Market", cat.event, "2026-07-01");
    const meet = ok(await as("staff").post("/partnerships/interactions", { lead_id: a.lead.lead_id, interaction_type: "meeting", occurred_at: new Date(Date.now() - 3600000).toISOString(), subject: "Intro meeting", summary: "Met the organisers about tickets." }), 201);
    const call = ok(await as("staff").post("/partnerships/interactions", { lead_id: a.lead.lead_id, interaction_type: "call", occurred_at: new Date(Date.now() - 3600000).toISOString(), subject: "Follow-up call", summary: "Called about the venue and dates." }), 201);
    await q("UPDATE partner_interaction SET occurred_at = '2026-03-15T10:00:00+01:00' WHERE partner_interaction_id = ANY($1::uuid[])", [[meet.partner_interaction_id, call.partner_interaction_id]]);
    await q(
      `INSERT INTO partnership_proposal (partnership_opportunity_id, number, version, status, title, sent_at, created_by)
       VALUES ($1, 'PRO-9001', 1, 'sent', 'Lekki Food Fair Proposal', '2026-04-05T09:00:00+01:00', $2)`,
      [a.deal.deal_id, people.staff.user.user_id],
    );
    // Moved on in the period: Prospect Identified, then Initial Contact, then Proposal Sent.
    ok(await as("staff").post(`/partnerships/deals/${a.deal.deal_id}/stage`, { stage: "initial_contact" }));
    ok(await as("staff").post(`/partnerships/deals/${a.deal.deal_id}/stage`, { stage: "proposal_sent" }));
    await q("UPDATE partnership_stage_history SET changed_at = '2026-04-06T09:00:00+01:00' WHERE partnership_opportunity_id = $1", [a.deal.deal_id]);
    await q("UPDATE partnership_opportunity SET created_at = '2026-03-10T09:00:00+01:00' WHERE partnership_opportunity_id = $1", [a.deal.deal_id]);
    const signed = ok(
      await as("staff").post("/partnerships/partners", {
        name: "Surulere Arts Centre",
        partner_category_id: cat.event,
        region: { scope: "national" },
        owner_id: emp("staff"),
        contact: { first_name: "Bola", last_name: "Ade", email: "bola@surulere.example.test" },
        deal: { title: "Arts Weekend", owner_id: emp("staff"), estimated_value: "3000000.00", member_ids: [emp("other")] },
        signed_before_hub: true,
      }),
      201,
    );
    const dealId = signed.deals[0].deal_id;
    await q("UPDATE partnership_opportunity SET signed_at = '2026-04-20T12:00:00+01:00' WHERE partnership_opportunity_id = $1", [dealId]);
    ok(await as("ops").put(`/partnerships/deals/${dealId}/returns/2026-04`, { units_sold: 30, gross_sales: "600000.00", mycity_commission: "48000.00", downloads: 120 }));
    ok(await as("ops").put(`/partnerships/deals/${dealId}/returns/2026-06`, { downloads: 999 }));

    // Kemi: one prospect in May.
    await lead("hod", "Ikeja Book Fest", cat.event, "2026-05-05");

    // Performance: Musa's April review closed at Meets.
    const cycle = (await q("INSERT INTO performance_cycle (name, starts_on, ends_on, status, month) VALUES ('April 2026', '2026-04-01', '2026-04-30', 'closed', '2026-04-01') RETURNING performance_cycle_id")).rows[0];
    await q(
      `INSERT INTO performance_review (performance_cycle_id, employee_id, reviewer_employee_id, review_type, review_kind, status, rating, closed_at)
       VALUES ($1, $2, $3, 'manager', 'monthly', 'closed', 'meets', '2026-05-03T10:00:00+01:00')`,
      [cycle.performance_cycle_id, emp("staff"), emp("hod")],
    );
    await drain();
  }, 180_000);

  afterAll(async () => {
    await require("../../src/shared/observability/error-reporter").flush();
    await pool.end();
  });

  test("the eight measures per lead owner, counted on a fixed set", async () => {
    const body = ok(await as("ops").get(`/partnerships/analytics?${PERIOD}`));
    expect(body.period).toEqual({ from: "2026-03-01", to: "2026-05-31" });
    expect(rowOf(body, "staff")).toEqual({
      owner: expect.objectContaining({ display_name: "Musa Danjuma" }),
      new_prospects: 2,
      meetings_held: 1,
      proposals_sent: 1,
      partnerships_signed: 1,
      active_partnerships: 1,
      downloads: 120,
      vendor_leads: 1,
      performance_rating: "Meets",
    });
    expect(rowOf(body, "hod")).toMatchObject({ new_prospects: 1, meetings_held: 0, partnerships_signed: 0, performance_rating: null });
    expect(body.kpis).toEqual({ new_prospects: 3, meetings_held: 1, proposals_sent: 1, partnerships_signed: 1 });
    expect(body.signed_per_month).toEqual([
      { month: "2026-03", signed: 0, value: "0.00" },
      { month: "2026-04", signed: 1, value: "3000000.00" },
      { month: "2026-05", signed: 0, value: "0.00" },
    ]);
    expect(body.returns_per_month.find((m) => m.month === "2026-04")).toEqual({ month: "2026-04", gross_sales: "600000.00", mycity_commission: "48000.00", downloads: 120 });
    expect(body.by_category.find((x) => x.name === "Event")).toMatchObject({ signed: 1, value: "3000000.00" });
    expect(body.by_region).toEqual(expect.arrayContaining([expect.objectContaining({ region: "National", signed: 1 })]));
    const step = body.stage_conversion.find((s) => s.from_stage === "initial_contact");
    expect(step).toMatchObject({ to_stage: "proposal_sent", moved: 1 });
    expect(body.stage_conversion[0]).toMatchObject({ from_stage: "prospect_identified", to_stage: "initial_contact" });
  });

  test("scope: a reader sees only what Partnerships shows them, and no returns without the money capability", async () => {
    const mine = ok(await as("staff").get(`/partnerships/analytics?${PERIOD}`));
    expect(mine.returns_per_month).toBeUndefined();
    expect(mine.by_owner.map((r) => r.owner.employee_id)).toEqual([emp("staff")]);
    expect(rowOf(mine, "staff").performance_rating).toBe("Meets");

    // A team member of Musa's signed deal sees that deal's figures under its owner, but not Musa's rating.
    const member = ok(await as("other").get(`/partnerships/analytics?${PERIOD}`));
    expect(rowOf(member, "staff")).toMatchObject({ new_prospects: 0, partnerships_signed: 1, downloads: 120, performance_rating: null });

    const head = ok(await as("hod").get(`/partnerships/analytics?${PERIOD}`));
    expect(rowOf(head, "staff")).toMatchObject({ new_prospects: 2, performance_rating: "Meets" });
  });

  test("an empty period answers zeros, and a custom period needs its dates", async () => {
    const none = ok(await as("ops").get("/partnerships/analytics?period=custom&from=2025-01-01&to=2025-01-31"));
    expect(none).toMatchObject({ kpis: { new_prospects: 0, meetings_held: 0, proposals_sent: 0, partnerships_signed: 0 }, by_owner: [], stage_conversion: expect.any(Array) });
    // Open deals are counted as they stand today; nothing was signed in the period.
    expect(none.by_category.every((x) => x.signed === 0)).toBe(true);
    expect(none.by_region.every((x) => x.signed === 0)).toBe(true);
    expect(none.stage_conversion.every((x) => x.moved === 0)).toBe(true);
    expect(none.signed_per_month).toEqual([{ month: "2025-01", signed: 0, value: "0.00" }]);
    const refused = await as("ops").get("/partnerships/analytics?period=custom&from=2026-03-01");
    expect(refused.status).toBe(422);
    expect(ok(await as("ops").get("/partnerships/analytics")).period.from).toMatch(/^\d{4}-\d{2}-01$/);
  });

  test("the assistant's summaries answer value by partner, and returns by partner only as money allows", async () => {
    const manifest = require("../../src/modules/partnership_analytics/partnership_analytics.ai");
    const [pipeline, returns] = manifest.summaries;
    const actorOf = async (who) => {
      const user = await require("../../src/shared/rbac/grants-cache").getAuthUser(pool, people[who].user.user_id);
      const scope = await require("../../src/middleware/rbac").scopeFor(user, "partnerships", "view");
      return { ...user, scope };
    };
    const params = c.partnership_analytics.PartnershipSummaryQuery.parse({ from: "2026-03-01", to: "2026-05-31", by: "partner" });
    const value = await pipeline.run(pool, params, await actorOf("ops"));
    expect(value.groups[0].rows[0]).toMatchObject({ label: "Surulere Arts Centre", value: "3000000.00", count: 1 });
    expect(value.figures.find((f) => f.key === "signed_value").value).toBe("3000000.00");

    const rparams = c.partnership_analytics.ReturnsSummaryQuery.parse({ from: "2026-03-01", to: "2026-05-31" });
    const withMoney = await returns.run(pool, rparams, await actorOf("ops"));
    expect(withMoney.figures.find((f) => f.key === "mycity_commission").value).toBe("48000.00");
    const without = await returns.run(pool, rparams, await actorOf("staff"));
    expect(without.figures.some((f) => f.key === "mycity_commission")).toBe(false);
    expect(without.groups[0].rows[0]).toMatchObject({ label: "Surulere Arts Centre", value: 120 });
  });

  test("Export reserves the analytics workbook for its period", async () => {
    const res = await as("ops").post("/partnerships/exports", { source: "partnerships.analytics", filters: { period: "custom", from: "2026-03-01", to: "2026-05-31" } });
    expect(res.status).toBe(202);
    const { analyticsSheets } = require("../../src/modules/partners/partners.export");
    const user = await require("../../src/shared/rbac/grants-cache").getAuthUser(pool, people.staff.user.user_id);
    const { sheets } = await analyticsSheets({ period: "custom", from: "2026-03-01", to: "2026-05-31" }, { scope: "own", scope_ids: [emp("staff")] }, user);
    expect(sheets.map((s) => s.name)).toEqual(["By Lead Owner", "Signed per Month", "By Category", "By Region", "Stage Conversion"]);
    expect(sheets[0].rows[0]).toMatchObject({ owner: "Musa Danjuma", new_prospects: 2 });
  });
});
