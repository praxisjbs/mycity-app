"use strict";
/**
 * Leads without a database (docs/guides/partnerships.md §5): every route asks for the partnerships
 * key with the action §5 names, and an owner outside the reader's scope is refused (§6.1).
 */
const { routesOf } = require("../../http/route");
const routes = require("./leads.routes");
const { assertOwner } = require("./leads.service");

test("each route's permission is the one §5 names", () => {
  const got = routesOf(routes.router).map((r) => `${r.method.toUpperCase()} ${r.path} ${r.permission.action}`);
  expect(got).toEqual([
    "GET /leads/summary view",
    "GET /leads view",
    "GET /leads/:id view",
    "POST /leads create",
    "PATCH /leads/:id edit",
    "POST /leads/:id/lose edit",
    "POST /leads/:id/convert edit",
  ]);
});

test("a record is given to someone in the reader's scope; all gives it to anyone", () => {
  const me = "8a6e0804-2bd0-4672-b79d-d97027f9071a";
  const other = "1f3e0804-2bd0-4672-b79d-d97027f9071b";
  expect(() => assertOwner({ scope: "all", scope_ids: null }, other)).not.toThrow();
  expect(() => assertOwner({ scope: "own", scope_ids: [me] }, me)).not.toThrow();
  expect(() => assertOwner({ scope: "own", scope_ids: [me] }, other)).toThrow(expect.objectContaining({ fields: { owner_id: ["Outside your team"] } }));
});
