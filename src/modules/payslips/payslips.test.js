"use strict";
/**
 * Payslips with no database (docs/guides/payroll.md §6.10, §6.11): what a payslip prints, the line groups the
 * breakdown reads, and the pay date a payslip and Next Payday use. The rest is tests/integration/payslips.test.js.
 */
const c = require("@mycity/contract");
const pdf = require("./payslips.pdf");
const repo = require("./payslips.repo");
const breakdown = require("./payslips.breakdown");
const settings = require("../payroll/payroll.config.repo");
const { render, parse } = require("../../shared/documents/render");
const variables = require("../../shared/templates/variables");
const templates = require("../../shared/templates/template-store");
const types = require("../../shared/documents/types");

const STATUTORY = /PAYE|pension|\btax\b|\bNHF\b|\bITF\b|NSITF/i;

/** The worked example of §6.14 as the print rows read it. */
const ROW = {
  payslip_id: "00000000-0000-4000-8000-000000000001",
  number: "PAY-2026-10-0001",
  employee_id: "00000000-0000-4000-8000-000000000002",
  period: "2026-10-01",
  run_paid_on: null,
  employee_name: "Ada Obi",
  staff_number: "00042",
  job_title: "Operations Associate",
  department: "Operations",
  working_days: 26,
  working_days_paid: 26,
  bank_name: "Sample Bank",
  account_last4: "1234",
  earnings_total: "458000.00",
  deductions_total: "95423.07",
  net_pay: "362576.93",
};
const LINES = [
  { kind: "earning", label: "Monthly Pay", detail: null, amount: "450000.00" },
  { kind: "earning", label: "Overtime", detail: "1 day", amount: "8000.00" },
  { kind: "deduction", label: "Lateness", detail: "2 late arrivals", amount: "3500.00" },
  { kind: "deduction", label: "Absence", detail: "1 absence", amount: "17307.69" },
  { kind: "deduction", label: "Unpaid Leave", detail: "2 days, 12 to 13 October", amount: "34615.38" },
  { kind: "deduction", label: "Fine", detail: "QRY-0019, 1 of 3", amount: "15000.00" },
  { kind: "deduction", label: "Salary Advance Repayment", detail: "1 of 3", amount: "25000.00" },
];

describe("what a payslip prints (§6.10 rule 1)", () => {
  test("every value is as it is read: money with the naira sign, the month in words, the day first", () => {
    const vars = pdf.varsOf(ROW, LINES, "2026-10-30");
    expect(vars).toMatchObject({
      number: "PAY-2026-10-0001",
      period_label: "October 2026",
      pay_date_label: "30/10/2026",
      employee_name: "Ada Obi",
      staff_number: "00042",
      working_days: "26 of 26",
      gross_pay: "₦458,000.00",
      total_deductions: "₦95,423.07",
      net_pay: "₦362,576.93",
    });
    expect(vars.earnings).toEqual([
      { label: "Monthly Pay", detail: null, amount: "₦450,000.00" },
      { label: "Overtime", detail: "1 day", amount: "₦8,000.00" },
    ]);
    expect(vars.deductions).toHaveLength(5);
    expect(vars.deductions[4]).toEqual({ label: "Salary Advance Repayment", detail: "1 of 3", amount: "₦25,000.00" });
  });

  test("the variables are the contract's PayslipVars, and a batch is its PayslipBatchVars", () => {
    const vars = pdf.varsOf(ROW, LINES, "2026-10-30");
    expect(c.payslips.PayslipVars.parse(vars)).toEqual(vars);
    const batch = { title: "Payslips, October 2026", period_label: "October 2026", payslips: [vars, vars] };
    expect(c.payslips.PayslipBatchVars.parse(batch)).toEqual(batch);
    expect(() => c.payslips.PayslipVars.parse({ ...vars, net_pay_extra: "x" })).toThrow();
  });

  test("a part month shows the days paid of the days worked, and a person with no bank shows none", () => {
    const part = pdf.varsOf({ ...ROW, working_days_paid: 16, bank_name: null, account_last4: null }, LINES, "2026-10-30");
    expect([part.working_days, part.bank_name, part.account_last4]).toEqual(["16 of 26", null, null]);
    expect(pdf.varsOf({ ...ROW, working_days: null, working_days_paid: null }, [], "2026-10-30").working_days).toBeNull();
  });

  test("employer charges never print: only earnings and deductions reach the document", () => {
    const vars = pdf.varsOf(ROW, [...LINES, { kind: "employer", label: "Employer Contribution", detail: null, amount: "9999.00" }], "2026-10-30");
    expect(JSON.stringify(vars)).not.toContain("Employer");
    expect(JSON.stringify(vars)).not.toContain("9,999");
  });
});

