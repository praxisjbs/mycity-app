"use strict";
/**
 * Charts in the Overview, PR 3 on the real migrations (docs/guides/praxis-ai.md §6.19 items 7 and 8,
 * Appendix B): Download PDF on an answer's Overview. The file is reserved at once (202, pending) and
 * made after commit in the outbox handler with the asker's rights at the build: the summary run
 * again, the stacked chart with its table, each other grouping and series, About This File; an answer
 * kept before its spec was draws the same; another person's answer, or one with no chart, is a 404; a
 * grant lost between the press and the build fails the file; a whole list that grew past a page says
 * so in place of its chart. The PDF renderer is stood in for, and the HTML it was handed is read.
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/ai-overview-export
 *
 * Refuses to run unless the database name ends in "_test": it drops and rebuilds the public schema.
 * Every person, budget and worksite here is invented.
 */
process.env.GEMINI_API_KEY = "test-key";
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
const registry = require("../../src/shared/ai/registry");
const lagos = require("../../src/shared/time/lagos");
const pdfService = require("../../src/services/pdf/pdf.service");
const { q, one, drain, fresh, script, callRead, say, harness } = require("./helpers/ai-actions");

const describeDb = String(config.DB_NAME || "").endsWith("_test") ? describe : describe.skip;

describeDb("Download PDF on an answer's Overview against the real migrations", () => {
  let h;
  const year = Number(lagos.today().slice(0, 4));
  const DEPARTMENTS = ["Programmes", "Operations", "Marketing", "Finance"];
  const BUDGET_SPEC = {
    summary: "budgets.summary",
    figures: ["allocated", "spent", "remaining"],
    chart: { kind: "stacked_bar", title: "Budget by department", group: "department" },
  };

  const ok = (res, status = 200) => {
    expect([res.status, res.body.error]).toEqual([status, undefined]);
    return res.body;
  };
  /** One question, the model scripted to read and then answer with the Overview given. */
  const asked = async (who, read, overview, question = "Our budget by department this year") => {
    script(callRead(read.tool, read.args || {}), say({ text: "Programmes has the most left to spend.", overview }));
    const body = ok(await h.ask(who, { question, shows: ["pane"] }));
    expect(() => c.assistant.AiAnswer.parse(body)).not.toThrow();
    return body;
  };
  const press = (who, id) => h.as(who).post(`/ai/answers/${id}/overview/export`).send({});
  const docOf = (id) => one("SELECT document_id, doc_type, render_status, render_error, uploaded_by, original_name, mime FROM document WHERE document_id = $1", [id]);
  /** The outbox run with the renderer stood in for: the HTML each PDF was drawn from. */
  const built = async () => {
    const render = jest.spyOn(pdfService, "render").mockResolvedValue(Buffer.from("%PDF-1.7 overview"));
    await drain();
    const pages = render.mock.calls.map(([html]) => html);
    render.mockRestore();
    return pages;
  };

  beforeAll(async () => {
    await rebuild(pool, config.DB_NAME);
    outbox.markReady();
    const { app } = buildApp({ strict: true, accessLog: false });
    h = harness(app);
    await h.makePeople([
      { who: "ceo", first: "Amaka", last: "Eze", email: "ceo@mycity.test", job: "Chief Executive Officer", role: "management", ceo: true, password: "Chief#Officer26", department: "Programmes" },
      { who: "ops", first: "Ada", last: "Obi", email: "ops@mycity.test", job: "Operations & People Lead", role: "operations_people", password: "Opera!ions2026", department: "Operations" },
      { who: "manager", first: "Kemi", last: "Alade", email: "manager@mycity.test", job: "Marketing Lead", role: "manager", password: "Marketing#Lead2026", department: "Marketing" },
      { who: "staff", first: "Musa", last: "Danjuma", email: "staff@mycity.test", job: "Finance Officer", role: "employee", password: "Finance#Officer2026", department: "Finance" },
    ]);

    // A budget for each of the four departments, as Budgets makes them, on two categories.
    await q("DELETE FROM expense_category");
    ok(await h.as("ops").post("/expense-categories/suggested").send({}));
    const cat = async (name) => (await one("SELECT expense_category_id FROM expense_category WHERE name = $1", [name])).expense_category_id;
    const travel = await cat("Travel and Transport");
    const amounts = { Programmes: "3500000.00", Operations: "2000000.00", Marketing: "1500000.00", Finance: "1050000.50" };
    for (const name of DEPARTMENTS) {
      const dept = (await one("SELECT department_id FROM department WHERE name = $1", [name])).department_id;
      ok(await h.as("ops").post("/budgets").send({ department_id: dept, year, lines: [{ expense_category_id: travel, amount: amounts[name] }] }), 201);
    }
    // Twenty worksites: a whole list on one page, until the test adds ten more.
    for (let i = 1; i <= 20; i += 1)
      await q("INSERT INTO worksite (code, name, latitude, longitude, radius_m) VALUES ($1, $2, 6.45, 3.4, $3)", [`SITE${String(i).padStart(2, "0")}`, `Site ${String(i).padStart(2, "0")}`, 100 + i]);
    await drain();
    registry.load();
    fresh();
  }, 180_000);

  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    registry.reset();
    await require("../../src/shared/observability/error-reporter").flush();
    await pool.end();
  });

  test("reserved at once and made after commit with the asker's rights: the stacked chart and its table, each other grouping and series, About This File", async () => {
    const body = await asked("ceo", { tool: "budgets__summary", args: { year, by: "department" } }, BUDGET_SPEC);
    expect(body.overview.chart).toMatchObject({ kind: "stacked_bar", unit: "ngn" });
    const kept = await one("SELECT metadata FROM ai_message WHERE ai_message_id = $1", [body.ai_message_id]);
    expect(kept.metadata.overview_spec).toMatchObject({ summary: "budgets.summary", chart: { group: "department" } });

    const res = await press("ceo", body.ai_message_id);
    expect(res.status).toBe(202);
    expect(() => c.documents.ExportFile.parse(res.body)).not.toThrow();
    expect(res.body.status).toBe("pending");
    expect(res.body.file_name).toMatch(/^praxis-ai-overview.*\.pdf$/);
    // Nothing is drawn inside the request: the worker draws it after commit.
    expect(await docOf(res.body.document_id)).toMatchObject({ doc_type: "ai_answer_overview", render_status: "pending", uploaded_by: h.people.ceo.user_id, mime: "application/pdf" });

    const [html] = await built();
    expect(await docOf(res.body.document_id)).toMatchObject({ render_status: "done" });
    expect(html).toContain("Our budget by department this year");
    expect(html).toContain("Amaka Eze");
    expect(html).toContain("Programmes has the most left to spend.");
    expect(html).toContain("₦8,050,000.50");
    expect(html).toContain("Budget by department");
    expect(html).toContain("<svg");
    expect(html).toMatch(/<th>Total<\/th>/);
    expect(html).toContain("₦3,500,000.00");
    // Every other grouping and series of the summary, each with its own chart and table.
    expect((html.match(/<section class="ov-section">/g) || []).length).toBeGreaterThanOrEqual(2);
    expect(html.match(/<h2>[^<]*<\/h2>/g)).toEqual(["<h2>Budget by department</h2>", "<h2>Budget by category</h2>", "<h2>About This File</h2>"]);
    expect(html).toContain("About This File");
    expect(html).toContain("budgets.summary");

    // The file is the asker's own: they wait on it, nobody else does.
    expect((await h.as("ceo").get(`/exports/${res.body.document_id}`)).body.status).toBe("done");
    expect((await h.as("ops").get(`/exports/${res.body.document_id}`)).status).toBe(404);
  });

  test("an answer kept before its spec was draws the same, its grouping found by the chart's own labels", async () => {
    const body = await asked("ceo", { tool: "budgets__summary", args: { year, by: "department" } }, BUDGET_SPEC);
    await q("UPDATE ai_message SET metadata = metadata - 'overview_spec' WHERE ai_message_id = $1", [body.ai_message_id]);
    const res = await press("ceo", body.ai_message_id);
    expect(res.status).toBe(202);
    const [html] = await built();
    expect(await docOf(res.body.document_id)).toMatchObject({ render_status: "done" });
    expect(html).toContain("Budget by department");
    expect(html).toMatch(/<th>Total<\/th>/);
  });

  test("another person's answer, and an answer with no chart, are not found", async () => {
    const body = await asked("ceo", { tool: "budgets__summary", args: { year, by: "department" } }, BUDGET_SPEC);
    expect((await press("ops", body.ai_message_id)).status).toBe(404);
    const plain = await asked("ceo", { tool: "budgets__summary", args: { year, by: "department" } }, { summary: "budgets.summary", figures: ["allocated"], chart: null });
    expect(plain.overview.chart).toBeNull();
    expect((await press("ceo", plain.ai_message_id)).status).toBe(404);
  });

  test("a grant lost between the press and the build fails the file", async () => {
    const body = await asked("ops", { tool: "budgets__summary", args: { year, by: "department" } }, BUDGET_SPEC);
    const res = await press("ops", body.ai_message_id);
    expect(res.status).toBe(202);
    const role = await one("SELECT role_id FROM role WHERE code = 'operations_people'");
    await q("UPDATE permission SET can_view = false WHERE role_id = $1 AND module_key = 'expenses'", [role.role_id]);
    await grantsCache.invalidateGrants();
    await grantsCache.invalidateUser(h.people.ops.user_id);
    try {
      const pages = await built();
      expect(pages).toHaveLength(0);
      expect(await docOf(res.body.document_id)).toMatchObject({ render_status: "failed" });
    } finally {
      await q("UPDATE permission SET can_view = true WHERE role_id = $1 AND module_key = 'expenses'", [role.role_id]);
      await grantsCache.invalidateGrants();
      await grantsCache.invalidateUser(h.people.ops.user_id);
    }
  });

  test("a whole list charted from its rows that grew past a page: its rows and the list's size in place of the chart", async () => {
    const body = await asked(
      "ceo",
      { tool: "worksites__list", args: {} },
      { summary: null, read: 1, figures: [{ of: "rows" }], chart: { kind: "bar", title: "Radius of each worksite", label: "name", values: ["radius_m"] } },
      "How wide is each worksite?",
    );
    expect(body.overview).toMatchObject({ read: 1 });
    expect(body.overview.chart).not.toBeNull();
    for (let i = 21; i <= 30; i += 1)
      await q("INSERT INTO worksite (code, name, latitude, longitude, radius_m) VALUES ($1, $2, 6.45, 3.4, 150)", [`SITE${i}`, `Site ${i}`]);
    const res = await press("ceo", body.ai_message_id);
    expect(res.status).toBe(202);
    const [html] = await built();
    expect(await docOf(res.body.document_id)).toMatchObject({ render_status: "done" });
    expect(html).toContain("The list now has 30 rows.");
    expect(html).not.toContain("<svg");
    expect(html).toContain("Site 01");
  });
});
