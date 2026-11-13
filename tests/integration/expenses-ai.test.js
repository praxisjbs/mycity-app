"use strict";
/**
 * Expenses' AI features on the real migrations with the model scripted (docs/guides/expenses.md
 * §6.8, §9; jobs chosen by AJ, docs/handoff/m8-expenses.md decision 14): Read Invoice reads the
 * file its requester staged on Image Reading and answers lines, payee and an offered category for
 * the form; Suggest Category picks one offered category on Default; Check Duplicate compares a
 * request with another sent to the same payee for the same amount, on Default. Each is off with no
 * provider set up, never reads somebody else's file, and keeps nothing.
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/expenses-ai
 */
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
const ai = require("../../src/services/ai/llm.service");
const drafts = require("../../src/services/ai/drafts");
const actions = require("../../src/services/ai/actions");
const { q, one, drain, harness } = require("./helpers/ai-actions");

const describeDb = String(config.DB_NAME || "").endsWith("_test") ? describe : describe.skip;

const pdf = () => Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");

describeDb("expenses' AI features against the real migrations", () => {
  let app;
  let h;
  const cat = {};
  const count = async () => (await one("SELECT count(*)::int AS n FROM expense_request")).n;

  beforeAll(async () => {
    await rebuild(pool, config.DB_NAME);
    outbox.markReady();
    ({ app } = buildApp({ strict: true, accessLog: false }));
    h = harness(app);
    await h.makePeople([
      { who: "ceo", first: "Amaka", last: "Eze", email: "ceo@mycity.test", job: "Chief Executive Officer", role: "management", ceo: true, password: "Chief#Officer26" },
      { who: "ops", first: "Ada", last: "Obi", email: "ops@mycity.test", job: "Operations & People Lead", role: "operations_people", password: "Opera!ions2026", department: "Operations" },
      { who: "manager", first: "Kemi", last: "Alade", email: "manager@mycity.test", job: "Programme Lead", role: "manager", password: "Programme#Lead2026", department: "Programmes" },
      { who: "staff", first: "Musa", last: "Danjuma", email: "staff@mycity.test", job: "Field Officer", role: "employee", password: "Field#Officer2026", department: "Programmes" },
      { who: "other", first: "Bisi", last: "Ade", email: "other@mycity.test", job: "Accounts Officer", role: "employee", password: "Staff#Member2026", department: "Finance" },
    ]);
    await q("UPDATE employee SET line_manager_id = $1 WHERE employee_id = $2", [h.people.manager.employee_id, h.people.staff.employee_id]);
    await grantsCache.bumpTeamVersion();
    await q("DELETE FROM expense_category");
    await h.as("ops").post("/expense-categories/suggested").send({});
    for (const r of (await pool.query("SELECT expense_category_id, name FROM expense_category")).rows) cat[r.name] = r.expense_category_id;
    await drain();
  }, 120_000);

  afterAll(async () => {
    await require("../../src/shared/observability/error-reporter").flush();
    await pool.end();
  });

  afterEach(() => jest.restoreAllMocks());

  test("the three are registered with their jobs, chosen by AJ, personal data kept from DeepSeek", () => {
    expect(["expense-invoice-read", "expense-duplicate-check", "expense-category-suggest"].map((k) => [k, actions.of(k).job, actions.of(k).chosen_by, actions.of(k).personal_data])).toEqual([
      ["expense-invoice-read", "image_reading", "AJ", true],
      ["expense-duplicate-check", "default", "AJ", true],
      ["expense-category-suggest", "default", "AJ", true],
    ]);
  });

  test("with no provider set up each says it is off and calls no model", async () => {
    const spy = jest.spyOn(ai, "complete");
    const staged = await h.as("staff").post("/documents").field("purpose", "document").attach("file", pdf(), { filename: "invoice.pdf", contentType: "application/pdf" });
    expect((await h.as("staff").post("/expenses/mine/invoice-reading").send({ document_id: staged.body.document_id })).body).toMatchObject({ available: false, reason: "off", lines: [] });
    expect((await h.as("staff").post("/expenses/mine/category-suggestion").send({ purpose: "Water for the walk" })).body).toMatchObject({ available: false, reason: "off" });
    expect(spy).not.toHaveBeenCalled();
  });

  test("Read Invoice: the staged PDF goes to the model as a file on Image Reading; the lines' amounts are worked out here; nothing is saved", async () => {
    jest.spyOn(drafts, "availability").mockResolvedValue({ available: true, reason: null });
    let asked;
    jest.spyOn(ai, "complete").mockImplementation(async (opts) => {
      asked = opts;
      return {
        output: {
          payee_name: " Chuks Stores ",
          category: "events and activations",
          lines: [
            { description: "Crates of water", quantity: "2", unit_price: "4500.00" },
            { description: "Ice", quantity: "1.5", unit_price: "1000.00" },
            { description: "Paid to date", quantity: "1", unit_price: "-500.00" },
          ],
          amount_due: "10000",
        },
        run_id: null,
      };
    });
    const staged = await h.as("staff").post("/documents").field("purpose", "document").attach("file", pdf(), { filename: "invoice.pdf", contentType: "application/pdf" });
    const before = await count();
    const res = await h.as("staff").post("/expenses/mine/invoice-reading").send({ document_id: staged.body.document_id });
    expect([res.status, res.body.error]).toEqual([200, undefined]);
    expect(res.body).toMatchObject({
      available: true,
      payee_name: "Chuks Stores",
      expense_category_id: cat["Events and Activations"],
      amount: "10000.00",
      amount_due: "10000.00",
      lines: [
        { description: "Crates of water", quantity: "2", unit_price: "4500.00" },
        { description: "Ice", quantity: "1.5", unit_price: "1000.00" },
        { description: "Paid to date", quantity: "1", unit_price: "-500.00" },
      ],
    });
    expect(asked).toMatchObject({ purpose: "expense-invoice-read", module: "expenses", files: [expect.objectContaining({ mime_type: "application/pdf" })] });
    expect(asked.input.categories).toContain("Events and Activations");
    expect(JSON.stringify(asked.input)).not.toContain("Musa");
    expect(await count()).toBe(before);

    // Somebody else's staged file is never read.
    expect((await h.as("other").post("/expenses/mine/invoice-reading").send({ document_id: staged.body.document_id })).status).toBe(404);
  });

  test("Suggest Category: one offered category, matched by name; a name the model made up is left empty", async () => {
    jest.spyOn(drafts, "availability").mockResolvedValue({ available: true, reason: null });
    jest.spyOn(ai, "complete").mockResolvedValueOnce({ output: { category: "Travel and Transport" }, run_id: null }).mockResolvedValueOnce({ output: { category: "Snacks" }, run_id: null });
    const one1 = await h.as("staff").post("/expenses/mine/category-suggestion").send({ purpose: "Bolt rides to Ikeja", lines: [{ description: "Ride" }] });
    expect(one1.body).toMatchObject({ available: true, expense_category_id: cat["Travel and Transport"], category: "Travel and Transport" });
    expect(ai.complete).toHaveBeenCalledWith(expect.objectContaining({ purpose: "expense-category-suggest", input: expect.objectContaining({ purpose: "Bolt rides to Ikeja", lines: ["Ride"] }) }));
    const two = await h.as("staff").post("/expenses/mine/category-suggestion").send({ purpose: "Puff puff" });
    expect(two.body).toMatchObject({ available: true, expense_category_id: null, category: null });
  });

  test("Possible duplicates and Check Duplicate: the same payee and amount within 30 days is shown; the model names which one it repeats, told nothing about who", async () => {
    const raise = async (purpose) => {
      const res = await h.as("staff").post("/expenses/mine").send({
        purpose,
        expense_category_id: cat["Events and Activations"],
        lines: [{ description: "Crates of water", quantity: "2", unit_price: "4500.00" }],
        payee_type: "vendor",
        payee_name: "Chuks Stores",
        bank_name: "GTBank",
        account_name: "Chuks Stores Ltd",
        account_number: "0123456789",
        submit: true,
      });
      expect(res.status).toBe(201);
      return res.body;
    };
    const first = await raise("Ikeja activation water");
    expect(first.possible_duplicates).toEqual([]);
    const second = await raise("Water for Ikeja activation");
    expect(second.possible_duplicates).toEqual([expect.objectContaining({ number: first.number, amount: "9000.00", status: "submitted" })]);

    const seen = await h.as("manager").get(`/expenses/${second.expense_request_id}`);
    expect(seen.body.possible_duplicates).toHaveLength(1);

    jest.spyOn(drafts, "availability").mockResolvedValue({ available: true, reason: null });
    let asked;
    jest.spyOn(ai, "complete").mockImplementation(async (opts) => {
      asked = opts;
      return { output: { duplicate_of: first.number, reason: "Both ask for two crates of water for the Ikeja activation." }, run_id: null };
    });
    const checked = await h.as("manager").post(`/expenses/${second.expense_request_id}/duplicate-check`).send({});
    expect([checked.status, checked.body.error]).toEqual([200, undefined]);
    expect(checked.body).toMatchObject({ available: true, duplicate: { number: first.number }, explanation: expect.stringContaining("Ikeja") });
    expect(asked).toMatchObject({ purpose: "expense-duplicate-check", output: expect.anything() });
    const sent = JSON.stringify(asked.input);
    for (const word of ["Chuks", "0123456789", "Musa", "GTBank"]) expect(sent).not.toContain(word);

    // Somebody outside its reach cannot ask.
    expect((await h.as("other").post(`/expenses/${second.expense_request_id}/duplicate-check`).send({})).status).toBe(404);
    // A request with none to compare calls no model.
    ai.complete.mockClear();
    const different = await h.as("staff").post("/expenses/mine").send({ purpose: "Banner", expense_category_id: cat["Events and Activations"], lines: [{ description: "Banner", unit_price: "15000.00" }], payee_type: "vendor", payee_name: "Print Hub", bank_name: "Zenith", account_name: "Print Hub Ltd", account_number: "1234509876", submit: true });
    const alone = await h.as("staff").post(`/expenses/${different.body.expense_request_id}/duplicate-check`).send({});
    expect(alone.body).toMatchObject({ available: false, reason: "none" });
    expect(ai.complete).not.toHaveBeenCalled();
  });

  test("a file the provider refuses reads as unreadable, and this month's AI budget spent as the limit (audit F9, F20)", async () => {
    const { AppError } = require("../../src/shared/errors");
    jest.spyOn(drafts, "availability").mockResolvedValue({ available: true, reason: null });
    const staged = await h.as("staff").post("/documents").field("purpose", "document").attach("file", pdf(), { filename: "invoice.pdf", contentType: "application/pdf" });
    jest.spyOn(ai, "complete").mockRejectedValueOnce(new AppError("AI_VENDOR_CONFIG", "The AI service is not set up correctly. An administrator has been told.", 503));
    const refused = await h.as("staff").post("/expenses/mine/invoice-reading").send({ document_id: staged.body.document_id });
    expect([refused.status, refused.body]).toEqual([200, expect.objectContaining({ available: false, reason: "unreadable", lines: [] })]);
    ai.complete.mockRejectedValueOnce(new AppError("AI_CAP_REACHED", "This month's AI budget is spent", 429));
    const capped = await h.as("staff").post("/expenses/mine/invoice-reading").send({ document_id: staged.body.document_id });
    expect([capped.status, capped.body]).toEqual([200, expect.objectContaining({ available: false, reason: "limit" })]);
    ai.complete.mockRejectedValueOnce(new AppError("AI_CAP_REACHED", "This month's AI budget is spent", 429));
    const suggest = await h.as("staff").post("/expenses/mine/category-suggestion").send({ purpose: "Water for the walk" });
    expect(suggest.body).toMatchObject({ available: false, reason: "limit" });
  });
});
