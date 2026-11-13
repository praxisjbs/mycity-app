"use strict";
/**
 * Charts in the Overview, PR 6 on the real migrations (docs/guides/praxis-ai.md §6.13 Partnerships, §6.19
 * item 9): `leads.summary`, `partners.summary`, `proposals.summary`, `agreements.summary` and
 * `interactions.summary` answer the CEO with figures and never a row; a head of department's figures are
 * their team's and a member of staff's their own, by the one rule every Partnerships list keeps
 * (partnerships.md §6.1); a role without Partnerships is refused; a part only some rows have is drawn only
 * where one does; quiet is the partners list's own rule; a period narrows a summary only when asked; the
 * reads name their summaries.
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/ai-summaries-partnerships
 *
 * Refuses to run unless the database name ends in "_test": it drops and rebuilds the public schema.
 * Every organisation and person here is invented.
 */
const c = require("@mycity/contract");
const { config } = require("../../src/config/env");
const { pool } = require("../../src/config/db");

jest.mock("../../src/jobs/queues", () => ({
  enqueue: jest.fn(async () => ({ id: "1" })),
  getQueue: jest.fn(() => ({ getDelayed: async () => [] })),
  closeQueues: jest.fn(async () => {}),
  DEFAULTS: {},
}));

const { rebuild } = require("./helpers/schema");
const { buildApp } = require("../../src/app");
const outbox = require("../../src/shared/events/outbox");
const grantsCache = require("../../src/shared/rbac/grants-cache");
const authorise = require("../../src/shared/ai/authorise");
const registry = require("../../src/shared/ai/registry");
const engine = require("../../src/services/ai/engine");
const lagos = require("../../src/shared/time/lagos");
const { q, one, drain, harness } = require("./helpers/ai-actions");

const describeDb = String(config.DB_NAME || "").endsWith("_test") ? describe : describe.skip;

const SUMMARIES = ["leads.summary", "partners.summary", "proposals.summary", "agreements.summary", "interactions.summary"];

const STAGES = [
  ["prospect_identified", "Prospect Identified", "prospect"],
  ["initial_contact", "Initial Contact", "contacted"],
  ["proposal_sent", "Proposal Sent", "proposal"],
  ["partnership_signed", "Partnership Signed", "signed"],
  ["active_partnership", "Active Partnership", "active"],
  ["closed_lost", "Closed Lost", "closed_lost"],
  ["on_hold", "On Hold", "on_hold"],
];

