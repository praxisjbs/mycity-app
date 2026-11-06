"use strict";
/**
 * Partnerships · Categories (M7 PR 2, docs/guides/partnerships.md §5, §6.3, §6.7, §6.8, §6.11) end to end
 * on the real migrations: who may configure, categories and their counts, MyCity's lists and the rules
 * that keep the pipeline whole, custom fields, the delivery checklist, agreement templates and their
 * wording, Tidy With AI (nothing kept until Use Draft), Start From Tracker on a synthetic workbook and
 * proof points with their images.
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test \
 *     npx jest tests/integration/partnerships-categories
 *
 * Every person, partner and workbook here is invented.
 */
const request = require("supertest");
const ExcelJS = require("exceljs");
const { config } = require("../../src/config/env");
const { pool } = require("../../src/config/db");
const { atomically } = require("../../src/shared/db/tx");

jest.mock("../../src/jobs/queues", () => ({
  enqueue: jest.fn(async () => ({ id: "1" })),
  getQueue: jest.fn(),
  closeQueues: jest.fn(async () => {}),
  DEFAULTS: {},
}));

const schema = require("./helpers/schema");
const { createAdmin } = require("../../scripts/db/create-admin");
const { buildApp } = require("../../src/app");
const outbox = require("../../src/shared/events/outbox");
const vault = require("../../src/shared/documents/vault");
const ai = require("../../src/services/ai/llm.service");
const drafts = require("../../src/services/ai/drafts");
const c = require("@mycity/contract");

const describeDb = String(config.DB_NAME || "").endsWith("_test") ? describe : describe.skip;

const q = (sql, params) => pool.query(sql, params);
const one = async (sql, params) => (await q(sql, params)).rows[0];

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

const OPS_PASSWORD = "Opera!ions2026";
const STAFF_PASSWORD = "Gr0wth!Pass2026";
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

const AGREEMENT = [
  "<h2>Deal Merchant Agreement</h2>",
  '<p>Date: <span data-field="today">{{ longdate today }}</span></p>',
  '<p>Business Name: <span data-field="partner.name">{{ partner.name }}</span></p>',
  '<p>Opening hours: <span data-field="ask.opening_hours">{{ ask.opening_hours }}</span></p>',
  "<p>Financials:</p>",
  '<p><span data-field="deal.options">{{ deal.options }}</span></p>',
  "<ol><li>Event registration and check-in on MyCityApp, with our team supporting the setup.</li><li>Amplification across MyCity's channels.</li></ol>",
].join("");

const ASKS = [{ key: "opening_hours", label: "Opening Hours", type: "text", default: "24hrs" }];

