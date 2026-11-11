"use strict";
/**
 * The delivery plan (FRONTEND_FOUNDATION F14), one reader and one rule for the app and the API
 * (@mycity/contract/plan): the docs read as the build reads them, the rule, and the API's own
 * answers (src/shared/delivery-plan.js) by which Need You and ⌘K leave out what would only open
 * Coming Soon (QA DEF-01). Need You's query is in tests/integration/workflow.test.js.
 */
const fs = require("node:fs");
const path = require("node:path");
const contractPlan = require("@mycity/contract/plan");
const deliveryPlan = require("../../../src/shared/delivery-plan");

const ROOT = path.resolve(__dirname, "../../..");
const docs = contractPlan.readPlan((rel) => fs.readFileSync(path.join(ROOT, rel), "utf8"));

afterEach(() => deliveryPlan.use());

describe("the plan, read from the docs", () => {
  test("each screen is its PROGRESS section and slug, with its milestone and ticks; each milestone its demo day", () => {
    // Payroll's four tabs are built (M6 PR 7): Configurations took Salary Structure's and Statutory's place (M6 PR 1),
    // whose rows stay, Dropped.
    expect(docs.screens["Payroll|payroll-runs"]).toEqual({ m: "M6", api: true, delivered: true });
    expect(docs.screens["Payroll|configurations"]).toEqual({ m: "M6", api: true, delivered: true });
    // Knowledge Hub's SOPs are built (M10 PR 2); Recruitment's Onboarding waits for its API (M5).
    expect(docs.screens["Knowledge Hub|sops"]).toEqual({ m: "M10", api: true, delivered: true });
    expect(docs.screens["Recruitment|onboarding"]).toEqual({ m: "M5", api: false, delivered: false });
    expect(docs.screens["Employee Self-Service|my-leave"]).toMatchObject({ m: "M1", api: true, delivered: true });
    expect(docs.milestones.find((m) => m.key === "M8")).toMatchObject({ n: 8, demo: "2026-12-11" });
    // "with M1": the foundation takes the next milestone's demo day.
    expect(docs.milestones.find((m) => m.key === "M0").demo).toBe(docs.milestones.find((m) => m.key === "M1").demo);
  });

  test("a plan that cannot be read stops the build", () => {
    expect(() => contractPlan.readPlan(() => "")).toThrow(/milestone table/);
  });

  test("a screen's key is its module's PROGRESS section and its slug", () => {
    expect(contractPlan.planKey("praxis_ai", "ask")).toBe("Praxis AI|ask");
    expect(contractPlan.planKey("ess", "my-leave")).toBe("Employee Self-Service|my-leave");
  });
});

describe("the rule", () => {
  const delivered = { m: "M1", api: true, delivered: true };
  const apiOnly = { m: "M8", api: true, delivered: false };
  const unbuilt = { m: "M8", api: false, delivered: false };

  test("production opens what is delivered, staging what has its API, the mock everything in Full Design", () => {
    expect([delivered, apiOnly, unbuilt].map((s) => contractPlan.screenOpens(s, "production", "full"))).toEqual([true, false, false]);
    expect([delivered, apiOnly, unbuilt].map((s) => contractPlan.screenOpens(s, "staging", "full"))).toEqual([true, true, false]);
    expect([delivered, apiOnly, unbuilt].map((s) => contractPlan.screenOpens(s, "mock", "full"))).toEqual([true, true, true]);
    expect(contractPlan.screenOpens(unbuilt, "mock", "delivered", { n: 2 })).toBe(false);
    expect(contractPlan.screenOpens(null, "staging", "full")).toBe(false);
  });

  test("a module opens when one of its tabs does; a link as the screen it lands on; a link outside the app is never held back", () => {
    const tabs = { ess: ["my-leave", "my-profile"], expenses: ["approvals", "my-requests"] };
    const open = contractPlan.opensFrom((m, t) => m === "ess" && t === "my-leave", (m) => tabs[m], (s) => s.replace(/-/g, "_"));
    expect([open.module("ess"), open.module("expenses")]).toEqual([true, false]);
    expect(open.link("/expenses?tab=approvals&id=42")).toBe(false);
    expect(open.link("/ess?tab=my-leave")).toBe(true);
    expect(open.link("/ess")).toBe(true);
    expect(open.link("/nowhere?tab=x")).toBe(true);
    expect(open.link("https://example.com/x")).toBe(true);
  });
});

