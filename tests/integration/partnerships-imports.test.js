"use strict";
/**
 * Partnerships · the Partnership Tracker and Partnership Returns imports end to end
 * (docs/guides/partnerships.md §6.13, §6.14, Appendix A PR 4), with Map Values on the import engine
 * (docs/guides/foundation.md §5): the real migrations on a throwaway database, the whole app through
 * HTTP, every response parsed with its contract (APP_ENV=test).
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/partnerships-imports
 *
 * The tracker is the synthetic one (tests/fixtures/partnership-tracker.synthetic.xlsx): MyCity's
 * headers, dropdowns and value shapes, invented organisations and contacts. The real tracker, which
 * holds partners' phones and emails, is never committed.
 */
const fs = require("node:fs");
const path = require("node:path");
const ExcelJS = require("exceljs");
const request = require("supertest");
const c = require("@mycity/contract");
const { config } = require("../../src/config/env");
const { pool } = require("../../src/config/db");
const { atomically } = require("../../src/shared/db/tx");
const { rebuild } = require("./helpers/schema");
const { createAdmin } = require("../../scripts/db/create-admin");
const { buildApp } = require("../../src/app");
const outbox = require("../../src/shared/events/outbox");

jest.mock("../../src/jobs/queues", () => ({
  enqueue: jest.fn(async () => ({ id: "1" })),
  getQueue: jest.fn(),
  closeQueues: jest.fn(async () => undefined),
  DEFAULTS: {},
}));

const describeDb = String(config.DB_NAME || "").endsWith("_test") ? describe : describe.skip;
const q = (sql, params) => pool.query(sql, params);
const one = async (sql, params) => (await q(sql, params)).rows[0] || null;
const PASSWORD = "Tracker-Imported7Rows";
const FIXTURE = fs.readFileSync(path.join(__dirname, "..", "fixtures", "partnership-tracker.synthetic.xlsx"));
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const STAGES = [
  ["prospect_identified", "Prospect Identified", "prospect"],
  ["initial_contact", "Initial Contact", "contacted"],
  ["intro_meeting_held", "Introductory Meeting Held", "meeting"],
  ["proposal_sent", "Proposal Sent", "proposal"],
  ["negotiation", "Negotiation", "negotiation"],
  ["partnership_signed", "Partnership Signed", "signed"],
  ["active_partnership", "Active Partnership", "active"],
  ["closed_lost", "Closed Lost", "closed_lost"],
  ["on_hold", "On Hold", "on_hold"],
];
const IMPACT = [
  ["brand_visibility", "Brand Visibility"],
  ["app_downloads", "App Downloads & Visibility"],
  ["revenue_generation", "Revenue Generation"],
  ["user_acquisition", "User Acquisition"],
];

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

/** A city as the address search would have signed it: Map Values' pick for a region (F27). */
const city = (name, lat, lon) =>
  require("../../src/modules/maps/maps.service").signed({ place_id: `city-${name}`, formatted: `${name}, Nigeria`, lat, lon, kind: "city", city: name, state: name, country_code: "ng" }, "search").token;