/** The synthetic tracker: the real headers and dropdowns, invented rows (guide §6.13). */
async function trackerWorkbook() {
  const wb = new ExcelJS.Workbook();
  const lists = wb.addWorksheet("Lists");
  const stages = [
    "Prospect Identified",
    "Initial Contact",
    "Introductory Meeting Scheduled",
    "Introductory Meeting Held",
    "Proposal Sent",
    "Follow-up Ongoing",
    "Negotiation",
    "Verbal Approval",
    "Contract Review",
    "Partnership Signed",
    "Active Partnership",
    "Closed Lost",
    "On Hold",
  ];
  stages.forEach((s, i) => (lists.getCell(i + 1, 1).value = s));
  const ws = wb.addWorksheet("Master Tracker");
  ws.getRow(1).values = ["MyCity Partnership Tracker"];
  ws.getRow(2).values = ["S/N", "Partner Name", "Partnership Type", "Partnership Stage", "Potential Impact", "Current Stage", "Status"];
  ws.getRow(3).values = [1, "Eko Arts Fair", "Event", "Prospect Identified", "Brand Visibility", "Sealed", "On Track"];
  for (let r = 3; r <= 40; r += 1) {
    ws.getCell(`C${r}`).dataValidation = { type: "list", allowBlank: true, formulae: ['"Event,Hospitality,Vendor,Media,Ticketing (exclusive) 8% commission"'] };
    ws.getCell(`D${r}`).dataValidation = { type: "list", allowBlank: true, formulae: ["Lists!$A$1:$A$13"] };
    ws.getCell(`E${r}`).dataValidation = { type: "list", allowBlank: true, formulae: ['"App Downloads & Visibility,Revenue Generation,Brand Visibility"'] };
    ws.getCell(`G${r}`).dataValidation = { type: "list", allowBlank: true, formulae: ['"On Track,Follow-up Required,Stalled"'] };
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describeDb("Partnerships · Categories against the real migrations", () => {
  let app;
  const tokens = {};
  const auth = (token) => (r) => r.set("Authorization", `Bearer ${token}`);
  const asOps = () => auth(tokens.ops);
  const asStaff = () => auth(tokens.staff);
  const api = (path) => `/api/v1/partnerships${path}`;
  const ops = (method, path) => asOps()(request(app)[method](api(path)));

  /** The first-time setup MyCity does: the three stages the pipeline cannot do without. */
  const stageList = async () => {
    for (const [label, meaning] of [
      ["Prospect Identified", "prospect"],
      ["Proposal Sent", "proposal"],
      ["Partnership Signed", "signed"],
      ["Closed Lost", "closed_lost"],
    ]) {
      const res = await ops("post", "/lists/partnership_stage").send({ label, meaning });
      expect(res.status).toBe(201);
    }
  };

  beforeAll(async () => {
    await schema.rebuild(pool, config.DB_NAME);
    outbox.markReady();
    ({ app } = buildApp({ strict: true, accessLog: false }));
    const sample = (first, last, email, job) => ({
      first_name: first,
      last_name: last,
      work_email: email,
      phone: "08031234567",
      job_title: job,
      department_name: "Partnerships",
      start_date: "2026-01-05",
      employment_type: "full_time",
      work_pattern: "remote",
    });
    await tx(async (client) => {
      await createAdmin(client, { employee: sample("Ada", "Obi", "ops@cat.test", "Operations & People Lead"), role_code: "operations_people", is_ceo: false }, OPS_PASSWORD);
      await createAdmin(client, { employee: sample("Uche", "Eze", "staff@cat.test", "Growth Officer"), role_code: "employee", is_ceo: false }, STAFF_PASSWORD);
    });
    for (const [key, email, password, ip] of [
      ["ops", "ops@cat.test", OPS_PASSWORD, 1],
      ["staff", "staff@cat.test", STAFF_PASSWORD, 2],
    ]) {
      const res = await request(app).post("/api/v1/auth/login").set("X-Forwarded-For", `10.50.0.${ip}`).send({ email, password });
      expect(res.status).toBe(200);
      tokens[key] = res.body.access_token;
    }
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await require("../../src/shared/observability/error-reporter").flush();
    await pool.end();
  });

  /* ---------------------------------------------------------------- */

  test("anyone who may open Partnerships reads; only a holder of partnerships.configure writes", async () => {
    expect((await asStaff()(request(app).get(api("/categories")))).status).toBe(200);
    const refused = await asStaff()(request(app).post(api("/categories"))).send({ name: "Event" });
    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe("CAPABILITY_REQUIRED");
    const made = await ops("post", "/categories").send({ name: "Event" });
    expect(made.status).toBe(201);
  });

  test("a category is added, found, changed, retired and restored; its name is one spelling; counts come with it", async () => {
    const hotel = await ops("post", "/categories").send({ name: "Hospitality", default_commission_pct: "8", default_validity_days: 60, counts_as_vendor: true });
    expect(hotel.status).toBe(201);
    expect(c.partner_pipeline.CategoryDetail.safeParse(hotel.body).success).toBe(true);
    expect(hotel.body).toMatchObject({ name: "Hospitality", default_commission_pct: "8.00", default_validity_days: 60, counts_as_vendor: true, active: true });
    expect(hotel.body.counts).toEqual({ partners: 0, leads: 0, open_deals: 0 });

    const twice = await ops("post", "/categories").send({ name: "hospitality" });
    expect(twice.status).toBe(409);
    expect(twice.body.error.fields.name).toBeTruthy();

    const id = hotel.body.partner_category_id;
    const renamed = await ops("patch", `/categories/${id}`).send({ name: "Hotels", default_commission_pct: "10.5" });
    expect(renamed.body).toMatchObject({ name: "Hotels", default_commission_pct: "10.50" });
    expect((await ops("patch", `/categories/${id}`).send({ name: "Event" })).status).toBe(409);

    const retired = await ops("patch", `/categories/${id}`).send({ active: false });
    expect(retired.body.active).toBe(false);
    const onlyActive = await ops("get", "/categories?active=true");
    expect(c.partner_pipeline.CategoryPage.safeParse(onlyActive.body).success).toBe(true);
    expect(onlyActive.body.page.size).toBe(25);
    expect(onlyActive.body.data.map((x) => x.name)).not.toContain("Hotels");
    expect((await ops("patch", `/categories/${id}`).send({ active: true })).body.active).toBe(true);

    const found = await ops("get", "/categories?q=hotel");
    expect(found.body.data.map((x) => x.name)).toEqual(["Hotels"]);
    await q("INSERT INTO lead (number, name, partner_category_id) VALUES ('LED-C1', 'Kano Fair', $1)", [id]);
    expect((await ops("get", `/categories/${id}`)).body.counts.leads).toBe(1);
    expect((await ops("get", "/categories?q=hotel")).body.data[0]).toMatchObject({ partners: 0, leads: 1 });
    const none = await ops("patch", `/categories/${id}`).send({});
    expect(none.status).toBe(422);
  });

  /* ---------------------------------------------------------------- */

  test("a stage needs what it counts as; the other lists take none; a list keeps a start, a signing and a loss", async () => {
    const noMeaning = await ops("post", "/lists/partnership_stage").send({ label: "Prospect Identified" });
    expect(noMeaning.status).toBe(422);
    expect(noMeaning.body.error.fields.meaning).toBeTruthy();
    const source = await ops("post", "/lists/lead_source").send({ label: "Meaning", meaning: "prospect" });
    expect(source.status).toBe(422);

    await stageList();
    const stages = await ops("get", "/lists/partnership_stage");
    expect(c.partner_pipeline.ListValues.safeParse(stages.body).success).toBe(true);
    const active = stages.body.values.filter((v) => v.active);
    expect(active.map((v) => [v.label, v.meaning])).toEqual([
      ["Prospect Identified", "prospect"],
      ["Proposal Sent", "proposal"],
      ["Partnership Signed", "signed"],
      ["Closed Lost", "closed_lost"],
    ]);
    expect(active.map((v) => v.position)).toEqual([...active.map((v) => v.position)].sort((a, b) => a - b));
    expect((await ops("post", "/lists/partnership_stage").send({ label: "proposal sent", meaning: "proposal" })).status).toBe(409);

    // The only stage that signs cannot retire or change what it counts as.
    const lastSigned = await ops("patch", "/lists/partnership_stage/partnership_signed").send({ active: false });
    expect(lastSigned.status).toBe(409);
    expect(lastSigned.body.error.code).toBe("STAGE_LAST_OF_MEANING");
    expect((await ops("patch", "/lists/partnership_stage/partnership_signed").send({ meaning: "active" })).status).toBe(409);
    // Renamed, it is still the stage; a second signing stage frees the first.
    expect((await ops("patch", "/lists/partnership_stage/partnership_signed").send({ label: "Signed" })).status).toBe(200);
    await ops("post", "/lists/partnership_stage").send({ label: "Contract Signed", meaning: "signed" });
    expect((await ops("patch", "/lists/partnership_stage/partnership_signed").send({ active: false })).status).toBe(200);

    // A stage no deal is at, other than a required kind, retires freely; one a deal is at does not while it is the last.
    await ops("post", "/lists/partnership_stage").send({ label: "Negotiation", meaning: "negotiation" });
    const partnerId = (await one("INSERT INTO partner (number, name) VALUES ('PAR-C1', 'Eko Arts') RETURNING partner_id")).partner_id;
    await q("INSERT INTO partnership_opportunity (number, partner_id, title, stage, status) VALUES ('DEAL-C1', $1, 'A deal', 'negotiation_2', 'open')", [partnerId]);
    // 7099's retired Negotiation holds the plain code, so MyCity's own is negotiation_2.
    const inUse = await ops("patch", "/lists/partnership_stage/negotiation_2").send({ active: false });
    expect(inUse.status).toBe(409);
    expect(inUse.body.error.code).toBe("STAGE_IN_USE");
    await q("DELETE FROM partnership_opportunity WHERE number = 'DEAL-C1'");
    expect((await ops("patch", "/lists/partnership_stage/negotiation_2").send({ active: false })).status).toBe(200);
    expect((await ops("patch", "/lists/partnership_stage/negotiation_2").send({ active: true, position: 5 })).status).toBe(200);

    const impact = await ops("post", "/lists/partnership_impact").send({ label: "Brand Visibility" });
    expect(impact.status).toBe(201);
    expect(impact.body.values.find((v) => v.label === "Brand Visibility").meaning).toBeNull();
  });

  /* ---------------------------------------------------------------- */

  test("a custom field gets its key from its label once; a pick needs choices; retiring keeps it listed", async () => {
    const cat = (await ops("post", "/categories").send({ name: "Ticketing" })).body;
    const text = await ops("post", "/fields").send({ label: "Ticketing Terms", field_type: "text", applies_to: "deal", partner_category_id: cat.partner_category_id, filterable: true });
    expect(text.status).toBe(201);
    expect(c.partner_pipeline.Field.safeParse(text.body).success).toBe(true);
    expect(text.body).toMatchObject({ key: "ticketing_terms", field_type: "text", filterable: true, active: true });
    const again = await ops("post", "/fields").send({ label: "Ticketing Terms", field_type: "text", applies_to: "lead" });
    expect(again.body.key).toBe("ticketing_terms_2");
    const noChoices = await ops("post", "/fields").send({ label: "Tier", field_type: "pick", applies_to: "deal" });
    expect(noChoices.status).toBe(422);
    const pick = await ops("post", "/fields").send({ label: "Tier", field_type: "pick", applies_to: "deal", options: ["Gold", "Silver"] });
    expect(pick.body.options).toEqual(["Gold", "Silver"]);
    expect((await ops("post", "/fields").send({ label: "Note", field_type: "text", applies_to: "deal", options: ["x"] })).status).toBe(422);
    expect((await ops("patch", `/fields/${text.body.partnership_field_id}`).send({ options: ["x"] })).status).toBe(422);

    const detail = await ops("get", `/categories/${cat.partner_category_id}`);
    expect(detail.body.fields.map((f) => f.key)).toEqual(expect.arrayContaining(["ticketing_terms", "tier"]));
    const retired = await ops("patch", `/fields/${text.body.partnership_field_id}`).send({ active: false, label: "Terms" });
    expect(retired.body).toMatchObject({ key: "ticketing_terms", label: "Terms", active: false });
    const listed = await ops("get", `/fields?partner_category_id=${cat.partner_category_id}&active=false`);
    expect(c.partner_pipeline.FieldList.safeParse(listed.body).success).toBe(true);
    expect(listed.body.data.map((f) => f.key)).toEqual(["ticketing_terms"]);
  });

  test("custom values are checked by their field's type", () => {
    const { checkValue } = require("../../src/modules/partner_pipeline/partner_pipeline.fields");
    const f = (field_type, options = null) => ({ key: "x", label: "X", field_type, options });
    expect(checkValue(f("money"), "1250000")).toBe("1250000.00");
    expect(() => checkValue(f("money"), "lots")).toThrow(/Not an amount/);
    expect(checkValue(f("number"), "12")).toBe(12);
    expect(() => checkValue(f("number"), "twelve")).toThrow();
    expect(checkValue(f("date"), "2026-11-26")).toBe("2026-11-26");
    expect(() => checkValue(f("date"), "2026-02-30")).toThrow(/real date/);
    expect(checkValue(f("yes_no"), true)).toBe(true);
    expect(() => checkValue(f("yes_no"), "yes")).toThrow();
    expect(checkValue(f("pick", ["A", "B"]), "A")).toBe("A");
    expect(() => checkValue(f("pick", ["A", "B"]), "C")).toThrow();
    expect(checkValue(f("multi_pick", ["A", "B"]), ["A", "A", "B"])).toEqual(["A", "B"]);
    expect(() => checkValue(f("url"), "mycity")).toThrow(/link/);
    expect(checkValue(f("text"), "  hello ")).toBe("hello");
    expect(checkValue(f("text"), "")).toBeNull();
  });

  /* ---------------------------------------------------------------- */

  test("the delivery checklist is ordered, moved and retired; a retired item keeps no place", async () => {
    const cat = (await ops("post", "/categories").send({ name: "Delivery" })).body;
    const id = cat.partner_category_id;
    const add = (title, extra = {}) => ops("post", `/categories/${id}/checklist`).send({ title, due_from: "signing", due_days: 7, ...extra });
    await add("Event registration and check-in");
    await add("Amplification across channels");
    const third = await add("On-ground documentation", { due_from: "event_start", due_days: 3 });
    expect(third.status).toBe(201);
    expect(c.partner_pipeline.CategoryDetail.safeParse(third.body).success).toBe(true);
    const titles = (body) => body.checklist.filter((i) => i.active).map((i) => i.title);
    expect(titles(third.body)).toEqual(["Event registration and check-in", "Amplification across channels", "On-ground documentation"]);
    expect(third.body.checklist[2]).toMatchObject({ due_from: "event_start", due_days: 3 });

    const last = third.body.checklist[2].partner_category_checklist_item_id;
    const up = await ops("patch", `/checklist-items/${last}`).send({ position: 1 });
    expect(titles(up.body)).toEqual(["Event registration and check-in", "On-ground documentation", "Amplification across channels"]);
    expect(up.body.checklist.map((i) => i.position)).toEqual([0, 1, 2]);

    const first = up.body.checklist[0].partner_category_checklist_item_id;
    const retired = await ops("patch", `/checklist-items/${first}`).send({ active: false });
    expect(titles(retired.body)).toEqual(["On-ground documentation", "Amplification across channels"]);
    expect(retired.body.checklist.find((i) => i.partner_category_checklist_item_id === first).active).toBe(false);
    const back = await ops("patch", `/checklist-items/${first}`).send({ active: true });
    expect(titles(back.body)).toEqual(["On-ground documentation", "Amplification across channels", "Event registration and check-in"]);
    expect((await add("Hi")).status).toBe(422);
  });

  /* ---------------------------------------------------------------- */

  describe("agreement templates", () => {
    let category;
    let template;

    test("a template is saved with its wording; the first of a kind is its default", async () => {
      category = (await ops("post", "/categories").send({ name: "Events" })).body;
      const made = await ops("post", `/categories/${category.partner_category_id}/templates`).send({
        kind: "deal_merchant",
        label: "Deal Merchant Agreement",
        title: "Deal Merchant Agreement",
        countersigned: true,
        body_html: AGREEMENT,
        asks: ASKS,
      });
      expect(made.status).toBe(201);
      expect(c.partner_pipeline.CategoryDetail.safeParse(made.body).success).toBe(true);
      template = made.body.templates[0];
      expect(template).toMatchObject({ kind: "deal_merchant", label: "Deal Merchant Agreement", is_default: true, countersigned: true, active: true, version: 1, asks: ASKS });
      expect(template.template_key).toBe("events-deal-merchant-agreement");
      expect((await one("SELECT body, format FROM template_version WHERE key = $1", [template.template_key])).format).toBe("markdown");
    });

    test("the editor gets the wording back with a chip for every field, and the record fields to offer", async () => {
      const res = await ops("get", `/category-templates/${template.partner_category_template_id}`);
      expect(res.status).toBe(200);
      expect(c.partner_pipeline.CategoryTemplateDetail.safeParse(res.body).success).toBe(true);
      expect(res.body.version).toBe(1);
      expect(res.body.title).toBe("Deal Merchant Agreement");
      expect(res.body.body_html).toContain('<span data-field="partner.name" data-label="Business Name">{{ partner.name }}</span>');
      expect(res.body.body_html).toContain('data-field="ask.opening_hours" data-label="Opening Hours"');
      expect(res.body.body_html).toContain('data-field="today" data-label="Date">{{ longdate today }}');
      expect(res.body.body_html).toContain("<ol><li>");
      expect(res.body.record_fields.map((f) => f.field)).toEqual(expect.arrayContaining(["partner.name", "deal.options", "category.checklist", "signer.signature"]));
    });

    test("wording that names what the agreement cannot fill is refused, naming it", async () => {
      const bad = await ops("put", `/category-templates/${template.partner_category_template_id}/wording`).send({
        body_html: `${AGREEMENT}<p>{{ partner.nickname }}</p>`,
      });
      expect(bad.status).toBe(422);
      expect(bad.body.error.code).toBe("TEMPLATE_UNKNOWN_VARIABLE");
      expect(bad.body.error.fields.body_html[0]).toMatch(/partner\.nickname/);
      const noAsk = await ops("put", `/category-templates/${template.partner_category_template_id}/wording`).send({ body_html: `${AGREEMENT}<p>{{ ask.bank_name }}</p>` });
      expect(noAsk.status).toBe(422);
      const unknownRoot = await ops("put", `/category-templates/${template.partner_category_template_id}/wording`).send({ body_html: `${AGREEMENT}<p>{{ employee.salary }}</p>` });
      expect(unknownRoot.status).toBe(422);
      const twice = await ops("put", `/category-templates/${template.partner_category_template_id}/wording`).send({
        body_html: AGREEMENT,
        asks: [...ASKS, ...ASKS],
      });
      expect(twice.status).toBe(422);
      expect((await one("SELECT count(*)::int AS n FROM template_version WHERE key = $1", [template.template_key])).n).toBe(1);
    });

    test("a custom field of the category can be named; one of another category cannot", async () => {
      const field = (await ops("post", "/fields").send({ label: "Exclusive Terms", field_type: "text", applies_to: "deal", partner_category_id: category.partner_category_id })).body;
      const other = (await ops("post", "/categories").send({ name: "Media" })).body;
      const elsewhere = (await ops("post", "/fields").send({ label: "Media Slot", field_type: "text", applies_to: "deal", partner_category_id: other.partner_category_id })).body;
      const ok = await ops("put", `/category-templates/${template.partner_category_template_id}/wording`).send({
        body_html: `${AGREEMENT}<p>Terms: {{ custom.${field.key} }}</p><table><tbody><tr><th>Item</th><th>Amount</th></tr><tr><td>Fee</td><td>{{ money deal.title }}</td></tr></tbody></table>`,
      });
      expect(ok.status).toBe(200);
      expect(ok.body.version).toBe(2);
      expect(ok.body.body_html).toContain("<table>");
      expect(ok.body.body_html).toContain('data-label="Exclusive Terms"');
      const kept = (await one("SELECT body FROM template_version WHERE key = $1 AND version = 2", [template.template_key])).body;
      expect(kept).toContain("| Item | Amount |");
      const refused = await ops("put", `/category-templates/${template.partner_category_template_id}/wording`).send({
        body_html: `${AGREEMENT}<p>{{ custom.${elsewhere.key} }}</p>`,
      });
      expect(refused.status).toBe(422);
      // The wording alone was saved: the asks stay when the request names none.
      expect((await ops("get", `/category-templates/${template.partner_category_template_id}`)).body.asks).toEqual(ASKS);
    });

    test("one default a kind: a second template can take it; retiring the default hands the kind on", async () => {
      const id = category.partner_category_id;
      const second = await ops("post", `/categories/${id}/templates`).send({ kind: "deal_merchant", label: "Ticketing Agreement", body_html: AGREEMENT, asks: ASKS, is_default: true });
      expect(second.status).toBe(201);
      const byLabel = (body) => Object.fromEntries(body.templates.map((t) => [t.label, t]));
      expect(byLabel(second.body)["Ticketing Agreement"].is_default).toBe(true);
      expect(byLabel(second.body)["Deal Merchant Agreement"].is_default).toBe(false);
      expect(second.body.templates.filter((t) => t.is_default)).toHaveLength(1);
      expect(second.body.templates.find((t) => t.label === "Ticketing Agreement").template_key).toBe("events-ticketing-agreement");

      const mou = await ops("post", `/categories/${id}/templates`).send({ kind: "mou", label: "Events MOU", body_html: AGREEMENT, asks: ASKS });
      expect(byLabel(mou.body)["Events MOU"].is_default).toBe(true);

      const ticketing = byLabel(mou.body)["Ticketing Agreement"].partner_category_template_id;
      const retired = await ops("patch", `/category-templates/${ticketing}`).send({ active: false });
      expect(byLabel(retired.body)["Ticketing Agreement"]).toMatchObject({ active: false, is_default: false });
      expect(byLabel(retired.body)["Deal Merchant Agreement"].is_default).toBe(true);
      expect((await ops("put", `/category-templates/${ticketing}/wording`).send({ body_html: AGREEMENT })).status).toBe(409);
      const renamed = await ops("patch", `/category-templates/${template.partner_category_template_id}`).send({ label: "Merchant Agreement", countersigned: false });
      expect(byLabel(renamed.body)["Merchant Agreement"]).toMatchObject({ countersigned: false, is_default: true });
    });

    test("a retired category takes no new template; a key cannot be a letter's or a shipped one", async () => {
      const gone = (await ops("post", "/categories").send({ name: "Gone" })).body;
      await ops("patch", `/categories/${gone.partner_category_id}`).send({ active: false });
      expect((await ops("post", `/categories/${gone.partner_category_id}/templates`).send({ kind: "mou", label: "X", body_html: AGREEMENT, asks: ASKS })).status).toBe(409);
      const shipped = await ops("post", `/categories/${category.partner_category_id}/templates`).send({ template_key: "query-letter", kind: "contract", label: "Contract", body_html: AGREEMENT, asks: ASKS });
      expect(shipped.status).toBe(409);
      const named = await ops("post", `/categories/${category.partner_category_id}/templates`).send({ template_key: "events-contract", kind: "contract", label: "Contract", body_html: AGREEMENT, asks: ASKS });
      expect(named.status).toBe(201);
    });
  });

  /* ---------------------------------------------------------------- */

  describe("Tidy With AI", () => {
    const text = "Deal Merchant Agreement\n\nBusiness Name: Eko Arts Fair\n\nOpening hours: 24hrs\n\n1. Event registration and check-in.\n2. Amplification across our channels.";
    const answer = {
      body_markdown: "## Deal Merchant Agreement\n\nBusiness Name: {{ partner.name }}\n\nOpening hours: {{ ask.opening_hours }}\n\n1. Event registration and check-in.\n2. Amplification across our channels.",
      fields: [
        { found: "Eko Arts Fair", field: "partner.name", source: "record", label: "Business Name", ask_type: null },
        { found: "24hrs", field: "ask.opening_hours", source: "ask", label: "Opening Hours", ask_type: "text" },
      ],
    };
    const versions = async () => (await one("SELECT count(*)::int AS n FROM template_version WHERE kind = 'document' AND key LIKE 'events-%'")).n;
    const asks = [];

    afterEach(() => jest.restoreAllMocks());

    test("the draft comes back with its fields as chips; nothing is kept", async () => {
      jest.spyOn(drafts, "availability").mockResolvedValue({ available: true, reason: null });
      const complete = jest.spyOn(ai, "complete").mockResolvedValue({ output: answer, run_id: "7b9f3c1e-0c3a-4f55-9a52-2a4c9c0f9e11" });
      const before = await versions();
      const res = await ops("post", "/templates/tidy").send({ text, kind: "deal_merchant" });
      expect(res.status).toBe(200);
      expect(c.partner_pipeline.TemplateTidyDraft.safeParse(res.body).success).toBe(true);
      expect(res.body).toMatchObject({ available: true, reason: null, ai_run_id: "7b9f3c1e-0c3a-4f55-9a52-2a4c9c0f9e11" });
      expect(res.body.body_html).toContain('<span data-field="partner.name" data-label="Business Name">{{ partner.name }}</span>');
      expect(res.body.body_html).toContain('data-field="ask.opening_hours" data-label="Opening Hours"');
      expect(res.body.fields.map((f) => f.field)).toEqual(["partner.name", "ask.opening_hours"]);
      expect(complete).toHaveBeenCalledWith(expect.objectContaining({ purpose: "template-tidy", module: "partnerships", egress: "external" }));
      expect(await versions()).toBe(before);
      asks.push(...res.body.fields.filter((f) => f.source === "ask"));
    });

    test("the pasted contact details never reach the model", async () => {
      jest.spyOn(drafts, "availability").mockResolvedValue({ available: true, reason: null });
      const complete = jest.spyOn(ai, "complete").mockResolvedValue({ output: { body_markdown: "Call KEPT001 today.", fields: [] }, run_id: null });
      await ops("post", "/templates/tidy").send({ text: "Call 08031234567 today." });
      expect(JSON.stringify(complete.mock.calls[0][0].input)).not.toContain("08031234567");
    });

    test("an answer that changed a word is refused, never shown", async () => {
      jest.spyOn(drafts, "availability").mockResolvedValue({ available: true, reason: null });
      jest.spyOn(ai, "complete").mockResolvedValue({ output: { ...answer, body_markdown: answer.body_markdown.replace("Amplification across our channels", "Amplification everywhere") }, run_id: null });
      const res = await ops("post", "/templates/tidy").send({ text });
      expect(res.status).toBe(502);
      expect(res.body.error.code).toBe("AI_CHANGED_WORDS");
    });

    test("AI off, or its limit reached, says so and the editor works as before", async () => {
      jest.spyOn(drafts, "availability").mockResolvedValue({ available: false, reason: "off" });
      const complete = jest.spyOn(ai, "complete");
      const off = await ops("post", "/templates/tidy").send({ text });
      expect(off.status).toBe(200);
      expect(off.body).toMatchObject({ available: false, reason: "off", body_html: null, fields: [] });
      expect(complete).not.toHaveBeenCalled();
      jest.spyOn(drafts, "availability").mockResolvedValue({ available: true, reason: null });
      complete.mockRejectedValue(Object.assign(new (require("../../src/shared/errors").AppError)("AI_CAP_REACHED", "cap", 429), {}));
      const limit = await ops("post", "/templates/tidy").send({ text });
      expect(limit.body).toMatchObject({ available: false, reason: "limit" });
    });

    test("the draft is saved only by Use Draft: the editor's save, with the fields as asks", async () => {
      const cat = (await ops("post", "/categories").send({ name: "Tidy Events" })).body;
      const saved = await ops("post", `/categories/${cat.partner_category_id}/templates`).send({
        kind: "deal_merchant",
        label: "From Word",
        body_html: '<h2>Deal Merchant Agreement</h2><p>Business Name: <span data-field="partner.name">{{ partner.name }}</span></p><p>Opening hours: <span data-field="ask.opening_hours">{{ ask.opening_hours }}</span></p><ol><li>Event registration and check-in.</li><li>Amplification across our channels.</li></ol>',
        asks: asks.map((a) => ({ key: a.field.slice(4), label: a.label, type: a.ask_type })),
      });
      expect(saved.status).toBe(201);
      expect(saved.body.templates[0].asks).toEqual([{ key: "opening_hours", label: "Opening Hours", type: "text" }]);
    });

    test("the tidy needs the same grant as the editor", async () => {
      expect((await asStaff()(request(app).post(api("/templates/tidy"))).send({ text })).status).toBe(403);
    });
  });

  /* ---------------------------------------------------------------- */

  describe("Start From Tracker", () => {
    const upload = async (buffer, name = "tracker.xlsx") => {
      const res = await asOps()(request(app).post("/api/v1/documents")).field("purpose", "attachment").attach("file", buffer, name);
      expect(res.status).toBe(201);
      return res.body.document_id;
    };

    test("the workbook's dropdowns become stages with a suggested meaning, types and impacts", async () => {
      const document_id = await upload(await trackerWorkbook());
      const res = await ops("post", "/setup/from-tracker").send({ document_id });
      expect(res.status).toBe(200);
      expect(c.partner_pipeline.TrackerSetupDraft.safeParse(res.body).success).toBe(true);
      expect(res.body.stages.map((s) => [s.label, s.meaning])).toEqual([
        ["Prospect Identified", "prospect"],
        ["Initial Contact", "contacted"],
        ["Introductory Meeting Scheduled", "meeting"],
        ["Introductory Meeting Held", "meeting"],
        ["Proposal Sent", "proposal"],
        ["Follow-up Ongoing", "proposal"],
        ["Negotiation", "negotiation"],
        ["Verbal Approval", "negotiation"],
        ["Contract Review", "negotiation"],
        ["Partnership Signed", "signed"],
        ["Active Partnership", "active"],
        ["Closed Lost", "closed_lost"],
        ["On Hold", "on_hold"],
      ]);
      expect(res.body.categories).toEqual([
        { name: "Event" },
        { name: "Hospitality" },
        { name: "Vendor" },
        { name: "Media" },
        { name: "Ticketing (exclusive)", default_commission_pct: "8" },
      ]);
      expect(res.body.impact.map((i) => i.label)).toEqual(["App Downloads & Visibility", "Revenue Generation", "Brand Visibility"]);
    });

    test("applied as corrected, it adds what is missing and leaves what MyCity has; the stages must be whole", async () => {
      const document_id = await upload(await trackerWorkbook());
      const draft = (await ops("post", "/setup/from-tracker").send({ document_id })).body;
      const before = (await ops("get", "/lists/partnership_stage")).body.values.length;
      const fixed = { ...draft, stages: draft.stages.map((s) => (s.label === "On Hold" ? { ...s, meaning: "on_hold" } : s)) };
      const applied = await ops("post", "/setup/from-tracker/apply").send(fixed);
      expect(applied.status).toBe(200);
      expect(c.partner_pipeline.SetupResult.safeParse(applied.body).success).toBe(true);
      const after = (await ops("get", "/lists/partnership_stage")).body.values;
      // Prospect Identified, Proposal Sent, Negotiation and Closed Lost were already MyCity's own (Partnership
      // Signed was renamed Signed): four of the thirteen are left alone.
      expect(applied.body.stages).toBe(13 - 4);
      expect(after.length).toBe(before + 13 - 4);
      expect(after.find((s) => s.label === "Partnership Signed")).toMatchObject({ meaning: "signed", active: true });
      const impact = (await ops("get", "/lists/partnership_impact")).body.values.filter((v) => v.active);
      expect(impact.map((v) => v.label)).toEqual(expect.arrayContaining(["Revenue Generation", "App Downloads & Visibility"]));
      const cats = (await ops("get", "/categories")).body.data.map((x) => x.name);
      expect(cats).toEqual(expect.arrayContaining(["Hospitality", "Vendor", "Ticketing (exclusive)"]));
      expect((await one("SELECT default_commission_pct::text AS p FROM partner_category WHERE name = 'Ticketing (exclusive)'")).p).toBe("8.00");
      // Again: nothing new.
      expect((await ops("post", "/setup/from-tracker/apply").send(fixed)).body).toEqual({ stages: 0, categories: 0, impact: 0 });
    });

    test("a list without a stage that signs is refused whole", async () => {
      const refused = await ops("post", "/setup/from-tracker/apply").send({
        stages: [{ label: "Spare Stage", meaning: "meeting" }],
        categories: [{ name: "Not Made" }],
        impact: [],
      });
      expect(refused.status).toBe(200);
      // The pipeline is already whole from the earlier setup, so a spare stage is only added.
      await q("UPDATE reference_value SET active = false WHERE domain = 'partnership_stage' AND metadata ->> 'meaning' = 'closed_lost'");
      const incomplete = await ops("post", "/setup/from-tracker/apply").send({ stages: [{ label: "Another Stage", meaning: "meeting" }], categories: [{ name: "Rolled Back" }], impact: [] });
      expect(incomplete.status).toBe(422);
      expect(incomplete.body.error.code).toBe("STAGES_INCOMPLETE");
      expect((await ops("get", "/categories?q=rolled")).body.data).toHaveLength(0);
      expect((await ops("get", "/lists/partnership_stage")).body.values.map((v) => v.label)).not.toContain("Another Stage");
      await q("UPDATE reference_value SET active = true WHERE domain = 'partnership_stage' AND metadata ->> 'meaning' = 'closed_lost'");
    });

    test("a workbook with no dropdowns, another person's file and a missing file are refused", async () => {
      const wb = new ExcelJS.Workbook();
      wb.addWorksheet("Plain").getRow(1).values = ["Partner Name"];
      const plain = await upload(Buffer.from(await wb.xlsx.writeBuffer()), "plain.xlsx");
      const none = await ops("post", "/setup/from-tracker").send({ document_id: plain });
      expect(none.status).toBe(422);
      expect(none.body.error.code).toBe("TRACKER_NO_DROPDOWNS");
      const theirs = (await asStaff()(request(app).post("/api/v1/documents")).field("purpose", "attachment").attach("file", await trackerWorkbook(), "t.xlsx")).body.document_id;
      expect((await ops("post", "/setup/from-tracker").send({ document_id: theirs })).status).toBe(404);
      expect((await ops("post", "/setup/from-tracker").send({ document_id: "7b9f3c1e-0c3a-4f55-9a52-2a4c9c0f9e11" })).status).toBe(404);
    });
  });

  /* ---------------------------------------------------------------- */

  describe("proof points", () => {
    let point;

    test("MyCity's facts are added, found and changed; none is seeded", async () => {
      expect((await ops("get", "/proof-points")).body.data).toEqual([]);
      const made = await ops("post", "/proof-points").send({ kind: "stat", label: "Network and community", value: "10,000+", source_note: "Growth team, November 2026" });
      expect(made.status).toBe(201);
      expect(c.proposals.ProofPoint.safeParse(made.body).success).toBe(true);
      point = made.body;
      expect(point).toMatchObject({ kind: "stat", label: "Network and community", value: "10,000+", document: null, active: true });
      await ops("post", "/proof-points").send({ kind: "endorsement", label: "Ember to Remember", detail: "The national content calendar" });
      const page = await ops("get", "/proof-points");
      expect(c.proposals.ProofPointPage.safeParse(page.body).success).toBe(true);
      expect(page.body.page.size).toBe(25);
      expect(page.body.data.map((p) => p.label)).toEqual(["Network and community", "Ember to Remember"]);
      expect((await ops("get", "/proof-points?kind=endorsement")).body.data).toHaveLength(1);
      expect((await ops("get", "/proof-points?q=ember")).body.data).toHaveLength(1);
      const edited = await ops("patch", `/proof-points/${point.proof_point_id}`).send({ value: "12,000+", position: 5 });
      expect(edited.body).toMatchObject({ value: "12,000+", position: 5 });
      expect((await ops("patch", `/proof-points/${point.proof_point_id}`).send({ active: false })).body.active).toBe(false);
      expect((await ops("get", "/proof-points?active=true")).body.data).toHaveLength(1);
      await ops("patch", `/proof-points/${point.proof_point_id}`).send({ active: true });
    });

    test("its picture is uploaded to it and read by whoever may open Partnerships, no one else", async () => {
      const res = await asOps()(request(app).post(api(`/proof-points/${point.proof_point_id}/image`))).attach("file", PNG, "logo.png");
      expect(res.status).toBe(200);
      expect(res.body.document).toMatchObject({ file_name: "logo.png", mime_type: "image/png" });
      const doc = await vault.get(pool, res.body.document.document_id);
      expect(doc).toMatchObject({ entity_type: "proof_point", entity_id: point.proof_point_id, doc_type: "proof_point_image" });
      const staff = await asStaff()(request(app).get(`/api/v1/documents/${doc.document_id}`));
      expect(staff.status).toBe(200);
      const nobody = { user_id: "00000000-0000-4000-8000-000000000001", role_ids: [], is_ceo: false };
      expect(await vault.canRead(pool, nobody, doc)).toBe(false);
      const removed = await ops("patch", `/proof-points/${point.proof_point_id}`).send({ document_id: null });
      expect(removed.body.document).toBeNull();
      expect((await asStaff()(request(app).post(api(`/proof-points/${point.proof_point_id}/image`))).attach("file", PNG, "logo.png")).status).toBe(403);
      expect((await asOps()(request(app).post(api(`/proof-points/${point.proof_point_id}/image`)))).status).toBe(422);
    });

    test("only a holder of partnerships.configure writes them", async () => {
      expect((await asStaff()(request(app).post(api("/proof-points"))).send({ kind: "stat", label: "Reach" })).status).toBe(403);
      expect((await asStaff()(request(app).get(api("/proof-points")))).status).toBe(200);
    });
  });

  test("a change to categories is audited", async () => {
    const { rows } = await q("SELECT DISTINCT event_key FROM event_log WHERE event_key LIKE 'category.%' OR event_key LIKE 'list_value.%' OR event_key LIKE 'partnership_field.%' OR event_key LIKE 'proof_point.%' ORDER BY 1");
    expect(rows.map((r) => r.event_key)).toEqual(
      expect.arrayContaining(["category.created", "category.updated", "category.template_added", "category.template_saved", "category.checklist_item_added", "list_value.created", "partnership_field.created", "proof_point.created"]),
    );
    expect((await one("SELECT count(*)::int AS n FROM audit_ledger WHERE module_key = 'partnerships'")).n).toBeGreaterThan(10);
  });
});
