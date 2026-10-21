"use strict";
/**
 * KPIs' routes and weights (docs/guides/performance.md §5, §6), without a database. Assigning,
 * scope, approval and progress run end to end in tests/integration/kpis.test.js; scoring is
 * tested beside the goals (goals.test.js).
 */
const { routesOf } = require("../../http/route");
const weights = require("./kpis.weights");

describe("kpis.routes", () => {
  const routes = routesOf(require("./kpis.routes").router);
  const find = (method, path) => routes.find((r) => r.method === method && r.path === path);

  test("mount at /performance/kpis, literal paths before /:id", () => {
    expect(require("./kpis.routes").basePath).toBe("/performance/kpis");
    expect(routes.map((r) => `${r.method} ${r.path}`)).toEqual([
      "GET /",
      "GET /summary",
      "GET /employees/:id",
      "PUT /employees/:id",
      "POST /:id/actual",
      "GET /:id/trace",
    ]);
  });

  test("setting KPIs takes kpis.assign; recording a figure takes edit", () => {
    expect(find("PUT", "/employees/:id").capability).toBe("kpis.assign");
    expect(find("POST", "/:id/actual").permission).toMatchObject({ key: "performance", action: "edit" });
  });
});

describe("kpis.weights", () => {
  test("a person's month is whole at exactly 100.00", () => {
    expect(weights.isWhole([{ weight: "60.00" }, { weight: "40" }])).toBe(true);
    expect(weights.isWhole([{ weight: "60.00" }, { weight: "39.99" }])).toBe(false);
  });

  test("the same KPI is named once", () => {
    expect(() => weights.assertDistinct([{ title: "Visits" }, { title: " visits " }])).toThrow(
      expect.objectContaining({ code: "VALIDATION_FAILED" }),
    );
  });
});
