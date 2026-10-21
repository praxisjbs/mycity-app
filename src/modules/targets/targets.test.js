"use strict";
/**
 * Targets' routes and wiring (docs/guides/performance.md §5, §7), without a database. A
 * department's month runs end to end in tests/integration/targets.test.js.
 */
const { routesOf } = require("../../http/route");
const outbox = require("../../shared/events/outbox");
const { EVENTS: TASK } = require("../tasks/tasks.events");
require("./targets.events");

describe("targets.routes", () => {
  const routes = routesOf(require("./targets.routes").router);
  const find = (method, path) => routes.find((r) => r.method === method && r.path === path);

  test("mount at /performance: targets and a department's month", () => {
    expect(require("./targets.routes").basePath).toBe("/performance");
    expect(routes.map((r) => `${r.method} ${r.path}`)).toEqual([
      "GET /targets",
      "GET /targets/summary",
      "POST /targets",
      "POST /plans/:department_id/:month/submit",
      "POST /plans/:id/decide",
    ]);
  });

  test("setting and submitting take goals.department; deciding takes approve", () => {
    expect(find("POST", "/targets").capability).toBe("goals.department");
    expect(find("POST", "/plans/:department_id/:month/submit").capability).toBe("goals.department");
    expect(find("POST", "/plans/:id/decide").permission).toMatchObject({ key: "performance", action: "approve" });
  });
});

describe("targets.progress", () => {
  test("a task entering or leaving Done recounts its KPI", () => {
    const names = (key) => outbox.handlersFor(key).map((h) => h.name);
    expect(names(TASK.TASK_COMPLETED)).toContain("targets.progress_on_done");
    expect(names(TASK.TASK_REOPENED)).toContain("targets.progress_on_reopen");
  });
});
