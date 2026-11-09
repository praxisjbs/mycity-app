"use strict";
/**
 * M6 PR 1's contract and the wiring that goes with it (docs/guides/payroll.md §4.2, §5, §6.13, Appendix
 * A): what the simple-mode schemas accept and refuse, the messages a field shows, the lists' sort
 * allow-lists, and that every amount derived from a salary is named the way the salary mask governs.
 */
const fs = require("node:fs");
const path = require("node:path");
const c = require("@mycity/contract");
const mask = require("../../src/shared/rbac/field-mask");
const routeMap = require("../../src/shared/route-map");
const screens = require("../../src/shared/search/screens");
const catalog = require("../../src/shared/access/access.catalog");
const definitions = require("../../src/shared/workflow/definitions");

const UUID = "3f1c2a9e-5b7d-4c11-9a0e-2d6f8b1a7c33";

/** The messages a schema gives for `value`, as a screen shows them under the field. */
const errors = (schema, value) => {
  const r = schema.safeParse(value);
  return r.success ? [] : r.error.issues.map((i) => `${i.path.join(".") || "(body)"}: ${i.message}`);
};
const words = (message) => message.split(": ").slice(1).join(": ").trim().split(/\s+/).length;

describe("the contract's field messages", () => {
  test("New Run takes a month's first day", () => {
    expect(c.payroll.PayrollRunCreate.safeParse({ period: "2026-10-01" }).success).toBe(true);
    expect(errors(c.payroll.PayrollRunCreate, { period: "2026-10-15" })).toEqual(["period: Pick a month"]);
    expect(errors(c.payroll.PayrollRunCreate, { period: "2026-13-01" })).toHaveLength(1);
    expect(errors(c.payroll.PayrollRunCreate, {})).toHaveLength(1);
  });

  test("an adjustment has a label of at most 60 characters, an amount above zero and a reason of 10 or more", () => {
    const ok = { employee_id: UUID, kind: "earning", label: "Bonus", amount: "5000.00", reason: "October bonus" };
    expect(c.payroll.PayrollAdjustmentAdd.safeParse(ok).success).toBe(true);
    expect(errors(c.payroll.PayrollAdjustmentAdd, { ...ok, amount: "0.00" })).toEqual(["amount: Enter an amount"]);
    expect(errors(c.payroll.PayrollAdjustmentAdd, { ...ok, amount: "-5.00" })).toEqual(["amount: Enter an amount"]);
    expect(errors(c.payroll.PayrollAdjustmentAdd, { ...ok, amount: "5000" })).toEqual(["amount: Enter an amount"]);
    expect(errors(c.payroll.PayrollAdjustmentAdd, { ...ok, label: "x".repeat(61) })).toEqual(["label: At most 60 characters"]);
    expect(errors(c.payroll.PayrollAdjustmentAdd, { ...ok, label: "" })).toEqual(["label: Give a label"]);
    expect(errors(c.payroll.PayrollAdjustmentAdd, { ...ok, reason: "" })).toEqual(["reason: Give a reason", "reason: At least 10 characters"]);
    expect(errors(c.payroll.PayrollAdjustmentAdd, { ...ok, reason: "Too short" })).toEqual(["reason: At least 10 characters"]);
    expect(errors(c.payroll.PayrollAdjustmentAdd, { ...ok, kind: "bonus" })).toHaveLength(1);
    expect(errors(c.payroll.PayrollAdjustmentAdd, { ...ok, pay_amount: "1.00" })).toHaveLength(1);
  });

  test("Accept This Month and Spread Over Months take one to twelve months from a month's first day", () => {
    expect(c.deductions.DeductionAccept.safeParse({ months: 1, start_period: "2026-10-01" }).success).toBe(true);
    expect(c.deductions.DeductionAccept.safeParse({ months: 12, start_period: "2026-10-01" }).success).toBe(true);
    expect(errors(c.deductions.DeductionAccept, { months: 13, start_period: "2026-10-01" })).toEqual(["months: Pick 1 to 12"]);
    expect(errors(c.deductions.DeductionAccept, { months: 0, start_period: "2026-10-01" })).toEqual(["months: Pick 1 to 12"]);
    expect(errors(c.deductions.DeductionAccept, { months: 3, start_period: "2026-10-09" })).toEqual(["start_period: Pick a start month"]);
  });

  test("Record Advance names the person, the amount, the day it was paid, the months and the first month", () => {
    const ok = { employee_id: UUID, amount: "75000.00", granted_on: "2026-10-20", months: 3, start_period: "2026-11-01", reason: "School fees advance" };
    expect(c.deductions.AdvanceRecord.safeParse(ok).success).toBe(true);
    expect(errors(c.deductions.AdvanceRecord, { ...ok, reason: "Fees" })).toEqual(["reason: At least 10 characters"]);
    expect(errors(c.deductions.AdvanceRecord, { ...ok, amount: "0.00" })).toEqual(["amount: Enter an amount"]);
    expect(errors(c.deductions.AdvanceRecord, { ...ok, granted_on: "2026-02-30" })).toHaveLength(1);
    expect(errors(c.deductions.AdvanceRecord, { ...ok, months: 13 })).toEqual(["months: Pick 1 to 12"]);
  });

  test("Waive, Cancel Advance and Exclude need a reason of 10 to 500 characters", () => {
    for (const [schema, extra] of [[c.deductions.DeductionWaive, {}], [c.deductions.AdvanceCancel, {}], [c.payroll.PayrollRunExclude, { employee_id: UUID }]]) {
      expect(schema.safeParse({ ...extra, reason: "Paid in full elsewhere" }).success).toBe(true);
      expect(errors(schema, { ...extra, reason: "Short" })).toEqual(["reason: At least 10 characters"]);
      expect(errors(schema, { ...extra, reason: "x".repeat(501) })).toEqual(["reason: At most 500 characters"]);
    }
  });

  test("a setting change names a date and at least one thing to change; the pay day is 1 to 31", () => {
    expect(c.payroll.PayrollSettingsChange.safeParse({ effective_from: "2026-12-01", pay_day: 28 }).success).toBe(true);
    expect(c.payroll.PayrollSettingsChange.safeParse({ effective_from: "2026-12-01", advanced_enabled: true, paye_basis: "monthly", pension_reduces_taxable: false, nhf_reduces_taxable: true, require_bank_details: true, reason: "Rates confirmed" }).success).toBe(true);
    expect(errors(c.payroll.PayrollSettingsChange, { effective_from: "2026-12-01" })).toEqual(["effective_from: Nothing to change"]);
    expect(errors(c.payroll.PayrollSettingsChange, { effective_from: "2026-12-01", reason: "Why" })).toEqual(["effective_from: Nothing to change"]);
    expect(errors(c.payroll.PayrollSettingsChange, { effective_from: "2026-12-01", pay_day: 0 })).toEqual(["pay_day: Pick 1 to 31"]);
    expect(errors(c.payroll.PayrollSettingsChange, { effective_from: "2026-12-01", pay_day: 32 })).toEqual(["pay_day: Pick 1 to 31"]);
    expect(errors(c.payroll.PayrollSettingsChange, { advanced_enabled: true })).toHaveLength(1);
    expect(errors(c.payroll.PayrollSettingsChange, { effective_from: "2026-12-01", paye_basis: "weekly" })).toHaveLength(1);
  });

  test("every field message in these schemas is four words or fewer", () => {
    const bad = [
      [c.payroll.PayrollRunCreate, { period: "2026-10-15" }],
      [c.payroll.PayrollAdjustmentAdd, { employee_id: UUID, kind: "earning", label: "x".repeat(61), amount: "0", reason: "" }],
      [c.payroll.PayrollSettingsChange, { effective_from: "2026-12-01", pay_day: 40 }],
      [c.deductions.DeductionAccept, { months: 13, start_period: "2026-10-09" }],
      [c.deductions.DeductionWaive, { reason: "x" }],
      [c.deductions.AdvanceRecord, { employee_id: UUID, amount: "0", granted_on: "2026-10-20", months: 20, start_period: "2026-11-09", reason: "x" }],
    ];
    const messages = bad.flatMap(([schema, value]) => errors(schema, value));
    expect(messages.length).toBeGreaterThan(8);
    expect(messages.filter((m) => words(m) > 4)).toEqual([]);
  });
});

