"use strict";
/**
 * Queries: who sees a query (the hard rule, guide §6.1), when one may be decided or a
 * reminder sent, and the routes' grants. Raising, answering and deciding run against
 * Postgres in tests/integration/queries.test.js.
 */
const { routesOf } = require("../../http/route");
const visibility = require("./queries.visibility");
const { decidable, remindable } = require("./queries.service");

const MANAGER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

describe("who sees a query", () => {
  test("scope all and the CEO see every query; anyone else only the ones they raised", () => {
    const people = visibility.readerOf({ scope: "all" }, { user_id: OTHER });
    const ceo = visibility.readerOf({ scope: "own" }, { user_id: OTHER, is_ceo: true });
    const manager = visibility.readerOf({ scope: "team" }, { user_id: MANAGER });
    const raisedByManager = { raised_by: MANAGER };
    const raisedByRule = { raised_by: null };

    expect([people.all, ceo.all, manager.all]).toEqual([true, true, false]);
    expect(visibility.canSee(people, raisedByRule)).toBe(true);
    expect(visibility.canSee(ceo, raisedByRule)).toBe(true);
    expect(visibility.canSee(manager, raisedByManager)).toBe(true);
    // Team scope does not widen it: a rule's query and another manager's are not theirs.
    expect(visibility.canSee(manager, raisedByRule)).toBe(false);
    expect(visibility.canSee(manager, { raised_by: OTHER })).toBe(false);
  });

  test("a list is narrowed in SQL for anyone below scope all, and not at all for scope all", () => {
    const params = ["x"];
    expect(visibility.clause(visibility.readerOf({ scope: "all" }, { user_id: OTHER }), params)).toEqual({ and: "" });
    expect(params).toEqual(["x"]);
    const s = visibility.clause(visibility.readerOf({ scope: "team" }, { user_id: MANAGER }), params, "v.raised_by");
    expect(s.and).toBe("AND v.raised_by = $2::uuid");
    expect(params).toEqual(["x", MANAGER]);
  });

  test("a query outside the rule is a 404, not a 403", () => {
    const manager = visibility.readerOf({ scope: "team" }, { user_id: MANAGER });
    expect(() => visibility.assertVisible(manager, { raised_by: null })).toThrow(
      expect.objectContaining({ code: "NOT_FOUND", status: 404 }),
    );
  });
});

describe("deciding and reminding", () => {
  const soon = new Date(Date.now() + 3600 * 1000).toISOString();
  const past = new Date(Date.now() - 3600 * 1000).toISOString();
  const open = { status: "awaiting_response", employee_id: "e1", response: null, response_due_at: soon, escalated: false };

  test("a decision waits for the response or the deadline, and needs edit", () => {
    const people = { employee_id: "p1" };
    expect(decidable(open, people, true)).toBe(false);
    expect(decidable({ ...open, response_due_at: past }, people, true)).toBe(true);
    expect(decidable({ ...open, status: "under_review", response: { body: "x" } }, people, true)).toBe(true);
    expect(decidable({ ...open, response_due_at: past }, people, false)).toBe(false);
  });

  test("never by the person it is about, never twice, never while a sanction waits", () => {
    const due = { ...open, response_due_at: past };
    expect(decidable(due, { employee_id: "e1" }, true)).toBe(false);
    expect(decidable({ ...due, status: "resolved" }, { employee_id: "p1" }, true)).toBe(false);
    expect(decidable({ ...due, escalated: true }, { employee_id: "p1" }, true)).toBe(false);
  });

  test("a reminder only while it waits for an answer, once a day", () => {
    expect(remindable(open, true)).toBe(true);
    expect(remindable(open, false)).toBe(false);
    expect(remindable({ ...open, reminded_at: new Date().toISOString() }, true)).toBe(false);
    expect(remindable({ ...open, reminded_at: "2026-01-01T09:00:00.000Z" }, true)).toBe(true);
    expect(remindable({ ...open, status: "under_review" }, true)).toBe(false);
  });
});

describe("the routes", () => {
  const routes = routesOf(require("./queries.routes").router);

  test("every route carries the queries grant; deciding needs edit; nothing approves here", () => {
    const grant = Object.fromEntries(routes.map((r) => [`${r.method} ${r.path}`, r.permission.action]));
    expect(grant).toEqual({
      "GET /summary": "view",
      "GET /": "view",
      "GET /:id": "view",
      "GET /assist": "create",
      "POST /assist": "create",
      "GET /policies": "view",
      "POST /": "create",
      "POST /:id/remind": "create",
      "POST /:id/decision": "edit",
    });
    for (const r of routes) {
      expect(r.permission.key).toBe("queries");
      expect(r.path).not.toMatch(/approve|reject/);
    }
  });

  test("the list pages through the contract's controls, with no page size", () => {
    const list = routes.find((r) => r.method === "GET" && r.path === "/");
    const keys = Object.keys(list.contract.query.shape);
    expect(keys).toEqual(expect.arrayContaining(["page", "q", "sort", "status", "raised"]));
    expect(keys).not.toContain("limit");
  });
});
