"use strict";
/**
 * Offers: the rules that need no database (docs/guides/offers.md §6). New Offer, the approval, the
 * company's signature, Send, the candidate's signature, Withdraw and Not Progressing on the real
 * schema are in tests/integration/offers.test.js.
 */
const render = require("./offers.render");
const routes = require("./offers.routes");
const { routesOf } = require("../../http/route");

describe("pay", () => {
  test("the monthly total is the sum of the lines; the annual figure twelve times it, to the kobo", () => {
    const lines = [{ monthly_amount: "400000.00" }, { monthly_amount: "30000.50" }, { monthly_amount: "19999.50" }];
    expect(render.totalOf(lines)).toBe("450000.00");
    expect(render.annualOf(lines)).toBe("5400000.00");
    expect(render.totalOf([])).toBe("0.00");
  });
});

describe("the letter's text", () => {
  test("is the rendered HTML a block a line, a table row's cells joined, entities read", () => {
    const html = "<h2>Offer of Employment</h2><p>Dear Chidi,</p><table><tr><th>Component</th><th>Monthly</th></tr><tr><td>Basic Salary</td><td>₦400,000.00</td></tr></table><ul><li>Lead &amp; grow</li></ul>";
    expect(render.textBlocks(html)).toEqual(["Offer of Employment", "Dear Chidi,", "Component · Monthly", "Basic Salary · ₦400,000.00", "Lead & grow"]);
  });

  test("the appendix is Additional Terms, then Schedule A, each only when written", () => {
    expect(render.appendixOf({ additional_terms: null, job_description: "Lead." }).map((a) => a.title)).toEqual(["Schedule A: Role Description"]);
    expect(render.appendixOf({ additional_terms: "Relocation paid.", job_description: "Lead." }).map((a) => a.title)).toEqual([
      "Additional Terms",
      "Schedule A: Role Description",
    ]);
  });

  test("what a signature covers leaves out who approved and when it was sent", () => {
    const o = { number: "OFF-0001", candidate_name: "Chidi Okafor", job_title: "Manager", currency: "NGN", terms_version: 0, approved_at: "2026-11-06T10:00:00Z", sent_at: "2026-11-07T10:00:00Z" };
    const payload = render.canonicalOf(o, [{ name: "Basic Salary", monthly_amount: "400000.00" }]);
    expect(payload).toMatchObject({ number: "OFF-0001", monthly_total: "400000.00", terms_version: 0 });
    expect(Object.keys(payload)).not.toEqual(expect.arrayContaining(["approved_at", "sent_at"]));
  });
});

describe("the employment type", () => {
  test("a vacancy's spellings become the employee's, which the offer and the employee record hold", () => {
    expect(render.employmentFromVacancy("contract")).toBe("contractor");
    expect(render.employmentFromVacancy("internship")).toBe("intern");
    expect(render.employmentFromVacancy("full_time")).toBe("full_time");
    expect(render.employmentFromVacancy("part_time")).toBe("part_time");
    expect(render.employmentFromVacancy(null)).toBeNull();
    const { EMPLOYMENT_TYPES } = require("@mycity/contract").organisation;
    for (const v of Object.values(render.FROM_VACANCY)) expect(EMPLOYMENT_TYPES).toContain(v);
    // Every employee spelling prints on the letter.
    for (const t of EMPLOYMENT_TYPES) expect(render.EMPLOYMENT[t]).toBeTruthy();
  });
});

describe("routes", () => {
  test("every route holds a recruitment grant; New Offer needs create, the writes edit, the company's signature view", () => {
    const rs = routesOf(routes.router);
    for (const r of rs) expect(r.permission && r.permission.key).toBe("recruitment");
    const action = (m, p) => rs.find((r) => r.method === m && r.path === p).permission.action;
    expect(action("POST", "/")).toBe("create");
    expect(action("GET", "/draft")).toBe("create");
    expect(action("PATCH", "/:id")).toBe("edit");
    expect(action("POST", "/:id/send")).toBe("edit");
    expect(action("POST", "/:id/withdraw")).toBe("edit");
    expect(action("PUT", "/settings/letter")).toBe("edit");
    // The signatory is checked against the request's signer, not a grant beyond view.
    expect(action("POST", "/:id/sign")).toBe("view");
    // No route approves: an offer is approved in its approval.
    expect(rs.some((r) => /approve/.test(r.path))).toBe(false);
  });

  test("the settings need the whole company's scope; a Head of Department's team grant drafts offers but never configures them", () => {
    const guarded = routes.router.stack
      .filter((l) => l.route && l.route.stack.some((m) => m.handle.scope === "all"))
      .map((l) => `${Object.keys(l.route.methods)[0].toUpperCase()} ${l.route.path}`);
    expect(guarded).toEqual(["GET /settings", "PUT /settings/signatory", "GET /settings/letter", "PUT /settings/letter", "POST /settings/letter/restore"]);
  });
});