describe("the lists", () => {
  test("each takes only its own filters and sorts, 25 a page and no page size", () => {
    const q = c.payroll.PayrollRunListQuery;
    expect(q.parse({ year: "2026", status: "draft", sort: "-period" })).toEqual({ page: 1, year: 2026, status: "draft", sort: { field: "period", dir: "desc" } });
    expect(errors(q, { sort: "net_pay" })).toHaveLength(1);
    expect(errors(q, { limit: "500" })).toHaveLength(1);
    expect(errors(q, { page_size: "500" })).toHaveLength(1);

    const p = c.payslips.PayslipListQuery;
    expect(p.parse({ sort: "-net_pay", run_id: UUID, status: "published", q: "ada" })).toMatchObject({ sort: { field: "net_pay", dir: "desc" }, status: "published", q: "ada" });
    expect(errors(p, { sort: "gross_pay" })).toHaveLength(1);

    const d = c.deductions.DeductionListQuery;
    expect(d.parse({ status: "pending", source: "fine", month: "2026-10", sort: "-amount" })).toMatchObject({ month: "2026-10", sort: { field: "amount", dir: "desc" } });
    expect(errors(d, { status: "cancelled" })).toHaveLength(1);
    expect(errors(d, { source: "loan" })).toHaveLength(1);
    expect(errors(d, { month: "2026-13" })).toHaveLength(1);
    expect(d.shape.sort).toBeDefined();

    expect(c.payslips.EssPayslipQuery.parse({ year: "2026" })).toEqual({ page: 1, year: 2026 });
    expect(c.payslips.EssPayslipQuery.shape.sort).toBeUndefined();
  });

  test("a page holds at most 25 rows", () => {
    const row = { payroll_problem: true };
    expect(c.payroll.PayrollProblemPage.shape.data.element).toBe(c.payroll.PayrollProblem);
    for (const page of [c.payroll.PayrollRunPage, c.payroll.PayrollProblemPage, c.payroll.PayrollAdjustmentPage, c.payslips.PayslipPage, c.payslips.EssDeductionPage, c.deductions.DeductionPage]) {
      expect(page.safeParse({ data: Array.from({ length: 26 }, () => row), page: { number: 1, size: 25, total: 26, pages: 2, has_next: true } }).success).toBe(false);
    }
  });
});

