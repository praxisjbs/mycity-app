"use strict";
/**
 * Partners without a database (docs/guides/partnerships.md §5, §6.2): every route asks for the
 * partnerships key with the action §5 names, and duplicates are scored as the guide sets them.
 */
const { routesOf } = require("../../http/route");
const dedup = require("../../shared/dedup/dedup");
const routes = require("./partners.routes");
const { hostOf, SIGNALS } = require("./partners.dedup");

test("each route's permission is the one §5 names", () => {
  const got = routesOf(routes.router).map((r) => `${r.method.toUpperCase()} ${r.path} ${r.permission.key}.${r.permission.action}`);
  expect(got).toEqual([
    "GET /partners/summary partnerships.view",
    "GET /partners partnerships.view",
    "GET /partners/:id partnerships.view",
    "POST /partners partnerships.create",
    "PATCH /partners/:id partnerships.edit",
    "POST /partners/:id/close partnerships.edit",
    "GET /duplicates partnerships.create",
    "POST /contacts partnerships.edit",
    "PATCH /contacts/:id partnerships.edit",
    "GET /documents partnerships.view",
    "POST /documents partnerships.edit",
  ]);
});

describe("duplicates (§6.2)", () => {
  test("a website's host, whatever way it is written", () => {
    expect(hostOf("https://www.Hevix.ng/events?x=1")).toBe("hevix.ng");
    expect(hostOf("hevix.ng")).toBe("hevix.ng");
    expect(hostOf("")).toBeNull();
  });

  test("an email or a website alone is a match; a phone alone is not; a name alone is when it is the same", () => {
    const rank = (input, candidate) => dedup.rank(input, [{ key: "x", ...candidate }], SIGNALS, { min: 55, idKey: "key" });
    expect(rank({ email: "a@b.ng" }, { email: "a@b.ng" })).toHaveLength(1);
    expect(rank({ website: "hevix.ng" }, { website: "hevix.ng" })).toHaveLength(1);
    expect(rank({ phone: "+2348031234567" }, { phone: "+2348031234567" })).toHaveLength(0);
    expect(rank({ name: "House of Hevix Ltd" }, { name: "House of Hevix" })).toHaveLength(1);
  });
});
