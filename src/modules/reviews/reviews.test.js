"use strict";
/**
 * Reviews' routes and schedules (docs/guides/performance.md §5, §7), without a database. The
 * self-first sequence, the approval and who reads what run end to end in
 * tests/integration/reviews.test.js.
 */
const { routesOf } = require("../../http/route");

describe("reviews.routes", () => {
  const routes = routesOf(require("./reviews.routes").router);
  const find = (method, path) => routes.find((r) => r.method === method && r.path === path);

  test("mount at /performance: cycles and reviews", () => {
    expect(require("./reviews.routes").basePath).toBe("/performance");
    expect(routes.map((r) => `${r.method} ${r.path}`)).toEqual([
      "GET /cycles",
      "POST /cycles",
      "POST /cycles/:id/close",
      "GET /reviews",
      "GET /reviews/summary",
      "GET /reviews/:id",
      "PUT /reviews/:id",
      "POST /reviews/:id/submit",
      "POST /reviews/:id/decide",
      "POST /reviews/:id/dictation",
      "GET /analytics",
    ]);
  });

  test("cycles take reviews.cycles; deciding takes approve", () => {
    expect(find("POST", "/cycles").capability).toBe("reviews.cycles");
    expect(find("POST", "/cycles/:id/close").capability).toBe("reviews.cycles");
    expect(find("POST", "/reviews/:id/decide").permission).toMatchObject({ key: "performance", action: "approve" });
  });
});

describe("review schedules", () => {
  test("cycles open at 06:00 daily, reminders at 08:00 on working days", () => {
    expect(require("../../jobs/schedulers/review-cycles")).toMatchObject({ name: "review-cycles", pattern: "0 6 * * *" });
    expect(require("../../jobs/schedulers/review-reminders")).toMatchObject({ name: "review-reminders", pattern: "0 8 * * 1-6" });
  });
});