describe("the API's answers", () => {
  test("its rule follows APP_ENV, as the app's does where it runs", () => {
    expect(["production", "staging", "development", "test"].map((env) => deliveryPlan.ruleFor(env))).toEqual(["production", "staging", "staging", "all"]);
  });

  test("on staging, each screen is held back until its API is ticked (Recruitment's Offers has, Onboarding not yet), and what has shipped opens", () => {
    deliveryPlan.use({ plan: docs, rule: "staging" });
    expect(deliveryPlan.screenOpen("recruitment", "onboarding")).toBe(false);
    expect(deliveryPlan.screenOpen("recruitment", "offers")).toBe(true);
    expect(deliveryPlan.screenOpen("knowledge", "sops")).toBe(true);
    expect(deliveryPlan.screenOpen("payroll", "payroll-runs")).toBe(true);
    expect(deliveryPlan.screenOpen("ess", "my-leave")).toBe(true);
    expect(deliveryPlan.moduleOpen("recruitment")).toBe(true);
    expect(deliveryPlan.linkOpens("/recruitment?tab=onboarding&id=1")).toBe(false);
    expect(deliveryPlan.linkOpens("/knowledge?tab=sops&id=1")).toBe(true);
    expect(deliveryPlan.linkOpens("/payroll?tab=payroll-runs&id=1")).toBe(true);
    expect(deliveryPlan.typeOpens("onboarding")).toBe(false);
    expect(deliveryPlan.typeOpens("sop")).toBe(true);
    expect(deliveryPlan.typeOpens("payroll_run")).toBe(true);
    expect(deliveryPlan.typeOpens("deduction")).toBe(true);
    expect(deliveryPlan.typeOpens("leave_request")).toBe(true);
    expect(deliveryPlan.typeOpens("not_a_route")).toBe(true);
    expect(deliveryPlan.closedTypes()).toContain("onboarding");
    expect(deliveryPlan.closedTypes()).not.toContain("sop");
    expect(deliveryPlan.closedTypes()).not.toContain("payroll_run");
    expect(deliveryPlan.closedTypes()).not.toContain("salary_structure");
    expect(deliveryPlan.closedTypes()).not.toContain("leave_request");
  });

  test("a test, or a plan that cannot be read, holds nothing back", () => {
    deliveryPlan.use({ plan: docs, rule: "all" });
    expect(deliveryPlan.screenOpen("recruitment", "onboarding")).toBe(true);
    expect(deliveryPlan.closedTypes()).toEqual([]);
    deliveryPlan.use({ plan: null, rule: "staging" });
    expect(deliveryPlan.screenOpen("recruitment", "onboarding")).toBe(true);
  });
});

describe("⌘K by the plan", () => {
  const spec = { type: "employee", module: "people", label: "Employees", from: "employee e", key: "e.employee_id", columns: ["e.first_name"], select: "e.employee_id AS id" };

  test("a record whose screen has not shipped is never searched; one that has is", async () => {
    await jest.isolateModulesAsync(async () => {
      jest.doMock("../../../src/middleware/rbac", () => ({ scopeFor: async () => ({ scope: "all", scope_ids: null }) }));
      const reg = require("../../../src/shared/search/registry");
      const service = require("../../../src/shared/search/search.service");
      const provider = require("../../../src/shared/search/provider");
      const plan = require("../../../src/shared/delivery-plan");
      const staff = provider.recordProvider(spec);
      const onboarding = provider.recordProvider({ ...spec, type: "onboarding", module: "recruitment", label: "Onboarding" });
      jest.spyOn(reg, "providers").mockReturnValue([staff, onboarding]);
      const rows = [{ id: "r-1", title: "Ada Obi", _total: 1 }];
      const client = { query: async (sql) => ({ rows: /\bLIMIT\b/.test(sql) ? rows : [] }), release() {} };
      const db = { connect: async () => client };
      const user = { user_id: "u-1", is_ceo: false };
      plan.use({ plan: docs, rule: "staging" });
      expect((await service.search(db, user, { q: "ada" })).groups.map((g) => g.type)).toEqual(["employee"]);
      plan.use({ plan: docs, rule: "all" });
      expect((await service.search(db, user, { q: "ada" })).groups.map((g) => g.type)).toEqual(["employee", "onboarding"]);
    });
  });

  test("a screen or an action that would open Coming Soon is never offered", () => {
    const { screenEntries, actionEntries } = require("../../../src/shared/search/search.service");
    // A Recruitment reader sees every tab of the module, Onboarding among them.
    const reader = { grants: { recruitment: ["view", "create", "edit"], knowledge: ["view"], payroll: ["view"], ess: ["view", "create"], settings: ["view"] }, capabilities: [], is_ceo: false, manages_people: true };
    const screensOf = () => screenEntries(reader).map((e) => e.hit.link);
    deliveryPlan.use({ plan: docs, rule: "all" });
    expect(screensOf()).toEqual(expect.arrayContaining(["/recruitment?tab=onboarding", "/ess?tab=my-leave"]));
    deliveryPlan.use({ plan: docs, rule: "staging" });
    expect(screensOf()).toEqual(expect.arrayContaining(["/ess?tab=my-leave", "/payroll?tab=payroll-runs", "/payroll?tab=payslips", "/knowledge?tab=sops"]));
    // Only the screens with their API ticked are offered: not Onboarding.
    expect(screensOf()).not.toContain("/recruitment?tab=onboarding");
    expect(actionEntries(reader).map((e) => e.hit.link).filter((link) => link && !deliveryPlan.linkOpens(link))).toEqual([]);
  });
});
