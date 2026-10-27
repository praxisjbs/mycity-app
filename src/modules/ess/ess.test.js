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
      expect(route.path).not.toMatch(/:employee_id\b/);
      // A record id (one of my leave requests, one of my queries) is checked against the session
      // in the service.
      if (/:id\b/.test(route.path))
        expect(route.path).toMatch(/^\/(leave\/:id(\/cancel)?|queries\/:id\/response)$/);
    }
  });

  test("the list pages at 25 through the contract's controls", () => {
    const list = routes.find((r) => r.method === "GET" && r.path === "/documents");
    expect(Object.keys(list.contract.query.shape)).toEqual(
      expect.arrayContaining(["page", "q", "status"]),
    );
  });
});

describe("My Profile", () => {
  const { profileOf } = require("./ess.profile");

  test("the bank account leaves as its last four digits only", () => {
    const p = profileOf({ employee_id: "e1", account_number: "0123456789", confirmed_on: null }, []);
    expect(p.account_last4).toBe("6789");
    expect(JSON.stringify(p)).not.toContain("0123456789");
    expect(p.confirmed).toBe(false);
  });

  test("no account, no digits", () => {
    expect(profileOf({ employee_id: "e1", account_number: null }, []).account_last4).toBeNull();
  });
});