async function returnsSheet(rows) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Returns");
  ws.getRow(1).values = ["Deal Number", "Partner", "Deal", "Month", "Units Sold", "Gross Sales", "MyCity Commission", "Paid to Partner", "Downloads", "Note"];
  rows.forEach((r, i) => (ws.getRow(i + 2).values = r));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describeDb("partnerships: the tracker and returns imports", () => {
  let app;
  const people = {};
  const tokens = {};
  let ip = 0;

  const as = (who) => {
    const auth = (r) => r.set("Authorization", `Bearer ${tokens[who]}`);
    return {
      get: (p) => auth(request(app).get(`/api/v1${p}`)),
      post: (p, body = {}) => auth(request(app).post(`/api/v1${p}`)).send(body),
      put: (p, body = {}) => auth(request(app).put(`/api/v1${p}`)).send(body),
      upload: (key, buffer, filename) => auth(request(app).post("/api/v1/imports")).field("importer_key", key).attach("file", buffer, { filename, contentType: XLSX }),
    };
  };
  const emp = (who) => people[who].employee.employee_id;

  /** Upload, take the mapping as found, and answer Map Values; returns the batch id. */
  const prepare = async (values) => {
    const up = await as("ops").upload("partnership_tracker", FIXTURE, "tracker.xlsx");
    expect([up.status, up.body.error]).toEqual([201, undefined]);
    const fields = Object.fromEntries(up.body.mapping.columns.map((col) => [String(col.index), col.field]));
    expect((await as("ops").put(`/imports/${up.body.import_batch_id}/mapping`, { fields })).status).toBe(200);
    if (values) {
      const set = await as("ops").put(`/imports/${up.body.import_batch_id}/values`, { values, save_profile: true });
      expect([set.status, set.body.error]).toEqual([200, undefined]);
    }
    return up.body.import_batch_id;
  };

  const VALUES = () => ({
    stage: { "Proposal drafted, outreach to begin": { to: "proposal_sent" }, Secured: { to: "partnership_signed" }, Prospecting: { to: "prospect_identified" } },
    category: { "Ticketing (exclusive)": { create: true }, Tourism: { create: true }, Media: { create: true } },
    region: { Lagos: { to: city("Lagos", 6.455, 3.394) }, IBADAN: { to: city("Ibadan", 7.377, 3.947) }, PH: { to: null }, Owerri: { to: null } },
    owner: { JANE: { to: null } },
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
    const make = (key, first, last, role, job, department = "Growth") =>
      tx(async (client) => {
        people[key] = await createAdmin(client, { employee: sample(first, last, `${key}@mycity.test`, job, department), role_code: role }, PASSWORD, { allowAdditional: true });
      });
    await make("ops", "Tunde", "Bakare", "operations_people", "Operations Lead", "Operations");
    await make("john", "John", "Eze", "employee", "Growth Officer");
    await make("ada", "Ada", "Obi", "employee", "Growth Officer");
    for (const [i, [code, label, meaning]] of STAGES.entries()) {
      await q(
        `INSERT INTO reference_value (domain, code, label, display_order, metadata) VALUES ('partnership_stage', $1, $2, $3, $4::jsonb)
         ON CONFLICT (domain, code) DO UPDATE SET label = EXCLUDED.label, display_order = EXCLUDED.display_order, metadata = EXCLUDED.metadata, active = true`,
        [code, label, (i + 1) * 10, JSON.stringify({ meaning })],
      );
    }
    await q("UPDATE reference_value SET active = false WHERE domain = 'partnership_stage' AND metadata = '{}'::jsonb");
    for (const [i, [code, label]] of IMPACT.entries()) {
      await q("INSERT INTO reference_value (domain, code, label, display_order) VALUES ('partnership_impact', $1, $2, $3) ON CONFLICT (domain, code) DO UPDATE SET label = EXCLUDED.label, active = true", [code, label, i]);
    }
    await q("INSERT INTO partner_category (name, default_commission_pct, display_order) VALUES ('Event', 8, 1), ('Hospitality', NULL, 2)");
    await q("INSERT INTO partnership_field (key, label, field_type, applies_to) VALUES ('instagram_handle', 'Instagram Handle', 'text', 'lead')");
    for (const key of Object.keys(people)) {
      ip += 1;
      const res = await request(app).post("/api/v1/auth/login").set("X-Forwarded-For", `10.74.0.${ip}`).send({ email: `${key}@mycity.test`, password: PASSWORD });
      expect(res.status).toBe(200);
      tokens[key] = res.body.access_token;
    }
  });

  afterAll(async () => {
    await require("../../src/shared/observability/error-reporter").flush();
    await pool.end();
  });

  test("who may import what: the tracker with create, the returns only with the money", async () => {
    const ops = await as("ops").get("/imports/importers");
    expect(ops.status).toBe(200);
    const keys = ops.body.importers.map((i) => i.key);
    expect(keys).toEqual(expect.arrayContaining(["partnership_tracker", "partnership_returns"]));
    const fields = ops.body.importers.find((i) => i.key === "partnership_tracker").fields;
    expect(Object.fromEntries(fields.filter((f) => f.map_values).map((f) => [f.key, f.map_values]))).toEqual({ region: "place", category: "list", stage: "list", owner: "person", status: "list" });

    const staff = (await as("john").get("/imports/importers")).body.importers.map((i) => i.key);
    expect(staff).toContain("partnership_tracker");
    expect(staff).not.toContain("partnership_returns");
    const refused = await as("john").upload("partnership_returns", await returnsSheet([["DEAL-2026-0001", null, null, "2026-10", 1]]), "returns.xlsx");
    expect(refused.status).toBe(403);
  });

  test("Map Values lists each distinct value once with its rows and what it matches", async () => {
    const batch = await prepare(null);
    const res = await as("ops").get(`/imports/${batch}/values`);
    expect(res.status).toBe(200);
    expect(c.imports.ImportValueList.safeParse(res.body).success).toBe(true);
    const field = (k) => res.body.fields.find((f) => f.field === k);

    const stage = field("stage");
    expect(stage.kind).toBe("list");
    expect(stage.choices.map((o) => o.value)).toContain("proposal_sent");
    const sv = Object.fromEntries(stage.values.map((v) => [v.value, [v.rows, v.suggested]]));
    expect(sv).toMatchObject({ "Partnership Signed": [1, "partnership_signed"], "Proposal drafted, outreach to begin": [1, null], Secured: [1, null], Prospecting: [1, null], "Closed Lost": [1, "closed_lost"] });

    const owner = Object.fromEntries(field("owner").values.map((v) => [v.value, [v.suggested, v.suggested_label]]));
    // "Mr. John" and "Mr.John" are one spelling, as the engine compares them.
    expect(owner).toEqual({ JOHN: [emp("john"), "John Eze"], "Ada Obi": [emp("ada"), "Ada Obi"], "Mr. John": [emp("john"), "John Eze"], JANE: [null, null] });
    expect(field("owner").values.find((v) => v.value === "Mr. John").rows).toBe(2);

    const cats = field("category");
    expect(cats.create_missing).toBe(true);
    expect(Object.fromEntries(cats.values.map((v) => [v.value, v.rows]))).toEqual({ Event: 4, Hospitality: 1, "Ticketing (exclusive)": 1, Tourism: 1, Media: 1 });

    // A region's cities, once each in any case; a scope word is not listed.
    expect(field("region").values.map((v) => v.value).sort()).toEqual(["IBADAN", "Lagos", "Owerri", "PH"]);
    expect(field("region").values.find((v) => v.value === "IBADAN").rows).toBe(1);

    expect(field("status").values.find((v) => v.value === "Follow-up Required").suggested).toBe("follow_up_required");

    // A value mapped to something its field does not offer is refused.
    const bad = await as("ops").put(`/imports/${batch}/values`, { values: { stage: { Secured: { to: "nonsense" } } } });
    expect([bad.status, bad.body.error.code]).toEqual([422, "IMPORT_VALUES_INVALID"]);
    const notCreatable = await as("ops").put(`/imports/${batch}/values`, { values: { stage: { Secured: { create: true } } } });
    expect(notCreatable.status).toBe(422);
  });

  describe("the tracker imported", () => {
    let batch;
    const record = (name) => one("SELECT 'partner' AS kind, partner_id AS id, number, status::text, owner_id, metadata FROM partner WHERE name = $1 UNION ALL SELECT 'lead', lead_id, number::text, status::text, owner_id, NULL FROM lead WHERE name = $1", [name]);
    const dealOf = (r) => one(`SELECT * FROM partnership_opportunity WHERE ${r.kind}_id = $1`, [r.id]);

    beforeAll(async () => {
      batch = await prepare(VALUES());
    });

    test("the preview is the real result, rolled back: the second Eko Arts Fair is a duplicate", async () => {
      const res = await as("ops").post(`/imports/${batch}/preview`, {});
      expect([res.status, res.body.error]).toEqual([200, undefined]);
      expect(res.body.stats).toMatchObject({ rows: 8, create: 7, duplicate: 1, error: 0 });
      expect((await one("SELECT count(*)::int AS n FROM lead")).n).toBe(0);
      const rows = await as("ops").get(`/imports/${batch}/rows?status=problem`);
      const problems = rows.body.data.map((r) => [r.row_number, r.status, r.problems.map((p) => p.message).join("; ")]);
      expect(problems).toEqual(
        expect.arrayContaining([
          [expect.any(Number), "duplicate", expect.stringContaining("Same Partner Name")],
          [expect.any(Number), "warning", 'Partnership Type "Ticketing (exclusive)" will be created'],
        ]),
      );
    });

    test("committed: signed rows are partners, the rest leads, each through the services", async () => {
      const res = await as("ops").post(`/imports/${batch}/commit`, { valid_only: true });
      expect([res.status, res.body.error]).toEqual([200, undefined]);
      expect(res.body.stats).toMatchObject({ create: 7 });

      const grill = await record("Harbour Grill House");
      expect(grill).toMatchObject({ kind: "partner", status: "active", owner_id: emp("john"), metadata: { signed_before_hub: true } });
      const grillDeal = await dealOf(grill);
      expect(grillDeal).toMatchObject({ status: "live", stage: "partnership_signed", title: "Hospitality Partnership", identified_on: "2026-07-03" });
      expect(await one("SELECT source FROM partnership_stage_history WHERE partnership_opportunity_id = $1", [grillDeal.partnership_opportunity_id])).toEqual({ source: "import" });
      const signedEvent = await one("SELECT payload, import_batch_id FROM event_log WHERE event_key = 'deal.signed' AND entity_id = $1", [grillDeal.partnership_opportunity_id]);
      expect(signedEvent).toMatchObject({ payload: expect.objectContaining({ source: "import" }), import_batch_id: batch });
      expect(await one("SELECT email::text, primary_contact FROM partner_contact WHERE partner_id = $1", [grill.id])).toEqual({ email: "chidi@harbourgrill.example", primary_contact: true });

      // Secured, mapped to Partnership Signed: a partner; JANE matched nobody, so No Owner.
      expect(await record("Pan-African Media Group")).toMatchObject({ kind: "partner", owner_id: null });

      const tech = await record("Savannah Tech Hub");
      expect(tech).toMatchObject({ kind: "lead", status: "qualified", owner_id: emp("ada") });
      const techDeal = await dealOf(tech);
      expect(techDeal).toMatchObject({ stage: "proposal_sent", commission_pct: "8.00", health: "follow_up_required", next_action: "Send the revised deck; This week" });
      expect(await one("SELECT name::text FROM partner_category WHERE partner_category_id = (SELECT partner_category_id FROM lead WHERE lead_id = $1)", [tech.id])).toEqual({ name: "Ticketing (exclusive)" });
      expect(await one("SELECT phones, first_name, last_name FROM partner_contact WHERE lead_id = $1", [tech.id])).toEqual({ phones: ["+2348123456789", "+2349098765432"], first_name: "Amina", last_name: "Bello" });
      expect(await one("SELECT impact_rating, impact_note FROM lead WHERE lead_id = $1", [tech.id])).toEqual({ impact_rating: "high", impact_note: "strong student reach in Ibadan" });
      expect((await one("SELECT count(*)::int AS n FROM place WHERE owner = 'lead.cities' AND owner_key LIKE $1", [`${tech.id}:%`])).n).toBe(1);

      const lagoon = await record("Blue Lagoon Resort");
      expect(lagoon).toMatchObject({ kind: "lead", status: "lost" });
      expect(await dealOf(lagoon)).toMatchObject({ stage: "closed_lost", status: "lost" });

      const owerri = await dealOf(await record("Owerri Food Festival"));
      expect(owerri).toMatchObject({ health: "stalled", blockers: "Waiting on the sponsor's legal team", expected_close_on: "2026-11-30" });

      const eko = await record("Eko Arts Fair");
      expect(eko).toMatchObject({ kind: "lead", status: "new", owner_id: emp("john") });
      expect(await one("SELECT custom FROM lead WHERE lead_id = $1", [eko.id])).toEqual({ custom: { instagram_handle: "@ekoartsfair" } });
      expect((await one("SELECT count(*)::int AS n FROM place WHERE owner = 'lead.cities' AND owner_key LIKE $1", [`${eko.id}:%`])).n).toBe(1);
      expect(await record("Abuja Startup Week")).toMatchObject({ kind: "lead", status: "new" });
    });

    test("Export on Partners and Leads writes the tracker's columns, which read back as they came", async () => {
      const asked = await as("ops").post("/partnerships/exports", { source: "partnerships.leads", filters: { stage: "proposal_sent" } });
      expect([asked.status, asked.body.error]).toEqual([202, undefined]);
      expect(c.documents.ExportFile.safeParse(asked.body).success).toBe(true);
      for (let i = 0; i < 10; i += 1) {
        await q("UPDATE event_outbox SET next_attempt_at = now() WHERE status = 'pending'");
        if ((await outbox.dispatchDue({ db: pool })).claimed === 0) break;
      }
      const file = await as("ops").get(`/documents/${asked.body.document_id}/content`).buffer(true).parse((res, cb) => {
        const parts = [];
        res.on("data", (d) => parts.push(d));
        res.on("end", () => cb(null, Buffer.concat(parts)));
      });
      expect(file.status).toBe(200);
      const book = await require("../../src/shared/spreadsheet/parse").readSheets({ buffer: file.body, filename: "leads.xlsx" });
      const sheet = book.sheets.find((x) => x.name === "Master Tracker");
      expect(sheet.rows[0].slice(0, 18)).toEqual(["S/N", "Partner Name", "Industry", "Contact Person", "Position", "Contact Details", "Region", "Partnership Objective", "Partnership Type", "Partnership Stage", "Potential Impact", "Lead Owner", "Date Identified", "Current Stage", "Next Action", "Expected Close Date", "Status", "Comments"]);
      expect(sheet.rows[0]).toContain("Instagram Handle");
      const back = require("../../src/modules/partners/partners.import").extract(book.sheets);
      expect(back.rows).toEqual([
        expect.objectContaining({
          name: "Savannah Tech Hub",
          stage: "Proposal Sent",
          category: "Ticketing (exclusive)",
          owner: "Ada Obi",
          phones: "+2348123456789, +2349098765432",
          identified_on: "2026-07-24",
          status: "Follow-Up Required",
          next_action: "Send the revised deck; This week",
        }),
      ]);
      // Money never leaves this way, and Export needs the grant.
      expect(JSON.stringify(sheet.rows)).not.toContain("8.00");
      expect((await as("john").post("/partnerships/exports", { source: "partnerships.partners" })).status).toBe(403);
      const bad = await as("ops").post("/partnerships/exports", { source: "partnerships.partners", filters: { page: 2 } });
      expect(bad.status).toBe(422);
    });

    test("the same file again makes nothing twice; an owner nobody matches is a note, not an error", async () => {
      const values = VALUES();
      delete values.owner;
      const again = await prepare(values);
      const res = await as("ops").post(`/imports/${again}/preview`, {});
      expect(res.body.stats).toMatchObject({ create: 0, unchanged: 6, warning: 1, duplicate: 1, error: 0 });
      const rows = await as("ops").get(`/imports/${again}/rows?status=warning`);
      expect(rows.body.data.map((r) => r.problems.map((p) => p.message))).toEqual([['Lead Owner "JANE" is not matched; saved without it']]);
    });

    test("revert removes what it made; once a record is in use, it is refused", async () => {
      const done = await as("ops").post(`/imports/${batch}/revert`, {});
      expect([done.status, done.body.error]).toEqual([200, undefined]);
      expect(done.body.archived).toBe(7);
      expect((await one("SELECT (SELECT count(*) FROM lead)::int + (SELECT count(*) FROM partner)::int AS n")).n).toBe(0);
      expect((await one("SELECT count(*)::int AS n FROM partnership_opportunity")).n).toBe(0);

      const second = await prepare(VALUES());
      expect((await as("ops").post(`/imports/${second}/preview`, {})).status).toBe(200);
      expect((await as("ops").post(`/imports/${second}/commit`, { valid_only: true })).status).toBe(200);
      const eko = await record("Eko Arts Fair");
      const logged = await as("ops").post("/partnerships/interactions", { lead_id: eko.id, interaction_type: "call", occurred_at: new Date(Date.now() - 60000).toISOString(), subject: "First call", summary: "Talked through ticketing for the fair" });
      expect([logged.status, logged.body.error]).toEqual([201, undefined]);
      const refused = await as("ops").post(`/imports/${second}/revert`, {});
      expect([refused.status, refused.body.error.code]).toEqual([409, "IMPORT_REVERT_BLOCKED"]);
    });
  });

  describe("returns imported", () => {
    let deal;
    beforeAll(async () => {
      deal = await one("SELECT po.partnership_opportunity_id AS id, po.number FROM partnership_opportunity po JOIN partner p ON p.partner_id = po.partner_id WHERE p.name = 'Harbour Grill House'");
    });

    const run = async (rows) => {
      const up = await as("ops").upload("partnership_returns", await returnsSheet(rows), "returns.xlsx");
      expect([up.status, up.body.error]).toEqual([201, undefined]);
      const id = up.body.import_batch_id;
      const preview = await as("ops").post(`/imports/${id}/preview`, {});
      expect(preview.status).toBe(200);
      return { id, stats: preview.body.stats };
    };

    test("by deal number, or partner and deal title; an unknown deal is an error, never a guess", async () => {
      const { id, stats } = await run([
        [deal.number, null, null, "Oct 2026", 120, 1200000, 96000, 1104000, 340, "October"],
        [null, "Harbour Grill House", "Hospitality Partnership", "2026-09", 5, null, null, null, 12, null],
        ["DEAL-2099-0999", null, null, "2026-10", 1, null, null, null, null, null],
      ]);
      expect(stats).toMatchObject({ create: 2, error: 1 });
      const committed = await as("ops").post(`/imports/${id}/commit`, { valid_only: true });
      expect(committed.status).toBe(200);
      expect(await one("SELECT units_sold, gross_sales, mycity_commission, downloads, source, import_batch_id FROM deal_return WHERE deal_id = $1 AND month = '2026-10-01'", [deal.id])).toEqual({
        units_sold: 120,
        gross_sales: "1200000.00",
        mycity_commission: "96000.00",
        downloads: 340,
        source: "import",
        import_batch_id: id,
      });
      const tab = await as("ops").get(`/partnerships/deals/${deal.id}/returns`);
      expect(tab.body.data.map((r) => [r.month, r.source])).toEqual([
        ["2026-10-01", "import"],
        ["2026-09-01", "import"],
      ]);
    });

    test("a month imported again replaces its figures; revert puts back what it held", async () => {
      const { id, stats } = await run([[deal.number, null, null, "2026-10", 150, 1500000, 120000, 1380000, 400, null]]);
      expect(stats).toMatchObject({ update: 1, create: 0 });
      expect((await as("ops").post(`/imports/${id}/commit`, {})).status).toBe(200);
      expect(await one("SELECT units_sold, downloads FROM deal_return WHERE deal_id = $1 AND month = '2026-10-01'", [deal.id])).toEqual({ units_sold: 150, downloads: 400 });
      const reverted = await as("ops").post(`/imports/${id}/revert`, {});
      expect([reverted.status, reverted.body.restored]).toEqual([200, 1]);
      expect(await one("SELECT units_sold, downloads FROM deal_return WHERE deal_id = $1 AND month = '2026-10-01'", [deal.id])).toEqual({ units_sold: 120, downloads: 340 });
    });

    test("the same figures again are unchanged; the returns are refused without the money", async () => {
      const { stats } = await run([[deal.number, null, null, "2026-10", 120, 1200000, 96000, 1104000, 340, "October"]]);
      expect(stats).toMatchObject({ unchanged: 1, update: 0 });
      expect((await as("john").get(`/partnerships/deals/${deal.id}/returns`)).status).toBe(403);
    });
  });
});
