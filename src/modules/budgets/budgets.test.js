"use strict";
/**
 * Budgets: the routes, the monthly report's month and the sweep's threshold. Setting, changing,
 * the recount, Budget History, projects and the sweep run against Postgres in
 * tests/integration/budgets.test.js.
 */
const { routesOf } = require("../../http/route");
const service = require("./budgets.service");
const variance = require("./budgets.variance");
const repo = require("./budgets.repo");

describe("the routes", () => {
  const routes = routesOf(require("./budgets.routes").router);

  test("reading needs expenses view; every write is held to expenses.finance", () => {
    expect(require("./budgets.routes").basePath).toBe("/budgets");
    expect(routes.map((r) => [r.method, r.path, r.permission, r.capability || null])).toEqual([
      ["GET", "/", { key: "expenses", action: "view" }, null],
      ["POST", "/", { key: "expenses", action: "create" }, "expenses.finance"],
      ["GET", "/projects", { key: "expenses", action: "view" }, null],
      ["PATCH", "/projects/:id", { key: "expenses", action: "edit" }, "expenses.finance"],
      ["GET", "/:id", { key: "expenses", action: "view" }, null],
      ["PATCH", "/:id", { key: "expenses", action: "edit" }, "expenses.finance"],
      ["GET", "/:id/history", { key: "expenses", action: "view" }, null],
    ]);
  });
});

describe("what is counted", () => {
  test("committed is approved and not yet paid; spent is paid", () => {
    expect(repo.COMMITTED).toEqual(["approved", "in_requisition", "authorised"]);
    expect(repo.SPENT).toEqual(["disbursed"]);
  });

  test("a line is warned about at 90% used", () => {
    expect(service.THRESHOLD_PERCENT).toBe("90");
  });
});

describe("the monthly report's month", () => {
  test("the calendar month before the day it is made, across a year end and a short month", () => {
    expect(variance.monthBefore("2026-12-01")).toEqual({ from: "2026-11-01", to: "2026-11-30" });
    expect(variance.monthBefore("2027-01-01")).toEqual({ from: "2026-12-01", to: "2026-12-31" });
    expect(variance.monthBefore("2028-03-31")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
  });
});

describe("Projects' spend", () => {
  test("is read across the company: a team reader is refused before anything is read", async () => {
    await expect(service.projects({ page: 1 }, { scope: "team", scope_ids: [] })).rejects.toMatchObject({ status: 403 });
  });
});
