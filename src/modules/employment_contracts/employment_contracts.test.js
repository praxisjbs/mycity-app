"use strict";
/**
 * Employment contracts: the rules that need no database (docs/guides/offers.md §3 step 5a, §6). The
 * contract generated at acceptance, Sign for Company, Resend and the hire's signature on the real
 * schema are in tests/integration/offers.test.js and tests/integration/onboarding.test.js.
 */
const c = require("@mycity/contract");
const lifecycle = require("./employment_contracts.lifecycle");
const render = require("./employment_contracts.render");
const routes = require("./employment_contracts.routes");
const { routesOf } = require("../../http/route");

describe("the statuses", () => {
  test("are the contract's own, in the order a contract moves through them", () => {
    expect(lifecycle.STATUSES).toEqual(c.employment_contracts.EmploymentContractStatus.options);
  });

  test("a draft is signed by the company before the hire; a signed or cancelled contract never moves", () => {
    expect(lifecycle.moves("draft", "sent")).toBe(true);
    expect(lifecycle.moves("draft", "signed")).toBe(false);
    expect(lifecycle.moves("sent", "signed")).toBe(true);
    expect(lifecycle.moves("sent", "cancelled")).toBe(true);
    for (const to of lifecycle.STATUSES) {
      expect(lifecycle.moves("signed", to)).toBe(false);
      expect(lifecycle.moves("cancelled", to)).toBe(false);
    }
    expect(lifecycle.moves("unknown", "sent")).toBe(false);
    expect(lifecycle.OPEN).toEqual(["draft", "sent"]);
  });

  test("the company signs as MyCity and the hire as an employee", () => {
    expect(lifecycle.ROLES).toEqual({ company: "mycity", hire: "employee" });
  });
});

const contract = {
  number: "CON-0001",
  created_at: new Date("2026-11-10T09:00:00Z"),
  starts_on: "2026-12-01",
  ends_on: null,
  employee_name: "Chiamaka Eze",
  employee_first_name: "Chiamaka",
  employee_email: "chiamaka@example.test",
  staff_number: "MCA-0101",
};
const offer = {
  number: "OFF-0017",
  candidate_name: "Chiamaka Eze",
  job_title: "Content Producer",
  department: "Content",
  employment_type: "full_time",
  work_pattern: "hybrid",
  office_days: 3,
  probation_months: 3,
  annual_leave_days: "15",
  start_date: "2026-11-30",
  currency: "NGN",
  additional_terms: null,
  job_description: "Plan and produce the content calendar.",
};
const pay = [
  { name: "Basic Salary", monthly_amount: "400000.00" },
  { name: "Transportation Allowance", monthly_amount: "50000.00" },
];

describe("the contract's values", () => {
  test("come from the offer as accepted and the hire's record, the contract's start date first", () => {
    const v = render.varsOf(contract, offer, pay, { company: "MyCity App Ltd", signatory: { name: "Cynthia Okafor", title: null } });
    expect(v).toMatchObject({
      company: "MyCity App Ltd",
      date: "2026-11-10",
      number: "CON-0001",
      offer_number: "OFF-0017",
      employee: { full_name: "Chiamaka Eze", first_name: "Chiamaka", staff_number: "MCA-0101" },
      start_date: "2026-12-01",
      office_days: 3,
      annual_leave_days: 15,
      monthly_total: "450000.00",
      signatory: { name: "Cynthia Okafor", title: null },
      sealing: null,
    });
    expect(v.pay_lines).toEqual([
      { name: "Basic Salary", monthly_amount: "400000.00" },
      { name: "Transportation Allowance", monthly_amount: "50000.00" },
    ]);
    expect(c.employment_contracts.EmploymentContractVars.safeParse(v).success).toBe(true);
  });

  test("office days print only for a hybrid pattern", () => {
    expect(render.varsOf(contract, { ...offer, work_pattern: "on_site" }, pay, { company: "MyCity" }).office_days).toBeNull();
  });
});

describe("what a signature covers", () => {
  test("the hire's name as the contract was made with it: a later rename never changes the hash", () => {
    const made = render.canonicalOf({ ...contract, hire_name: "Chiamaka Eze" }, offer, pay);
    const renamed = render.canonicalOf({ ...contract, hire_name: "Chiamaka Eze", employee_name: "Chiamaka Eze-Obi" }, offer, pay);
    expect(renamed).toEqual(made);
    expect(renamed.employee).toBe("Chiamaka Eze");
  });

  test("the terms and the appendix's headings, never the bodies a stranger would read on Verify", () => {
    const k = render.canonicalOf(contract, offer, pay);
    expect(k).toMatchObject({ number: "CON-0001", employee: "Chiamaka Eze", start_date: "2026-12-01", gross_salary: "450000.00", end_date: null });
    expect(k.clauses).toEqual([{ heading: "Schedule A: Role Description" }]);
    expect(JSON.stringify(k)).not.toContain("content calendar");
  });

  test("the appendix is Additional Terms, then Schedule A, each only when written", () => {
    expect(render.appendixOf({ additional_terms: null, job_description: null })).toEqual([]);
    expect(render.appendixOf({ additional_terms: "Relocation paid.", job_description: "Lead." }).map((a) => a.title)).toEqual(["Additional Terms", "Schedule A: Role Description"]);
  });
});

describe("the routes", () => {
  test("are Recruitment's: reading and signing with view, the wording and Resend with edit; every write validated", () => {
    const rs = routesOf(routes.router);
    for (const r of rs) expect(r.permission && r.permission.key).toBe("recruitment");
    const action = (m, p) => rs.find((r) => r.method === m && r.path === p).permission.action;
    expect(action("GET", "/:id")).toBe("view");
    expect(action("POST", "/:id/sign")).toBe("view");
    expect(action("POST", "/:id/resend")).toBe("edit");
    expect(action("PUT", "/settings/template")).toBe("edit");
    const paths = rs.map((r) => `${r.method} ${r.path}`);
    expect(paths.indexOf("GET /settings/template")).toBeLessThan(paths.indexOf("GET /:id"));
    for (const r of rs.filter((x) => x.method !== "GET")) expect(r.contract.body).toBeTruthy();
  });

  test("the wording, Resend and Reissue need the whole company's scope: a Head of Department's team grant reads and signs", () => {
    const stack = (m, p) => routes.router.stack.find((l) => l.route && l.route.path === p && l.route.methods[m.toLowerCase()]).route.stack;
    const all = (m, p) => stack(m, p).some((x) => x.handle.scope === "all");
    for (const [m, p] of [["GET", "/settings/template"], ["PUT", "/settings/template"], ["POST", "/settings/template/restore"], ["POST", "/:id/resend"], ["POST", "/:id/reissue"]])
      expect([m, p, all(m, p)]).toEqual([m, p, true]);
    for (const [m, p] of [["GET", "/:id"], ["POST", "/:id/sign"]]) expect([m, p, all(m, p)]).toEqual([m, p, false]);
  });
});
