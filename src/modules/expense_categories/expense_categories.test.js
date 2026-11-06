"use strict";
/**
 * Expense categories: the code a name makes, the twelve suggestions, and the routes. Adding,
 * renaming, deactivating and the suggestions run against Postgres in tests/integration/expenses.test.js.
 */
const { routesOf } = require("../../http/route");
const service = require("./expense_categories.service");

describe("a category's code", () => {
  test("is made from its name, never shown", () => {
    expect(service.codeOf("Travel and Transport")).toBe("travel_and_transport");
    expect(service.codeOf("  Data, Airtime & Subscriptions ")).toBe("data_airtime_subscriptions");
    expect(service.codeOf("3D Printing")).toBe("category_3d_printing");
  });
});

describe("Add Suggested Categories", () => {
  test("puts in the twelve of guide §6.7: eleven operating, Equipment capital, no salaries", () => {
    expect(service.SUGGESTED).toHaveLength(12);
    expect(service.SUGGESTED.filter((s) => s.type === "capital").map((s) => s.name)).toEqual(["Equipment"]);
    expect(new Set(service.SUGGESTED.map((s) => service.codeOf(s.name))).size).toBe(12);
    expect(service.SUGGESTED.some((s) => /salar/i.test(s.name))).toBe(false);
  });
});

describe("the routes", () => {
  const routes = routesOf(require("./expense_categories.routes").router);

  test("every `expenses` holder reads them; only `expenses.finance` keeps them", () => {
    expect(require("./expense_categories.routes").basePath).toBe("/expense-categories");
    expect(routes.map((r) => [r.method, r.path, r.permission, r.capability || null])).toEqual([
      ["GET", "/", { key: "expenses", action: "view" }, null],
      ["POST", "/", { key: "expenses", action: "create" }, "expenses.finance"],
      ["POST", "/suggested", { key: "expenses", action: "create" }, "expenses.finance"],
      ["PATCH", "/:id", { key: "expenses", action: "edit" }, "expenses.finance"],
    ]);
  });
});
