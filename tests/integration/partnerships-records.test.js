"use strict";
/**
 * Partnerships · leads, partners, deals and the 360s end to end (docs/guides/partnerships.md §6.1 to
 * §6.6, Appendix A PR 3): the real migrations on a throwaway database, the whole app through HTTP,
 * every response parsed with its contract (APP_ENV=test).
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/partnerships-records
 *
 * MyCity's stages, categories and lists are entered here as Categories will enter them (A26: none
 * is seeded). Every organisation and person is invented.
 */
const request = require("supertest");
const { config } = require("../../src/config/env");
const { pool } = require("../../src/config/db");
const { atomically } = require("../../src/shared/db/tx");
const { rebuild } = require("./helpers/schema");
const { createAdmin } = require("../../scripts/db/create-admin");
const { buildApp } = require("../../src/app");
const outbox = require("../../src/shared/events/outbox");
const registry = require("../../src/shared/ai/registry");
const authorise = require("../../src/shared/ai/authorise");
const { scopeFor } = require("../../src/middleware/rbac");

jest.mock("../../src/jobs/queues", () => ({
  enqueue: jest.fn(async () => ({ id: "1" })),
  getQueue: jest.fn(),
  closeQueues: jest.fn(async () => undefined),
  DEFAULTS: {},
}));

const describeDb = String(config.DB_NAME || "").endsWith("_test") ? describe : describe.skip;
const q = (sql, params) => pool.query(sql, params);
const one = async (sql, params) => (await q(sql, params)).rows[0] || null;
const PASSWORD = "Partners-Signed9Deal";
const PDF = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n");

/** MyCity's thirteen stages from the tracker's dropdown, each with what it counts as (§6.3). */
const STAGES = [
  ["prospect_identified", "Prospect Identified", "prospect"],
  ["initial_contact", "Initial Contact", "contacted"],
  ["intro_meeting_scheduled", "Introductory Meeting Scheduled", "meeting"],
  ["intro_meeting_held", "Introductory Meeting Held", "meeting"],
  ["proposal_sent", "Proposal Sent", "proposal"],
  ["follow_up_ongoing", "Follow-up Ongoing", "proposal"],
  ["negotiation", "Negotiation", "negotiation"],
  ["verbal_approval", "Verbal Approval", "negotiation"],
  ["contract_review", "Contract Review", "negotiation"],
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
  for (let i = 0; i < 10; i += 1) {
    await q("UPDATE event_outbox SET next_attempt_at = now() WHERE status = 'pending'");
    const r = await outbox.dispatchDue({ db: pool });
    if (r.claimed === 0) return;
  }
}

