"use strict";
/**
 * Sanctions: a rung's code, an approval's end state, a suspension's days and the routes'
 * grants. Building the chain, proposing, approving, issuing and the fines run against
 * Postgres in tests/integration/queries.test.js.
 */
const { routesOf } = require("../../http/route");
const definitions = require("../../shared/workflow/definitions");
const { codeFrom } = require("./sanctions.chain");
const { daysOf } = require("./sanctions.letters");
const { OUTCOME, DEFINITION_KEY } = require("./sanctions.events");

describe("the chain", () => {
  test("a rung's code is made from its name", () => {
    expect(codeFrom("Suspension Without Pay")).toBe("suspension_without_pay");
    expect(codeFrom("Dismissal or Termination")).toBe("dismissal_or_termination");
    expect(codeFrom("  Fine (Damage)  ")).toBe("fine_damage");
    expect(codeFrom("***")).toBe("step");
  });

  test("who approves is a valid shipped definition: Operations & People, then the CEO from rank 4", () => {
    const def = definitions.DEFAULTS[DEFINITION_KEY];
    expect(definitions.problemsOf(def)).toEqual([]);
    expect(def.stages.map((s) => [s.key, s.approver, s.condition || null])).toEqual([
      ["operations_people", { type: "role", value: "operations_people" }, null],
      ["ceo", { type: "ceo" }, { field: "rank", op: ">=", value: 4 }],
    ]);
  });
});

describe("an approval's end", () => {
  test("every end state of the approval maps to a sanction status", () => {
    expect(OUTCOME).toEqual({
      approved: "issued",
      timeout_approved: "issued",
      rejected: "rejected",
      timeout_rejected: "rejected",
      cancelled: "withdrawn",
    });
  });
});

describe("a suspension's days", () => {
  test("both ends counted; none without an end", () => {
    expect(daysOf({ effective_on: "2026-11-02", ends_on: "2026-11-04" })).toBe(3);
    expect(daysOf({ effective_on: "2026-11-02", ends_on: "2026-11-02" })).toBe(1);
    expect(daysOf({ effective_on: "2026-11-02", ends_on: null })).toBeNull();
  });
});

describe("the routes", () => {
  const routes = routesOf(require("./sanctions.routes").router);

  test("every route carries the queries grant; the chain's writes need queries.configure; approvers decide here", () => {
    const grant = Object.fromEntries(
      routes.map((r) => [`${r.method} ${r.path}`, [r.permission.key, r.permission.action, r.capability]]),
    );
    expect(grant).toEqual({
      "GET /summary": ["queries", "view", null],
      "GET /standing": ["queries", "view", null],
      "GET /chain": ["queries", "view", null],
      "POST /chain": ["queries", "create", "queries.configure"],
      "PATCH /chain/:id": ["queries", "edit", "queries.configure"],
      "GET /": ["queries", "view", null],
      "GET /:id": ["queries", "view", null],
      "POST /:id/approve": ["queries", "approve", null],
      "POST /:id/reject": ["queries", "approve", null],
    });
  });
});
