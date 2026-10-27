"use strict";
/**
 * KPIs: what a KPI must say and what a month needs (docs/guides/performance.md §6.5). The service
 * end to end, with the authority a head holds and the real tables, runs against Postgres in
 * tests/integration/performance-plan.test.js.
 */
const c = require("@mycity/contract");
const { routesOf } = require("../../http/route");

const DEPARTMENT = "11111111-1111-4111-8111-111111111111";
const issues = (r) => (r.success ? [] : r.error.issues.map((i) => [i.path.join("."), i.message]));

describe("a KPI's target", () => {
  const create = (extra = {}) => c.kpis.KpiCreate.safeParse({ department_id: DEPARTMENT, name: "Assets on time", ...extra });

  test("its wording is required: it is what every screen shows", () => {
    expect(issues(create())).toEqual([["target_text", "Required"]]);
    expect(issues(create({ target_text: "   " }))[0][0]).toBe("target_text");
    expect(create({ target_text: "≥95%" }).success).toBe(true);
  });

  test("the figure, the unit, the formula and the data source may be left out", () => {
    const r = create({ target_text: "Approved ceiling" });
    expect(r.success).toBe(true);
    expect(r.data).toMatchObject({ target_text: "Approved ceiling", direction: "higher", frequency: "monthly" });
    expect(r.data).not.toHaveProperty("target_value");
    expect(r.data).not.toHaveProperty("unit");
    expect(r.data).not.toHaveProperty("formula");
    expect(r.data).not.toHaveProperty("data_source");
  });

  test("a blank figure is no figure, and a figure written wrongly is refused", () => {
    expect(create({ target_text: "10", target_value: "" }).success).toBe(true);
    expect(create({ target_text: "10", target_value: "10" }).data.target_value).toBe("10");
    expect(issues(create({ target_text: "10", target_value: "1,000" }))).toEqual([["target_value", "Like 64000 or 0.95"]]);
  });

  test("an edit changes the wording but never clears it", () => {
    expect(c.kpis.KpiEdit.safeParse({ target_text: "0" }).success).toBe(true);
    expect(issues(c.kpis.KpiEdit.safeParse({ target_text: null }))[0][0]).toBe("target_text");
    expect(issues(c.kpis.KpiEdit.safeParse({ target_text: "" }))[0][0]).toBe("target_text");
    // The rest can still be cleared.
    expect(c.kpis.KpiEdit.safeParse({ unit: null, formula: null, data_source: null, target_value: null }).success).toBe(true);
  });
});

describe("a KPI's month", () => {
  const record = (extra) => c.kpis.KpiActual.safeParse({ month: "2026-10-01", ...extra });

  test("Met and Not Met need the figure, on the Actual field", () => {
    expect(issues(record({ result: "met" }))).toEqual([["actual_value", "Enter the actual"]]);
    expect(issues(record({ result: "not_met", actual_value: "" }))).toEqual([["actual_value", "Enter the actual"]]);
    expect(record({ result: "met", actual_value: "96" }).success).toBe(true);
    expect(record({ result: "not_met", actual_value: "0" }).success).toBe(true);
  });

  test("the figure in words counts, as the workbook's imports carry it", () => {
    expect(record({ result: "not_met", actual_text: "2 of 9 on time" }).success).toBe(true);
  });

  test("N/A, no eligible cases, has none", () => {
    expect(record({ result: "na" }).success).toBe(true);
    expect(record({ result: "na", comment: "No cases" }).success).toBe(true);
  });

  test("a KPI's row on Report Month holds the same rule, on its own row", () => {
    const report = (kpis) => c.goals.MonthReport.safeParse({ month: "2026-10-01", department_id: DEPARTMENT, key_results: [], kpis });
    const id = "22222222-2222-4222-8222-222222222222";
    expect(issues(report([{ kpi_definition_id: id, result: "met" }]))).toEqual([["kpis.0.actual_value", "Enter the actual"]]);
    expect(issues(report([{ kpi_definition_id: id, result: "na" }, { kpi_definition_id: id, result: "not_met" }]))).toEqual([["kpis.1.actual_value", "Enter the actual"]]);
    expect(report([{ kpi_definition_id: id, result: "met", actual_value: "96" }, { kpi_definition_id: id, result: "na" }]).success).toBe(true);
  });
});

describe("the units in use", () => {
  const routes = routesOf(require("./kpis.routes").router);
  const find = (method, path) => routes.find((r) => r.method === method && r.path === path);

  test("a read behind `performance` view, a page of 25 narrowed by q", () => {
    expect(find("GET", "/kpis/units")).toMatchObject({
      contract: { query: c.kpis.KpiUnitListQuery, response: c.kpis.KpiUnitPage },
      permission: { key: "performance", action: "view" },
    });
  });

  test("it is declared before a KPI's own address, so units is never read as an id", () => {
    const paths = routes.filter((r) => r.method === "GET").map((r) => r.path);
    expect(paths.indexOf("/kpis/units")).toBeGreaterThan(-1);
    expect(paths.indexOf("/kpis/units")).toBeLessThan(paths.indexOf("/kpis/:id"));
  });

  test("the caller has no page size and no sort to choose", () => {
    expect(c.kpis.KpiUnitListQuery.safeParse({ q: "%", page: "2" }).success).toBe(true);
    expect(c.kpis.KpiUnitListQuery.safeParse({ limit: "100" }).success).toBe(false);
    expect(c.kpis.KpiUnitListQuery.safeParse({ sort: "uses" }).success).toBe(false);
  });

  test("a page never holds more than 25", () => {
    const rows = (n) => Array.from({ length: n }, (_, i) => ({ unit: `u${i}`, uses: 1 }));
    const page = { number: 1, size: 25, total: 26, pages: 2, has_next: true };
    expect(c.kpis.KpiUnitPage.safeParse({ data: rows(25), page }).success).toBe(true);
    expect(c.kpis.KpiUnitPage.safeParse({ data: rows(26), page }).success).toBe(false);
  });
});
