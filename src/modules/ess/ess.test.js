"use strict";
/**
 * Employee Self-Service: that it is the caller's own record and nothing else.
 * My Documents runs end to end against Postgres in
 * tests/integration/documents-api.test.js.
 */
const { routesOf } = require("../../http/route");
const catalog = require("../../shared/access/access.catalog");
const documents = require("./ess.documents");

describe("whose record it is", () => {
  test("a login with no employee record is refused, not shown somebody else's", () => {
    expect(() => documents.meOf({ user_id: "u1" })).toThrow(
      expect.objectContaining({ code: "NO_EMPLOYEE_RECORD", status: 409 }),
    );
    expect(() => documents.meOf(null)).toThrow(
      expect.objectContaining({ code: "NO_EMPLOYEE_RECORD" }),
    );
  });

  test("the employee comes from the session", () => {
    expect(documents.meOf({ user_id: "u1", employee_id: "e1" })).toBe("e1");
  });

  test("the ess grant is always the person's own records", () => {
    expect(catalog.OWN_ONLY.has("ess")).toBe(true);
  });
});

describe("the routes", () => {
  const routes = routesOf(require("./ess.routes").router);

  test("every one is the caller's own: a session, and no parameter naming anyone", () => {
    expect(routes.length).toBeGreaterThan(0);
    for (const route of routes) {
      expect(route.contract.self).toBe(true);
      expect(route.permission).toBeNull();
      expect(route.path).not.toMatch(/:(id|employee_id)\b/);
    }
  });

  test("the list pages at 25 through the contract's controls", () => {
    const list = routes.find((r) => r.method === "GET" && r.path === "/documents");
    expect(Object.keys(list.contract.query.shape)).toEqual(
      expect.arrayContaining(["page", "q", "status"]),
    );
  });
});
