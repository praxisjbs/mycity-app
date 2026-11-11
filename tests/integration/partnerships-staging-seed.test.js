"use strict";
/**
 * The staging seed for Partnerships · Categories (seeds/staging/65_partnership_setup.js; docs/guides/
 * partnerships.md §6.3, §6.8): MyCity's stages, impacts and types, the Events category's checklist and
 * the Deal Merchant Agreement rebuilt as its default template, through the services, and nothing added
 * by a second run.
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/partnerships-staging
 */
const { config } = require("../../src/config/env");
const { pool } = require("../../src/config/db");
const schema = require("./helpers/schema");
const outbox = require("../../src/shared/events/outbox");
const seed = require("../../seeds/staging/65_partnership_setup");
const categories = require("../../src/modules/partner_pipeline/partner_pipeline.categories");
const wording = require("../../src/modules/templates/templates.agreements");
const c = require("@mycity/contract");

const describeDb = String(config.DB_NAME || "").endsWith("_test") ? describe : describe.skip;
const ACTOR = { user_id: null, source: "test" };
const count = async (sql) => (await pool.query(sql)).rows[0].n;

describeDb("Partnerships · Categories staging seed", () => {
  const logs = [];

  beforeAll(async () => {
    await schema.rebuild(pool, config.DB_NAME);
    outbox.markReady();
    await seed({ pool, actor: ACTOR, log: (m) => logs.push(m) });
  });

  afterAll(async () => {
    await require("../../src/shared/observability/error-reporter").flush();
    await pool.end();
  });

  test("MyCity's thirteen stages carry what each counts as, and the pipeline is whole", async () => {
    const stages = (await pool.query("SELECT label, metadata ->> 'meaning' AS meaning FROM reference_value WHERE domain = 'partnership_stage' AND active ORDER BY display_order")).rows;
    expect(stages).toHaveLength(13);
    expect(stages.map((s) => s.label)).toEqual(seed.STAGES.map(([label]) => label));
    for (const meaning of ["prospect", "signed", "closed_lost"]) expect(stages.some((s) => s.meaning === meaning)).toBe(true);
    expect(await count("SELECT count(*)::int AS n FROM reference_value WHERE domain = 'partnership_impact' AND active")).toBe(9);
    expect(await count("SELECT count(*)::int AS n FROM partner_category WHERE active")).toBe(12);
    expect(await count("SELECT count(*)::int AS n FROM partner_category WHERE counts_as_vendor")).toBe(1);
  });

  test("Events holds the five clauses as its checklist, a custom field and the Deal Merchant Agreement as its default", async () => {
    const events = (await categories.list({ q: "event", page: 1 })).data[0];
    const detail = await categories.detail(events.partner_category_id);
    expect(c.partner_pipeline.CategoryDetail.safeParse(detail).success).toBe(true);
    expect(detail.default_validity_days).toBe(30);
    expect(detail.checklist.filter((i) => i.active).map((i) => i.title)).toEqual(seed.CHECKLIST.map((i) => i.title));
    expect(detail.fields.map((f) => f.key)).toEqual(["ticket_model"]);
    expect(detail.templates).toHaveLength(1);
    expect(detail.templates[0]).toMatchObject({ kind: "deal_merchant", label: "Deal Merchant Agreement", is_default: true, countersigned: true, version: 1 });
    expect(detail.templates[0].asks.map((a) => a.key)).toEqual(seed.ASKS.map((a) => a.key));
  });

  test("the template's wording names only what it can fill, and opens in the editor with chips", async () => {
    const events = (await categories.list({ q: "event", page: 1 })).data[0];
    const [template] = (await categories.detail(events.partner_category_id)).templates;
    const open = await categories.getTemplate(template.partner_category_template_id);
    expect(c.partner_pipeline.CategoryTemplateDetail.safeParse(open).success).toBe(true);
    const markdown = (await pool.query("SELECT body FROM template_version WHERE key = $1", [template.template_key])).rows[0].body;
    expect(markdown).toContain("{{ longdate today }}");
    expect(markdown).toContain("{{ deal.options }}");
    expect(markdown).toContain("{{ category.checklist }}");
    expect(markdown).toContain("{{ signer.signature }}");
    expect(markdown).toContain("The Company shall remit payment for coupons to the Merchant");
    const catalog = wording.catalogOf([], template.asks);
    expect(() => wording.checkNames(markdown, catalog)).not.toThrow();
    expect((open.body_html.match(/data-field="/g) || []).length).toBeGreaterThan(20);
    expect(open.body_html).toContain('data-label="Opening Hours"');
  });

  test("a demonstration set of proof points is there, with no image", async () => {
    const points = (await pool.query("SELECT kind, label, value FROM proof_point ORDER BY position")).rows;
    expect(points.map((p) => p.label)).toEqual(["Network and community", "Ember to Remember calendar", "MTN Nigeria"]);
    expect(points[0]).toMatchObject({ kind: "stat", value: "10,000+" });
  });

  test("a second run adds nothing", async () => {
    const before = [
      await count("SELECT count(*)::int AS n FROM reference_value WHERE domain LIKE 'partnership_%'"),
      await count("SELECT count(*)::int AS n FROM partner_category"),
      await count("SELECT count(*)::int AS n FROM partner_category_template"),
      await count("SELECT count(*)::int AS n FROM template_version WHERE kind = 'document'"),
      await count("SELECT count(*)::int AS n FROM partner_category_checklist_item"),
      await count("SELECT count(*)::int AS n FROM proof_point"),
    ];
    await seed({ pool, actor: ACTOR });
    const after = [
      await count("SELECT count(*)::int AS n FROM reference_value WHERE domain LIKE 'partnership_%'"),
      await count("SELECT count(*)::int AS n FROM partner_category"),
      await count("SELECT count(*)::int AS n FROM partner_category_template"),
      await count("SELECT count(*)::int AS n FROM template_version WHERE kind = 'document'"),
      await count("SELECT count(*)::int AS n FROM partner_category_checklist_item"),
      await count("SELECT count(*)::int AS n FROM proof_point"),
    ];
    expect(after).toEqual(before);
    expect(logs[0]).toMatch(/13 stages, 9 impacts, 12 categories, 5 checklist items, 1 field, 1 template, 3 proof points/);
  });
});
