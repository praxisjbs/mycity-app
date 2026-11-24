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
    "DELETE /documents/:id partnerships.edit",
    "GET /work partnerships.view",
    "GET /work/records partnerships.view",
    "GET /work/deals partnerships.view",
    "POST /exports partnerships.export",
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

  test("a near name is a match on its own: a plural, an abbreviation, or a trigram likeness of 0.6 (QA F54b)", () => {
    const rank = (input, candidate) => dedup.rank(input, [{ key: "x", ...candidate }], SIGNALS, { min: 55, idKey: "key" });
    const kora = { name: "Kora Street Kitchens" };
    expect(rank({ name: "kora street kitchen" }, kora)).toEqual([{ id: "x", score: 60, reasons: ["name"] }]);
    expect(rank({ name: "Kora St Kitchens" }, kora)).toEqual([{ id: "x", score: 60, reasons: ["name"] }]);
    // A misspelling shares no word: the likeness the duplicate query measured makes it similar.
    expect(rank({ name: "Kora Strt Kitchenz" }, kora)).toEqual([]);
    expect(rank({ name: "Kora Strt Kitchenz" }, { ...kora, likeness: { name: 0.62 } })).toEqual([{ id: "x", score: 55, reasons: ["name (similar)"] }]);
    expect(rank({ name: "Lagos Food Festival" }, { name: "Lagos Fashion Festival", likeness: { name: 0.58 } })).toEqual([]);
  });
});