describeDb("Partnerships summaries against the real migrations", () => {
  let h;
  const cat = {};
  const lead = {};
  const partner = {};

  const userOf = (who) => grantsCache.getAuthUser(pool, h.people[who].user_id);
  const summaryOf = async (who, key, params = {}) => (await authorise.runSummary(pool, await userOf(who), key, params)).result;
  const figuresOf = (result) => Object.fromEntries(result.figures.map((x) => [x.key, x.value]));
  const groupOf = (result, by) => result.groups.find((g) => g.by === by);
  const ok = (res, status = 200) => {
    expect([res.status, res.body.error]).toEqual([status, undefined]);
    return res.body;
  };
  const emp = (who) => h.people[who].employee_id;

  beforeAll(async () => {
    await rebuild(pool, config.DB_NAME);
    outbox.markReady();
    const { app: server } = buildApp({ strict: true, accessLog: false });
    h = harness(server);
    await h.makePeople([
      { who: "ceo", first: "Amaka", last: "Eze", email: "ceo@mycity.test", job: "Chief Executive Officer", role: "management", ceo: true, password: "Chief#Officer26" },
      { who: "ops", first: "Ada", last: "Obi", email: "ops@mycity.test", job: "Operations & People Lead", role: "operations_people", password: "Opera!ions2026", department: "Operations" },
      { who: "head", first: "Kemi", last: "Alade", email: "head@mycity.test", job: "Head of Growth", role: "head_of_department", password: "Growth#Lead2026", department: "Growth" },
      { who: "staff", first: "Musa", last: "Danjuma", email: "staff@mycity.test", job: "Growth Officer", role: "employee", password: "Field#Officer2026", department: "Growth" },
      { who: "other", first: "Zainab", last: "Lawal", email: "other@mycity.test", job: "Brand Officer", role: "employee", password: "Brand#Officer2026", department: "Marketing" },
      { who: "admin", first: "Tobi", last: "Ige", email: "admin@mycity.test", job: "Systems Administrator", role: "administrator", password: "Settings#Keeper2026", department: "Operations" },
    ]);
    await q("UPDATE employee SET line_manager_id = $1 WHERE employee_id = $2", [emp("head"), emp("staff")]);
    await grantsCache.bumpTeamVersion();
    for (const [i, [code, label, meaning]] of STAGES.entries()) {
      await q(
        `INSERT INTO reference_value (domain, code, label, display_order, metadata) VALUES ('partnership_stage', $1, $2, $3, $4::jsonb)
         ON CONFLICT (domain, code) DO UPDATE SET label = EXCLUDED.label, display_order = EXCLUDED.display_order, metadata = EXCLUDED.metadata, active = true`,
        [code, label, (i + 1) * 10, JSON.stringify({ meaning })],
      );
    }
    await q("UPDATE reference_value SET active = false WHERE domain = 'partnership_stage' AND metadata = '{}'::jsonb");
    cat.event = ok(await h.as("ops").post("/partnerships/categories").send({ name: "Event", default_commission_pct: "8" }), 201).partner_category_id;
    cat.vendor = ok(await h.as("ops").post("/partnerships/categories").send({ name: "Vendor", counts_as_vendor: true }), 201).partner_category_id;

    const newLead = async (who, name, category) =>
      ok(
        await h.as(who).post("/partnerships/leads").send({
          name,
          partner_category_id: category,
          region: { scope: "national" },
          owner_id: emp(who),
          contact: { first_name: "Ife", last_name: "Okon", email: `${name.toLowerCase().replace(/\W+/g, ".")}@example.test` },
          deal: { title: `${name} Deal`, owner_id: emp(who), estimated_value: "1000000.00" },
        }),
        201,
      );
    const newPartner = async (who, name, category) =>
      ok(
        await h.as(who).post("/partnerships/partners").send({
          name,
          partner_category_id: category,
          region: { scope: "national" },
          owner_id: emp(who),
          contact: { first_name: "Bola", last_name: "Ade", email: `${name.toLowerCase().replace(/\W+/g, ".")}@example.test` },
          deal: { title: `${name} Weekend`, owner_id: emp(who), estimated_value: "3000000.00" },
          signed_before_hub: true,
        }),
        201,
      );

    // Five leads: Musa's three (new, moved to Initial Contact, lost), Kemi's one and Zainab's one, both new.
    lead.lekki = await newLead("staff", "Lekki Food Fair", cat.event);
    lead.yaba = await newLead("staff", "Yaba Stalls", cat.vendor);
    lead.ajah = await newLead("staff", "Ajah Night Market", cat.event);
    lead.ikeja = await newLead("head", "Ikeja Book Fest", cat.event);
    lead.ibadan = await newLead("other", "Ibadan Expo", cat.vendor);
    ok(await h.as("staff").post(`/partnerships/deals/${lead.yaba.deal.deal_id}/stage`).send({ stage: "initial_contact" }));
    ok(await h.as("staff").post(`/partnerships/leads/${lead.ajah.lead.lead_id}/lose`).send({ reason: "The organisers chose another ticketing app." }));

    // Two partners: Musa's, active and quiet for sixty days; Zainab's, dormant with its deal completed.
    partner.surulere = await newPartner("staff", "Surulere Arts Centre", cat.event);
    partner.abuja = await newPartner("other", "Abuja Arts Hub", cat.vendor);
    await q("UPDATE partner SET created_at = now() - interval '60 days' WHERE partner_id = $1", [partner.surulere.partner.partner_id]);
    await q("UPDATE partner SET status = 'dormant' WHERE partner_id = $1", [partner.abuja.partner.partner_id]);
    await q("UPDATE partnership_opportunity SET status = 'completed', completed_at = now() WHERE partner_id = $1", [partner.abuja.partner.partner_id]);

    // Three proposals: Lekki's sent, Yaba's accepted, Ikeja's a draft.
    const proposal = (deal, number, status, value, sent, accepted) =>
      q(
        `INSERT INTO partnership_proposal (partnership_opportunity_id, number, version, status, title, value, currency, sent_at, accepted_at, created_by)
         VALUES ($1, $2, 1, $3, $2, $4, 'NGN', CASE WHEN $5 THEN now() - interval '2 days' END, CASE WHEN $6 THEN now() END, $7)`,
        [deal, number, status, value, sent, accepted, h.people.staff.user_id],
      );
    await proposal(lead.lekki.deal.deal_id, "PRO-9001", "sent", "1000000.00", true, false);
    await proposal(lead.yaba.deal.deal_id, "PRO-9002", "accepted", "2000000.00", true, true);
    await proposal(lead.ikeja.deal.deal_id, "PRO-9003", "draft", null, false, false);

    // Three agreements: Surulere's active and ending in 40 days, Lekki's waiting for its signature, Abuja's a draft.
    const today = lagos.today();
    const agreement = (record, deal, number, kind, status, owner, ends) =>
      q(
        `INSERT INTO partnership_agreement (partner_id, lead_id, partnership_opportunity_id, number, title, kind, status, starts_on, ends_on, owner_id)
         VALUES ($1, $2, $3, $4, $4, $5, $6, $7, $8, $9)`,
        [record.partner_id || null, record.lead_id || null, deal, number, kind, status, lagos.addDays(today, -30), ends, emp(owner)],
      );
    await agreement({ partner_id: partner.surulere.partner.partner_id }, partner.surulere.deals[0].deal_id, "AGR-2026-9001", "deal_merchant", "active", "staff", lagos.addDays(today, 40));
    await agreement({ lead_id: lead.lekki.lead.lead_id }, lead.lekki.deal.deal_id, "AGR-2026-9002", "mou", "sent", "staff", null);
    await agreement({ partner_id: partner.abuja.partner.partner_id }, partner.abuja.deals[0].deal_id, "AGR-2026-9003", "contract", "draft", "other", null);

    // Three interactions: Musa's meeting and call on Lekki, Zainab's visit to Abuja.
    const log = (who, body) => h.as(who).post("/partnerships/interactions").send({ occurred_at: new Date(Date.now() - 3600000).toISOString(), ...body });
    ok(await log("staff", { lead_id: lead.lekki.lead.lead_id, interaction_type: "meeting", subject: "Intro meeting", summary: "Met the organisers about tickets." }), 201);
    ok(await log("staff", { lead_id: lead.lekki.lead.lead_id, interaction_type: "call", subject: "Follow-up call", summary: "Called about the venue and dates." }), 201);
    ok(await log("other", { partner_id: partner.abuja.partner.partner_id, interaction_type: "visit", subject: "Site visit", summary: "Walked the hall with the manager." }), 201);
    await drain();
  }, 180_000);

  afterAll(async () => {
    await require("../../src/shared/observability/error-reporter").flush();
    await pool.end();
  });

  test("each summary answers the CEO with figures and never a row", async () => {
    for (const key of SUMMARIES) {
      const res = await authorise.runSummary(pool, await userOf("ceo"), key, {});
      expect([key, c.assistant.AiSummaryResult.safeParse(res.result).success]).toEqual([key, true]);
      expect([key, "data" in res, "rows" in res.result]).toEqual([key, false, false]);
    }
  });

  test("leads.summary: by status, by stage in the list's order stacked by status, the lost counted; the head's are their team's, Musa's his own", async () => {
    const all = await summaryOf("ceo", "leads.summary");
    expect(figuresOf(all)).toMatchObject({ leads: 5, new: 3, contacted: 1, qualified: 0, converted: 0, lost: 1, conversion_rate: 0 });
    expect(groupOf(all, "status").rows.map((r) => [r.label, r.value])).toEqual([["New", 3], ["Contacted", 1], ["Lost", 1]]);
    const stages = groupOf(all, "stage").rows;
    expect(stages.map((r) => [r.label, r.value])).toEqual([["Prospect Identified", 3], ["Initial Contact", 1], ["Closed Lost", 1]]);
    // Nobody is qualified or converted, so the legend names neither.
    expect(stages[0].parts.map((p) => p.label)).toEqual(["New", "Contacted", "Lost"]);
    const o = engine.pane.overviewOf(
      { summary: "leads.summary", figures: ["leads", "new", "lost"], chart: { kind: "stacked_bar", title: "Leads by stage", group: "stage" } },
      [{ n: 1, key: "leads.summary", kind: "summary", ok: true, result: all }],
    );
    expect(() => c.assistant.AiOverview.parse(o)).not.toThrow();
    expect(o.chart.series.map((s) => s.label)).toEqual(["New", "Contacted", "Lost"]);
    const byCategory = await summaryOf("ceo", "leads.summary", { by: "category" });
    expect(Object.fromEntries(groupOf(byCategory, "category").rows.map((r) => [r.label, r.value]))).toEqual({ Event: 3, Vendor: 2 });
    expect(groupOf(await summaryOf("ceo", "leads.summary", { by: "source" }), "source").rows).toEqual([expect.objectContaining({ label: "No Source", value: 5 })]);
    expect(groupOf(await summaryOf("ceo", "leads.summary", { by: "region" }), "region").rows).toEqual([expect.objectContaining({ label: "National", value: 5 })]);
    expect(groupOf(await summaryOf("ceo", "leads.summary", { by: "owner" }), "owner").rows.map((r) => [r.label, r.value])).toEqual([["Musa Danjuma", 3], ["Kemi Alade", 1], ["Zainab Lawal", 1]]);
    expect(all.series.map((s) => s.key)).toEqual(["identified", "converted"]);
    expect([(await summaryOf("head", "leads.summary")).total, (await summaryOf("staff", "leads.summary")).total]).toEqual([4, 3]);
    expect((await summaryOf("ceo", "leads.summary", { status: "lost" })).total).toBe(1);
  });

  test("partners.summary: by status, by category stacked Active and Dormant with no Closed part, quiet by the list's own rule", async () => {
    const all = await summaryOf("ceo", "partners.summary");
    expect(figuresOf(all)).toMatchObject({ partners: 2, active: 1, dormant: 1, closed: 0, quiet: 1, live: 1 });
    expect(all.figures.find((x) => x.key === "quiet").label).toMatch(/^Quiet, no contact in \d+ days$/);
    expect(groupOf(all, "status").rows.map((r) => [r.label, r.value])).toEqual([["Active", 1], ["Dormant", 1]]);
    const event = groupOf(all, "category").rows.find((r) => r.label === "Event");
    expect(event.parts.map((p) => [p.label, p.value])).toEqual([["Active", 1], ["Dormant", 0]]);
    // The list's Quiet filter and the summary's agree.
    const quiet = await summaryOf("ceo", "partners.summary", { quiet: true });
    const listed = await authorise.runRead(pool, await userOf("ceo"), "partners.list", { quiet: "true" });
    expect([quiet.total, listed.page.total]).toEqual([1, 1]);
    expect(groupOf(await summaryOf("ceo", "partners.summary", { by: "owner" }), "owner").rows.map((r) => r.label).sort()).toEqual(["Musa Danjuma", "Zainab Lawal"]);
    expect(groupOf(await summaryOf("ceo", "partners.summary", { by: "region" }), "region").rows).toEqual([expect.objectContaining({ label: "National", value: 2 })]);
    const byHealth = await summaryOf("ceo", "partners.summary", { by: "health" });
    expect(groupOf(byHealth, "health").rows.map((r) => r.label)).toEqual(expect.arrayContaining(["No Open Deal"]));
    expect([(await summaryOf("head", "partners.summary")).total, (await summaryOf("staff", "partners.summary")).total]).toEqual([1, 1]);
  });

  test("proposals.summary: by status and value in naira, the sent ones by owner stacked by outcome, the acceptance rate", async () => {
    const all = await summaryOf("ceo", "proposals.summary");
    expect(figuresOf(all)).toMatchObject({ proposals: 3, sent: 2, viewed: 0, accepted: 1, declined: 0, expired: 0, acceptance_rate: 100, value_sent: "3000000.00", value_accepted: "2000000.00" });
    expect(all.figures.find((x) => x.key === "value_sent").unit).toBe("ngn");
    expect(groupOf(all, "status").rows.map((r) => [r.label, r.value])).toEqual([["Draft", 1], ["Sent", 1], ["Accepted", 1]]);
    expect(groupOf(all, "value").rows.map((r) => [r.label, r.value])).toEqual([["Sent", "1000000.00"], ["Accepted", "2000000.00"]]);
    const musa = groupOf(all, "owner").rows.find((r) => r.label === "Musa Danjuma");
    expect(musa.parts.map((p) => [p.label, p.value])).toEqual([["Accepted", 1], ["Waiting", 1], ["Declined", 0]]);
    expect((await summaryOf("ceo", "proposals.summary", { by: "owner" })).groups[0].by).toBe("owner");
    expect([(await summaryOf("head", "proposals.summary")).total, (await summaryOf("staff", "proposals.summary")).total]).toEqual([3, 2]);
  });

  test("agreements.summary: by status, kind and owner, ending within 60 days, the renewals due by month", async () => {
    const all = await summaryOf("ceo", "agreements.summary");
    expect(figuresOf(all)).toMatchObject({ agreements: 3, draft: 1, awaiting_signature: 1, active: 1, ending_soon: 1, renewed: 0, closed: 0 });
    expect(groupOf(all, "status").rows.map((r) => r.label)).toEqual(["Draft", "Sent", "Active"]);
    expect(groupOf(all, "kind").rows.map((r) => r.label)).toEqual(["Deal Merchant", "MOU", "Contract"]);
    expect(all.series[0].points).toEqual([{ at: lagos.addDays(lagos.today(), 40).slice(0, 7), value: 1 }]);
    expect((await summaryOf("ceo", "agreements.summary", { by: "kind" })).groups.map((g) => g.by)).toEqual(["kind", "status", "owner"]);
    expect([(await summaryOf("head", "agreements.summary")).total, (await summaryOf("staff", "agreements.summary")).total]).toEqual([2, 2]);
  });

  test("interactions.summary: by type, by person stacked by type, the partners and leads most reached, by month or week", async () => {
    const all = await summaryOf("ceo", "interactions.summary");
    expect(figuresOf(all)).toMatchObject({ interactions: 3, calls: 1, meetings: 1, visits: 1, emails: 0, notes: 0, people: 2, partners: 1, leads: 1 });
    expect(groupOf(all, "type").rows.map((r) => [r.label, r.value])).toEqual([["Call", 1], ["Meeting", 1], ["Visit", 1]]);
    const musa = groupOf(all, "person").rows.find((r) => r.label === "Musa Danjuma");
    expect(musa.parts.map((p) => [p.label, p.value])).toEqual([["Call", 1], ["Meeting", 1], ["Visit", 0]]);
    expect(groupOf(all, "partner").rows[0]).toMatchObject({ label: "Lekki Food Fair (lead)", value: 2 });
    expect(all.series[0].label).toBe("Interactions by month");
    expect((await summaryOf("ceo", "interactions.summary", { by: "week" })).series[0].label).toBe("Interactions by week");
    expect([(await summaryOf("head", "interactions.summary")).total, (await summaryOf("staff", "interactions.summary")).total]).toEqual([2, 2]);
  });

  test("a period narrows a summary only when asked: a month long past counts nothing", async () => {
    const lastYear = `${Number(lagos.today().slice(0, 4)) - 1}-01`;
    for (const key of SUMMARIES) {
      expect([key, (await summaryOf("ceo", key)).total > 0]).toEqual([key, true]);
      expect([key, (await summaryOf("ceo", key, { month: lastYear })).total]).toEqual([key, 0]);
    }
  });

  test("a role without Partnerships is refused every one", async () => {
    const admin = await userOf("admin");
    for (const key of SUMMARIES) await expect(authorise.runSummary(pool, admin, key, {})).rejects.toMatchObject({ code: "AI_READ_FORBIDDEN" });
  });

  test("Partnerships' built summaries read their money as naira", async () => {
    const value = await summaryOf("ceo", "partnerships.summary");
    expect(value.figures.find((x) => x.key === "open_value").unit).toBe("ngn");
  });

  test("every read names its summary: the partnerships lists name theirs, and none waits in the gaps file", async () => {
    const named = {
      "leads.list": "leads.summary",
      "partners.list": "partners.summary",
      "proposals.list": "proposals.summary",
      "agreements.list": "agreements.summary",
      "agreements.renewals": "agreements.summary",
      "interactions.list": "interactions.summary",
    };
    for (const [read, summary] of Object.entries(named)) expect([read, registry.read(read).summary]).toEqual([read, summary]);
    const gaps = require("../../scripts/check/ai-summary-gaps.json").gaps.map((g) => g.read);
    expect(gaps.filter((r) => r in named)).toEqual([]);
    expect(await one("SELECT count(*)::int AS n FROM partnership_proposal")).toEqual({ n: 3 });
  });
});