describe("a statutory CHECK list is the contract's", () => {
  test("a payslip line's codes are the sixteen the guide lists, the statutory six among them", () => {
    expect(c.payslips.PayslipLineCode.options).toHaveLength(17);
    expect(c.payslips.PayslipLineCode.options).toEqual(expect.arrayContaining(["paye", "pension_employee", "pension_employer", "nhf", "itf", "nsitf"]));
    expect(c.payroll.RunStatus.options).toEqual(["draft", "computed", "submitted", "approved", "paid"]);
    expect(c.deductions.InstalmentStatus.options).toEqual(["scheduled", "in_run", "applied", "cancelled"]);
  });
});

describe("amounts derived from a salary carry the names the salary mask governs (guide §6.13)", () => {
  const salary = mask.maskedPropsFor(["employee.salary"]);
  const bank = mask.maskedPropsFor(["employee.bank"]);

  test("the mask names gross_pay, total_deductions, net_pay, pay_amount and employer_cost", () => {
    for (const name of ["gross_pay", "total_deductions", "net_pay", "pay_amount", "employer_cost", "gross_monthly"]) expect(salary.has(name)).toBe(true);
    for (const name of ["bank_name", "account_last4", "account_number"]) expect(bank.has(name)).toBe(true);
  });

  test("a bare amount is not masked, so a budget or an expense is never hidden by it", () => {
    expect(salary.has("amount")).toBe(false);
    expect(salary.has("total_amount")).toBe(false);
  });

  test("masking a run, a payslip and a deduction nulls the money and keeps the shape", () => {
    const data = {
      data: [
        { number: "PAY-2026-10", headcount: 25, gross_pay: "9.00", total_deductions: "1.00", net_pay: "8.00", employer_cost: "2.00", bank_name: "GTBank", account_last4: "6789" },
        { lines: [{ label: "Monthly Pay", pay_amount: "9.00" }], amount: "5.00" },
      ],
    };
    expect(mask.maskData(data, ["employee.salary", "employee.bank"])).toEqual({
      data: [
        { number: "PAY-2026-10", headcount: 25, gross_pay: null, total_deductions: null, net_pay: null, employer_cost: null, bank_name: null, account_last4: null },
        { lines: [{ label: "Monthly Pay", pay_amount: null }], amount: "5.00" },
      ],
    });
  });

  test("every salary-derived key in the three contracts is either masked or a count, a flag or text", () => {
    const money = (shape, key) => key in shape && /ZodNullable|ZodString/.test(shape[key]._def.typeName);
    expect(money(c.payroll.PayrollRun.shape, "net_pay")).toBe(true);
    for (const key of ["gross_pay", "total_deductions", "net_pay", "employer_cost"]) expect(c.payroll.PayrollRun.shape[key].isNullable()).toBe(true);
    for (const key of ["gross_pay", "total_deductions", "net_pay", "gross_monthly"]) expect(c.payslips.PayslipDetail.shape[key].isNullable()).toBe(true);
    for (const schema of [c.payroll.PayrollAdjustment, c.payslips.PayslipLine, c.payslips.EssDeductionRow, c.deductions.DeductionRow, c.payslips.PayslipLineItem]) {
      expect(schema.shape.pay_amount.isNullable()).toBe(true);
    }
    // A column called amount would be left unmasked: only the requests that take money in use it.
    for (const schema of [c.payroll.PayrollAdjustment, c.payslips.PayslipLine, c.payslips.EssDeductionRow, c.deductions.DeductionRow]) {
      expect(Object.keys(schema.shape)).not.toContain("amount");
    }
  });
});

