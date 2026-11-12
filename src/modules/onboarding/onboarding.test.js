"use strict";
/**
 * Onboarding's rules without a database: the documentation gate (docs/guides/offers.md §3 step 7,
 * §6), how long an Upload Documents link lives, the privacy notice's sentences, and the routes'
 * permissions. The whole flow on the real migrations is tests/integration/onboarding.test.js.
 */
const { waitingOn, CONDITIONS } = require("./onboarding.checklist");
const { ttlHours, privacyNotice } = require("./onboarding.upload");
const publicToken = require("../../shared/tokens/public-token");

const done = {
  items: [
    { required: true, status: "verified" },
    { required: false, status: "pending" },
  ],
  guarantors: [{ check_status: "passed" }, { check_status: "passed" }],
  bvn_entered: true,
  address_entered: true,
  contract_status: "signed",
};

describe("the documentation gate", () => {
  test("nothing waits once every required item is verified, both guarantors passed, the BVN and address entered and the contract signed", () => {
    expect(waitingOn(done)).toEqual([]);
  });

  test("an optional item never holds it; a required one does until it is verified", () => {
    expect(waitingOn({ ...done, items: [{ required: true, status: "uploaded" }] })).toEqual(["documents"]);
    expect(waitingOn({ ...done, items: [{ required: true, status: "rejected" }] })).toEqual(["documents"]);
    expect(waitingOn({ ...done, items: [{ required: false, status: "rejected" }] })).toEqual([]);
  });

  test("two guarantors, both passed: one, a pending or a failed check waits", () => {
    expect(waitingOn({ ...done, guarantors: [{ check_status: "passed" }] })).toEqual(["guarantors"]);
    expect(waitingOn({ ...done, guarantors: [{ check_status: "passed" }, { check_status: "pending" }] })).toEqual(["guarantors"]);
    expect(waitingOn({ ...done, guarantors: [{ check_status: "failed" }, { check_status: "passed" }] })).toEqual(["guarantors"]);
  });

  test("the BVN, the home address and a contract only drafted or sent wait; the conditions keep their order", () => {
    expect(waitingOn({ ...done, contract_status: "sent" })).toEqual(["contract"]);
    expect(waitingOn({ ...done, address_entered: false })).toEqual(["address"]);
    expect(waitingOn({ items: [{ required: true, status: "pending" }], guarantors: [], bvn_entered: false, address_entered: false, contract_status: null })).toEqual(CONDITIONS);
  });
});

describe("the Upload Documents link", () => {
  const now = new Date("2026-11-11T09:00:00+01:00");

  test("lives a month when the start date is near", () => {
    expect(ttlHours("2026-11-20", now)).toBe(30 * 24);
  });

  test("lives a week past a start date further away", () => {
    const hours = ttlHours("2026-12-31", now);
    expect(hours).toBeGreaterThan(30 * 24);
    expect(new Date(now.getTime() + hours * 3_600_000).toISOString().slice(0, 10)).toBe("2027-01-07");
  });

  test("never outlives a public token", () => {
    expect(ttlHours("2027-12-31", now)).toBe(publicToken.MAX_TTL_HOURS);
  });
});

describe("the privacy notice", () => {
  test("names the company and keeps every sentence to twenty words", () => {
    const lines = privacyNotice("MyCity App");
    expect(lines[0]).toContain("MyCity App");
    for (const line of lines) expect(line.split(/\s+/).length).toBeLessThanOrEqual(20);
  });
});

describe("the routes", () => {
  const routesOf = (file) => require(file).router.stack.filter((l) => l.route).map((l) => `${Object.keys(l.route.methods)[0].toUpperCase()} ${l.route.path}`);

  test("staff routes: the cases and the settings", () => {
    expect(routesOf("./onboarding.routes")).toEqual([
      "GET /requirements",
      "POST /requirements",
      "PATCH /requirements/:id",
      "GET /plans",
      "POST /plans",
      "GET /plans/:id",
      "PUT /plans/:id",
      "GET /",
      "GET /summary",
      "GET /:id",
      "POST /:id/items/:item_id/verify",
      "POST /:id/items/:item_id/reject",
      "POST /:id/guarantors/:guarantor_id/check",
      "POST /:id/remind",
      "POST /:id/steps/:step_id/done",
      "POST /:id/complete",
      "POST /:id/withdraw",
    ]);
  });

  test("onboarding-dispatch is a daily scheduler the worker starts", () => {
    const { SCHEDULERS } = require("../../jobs/registry");
    expect(SCHEDULERS).toContain("onboarding-dispatch");
    const schedule = require("../../jobs/schedulers/onboarding-dispatch");
    expect(schedule).toMatchObject({ name: "onboarding-dispatch", pattern: "43 6 * * *" });
  });

  test("the hire's page", () => {
    expect(routesOf("./onboarding.public.routes")).toEqual([
      "GET /:token",
      "POST /:token/privacy",
      "POST /:token/files",
      "POST /:token/items/:item_id",
      "POST /:token/guarantors",
      "POST /:token/bvn",
      "POST /:token/address",
      "GET /:token/places/search",
      "GET /:token/places/pin",
    ]);
  });

  test("settings and Operations & People's case actions need the whole company's scope; Mark Step Done the reader's own", () => {
    const guarded = require("./onboarding.routes")
      .router.stack.filter((l) => l.route)
      .map((l) => [`${Object.keys(l.route.methods)[0].toUpperCase()} ${l.route.path}`, l.route.stack.some((m) => m.handle.scope === "all")]);
    const all = guarded.filter(([, g]) => g).map(([r]) => r);
    expect(all).toEqual([
      "GET /requirements",
      "POST /requirements",
      "PATCH /requirements/:id",
      "GET /plans",
      "POST /plans",
      "GET /plans/:id",
      "PUT /plans/:id",
      "POST /:id/items/:item_id/verify",
      "POST /:id/items/:item_id/reject",
      "POST /:id/guarantors/:guarantor_id/check",
      "POST /:id/remind",
      "POST /:id/complete",
      "POST /:id/withdraw",
    ]);
    expect(all).not.toContain("POST /:id/steps/:step_id/done");
  });
});
