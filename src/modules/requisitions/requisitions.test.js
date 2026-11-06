"use strict";
/**
 * Requisitions: the routes. Grouping, the CEO's removal and decision run against Postgres in
 * tests/integration/expenses.test.js; Create Requisition's card in ai-actions-expenses.test.js.
 */
const { routesOf } = require("../../http/route");
const { DEFINITION_KEY } = require("./requisitions.events");

describe("the routes", () => {
  const routes = routesOf(require("./requisitions.routes").router);

  test("held to expenses.finance, the CEO passing; removing a request is for its approver", () => {
    expect(require("./requisitions.routes").basePath).toBe("/requisitions");
    expect(DEFINITION_KEY).toBe("expenses.requisition");
    expect(routes.map((r) => [r.method, r.path, r.permission, r.capability || null])).toEqual([
      ["GET", "/", { key: "expenses", action: "view" }, "expenses.finance"],
      ["POST", "/", { key: "expenses", action: "create" }, "expenses.finance"],
      ["GET", "/:id", { key: "expenses", action: "view" }, "expenses.finance"],
      ["POST", "/:id/remove", { key: "expenses", action: "approve" }, null],
    ]);
  });
});