describeDb("partnerships: leads, partners, deals and the 360s", () => {
  let app;
  const people = {};
  const tokens = {};
  const cat = {};
  let ip = 0;

  const as = (who) => {
    const auth = (r) => r.set("Authorization", `Bearer ${tokens[who]}`);
    return {
      get: (path) => auth(request(app).get(`/api/v1${path}`)),
      post: (path, body = {}) => auth(request(app).post(`/api/v1${path}`)).send(body),
      put: (path, body = {}) => auth(request(app).put(`/api/v1${path}`)).send(body),
      patch: (path, body = {}) => auth(request(app).patch(`/api/v1${path}`)).send(body),
      upload: (name) => auth(request(app).post("/api/v1/documents")).attach("file", PDF, { filename: name, contentType: "application/pdf" }),
    };
  };
  const emp = (who) => people[who].employee.employee_id;
  const user = (who) => people[who].user.user_id;

  /** New Lead's body, its owner and its deal's owner `who`. */
  const leadBody = (who, name, extra = {}) => ({
    name,
    partner_category_id: cat.event,
    region: { scope: "national" },
    industry: "Events",
    owner_id: emp(who),
    contact: { first_name: "Ngozi", last_name: "Adebayo", job_title: "Founder", email: `${name.toLowerCase().replace(/\W+/g, ".")}@example.test`, phones: ["08031234500"] },
    deal: { title: `${name} Festival 2026`, owner_id: emp(who), estimated_value: "2500000.00", options: [{ position: 1, label: "Regular", deal_price: "10000.00" }] },
    ...extra,
  });
  const newLead = async (who, name, extra) => {
    const res = await as(who).post("/partnerships/leads", leadBody(who, name, extra));
    expect([res.status, res.body.error]).toEqual([201, undefined]);
    return res.body;
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
    const make = (key, first, last, role, job, department = "Growth", isCeo = false) =>
      tx(async (client) => {
        people[key] = await createAdmin(client, { employee: sample(first, last, `${key}@mycity.test`, job, department), role_code: role, is_ceo: isCeo }, PASSWORD, {
          allowAdditional: true,
        });
      });
    await make("ops", "Tunde", "Bakare", "operations_people", "Operations Lead", "Operations");
    await make("ceo", "Ada", "Okafor", "management", "Chief Executive Officer", "Management", true);
    await make("manager", "Kemi", "Alade", "manager", "Growth Lead");
    await make("staff", "Musa", "Danjuma", "employee", "Growth Officer");
    await make("peer", "Bola", "Ige", "employee", "Growth Officer");
    await make("other", "Zainab", "Lawal", "employee", "Growth Officer", "Marketing");
    await q("UPDATE employee SET line_manager_id = $1 WHERE employee_id = ANY($2::uuid[])", [emp("manager"), [emp("staff"), emp("peer")]]);
    await require("../../src/shared/rbac/grants-cache").bumpTeamVersion();

    // MyCity's lists and two categories, as Categories enters them.
    for (const [i, [code, label, meaning]] of STAGES.entries()) {
      // 7099's switched-off stages hold some of these codes: Categories takes them back with a meaning.
      await q(
        `INSERT INTO reference_value (domain, code, label, display_order, metadata) VALUES ('partnership_stage', $1, $2, $3, $4::jsonb)
         ON CONFLICT (domain, code) DO UPDATE SET label = EXCLUDED.label, display_order = EXCLUDED.display_order, metadata = EXCLUDED.metadata, active = true`,
        [code, label, (i + 1) * 10, JSON.stringify({ meaning })],
      );
    }
    await q("INSERT INTO reference_value (domain, code, label, display_order) VALUES ('lead_source', 'referral', 'Referral', 10), ('partner_document_kind', 'mou', 'MOU', 10), ('partnership_impact', 'app_downloads', 'App Downloads & Visibility', 10)");
    // The rest of 7099's stages stay off: only MyCity's thirteen are offered.
    await q("UPDATE reference_value SET active = false WHERE domain = 'partnership_stage' AND metadata = '{}'::jsonb");
    cat.event = (await one("INSERT INTO partner_category (name, default_commission_pct, default_validity_days, display_order) VALUES ('Event', 8, 30, 1) RETURNING partner_category_id")).partner_category_id;
    cat.hospitality = (await one("INSERT INTO partner_category (name, display_order) VALUES ('Hospitality', 2) RETURNING partner_category_id")).partner_category_id;
    await drain();
    for (const key of Object.keys(people)) {
      ip += 1;
      const res = await request(app).post("/api/v1/auth/login").set("X-Forwarded-For", `10.71.0.${ip}`).send({ email: `${key}@mycity.test`, password: PASSWORD });
      expect(res.status).toBe(200);
      tokens[key] = res.body.access_token;
    }
  });

  afterAll(async () => {
    await require("../../src/shared/observability/error-reporter").flush();
    await pool.end();
  });

  test("the lists, categories and fields the forms read", async () => {
    const stages = await as("staff").get("/partnerships/lists/partnership_stage");
    expect(stages.status).toBe(200);
    expect(stages.body.values.filter((s) => s.active).map((s) => [s.code, s.meaning]).slice(0, 2)).toEqual([
      ["prospect_identified", "prospect"],
      ["initial_contact", "contacted"],
    ]);
    const cats = await as("staff").get("/partnerships/categories");
    expect(cats.body.data.map((c) => c.name)).toEqual(["Event", "Hospitality"]);
    expect(cats.body.page.size).toBe(25);
    expect((await as("staff").get("/partnerships/fields?applies_to=lead")).body).toEqual({ data: [] });
  });

  describe("the 360 of a record made a minute ago (§6.2)", () => {
    test("a bare partner and a bare lead read with zeros and empty collections", async () => {
      const bare = await one("INSERT INTO partner (number, name, owner_id) VALUES ('PAR-9001', 'Bare Partner Ltd', $1) RETURNING partner_id", [emp("staff")]);
      const p = await as("staff").get(`/partnerships/partners/${bare.partner_id}`);
      expect(p.status).toBe(200);
      expect(p.body.kpis).toEqual({ signed_value: "0.00", downloads_this_year: 0, active_deals: 0, days_since_contact: 0 });
      expect([p.body.deals, p.body.contacts, p.body.overview, p.body.deliverables, p.body.custom_fields, p.body.history]).toEqual([[], [], { events: [], interactions: [] }, [], [], []]);
      expect(p.body.partner).toMatchObject({ status: "dormant", stage_label: null, health: null, signed_outside: false, region_view: { scope: null, cities: [], label: null } });

      const lead = await one("INSERT INTO lead (number, name, owner_id) VALUES ('LED-9001', 'Bare Lead Ltd', $1) RETURNING lead_id", [emp("staff")]);
      const l = await as("staff").get(`/partnerships/leads/${lead.lead_id}`);
      expect(l.status).toBe(200);
      expect(l.body).toMatchObject({
        kpis: { projected_value: "0.00", days_at_stage: 0, health: null, days_since_contact: 0 },
        deal: null,
        contacts: [],
        overview: { events: [], interactions: [] },
        custom_fields: [],
      });
    });

    test("New Lead captures the lead, its contact and its first deal, at the first stage, in one go", async () => {
      const made = await newLead("staff", "Hevix Events");
      expect(made.lead).toMatchObject({ number: "LED-0001", status: "new", on_hold: false, stage_label: "Prospect Identified", health: "on_track", region: "National" });
      expect(made.deal).toMatchObject({ number: expect.stringMatching(/^DEAL-\d{4}-0001$/), stage: "prospect_identified", meaning: "prospect", status: "open", days_at_stage: 0 });
      expect(made.deal.members).toEqual([{ employee: expect.objectContaining({ employee_id: emp("staff") }), role: "owner" }]);
      expect(made.deal.history).toEqual([expect.objectContaining({ kind: "stage", from_stage: null, to_stage: "prospect_identified", source: "person" })]);
      expect(made.contacts).toEqual([expect.objectContaining({ first_name: "Ngozi", primary_contact: true, phones: ["+2348031234500"] })]);
      expect(made.kpis).toMatchObject({ projected_value: "2500000.00", days_at_stage: 0, health: "on_track" });
    });
  });

  describe("who sees what (§6.1)", () => {
    let mine;
    let peers;
    let outsider;
    beforeAll(async () => {
      mine = (await newLead("staff", "Lekki Food Fair")).lead;
      peers = (await newLead("peer", "Ibadan Arts Week")).lead;
      outsider = (await newLead("other", "Enugu Coal City Expo")).lead;
    });

    const names = async (who) => (await as(who).get("/partnerships/leads?sort=name")).body.data.map((l) => l.name);

    test("own sees their own, team their team's, all everyone's; a record outside reads as not found", async () => {
      expect(await names("staff")).toEqual(expect.arrayContaining(["Hevix Events", "Lekki Food Fair"]));
      expect(await names("staff")).not.toEqual(expect.arrayContaining(["Ibadan Arts Week"]));
      expect(await names("manager")).toEqual(expect.arrayContaining(["Lekki Food Fair", "Ibadan Arts Week"]));
      expect(await names("manager")).not.toContain("Enugu Coal City Expo");
      expect(await names("ops")).toEqual(expect.arrayContaining(["Lekki Food Fair", "Ibadan Arts Week", "Enugu Coal City Expo"]));
      expect((await as("staff").get(`/partnerships/leads/${outsider.lead_id}`)).status).toBe(404);
      expect((await as("staff").get(`/partnerships/leads/${mine.lead_id}`)).status).toBe(200);
    });

    test("a deal's team see the deal and its lead", async () => {
      const deal = (await as("peer").get(`/partnerships/leads/${peers.lead_id}`)).body.deal;
      expect((await as("staff").get(`/partnerships/deals/${deal.deal_id}`)).status).toBe(404);
      const added = await as("peer").patch(`/partnerships/deals/${deal.deal_id}`, { member_ids: [emp("staff")] });
      expect(added.status).toBe(200);
      expect(added.body.members.map((m) => m.role).sort()).toEqual(["owner", "support"]);
      expect((await as("staff").get(`/partnerships/deals/${deal.deal_id}`)).status).toBe(200);
      expect(await names("staff")).toContain("Ibadan Arts Week");
    });

    test("a record with no owner is seen only with all", async () => {
      await q("INSERT INTO lead (number, name) VALUES ('LED-9002', 'Ownerless Ltd')");
      expect(await names("manager")).not.toContain("Ownerless Ltd");
      expect(await names("ops")).toContain("Ownerless Ltd");
    });

    test("an owner outside the reader's team is refused", async () => {
      const res = await as("staff").post("/partnerships/leads", leadBody("other", "Someone Else's Lead"));
      expect(res.status).toBe(422);
      expect(res.body.error.fields).toHaveProperty("owner_id");
    });
  });

  describe("money is left out without partnerships.money (§6.1)", () => {
    test("commission and the merchant's take reach a holder, never anyone else", async () => {
      const lead = (await as("ops").get("/partnerships/leads?q=Hevix")).body.data[0];
      const deal = (await as("ops").get(`/partnerships/leads/${lead.lead_id}`)).body.deal;
      expect(deal).toMatchObject({ commission_pct: "8.00", commission_deviates: false });
      expect(deal.options[0]).toMatchObject({ deal_price: "10000.00", commission_amount: "800.00", merchant_take: "9200.00" });
      const seen = (await as("staff").get(`/partnerships/deals/${deal.deal_id}`)).body;
      expect(seen).not.toHaveProperty("commission_pct");
      expect(seen).not.toHaveProperty("commission_deviates");
      expect(seen.options[0]).not.toHaveProperty("commission_amount");
      expect(seen.options[0]).not.toHaveProperty("merchant_take");
      // Entering it is refused, and so are the returns.
      const set = await as("staff").patch(`/partnerships/deals/${deal.deal_id}`, { commission_pct: "10" });
      expect(set.status).toBe(403);
      expect((await as("staff").get(`/partnerships/deals/${deal.deal_id}/returns`)).status).toBe(403);
      const month = await as("ops").put(`/partnerships/deals/${deal.deal_id}/returns/2026-10`, { units_sold: 40, mycity_commission: "32000.00", downloads: 120 });
      expect(month.status).toBe(200);
      expect(month.body).toMatchObject({ month: "2026-10-01", units_sold: 40, source: "entered" });
      const again = await as("ops").put(`/partnerships/deals/${deal.deal_id}/returns/2026-10`, { units_sold: 44 });
      expect(again.body).toMatchObject({ units_sold: 44, mycity_commission: null });
      // A rate other than the category's sets commission_deviates.
      const deviates = await as("ops").patch(`/partnerships/deals/${deal.deal_id}`, { commission_pct: "10" });
      expect(deviates.body).toMatchObject({ commission_pct: "10.00", commission_deviates: true });
    });
  });

  describe("the stage switcher (§6.5)", () => {
    let lead;
    let dealId;
    beforeAll(async () => {
      lead = (await newLead("staff", "Owerri Comedy Night")).lead;
      dealId = (await as("staff").get(`/partnerships/leads/${lead.lead_id}`)).body.deal.deal_id;
    });
    const move = (body) => as("staff").post(`/partnerships/deals/${dealId}/stage`, body);

    test("forward needs no reason; the same stage is refused; the lead's status follows", async () => {
      expect((await move({ stage: "prospect_identified" })).body.error.fields.stage).toEqual(["Already at this stage"]);
      const res = await move({ stage: "proposal_sent" });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ stage: "proposal_sent", meaning: "proposal" });
      expect(res.body.history[0]).toMatchObject({ kind: "stage", from_label: "Prospect Identified", to_label: "Proposal Sent", by: expect.objectContaining({ employee_id: emp("staff") }) });
      expect((await one("SELECT status FROM lead WHERE lead_id = $1", [lead.lead_id])).status).toBe("qualified");
    });

    test("back, On Hold and Closed Lost need why; On Hold keeps the lead's status", async () => {
      expect((await move({ stage: "initial_contact" })).body.error.fields.reason).toEqual(["Say why"]);
      expect((await move({ stage: "initial_contact", reason: "Short" })).status).toBe(422);
      expect((await move({ stage: "initial_contact", reason: "The proposal went to the wrong person" })).status).toBe(200);
      expect((await one("SELECT status FROM lead WHERE lead_id = $1", [lead.lead_id])).status).toBe("contacted");
      expect((await move({ stage: "on_hold" })).status).toBe(422);
      const held = await move({ stage: "on_hold", reason: "Their budget opens in January" });
      expect(held.status).toBe(200);
      const view = (await as("staff").get(`/partnerships/leads/${lead.lead_id}`)).body.lead;
      expect(view).toMatchObject({ status: "contacted", on_hold: true });
    });

    test("a signed stage needs the signed copy", async () => {
      const res = await move({ stage: "partnership_signed" });
      expect(res.status).toBe(422);
      expect(res.body.error).toMatchObject({ code: "SIGNED_COPY_REQUIRED", fields: { signed_copy_document_id: ["Attach the signed copy"] } });
    });

    test("Close as Lost moves the deal to Closed Lost with the reason; the lead leaves the default list", async () => {
      const res = await as("staff").post(`/partnerships/leads/${lead.lead_id}/lose`, { reason: "They chose another ticketing app" });
      expect(res.status).toBe(200);
      expect(res.body.lead).toMatchObject({ status: "lost", lost_reason: "They chose another ticketing app" });
      expect(res.body.deal).toMatchObject({ status: "lost", stage: "closed_lost", close_reason: "They chose another ticketing app" });
      expect((await as("staff").get("/partnerships/leads")).body.data.map((l) => l.lead_id)).not.toContain(lead.lead_id);
      expect((await as("staff").get("/partnerships/leads?status=lost")).body.data.map((l) => l.lead_id)).toContain(lead.lead_id);
    });
  });

  describe("health and blockers (§6.5)", () => {
    test("Stalled needs blockers; the change is a health line and Pipeline lists it", async () => {
      const lead = (await newLead("staff", "Calabar Carnival Partners")).lead;
      const dealId = (await as("staff").get(`/partnerships/leads/${lead.lead_id}`)).body.deal.deal_id;
      const bare = await as("staff").post(`/partnerships/deals/${dealId}/health`, { health: "stalled" });
      expect(bare.status).toBe(422);
      expect(bare.body.error.fields.blockers).toEqual(["Say what is in the way"]);
      const res = await as("staff").post(`/partnerships/deals/${dealId}/health`, { health: "stalled", blockers: "Waiting on the venue's insurance papers" });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ health: "stalled", blockers: "Waiting on the venue's insurance papers" });
      expect(res.body.history[0]).toMatchObject({ kind: "health", from_label: "On Track", to_label: "Stalled" });
      const pipeline = await as("manager").get("/partnerships/pipeline");
      expect(pipeline.status).toBe(200);
      expect(pipeline.body.stalled.map((d) => d.deal_id)).toContain(dealId);
      expect(pipeline.body.kpis.stalled).toBeGreaterThanOrEqual(1);
      expect(pipeline.body.by_stage.map((s) => s.stage)).not.toContain("closed_lost");
    });
  });

  describe("conversion (§6.4)", () => {
    test("a signed deal converts its lead in one transaction: a bad copy leaves nothing behind", async () => {
      const lead = (await newLead("staff", "Port Harcourt Jazz")).lead;
      const dealId = (await as("staff").get(`/partnerships/leads/${lead.lead_id}`)).body.deal.deal_id;
      // A copy uploaded by someone else is not this person's to attach: refused, and the lead is untouched.
      const theirs = await as("peer").upload("theirs.pdf");
      expect(theirs.status).toBe(201);
      const refused = await as("staff").post(`/partnerships/deals/${dealId}/stage`, { stage: "partnership_signed", signed_copy_document_id: theirs.body.document_id });
      expect(refused.status).toBe(422);
      expect(await one("SELECT status, converted_partner_id FROM lead WHERE lead_id = $1", [lead.lead_id])).toEqual({ status: "new", converted_partner_id: null });
      expect((await one("SELECT count(*)::int AS n FROM partner WHERE lead_id = $1", [lead.lead_id])).n).toBe(0);
    });

    test("Convert to Partner moves the deal, contacts, documents and interactions; a second press answers the same partner", async () => {
      const lead = (await newLead("staff", "Abuja Tech Summit")).lead;
      const logged = await as("staff").post("/partnerships/interactions", {
        lead_id: lead.lead_id,
        interaction_type: "call",
        occurred_at: new Date(Date.now() - 3600000).toISOString(),
        subject: "Kick-off call",
        summary: "Agreed the ticket tiers and the launch date.",
      });
      expect(logged.status).toBe(201);
      const kind = await as("staff").upload("brief.pdf");
      const attached = await as("staff").post("/partnerships/documents", { document_id: kind.body.document_id, kind: "mou", lead_id: lead.lead_id });
      expect(attached.status).toBe(201);
      expect(attached.body).toMatchObject({ kind: "mou", kind_label: "MOU", origin: "upload" });

      expect((await as("staff").post(`/partnerships/leads/${lead.lead_id}/convert`, {})).body.error.code).toBe("SIGNED_COPY_REQUIRED");
      const copy = await as("staff").upload("signed.pdf");
      const first = await as("staff").post(`/partnerships/leads/${lead.lead_id}/convert`, { signed_copy_document_id: copy.body.document_id });
      expect(first.status).toBe(200);
      const partnerId = first.body.partner_id;
      const again = await as("staff").post(`/partnerships/leads/${lead.lead_id}/convert`, {});
      expect(again.body).toEqual({ partner_id: partnerId });
      expect((await one("SELECT count(*)::int AS n FROM partner WHERE lead_id = $1", [lead.lead_id])).n).toBe(1);

      const p = (await as("staff").get(`/partnerships/partners/${partnerId}`)).body;
      expect(p.partner).toMatchObject({ name: "Abuja Tech Summit", status: "active", lead_id: lead.lead_id, category: "Event" });
      expect(p.deals).toEqual([expect.objectContaining({ status: "live", meaning: "signed", record: expect.objectContaining({ type: "partner", id: partnerId }) })]);
      expect(p.contacts.map((ct) => ct.first_name)).toEqual(["Ngozi"]);
      expect(p.overview.interactions.map((i) => i.subject)).toEqual(["Kick-off call"]);
      expect(p.kpis.active_deals).toBe(1);
      const docs = (await as("staff").get(`/partnerships/documents?partner_id=${partnerId}`)).body.data;
      expect(docs.map((d) => d.origin).sort()).toEqual(["signed_copy", "upload"]);
      const converted = (await as("staff").get(`/partnerships/leads/${lead.lead_id}`)).body.lead;
      expect(converted).toMatchObject({ status: "converted", converted_partner_id: partnerId });
      expect((await as("staff").patch(`/partnerships/leads/${lead.lead_id}`, { name: "Renamed" })).status).toBe(409);
      // The signed copy reads for the record's readers, not for someone outside.
      expect((await as("staff").get(`/documents/${copy.body.document_id}/content`)).status).toBe(200);
      expect((await as("other").get(`/documents/${copy.body.document_id}/content`)).status).toBe(404);
    });

    test("a stage move with the signed copy converts too, and the history says who moved it", async () => {
      const lead = (await newLead("staff", "Kano Durbar Tours")).lead;
      const dealId = (await as("staff").get(`/partnerships/leads/${lead.lead_id}`)).body.deal.deal_id;
      const copy = await as("staff").upload("signed.pdf");
      const res = await as("staff").post(`/partnerships/deals/${dealId}/stage`, { stage: "partnership_signed", signed_copy_document_id: copy.body.document_id });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: "live", partner_id: expect.any(String), lead_id: lead.lead_id, valid_until: expect.any(String) });
      expect(res.body.signed_at).not.toBeNull();
      // Signed deals do not go back before signing.
      const back = await as("staff").post(`/partnerships/deals/${dealId}/stage`, { stage: "negotiation", reason: "Trying to reopen the terms" });
      expect(back.body.error.fields.stage).toEqual(["Already signed"]);
    });
  });

  describe("partners (§6.6)", () => {
    test("New Partner records one signed before the hub; Close Partner loses its deals", async () => {
      const res = await as("staff").post("/partnerships/partners", {
        name: "Eko Hotels Group",
        partner_category_id: cat.hospitality,
        region: { scope: "national" },
        owner_id: emp("staff"),
        contact: { first_name: "Femi", last_name: "Bello", email: "femi@eko.example.test" },
        deal: { title: "Weekend Listing", owner_id: emp("staff") },
        signed_before_hub: true,
      });
      expect(res.status).toBe(201);
      expect(res.body.partner).toMatchObject({ number: "PAR-0003", status: "active", signed_outside: true, stage_label: "Partnership Signed" });
      const id = res.body.partner.partner_id;
      // A second deal opens at the first stage.
      const deal = await as("staff").post("/partnerships/deals", { partner_id: id, title: "Christmas Brunch", owner_id: emp("staff") });
      expect(deal.status).toBe(201);
      expect(deal.body).toMatchObject({ stage: "prospect_identified", status: "open" });
      // A duplicate is advisory: the name and the contact's email find it.
      const dup = await as("staff").get("/partnerships/duplicates?name=Eko%20Hotels&email=femi@eko.example.test");
      expect(dup.body.candidates[0]).toMatchObject({ type: "partner", id, reasons: expect.arrayContaining(["email"]) });

      const closed = await as("staff").post(`/partnerships/partners/${id}/close`, { reason: "They left MyCityApp for good" });
      expect(closed.status).toBe(200);
      expect(closed.body.partner).toMatchObject({ status: "closed", close_reason: "They left MyCityApp for good" });
      expect(closed.body.deals.map((d) => d.status)).toEqual(["lost", "lost"]);
    });

    test("New Partner needs a signed or active stage and its evidence", async () => {
      const res = await as("staff").post("/partnerships/partners", {
        name: "No Evidence Ltd",
        partner_category_id: cat.event,
        region: { scope: "national" },
        owner_id: emp("staff"),
        contact: { first_name: "A", last_name: "B" },
        deal: { title: "Something", owner_id: emp("staff") },
      });
      expect(res.status).toBe(422);
      expect(res.body.error.fields).toHaveProperty("signed_copy_document_id");
    });

    test("the list and its cards, and an interaction in the future refused", async () => {
      const list = await as("ops").get("/partnerships/partners?sort=name");
      expect(list.status).toBe(200);
      const summary = await as("ops").get("/partnerships/partners/summary");
      expect(summary.body).toMatchObject({ active: expect.any(Number), dormant: expect.any(Number), quiet: expect.any(Number) });
      const future = await as("ops").post("/partnerships/interactions", {
        partner_id: list.body.data[0].partner_id,
        interaction_type: "note",
        occurred_at: new Date(Date.now() + 86400000).toISOString(),
        subject: "Tomorrow",
        summary: "Something that has not happened yet.",
      });
      expect(future.status).toBe(422);
      expect(future.body.error.fields.occurred_at).toEqual(["Not in the future"]);
    });
  });

  describe("the rules settled at the audit before PR 4 (§6.1, §6.4, §6.12, §13.2)", () => {
    let partnerId;
    let mineDeal;
    let theirDeal;
    beforeAll(async () => {
      const made = await as("staff").post("/partnerships/partners", {
        name: "Ikoyi Lights Festival",
        partner_category_id: cat.event,
        region: { scope: "national" },
        owner_id: emp("staff"),
        contact: { first_name: "Chidi", last_name: "Eze", email: "chidi@ikoyi.example.test" },
        deal: { title: "Lights 2026", owner_id: emp("staff") },
        signed_before_hub: true,
      });
      expect(made.status).toBe(201);
      partnerId = made.body.partner.partner_id;
      mineDeal = made.body.deals[0].deal_id;
      // A colleague outside the owner's team opens the next edition on the same partner.
      const theirs = await as("ops").post("/partnerships/deals", { partner_id: partnerId, title: "Lights 2027", owner_id: emp("other") });
      expect(theirs.status).toBe(201);
      theirDeal = theirs.body.deal_id;
    });

    test("a partner's owner sees and moves every deal on it; a member of one sees only that one", async () => {
      expect((await as("staff").get(`/partnerships/deals/${theirDeal}`)).status).toBe(200);
      const moved = await as("staff").post(`/partnerships/deals/${theirDeal}/stage`, { stage: "initial_contact" });
      expect(moved.status).toBe(200);
      const owner360 = (await as("staff").get(`/partnerships/partners/${partnerId}`)).body;
      expect(owner360.deals.map((d) => d.deal_id).sort()).toEqual([mineDeal, theirDeal].sort());
      expect(owner360.kpis.active_deals).toBe(1);
      expect(owner360.history.map((h) => h.deal_title)).toEqual(expect.arrayContaining(["Lights 2026", "Lights 2027"]));
      expect(owner360.history[0]).toMatchObject({ kind: "stage", to_label: "Initial Contact", deal_id: theirDeal, deal_title: "Lights 2027" });
      // The colleague sees the partner through their own deal, and only that deal.
      const member360 = (await as("other").get(`/partnerships/partners/${partnerId}`)).body;
      expect(member360.deals.map((d) => d.deal_id)).toEqual([theirDeal]);
      expect(member360.kpis.active_deals).toBe(0);
      expect(member360.history.every((h) => h.deal_id === theirDeal)).toBe(true);
      expect((await as("other").get(`/partnerships/deals/${mineDeal}`)).status).toBe(404);
      expect((await as("other").get(`/partnerships/deals?partner_id=${partnerId}`)).body.data.map((d) => d.deal_id)).toEqual([theirDeal]);
    });

    test("New Deal and Edit Deal refuse an owner outside the reader's team", async () => {
      const made = await as("staff").post("/partnerships/deals", { partner_id: partnerId, title: "Lights Pop-Up", owner_id: emp("other") });
      expect(made.status).toBe(422);
      expect(made.body.error.fields).toHaveProperty("owner_id");
      const edited = await as("staff").patch(`/partnerships/deals/${mineDeal}`, { owner_id: emp("other") });
      expect(edited.status).toBe(422);
      expect(edited.body.error.fields).toHaveProperty("owner_id");
      expect((await as("manager").patch(`/partnerships/deals/${mineDeal}`, { owner_id: emp("peer") })).status).toBe(200);
    });

    test("a lost lead reopened by its deal's move is no longer lost", async () => {
      const lead = (await newLead("staff", "Badagry Heritage Walk")).lead;
      const lost = await as("staff").post(`/partnerships/leads/${lead.lead_id}/lose`, { reason: "They went with a tour operator" });
      expect(lost.body.lead).toMatchObject({ status: "lost", lost_reason: "They went with a tour operator" });
      const back = await as("staff").post(`/partnerships/deals/${lost.body.deal.deal_id}/stage`, { stage: "initial_contact", reason: "They came back after the season" });
      expect(back.status).toBe(200);
      const view = (await as("staff").get(`/partnerships/leads/${lead.lead_id}`)).body.lead;
      expect(view).toMatchObject({ status: "contacted", lost_reason: null });
    });

    test("Categories' counts follow scope; the duplicate check reads beyond it, names and numbers only", async () => {
      const count = async (who) => (await as(who).get("/partnerships/categories")).body.data.find((c) => c.name === "Event");
      const staffs = await count("staff");
      const all = await count("ops");
      expect(all.leads).toBeGreaterThan(staffs.leads);
      const detail = (await as("staff").get(`/partnerships/categories/${cat.event}`)).body.counts;
      expect([detail.partners, detail.leads]).toEqual([staffs.partners, staffs.leads]);
      const dup = await as("staff").get("/partnerships/duplicates?name=Enugu%20Coal%20City%20Expo");
      expect(dup.body.candidates[0]).toEqual({ type: "lead", id: expect.any(String), number: expect.any(String), name: "Enugu Coal City Expo", score: expect.any(Number), reasons: ["name"] });
      expect((await as("staff").get(`/partnerships/leads/${dup.body.candidates[0].id}`)).status).toBe(404);
    });

    test("Partners' Quiet names the days in use", async () => {
      expect((await as("staff").get("/partnerships/partners/summary")).body.quiet_days).toBe(30);
    });

    test("PR 4's hooks write a lead, a partner and a month of returns in the caller's transaction, marked as imported", async () => {
      const leads = require("../../src/modules/leads/leads.service");
      const partners = require("../../src/modules/partners/partners.service");
      const returns = require("../../src/modules/partner_pipeline/partner_pipeline.returns");
      const dealRepo = require("../../src/modules/partner_pipeline/partner_pipeline.repo");
      const actor = { user_id: user("ops"), employee_id: emp("ops") };
      const lead = await tx((client) =>
        leads.createIn(
          client,
          actor,
          { name: "Imported Lead Ltd", partner_category_id: cat.event, region: { scope: "national" }, owner_id: emp("staff"), identified_on: "2026-06-25", deal: { title: "Imported Deal", owner_id: emp("staff") } },
          { held: true, source: "import" },
        ),
      );
      expect(await one("SELECT identified_on::text AS d, (SELECT count(*)::int FROM partner_contact WHERE lead_id = $1) AS contacts FROM lead WHERE lead_id = $1", [lead.lead_id])).toEqual({ d: "2026-06-25", contacts: 0 });
      expect(await one("SELECT identified_on::text AS d FROM partnership_opportunity WHERE partnership_opportunity_id = $1", [lead.deal_id])).toEqual({ d: "2026-06-25" });
      expect(await one("SELECT source FROM partnership_stage_history WHERE partnership_opportunity_id = $1", [lead.deal_id])).toEqual({ source: "import" });

      const partner = await tx((client) =>
        partners.createIn(
          client,
          actor,
          { name: "Imported Partner Ltd", partner_category_id: cat.event, region: { scope: "national" }, owner_id: emp("staff"), signed_before_hub: true, deal: { title: "Imported Listing", owner_id: emp("staff") } },
          { held: true, source: "import" },
        ),
      );
      expect(await one("SELECT status FROM partner WHERE partner_id = $1", [partner.partner_id])).toEqual({ status: "active" });
      expect(await one("SELECT source FROM partnership_stage_history WHERE partnership_opportunity_id = $1", [partner.deal_id])).toEqual({ source: "import" });

      const saved = await tx(async (client) => returns.saveIn(client, actor, await dealRepo.lock(client, partner.deal_id), "2026-08", { units_sold: 12, downloads: 30 }, { source: "import" }));
      expect(saved).toMatchObject({ month: "2026-08-01", units_sold: 12, downloads: 30, source: "import" });
    });
  });

  describe("Praxis AI's cards run the screens' own functions (§9)", () => {
    const roles = async (who) => (await one("SELECT COALESCE(array_agg(role_id), '{}') AS ids FROM user_role WHERE user_id = $1", [user(who)])).ids;
    const actorOf = async (who, key) => {
      const u = { user_id: user(who), employee_id: emp(who), role_ids: await roles(who), is_ceo: who === "ceo" };
      const checked = await authorise.checkAction(u, key, {}, pool);
      return { ...u, scope: checked.scope };
    };
    const run = async (who, key, values) => {
      const actor = await actorOf(who, key);
      const checked = await authorise.checkAction(actor, key, values, pool);
      expect([key, checked.problems]).toEqual([key, {}]);
      const action = registry.action(key);
      if (action.check) await action.check(pool, checked.values, actor);
      return action.run(checked.values, actor);
    };

    test("leads.create, leads.update and leads.lose", async () => {
      const made = await run("staff", "leads.create", {
        name: "Jos Wildlife Park",
        partner_category_id: cat.event,
        region_scope: "national",
        owner_id: emp("staff"),
        contact_first_name: "Yusuf",
        contact_last_name: "Garba",
        deal_title: "Season Passes",
      });
      expect(made.lead).toMatchObject({ name: "Jos Wildlife Park", status: "new" });
      const saved = await run("staff", "leads.update", { lead_id: made.lead.lead_id, industry: "Tourism" });
      expect(saved.lead.industry).toBe("Tourism");
      const lost = await run("staff", "leads.lose", { lead_id: made.lead.lead_id, reason: "The park closed for renovation" });
      expect(lost.lead.status).toBe("lost");
    });

    test("partners.create, partners.update, contacts.create and contacts.update", async () => {
      const made = await run("staff", "partners.create", {
        name: "Obudu Ranch Resort",
        partner_category_id: cat.hospitality,
        region_scope: "national",
        owner_id: emp("staff"),
        contact_first_name: "Efe",
        contact_last_name: "Okon",
        deal_title: "Holiday Listing",
      });
      expect(made.partner).toMatchObject({ status: "active", signed_outside: true });
      const saved = await run("staff", "partners.update", { partner_id: made.partner.partner_id, website: "https://obudu.example.test" });
      expect(saved.partner.website).toBe("https://obudu.example.test");
      const contact = await run("staff", "contacts.create", { partner_id: made.partner.partner_id, first_name: "Ada", last_name: "Nwosu" });
      expect(contact).toMatchObject({ first_name: "Ada", primary_contact: false });
      const changed = await run("staff", "contacts.update", { partner_contact_id: contact.partner_contact_id, primary_contact: true });
      expect(changed.primary_contact).toBe(true);
    });

    test("deals.create, deals.update, deals.move_stage, deals.set_health, deal_returns.save and interactions.log", async () => {
      const partner = (await as("staff").get("/partnerships/partners?q=Obudu")).body.data[0];
      const deal = await run("staff", "deals.create", { partner_id: partner.partner_id, title: "Easter Packages", owner_id: emp("staff") });
      expect(deal).toMatchObject({ title: "Easter Packages", stage: "prospect_identified" });
      expect((await run("staff", "deals.update", { deal_id: deal.deal_id, next_action: "Send the rate card" })).next_action).toBe("Send the rate card");
      expect((await run("staff", "deals.move_stage", { deal_id: deal.deal_id, stage: "Proposal Sent" })).stage).toBe("proposal_sent");
      // A signed stage needs the copy, a file: the card is refused by its own check.
      const signed = await actorOf("staff", "deals.move_stage");
      await expect(registry.action("deals.move_stage").check(pool, { deal_id: deal.deal_id, stage: "partnership_signed" }, signed)).rejects.toMatchObject({ code: "SIGNED_COPY_REQUIRED" });
      expect((await run("staff", "deals.set_health", { deal_id: deal.deal_id, health: "follow_up_required" })).health).toBe("follow_up_required");
      // Returns are a holder's of partnerships.money.
      const ops = { user_id: user("ops"), employee_id: emp("ops"), role_ids: await roles("ops") };
      await expect(authorise.checkAction({ user_id: user("staff"), employee_id: emp("staff"), role_ids: await roles("staff") }, "deal_returns.save", {})).rejects.toMatchObject({ code: "AI_ACTION_FORBIDDEN" });
      expect((await authorise.checkAction(ops, "deal_returns.save", {})).scope.scope).toBe("all");
      const saved = await run("ops", "deal_returns.save", { deal_id: deal.deal_id, month: "2026-09", downloads: 15 });
      expect(saved.deal_id).toBe(deal.deal_id);
      const logged = await run("staff", "interactions.log", {
        partner_id: partner.partner_id,
        interaction_type: "meeting",
        occurred_at: new Date(Date.now() - 60000).toISOString(),
        subject: "Site visit",
        summary: "Walked the chalets with the manager.",
      });
      expect(logged).toMatchObject({ subject: "Site visit", owner: expect.objectContaining({ employee_id: emp("staff") }) });
    });

    test("a reader only sees through cards what the screen shows them", async () => {
      const staff = { user_id: user("staff"), employee_id: emp("staff"), role_ids: await roles("staff") };
      expect((await scopeFor(staff, "partnerships", "view")).scope).toBe("own");
      const read = await authorise.runRead(pool, staff, "leads.list", {});
      expect(read.data.map((l) => l.name)).not.toContain("Enugu Coal City Expo");
    });
  });
});
