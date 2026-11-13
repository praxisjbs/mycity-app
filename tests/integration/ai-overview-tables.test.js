"use strict";
/**
 * Charts in the Overview, PR 2 on the real migrations (docs/guides/praxis-ai.md §6.19 item 6,
 * Appendix B): through `POST /ai/ask` with the model scripted, the budgets of four departments read
 * with `budgets.list` are charted from the rows, amounts in naira, the figures the server's own; a
 * list of 30 whose first 25 came back is never charted; a field a role's mask empties is never
 * charted for that role, while the CEO, never masked, sees it drawn.
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/ai-overview-tables
 *
 * Refuses to run unless the database name ends in "_test": it drops and rebuilds the public schema.
 * Every person and budget here is invented.
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
const { q, one, drain, fresh, script, callRead, say, harness } = require("./helpers/ai-actions");

const describeDb = String(config.DB_NAME || "").endsWith("_test") ? describe : describe.skip;

describeDb("charts from a complete table against the real migrations", () => {
  let h;
  const year = Number(lagos.today().slice(0, 4));
  const DEPARTMENTS = ["Programmes", "Operations", "Marketing", "Finance"];

  const ok = (res, status = 200) => {
    expect([res.status, res.body.error]).toEqual([status, undefined]);
    return res.body;
  };
  /** One question, the model scripted to read and then answer with the Overview given. */
  const asked = async (who, read, overview, text = "Here they are.") => {
    script(callRead(read.tool, read.args || {}), say({ text, overview }));
    const body = ok(await h.ask(who, { question: "Show it as a chart", shows: ["pane"] }));
    expect(() => c.assistant.AiAnswer.parse(body)).not.toThrow();
    return body;
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
    const emp = (who) => h.people[who].employee_id;
    await q("UPDATE employee SET line_manager_id = $1 WHERE employee_id = $2", [emp("manager"), emp("staff")]);
    await grantsCache.bumpTeamVersion();

    // A budget for each of the four departments, as Budgets makes them.
    await q("DELETE FROM expense_category");
    ok(await h.as("ops").post("/expense-categories/suggested").send({}));
    const travel = (await one("SELECT expense_category_id FROM expense_category WHERE name = 'Travel and Transport'")).expense_category_id;
    const amounts = { Programmes: "3500000.00", Operations: "2000000.00", Marketing: "1500000.00", Finance: "1050000.50" };
    for (const name of DEPARTMENTS) {
      const dept = (await one("SELECT department_id FROM department WHERE name = $1", [name])).department_id;
      ok(await h.as("ops").post("/budgets").send({ department_id: dept, year, lines: [{ expense_category_id: travel, amount: amounts[name] }] }), 201);
    }

    // Thirty worksites: more than one page.
    for (let i = 1; i <= 30; i += 1)
      await q("INSERT INTO worksite (code, name, latitude, longitude, radius_m) VALUES ($1, $2, 6.45, 3.4, 100)", [`SITE${String(i).padStart(2, "0")}`, `Site ${String(i).padStart(2, "0")}`]);

    // Two attendance deductions for the manager's report, priced from the salary.
    const today = lagos.today();
    for (const [kind, amount] of [
      ["late", "1500.00"],
      ["absence", "12000.00"],
    ])
      await q("INSERT INTO attendance_pay_item (employee_id, work_date, kind, minutes, method, amount, status) VALUES ($1, $2, $3, 30, 'pro_rata', $4, 'pending')", [emp("staff"), today, kind, amount]);
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

  test("the budgets of four departments, read with budgets.list, charted from the rows: amounts in naira, figures the server's", async () => {
    const body = await asked(
      "ceo",
      { tool: "budgets__list", args: { year } },
      {
        summary: null,
        read: 1,
        figures: [{ of: "rows" }, { of: "sum", field: "allocated" }],
        chart: { kind: "bar", title: "Allocated by department", label: "department", values: ["allocated"] },
      },
    );
    expect(body.reads[0]).toMatchObject({ key: "budgets.list", outcome: "read", rows: 4, total: 4 });
    expect(body.overview).toMatchObject({ summary: null, read: 1 });
    expect(body.overview.figures).toEqual([
      { key: "rows", label: "Budgets", value: 4, unit: "count" },
      { key: "sum_allocated", label: "Allocated", value: "8050000.50", unit: "ngn" },
    ]);
    expect(body.overview.chart.kind).toBe("bar");
    expect(body.overview.chart.unit).toBe("ngn");
    expect([...body.overview.chart.labels].sort()).toEqual([...DEPARTMENTS].sort());
    const at = (name) => body.overview.chart.series[0].values[body.overview.chart.labels.indexOf(name)];
    expect([at("Programmes"), at("Finance")]).toEqual([3500000, 1050000.5]);
    // Kept with the answer, so the conversation shows it again.
    const turns = ok(await h.as("ceo").get(`/ai/conversations/${body.ai_conversation_id}/turns`));
    expect(turns.data[0].overview).toEqual(body.overview);
  });

  test("a list of 30 is never charted from its first 25", async () => {
    const body = await asked("ops", { tool: "worksites__list" }, { summary: null, read: 1, figures: [{ of: "rows" }], chart: { kind: "bar", title: "Radius by site", label: "name", values: ["radius_m"] } });
    expect(body.reads[0]).toMatchObject({ key: "worksites.list", rows: 25, total: 30 });
    expect(body.overview).toBeNull();
  });

  test("a field the role's mask empties is never charted for that role; the CEO, never masked, sees it drawn", async () => {
    await q("INSERT INTO field_visibility (role_id, field_key, visibility) SELECT role_id, 'employee.salary', 'masked' FROM role WHERE code = 'manager' ON CONFLICT DO NOTHING");
    await grantsCache.bumpTeamVersion();
    const overview = { summary: null, read: 1, figures: [{ of: "sum", field: "pay_amount" }], chart: { kind: "bar", title: "Deductions by kind", label: "kind", values: ["pay_amount"] } };
    try {
      const masked = await asked("manager", { tool: "attendance__pay_items" }, overview);
      expect(masked.reads[0]).toMatchObject({ key: "attendance.pay_items", rows: 2, total: 2 });
      expect(masked.reads[0].masked).toContain("employee.salary");
      expect(masked.overview).toBeNull();
      const ceo = await asked("ceo", { tool: "attendance__pay_items" }, overview);
      // A code reads as its words, as the table draws it.
      expect(ceo.overview.chart).toMatchObject({ kind: "bar", unit: "ngn" });
      expect([...ceo.overview.chart.labels].sort()).toEqual(["Absence", "Late"]);
      expect([...ceo.overview.chart.series[0].values].sort((a, b) => a - b)).toEqual([1500, 12000]);
      expect(ceo.overview.figures).toEqual([{ key: "sum_pay_amount", label: "Pay Amount", value: "13500.00", unit: "ngn" }]);
    } finally {
      await q("DELETE FROM field_visibility WHERE field_key = 'employee.salary'");
      await grantsCache.bumpTeamVersion();
    }
  });
});
