"use strict";
/**
 * Salary structure with no database (docs/guides/payroll.md §6.11 rules 4 to 6): what a grade, a placement and a pay
 * split accept as they are entered, that the figures a reader without the salary grant must not see carry the mask's
 * names, and the routes' grants. Against the real migrations: tests/integration/payroll-advanced.test.js.
 */
const c = require("@mycity/contract");
const { routesOf } = require("../../http/route");
const { applyMask, maskedPropsFor } = require("../../shared/rbac/field-mask");

const s = c.salary_structure;
const fields = (r) => Object.fromEntries(r.error.issues.map((i) => [i.path.join("."), i.message]));

describe("a grade, a placement and a split as they are entered", () => {
  test("a grade's code is kept upper case and its maximum is never below its minimum", () => {
    expect(s.SalaryGradeSave.parse({ code: " g4 ", name: "Lead", minimum: "460000.00", maximum: "640000.00", effective_from: "2026-12-01" }).code).toBe("G4");
    const r = s.SalaryGradeSave.safeParse({ code: "G4", name: "Lead", minimum: "640000.00", maximum: "460000.00", effective_from: "2026-12-01" });
    expect(fields(r)).toEqual({ maximum: "Not below the minimum" });
    expect(fields(s.SalaryGradeSave.safeParse({ code: "G 4", name: "Lead", minimum: "0.00", maximum: "1.00", effective_from: "2026-12-01" }))).toEqual({
      code: "Letters and digits",
      minimum: "Enter an amount",
    });
  });

  test("a placement names a grade", () => {
    expect(fields(s.GradePlacementSave.safeParse({ salary_grade_id: "", effective_from: "2026-12-01" }))).toEqual({ salary_grade_id: "Pick a grade" });
  });

  test("a split has one basic, every code once, at most ten, each an amount above nothing", () => {
    const comp = (code, amount = "100.00") => ({ code, label: code, amount, pensionable: true });
    expect(s.PayComponentsSave.safeParse({ effective_from: "2026-12-01", components: [comp("basic"), comp("Housing")] }).success).toBe(true);
    expect(fields(s.PayComponentsSave.safeParse({ effective_from: "2026-12-01", components: [comp("housing")] }))).toEqual({ components: "Add a basic component" });
    expect(fields(s.PayComponentsSave.safeParse({ effective_from: "2026-12-01", components: [comp("basic"), comp("basic")] }))).toEqual({ "components.1.code": "Used twice" });
    expect(fields(s.PayComponentsSave.safeParse({ effective_from: "2026-12-01", components: [comp("basic", "0.00")] }))).toEqual({ "components.0.amount": "Enter an amount" });
    expect(fields(s.PayComponentsSave.safeParse({ effective_from: "2026-12-01", components: [comp("basic"), comp("meal plan")] }))).toEqual({
      "components.1.code": "Letters and underscores",
    });
    const eleven = ["basic", ...Array.from({ length: 10 }, (_, i) => `extra_${i}`)].map((code) => comp(code));
    expect(fields(s.PayComponentsSave.safeParse({ effective_from: "2026-12-01", components: eleven }))).toEqual({ components: "At most 10" });
  });
});

describe("the salary mask reaches the structure (§6.13)", () => {
  test("a band's limits, a person's gross and position, and a component's amount are masked by name", () => {
    const props = maskedPropsFor(["employee.salary"]);
    const grade = { code: "G4", band_minimum: "1.00", band_maximum: "2.00", staff: 3 };
    const placement = { grade_code: "G4", gross_pay: "1.00", band_position: "above", has_pay_split: true };
    const component = { code: "basic", pay_amount: "1.00", pensionable: true };
    expect(applyMask({ grade, placement, component }, props)).toEqual({
      grade: { code: "G4", band_minimum: null, band_maximum: null, staff: 3 },
      placement: { grade_code: "G4", gross_pay: null, band_position: null, has_pay_split: true },
      component: { code: "basic", pay_amount: null, pensionable: true },
    });
  });
});

describe("the routes", () => {
  test("reads behind payroll view; every write behind payroll edit and payroll.configure", () => {
    const mod = require("./salary_structure.routes");
    expect(mod.basePath).toBe("/salary-structure");
    expect(routesOf(mod.router).map((r) => [r.method, r.path, r.permission.action, r.capability || null])).toEqual([
      ["GET", "/grades", "view", null],
      ["POST", "/grades", "edit", "payroll.configure"],
      ["GET", "/placements", "view", null],
      ["PUT", "/placements/:employee_id", "edit", "payroll.configure"],
      ["GET", "/employees/:employee_id/components", "view", null],
      ["PUT", "/employees/:employee_id/components", "edit", "payroll.configure"],
    ]);
    for (const r of routesOf(mod.router)) expect(r.permission.key).toBe("payroll");
  });
});