describe("the shipped templates", () => {
  const sample = () => pdf.varsOf(ROW, LINES, "2026-10-30");

  test("the payslip names only variables its contract declares, and prints the slip", async () => {
    const t = templates.current({ query: async () => ({ rows: [] }) }, "document", "payslip");
    const template = await t;
    expect(variables.undeclared("document", "payslip", parse(template.body))).toEqual([]);
    const html = render(template.body, sample());
    for (const text of ["October 2026", "PAY-2026-10-0001", "Ada Obi", "Ending 1234", "30/10/2026", "26 of 26", "Monthly Pay", "₦450,000.00", "Total Earnings", "Total Deductions", "₦95,423.07", "Net Pay", "₦362,576.93", "QRY-0019, 1 of 3"])
      expect([text, html.includes(text)]).toEqual([text, true]);
    expect(html).not.toMatch(STATUTORY);
  });

  test("a value is escaped: a name cannot put markup on a payslip", async () => {
    const template = await templates.current({ query: async () => ({ rows: [] }) }, "document", "payslip");
    const html = render(template.body, { ...sample(), employee_name: "<script>alert(1)</script>" });
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
  });

  test("Download All is one section a person, with a page break between and none after the last", async () => {
    const template = await templates.current({ query: async () => ({ rows: [] }) }, "document", "payslip-batch");
    expect(variables.undeclared("document", "payslip-batch", parse(template.body))).toEqual([]);
    const other = { ...sample(), number: "PAY-2026-10-0002", employee_name: "Bola Okoro" };
    const html = render(template.body, { title: "Payslips, October 2026", period_label: "October 2026", payslips: [sample(), other] });
    expect(html.match(/<section class="pb-slip">/g)).toHaveLength(2);
    expect(html).toMatch(/\.pb-slip \+ \.pb-slip \{ break-before: page/);
    expect(html.indexOf("Ada Obi")).toBeLessThan(html.indexOf("Bola Okoro"));
    expect(html).not.toMatch(STATUTORY);
  });

  test("the email states the month and where to read, never an amount", async () => {
    const template = await templates.current({ query: async () => ({ rows: [] }) }, "email", "payslip-ready");
    expect(template.subject).toBe("Your payslip for {{ period_label }}");
    expect(variables.undeclared("email", "payslip-ready", parse(template.body))).toEqual([]);
    expect(template.body).not.toMatch(/₦|amount|net pay|gross/i);
    expect(`${template.subject} ${template.body}`).not.toMatch(STATUTORY);
  });

  test("a payslip is a restricted document of Payroll, and Download All an export file", () => {
    expect(types.typeOf("payslip")).toMatchObject({ module: "payroll", sensitivity: "restricted", signable: false, export: false });
    expect(types.typeOf("payroll_payslips_export")).toMatchObject({ module: "payroll", sensitivity: "restricted", export: true });
    expect(types.exportTypes()).toContain("payroll_payslips_export");
    expect(types.exportTypes()).not.toContain("payslip");
  });
});

describe("what stands behind a line (§6.10 rule 7)", () => {
  test("the groups are the four lines whose amount is the sum of several pay items, by their attendance kind", () => {
    expect(repo.GROUPS).toEqual({ overtime: "overtime", lateness: "late", early_departure: "early_departure", absence: "absence" });
    expect(breakdown.ITEM_WORDS).toMatchObject({ late: "Late Arrival", early_departure: "Early Departure", absence: "Absence", overtime: "Overtime" });
  });
});

describe("the pay date (§6.11 rule 1, §11)", () => {
  test("the 30th by default, held to a short month's last day, and never moved for a Sunday", () => {
    const date = (setting, period) => settings.payDateOf(setting, period);
    expect(date({ pay_day: null }, "2026-10-01")).toBe("2026-10-30");
    expect(date({ pay_day: null }, "2026-02-01")).toBe("2026-02-28");
    expect(date({ pay_day: null }, "2028-02-01")).toBe("2028-02-29");
    expect(date({ pay_day: 31 }, "2026-04-01")).toBe("2026-04-30");
    expect(date({ pay_day: 25 }, "2026-02-01")).toBe("2026-02-25");
    expect(date({ pay_day: 1 }, "2026-10-01")).toBe("2026-10-01");
    // Sunday 30 August 2026 stays the 30th: the CEO transfers by hand.
    expect(date({ pay_day: null }, "2026-08-01")).toBe("2026-08-30");
  });

  /** A database with no setting row: the defaults. */
  const none = { query: async () => ({ rows: [] }) };

  test("Next Payday is the first pay date on or after today whose month is not paid", async () => {
    const never = () => false;
    expect(await settings.nextPayDate(none, "2026-10-12", never)).toBe("2026-10-30");
    expect(await settings.nextPayDate(none, "2026-10-30", never)).toBe("2026-10-30");
    expect(await settings.nextPayDate(none, "2026-10-31", never)).toBe("2026-11-30");
    expect(await settings.nextPayDate(none, "2027-01-31", never)).toBe("2027-02-28");
    // A month whose run is paid has had its payday: the search moves on.
    expect(await settings.nextPayDate(none, "2026-10-12", (period) => period === "2026-10-01")).toBe("2026-11-30");
  });
});