describe("the wiring", () => {
  test("Payroll has four tabs; Salary Structure and Statutory are retired, and their entity types open Configurations", () => {
    expect(routeMap.SCREENS.payroll).toEqual(["payroll-runs", "payslips", "deductions", "configurations"]);
    expect(routeMap.linkFor("salary_structure", "x")).toMatchObject({ module: "payroll", tab: "configurations" });
    expect(routeMap.linkFor("statutory_return", "x")).toMatchObject({ module: "payroll", tab: "configurations" });
    expect(routeMap.linkFor("payroll_run", "r1").path).toBe("/payroll?tab=payroll-runs&id=r1");
    expect(routeMap.linkFor("deduction", "d1").path).toBe("/payroll?tab=deductions&id=d1");
    expect(routeMap.linkFor("payslip", "p1").path).toBe("/payroll?tab=payslips&id=p1");
    expect(routeMap.linkFor("payslip", "p1", { self: true }).path).toBe("/ess?tab=my-payslips&id=p1");
  });

  test("⌘K lists the four tabs and none of the retired ones", () => {
    const payroll = screens.SCREENS.filter((s) => s.module === "payroll").map((s) => s.tab);
    expect(payroll).toEqual(["payroll-runs", "payslips", "deductions", "configurations"]);
    const configurations = screens.SCREENS.find((s) => s.module === "payroll" && s.tab === "configurations");
    expect(configurations.label).toBe("Configurations");
    expect(configurations.words).toEqual(expect.arrayContaining(["advanced payroll", "pay day", "paye", "pension", "grades"]));
  });

  test("payroll.configure is catalogued under payroll, and payroll.run is a CEO-only approval that carries money", () => {
    const cap = catalog.CAPABILITY_CATALOG.find((x) => x.code === "payroll.configure");
    expect(cap).toMatchObject({ module: "payroll", label: "Configure Payroll" });
    expect(catalog.isModule(cap.module)).toBe(true);
    const def = definitions.DEFAULTS["payroll.run"];
    expect(definitions.problemsOf(def)).toEqual([]);
    expect(def.stages).toHaveLength(1);
    expect(def.stages[0].approver).toEqual({ type: "ceo" });
    expect(def.context).toEqual({ net_total: "money" });
  });

  test("the app's shell lists the same four tabs and Coming Soon says what each will do", () => {
    const read = (rel) => fs.readFileSync(path.join(__dirname, "..", "..", rel), "utf8");
    const catalogue = read("app/src/shell/catalogue.ts");
    expect(catalogue).toContain('t("Payroll Runs", "payroll-runs"), t("Payslips", "payslips"), t("Deductions", "deductions"), t("Configurations", "configurations")');
    expect(catalogue).not.toMatch(/salary-structure|"statutory"/);
    const coming = read("app/src/shell/coming-soon.ts");
    for (const tab of ["payroll-runs", "payslips", "deductions", "configurations"]) expect(coming).toContain(`"payroll/${tab}"`);
    expect(coming).not.toMatch(/payroll\/(salary-structure|statutory)/);
    expect(coming).not.toMatch(/Bank file/);
  });
});
