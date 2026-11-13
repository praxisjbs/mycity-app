"use strict";
/**
 * Charts in the Overview, PR 1 on the real migrations (docs/guides/praxis-ai.md §6.13 Finance:
 * Budgets, §6.19 items 1 to 3): `budgets.summary` answers the CEO with each department's allocation
 * stacked as Spent, Committed, Remaining and Over Budget, figures in naira and never a row; an
 * overspent line is Over Budget with nothing below zero; a head of department's figures are their own
 * department's; a member of staff sees none, as on Budgets; by project only for a reader whose
 * scope is all; the parts reach the pane as a stacked bar.
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/ai-summaries-budgets
 *
 * Refuses to run unless the database name ends in "_test": it drops and rebuilds the public schema.
 * Every person here is invented.
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
const engine = require("../../src/services/ai/engine");
const lagos = require("../../src/shared/time/lagos");
const { q, one, drain, harness } = require("./helpers/ai-actions");

const describeDb = String(config.DB_NAME || "").endsWith("_test") ? describe : describe.skip;

describeDb("budgets.summary against the real migrations", () => {
  let h;
  const cat = {};
  const dept = {};
  const year = Number(lagos.today().slice(0, 4));

  const summaryOf = async (who, params = {}) => authorise.runSummary(pool, await grantsCache.getAuthUser(pool, h.people[who].user_id), "budgets.summary", params);
  const setLine = (department, category, committed, spent) =>
    q(
      `UPDATE budget_line bl SET committed_amount = $3, spent_amount = $4
         FROM budget b WHERE b.budget_id = bl.budget_id AND b.department_id = $1 AND bl.expense_category_id = $2`,
      [department, category, committed, spent],
    );

  beforeAll(async () => {
    await rebuild(pool, config.DB_NAME);
    outbox.markReady();
    const { app } = buildApp({ strict: true, accessLog: false });
    h = harness(app);
    await h.makePeople([
      { who: "ceo", first: "Amaka", last: "Eze", email: "ceo@mycity.test", job: "Chief Executive Officer", role: "management", ceo: true, password: "Chief#Officer26" },
      { who: "ops", first: "Ada", last: "Obi", email: "ops@mycity.test", job: "Operations & People Lead", role: "operations_people", password: "Opera!ions2026", department: "Operations" },
      { who: "manager", first: "Kemi", last: "Alade", email: "manager@mycity.test", job: "Programme Lead", role: "manager", password: "Programme#Lead2026", department: "Programmes" },
      { who: "staff", first: "Musa", last: "Danjuma", email: "staff@mycity.test", job: "Field Officer", role: "employee", password: "Field#Officer2026", department: "Programmes" },
    ]);
    dept.programmes = (await one("SELECT department_id FROM employee WHERE employee_id = $1", [h.people.manager.employee_id])).department_id;
    dept.operations = (await one("SELECT department_id FROM employee WHERE employee_id = $1", [h.people.ops.employee_id])).department_id;
    await q("UPDATE department SET head_employee_id = $1 WHERE department_id = $2", [h.people.manager.employee_id, dept.programmes]);
    await q("UPDATE employee SET line_manager_id = $1 WHERE employee_id = $2", [h.people.manager.employee_id, h.people.staff.employee_id]);
    await grantsCache.bumpTeamVersion();
    await q("DELETE FROM expense_category");
    expect((await h.as("ops").post("/expense-categories/suggested").send({})).status).toBe(200);
    for (const r of (await pool.query("SELECT expense_category_id, name FROM expense_category")).rows) cat[r.name] = r.expense_category_id;
    const make = async (department, lines) => {
      const res = await h.as("ops").post("/budgets").send({ department_id: department, year, lines });
      expect([res.status, res.body.error]).toEqual([201, undefined]);
    };
    await make(dept.programmes, [
      { expense_category_id: cat["Events and Activations"], amount: "300000.00" },
      { expense_category_id: cat["Travel and Transport"], amount: "50000.00" },
    ]);
    await make(dept.operations, [{ expense_category_id: cat["Office and Admin"], amount: "100000.00" }]);
    // Programmes' events line well within; its travel line overspent; Operations' office line untouched.
    await setLine(dept.programmes, cat["Events and Activations"], "40000.00", "60000.00");
    await setLine(dept.programmes, cat["Travel and Transport"], "10000.00", "55000.00");
    await drain();
  }, 120_000);

  afterAll(async () => {
    await require("../../src/shared/observability/error-reporter").flush();
    await pool.end();
  });

  test("the CEO: figures in naira, never a row, each department stacked to its allocation, Over Budget where it went past", async () => {
    const { result } = await summaryOf("ceo");
    expect(() => c.assistant.AiSummaryResult.parse(result)).not.toThrow();
    expect(result).not.toHaveProperty("data");
    const f = Object.fromEntries(result.figures.map((x) => [x.key, x.value]));
    expect(f).toMatchObject({ allocated: "450000.00", committed: "50000.00", spent: "115000.00", remaining: "285000.00", budgets: 2, lines_over: 1, lines_past_80: 1 });
    const byDept = result.groups.find((g) => g.by === "department");
    const programmes = byDept.rows.find((r) => r.key === dept.programmes);
    // 350,000.00 allocated, 165,000.00 used: no department went past in total, so no Over Budget part.
    expect(programmes.parts.map((p) => [p.label, p.value])).toEqual([["Spent", "115000.00"], ["Committed", "50000.00"], ["Remaining", "185000.00"]]);
    const byCategory = result.groups.find((g) => g.by === "category");
    const travel = byCategory.rows.find((r) => r.key === cat["Travel and Transport"]);
    // 50,000.00 allocated, 65,000.00 used: Spent fills it and 15,000.00 is over; nothing is below zero.
    expect(travel.parts.map((p) => [p.key, p.value])).toEqual([["spent", "50000.00"], ["committed", "0.00"], ["remaining", "0.00"], ["over", "15000.00"]]);
    expect(travel.value).toBe("65000.00");
    expect(result.groups.map((g) => g.by)).toEqual(["department", "category"]);
  });

  test("the parts reach the pane as a stacked bar, one series a part, Over Budget where a category went past", async () => {
    const { result } = await summaryOf("ceo");
    const o = engine.pane.overviewOf(
      { summary: "budgets.summary", figures: ["allocated", "spent", "remaining"], chart: { kind: "stacked_bar", title: "Budget by category", group: "category" } },
      [{ n: 1, key: "budgets.summary", kind: "summary", ok: true, result }],
    );
    expect(() => c.assistant.AiOverview.parse(o)).not.toThrow();
    expect(o.chart.series.map((s) => s.label)).toEqual(["Spent", "Committed", "Remaining", "Over Budget"]);
    expect(o.figures.map((x) => x.key)).toEqual(["allocated", "spent", "remaining"]);
  });

  test("a head of department's figures are their own department's; a member of staff sees none, as on Budgets", async () => {
    const { result } = await summaryOf("manager");
    expect(result.groups.find((g) => g.by === "department").rows.map((r) => r.key)).toEqual([dept.programmes]);
    expect(result.figures.find((x) => x.key === "allocated").value).toBe("350000.00");
    const staff = await summaryOf("staff");
    expect(staff.result.total).toBe(0);
    expect(staff.result.figures.find((x) => x.key === "allocated").value).toBe("0.00");
  });

  test("by project only for a reader whose scope is all", async () => {
    await q("UPDATE project SET budget_amount = NULL");
    const team = await summaryOf("manager", { by: "project" });
    expect(team.result.groups.map((g) => g.by)).toEqual(["department", "category"]);
    const all = await summaryOf("ceo", { by: "project", year });
    expect(all.result.groups.map((g) => g.by)).toEqual(["department", "category", "project"]);
  });

  test("every read names its summary: the budgets reads name budgets.summary", () => {
    const registry = require("../../src/shared/ai/registry");
    expect(registry.read("budgets.list").summary).toBe("budgets.summary");
    expect(registry.read("budgets.projects").summary).toBe("budgets.summary");
  });
});
