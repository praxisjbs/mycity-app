"use strict";
/**
 * The statutory engine and its rates, with no database (docs/guides/payroll.md §6.12): each item, the PAYE bands, the
 * relief as a flat amount and a rate, both PAYE bases and both reducing conventions, an item with no row not computed,
 * employer lines out of the net, the save's checks (its legal source among them), an unset PAYE basis, the report's
 * template with each item's source, and the routes' grants. The runs against
 * the real migrations are tests/integration/payroll-advanced.test.js.
 *
 * THE RATES HERE ARE TEST RATES: round figures invented for this file so the expected amounts can be worked by hand.
 * None is Nigerian law, none is in any seed, and none may be copied into one (§6.12 rule 5). Their source is a TEST
 * SOURCE, labelled so: no instrument says any of them.
 */
const c = require("@mycity/contract");
const calc = require("../payroll/payroll.calc");
const rates = require("./statutory.rates");
const report = require("./statutory.report");
const { routesOf } = require("../../http/route");
const { render, parse } = require("../../shared/documents/render");
const variables = require("../../shared/templates/variables");
const templates = require("../../shared/templates/template-store");

/** TEST RATES (invented): annual PAYE bands 10% to 1,000,000.00 and 20% above; relief 100,000.00 + 10%. */
const TEST = Object.freeze({
  paye: {
    base: "taxable",
    bands: [
      { band_from: "0.00", band_to: "1000000.00", rate: "10", position: 1 },
      { band_from: "1000000.00", band_to: null, rate: "20", position: 2 },
    ],
  },
  relief: { base: "gross", rate: "10", flat_amount: "100000.00" },
  pension_employee: { base: "pensionable", rate: "5" },
  pension_employer: { base: "pensionable", rate: "6" },
  nhf: { base: "basic", rate: "2" },
  itf: { base: "annual_payroll", rate: "1" },
  nsitf: { base: "annual_payroll", rate: "1" },
});
const REDUCING = { paye_basis: "annualised", pension_reduces_taxable: true, nhf_reduces_taxable: true };
/** A TEST SOURCE, labelled: no instrument says any of the test rates; it only satisfies the rule that every version names one. */
const SOURCE = Object.freeze({ source_title: "TEST SOURCE, not a law", source_section: "Test section 1", source_checked_on: "2026-11-10" });
const NO_SOURCE = Object.freeze({ no_legal_source: true, no_source_reason: "Test rate for this file, not a law" });
const amountsOf = (lines) => Object.fromEntries(lines.map((l) => [l.code, l.amount]));

describe("computeStatutory (§6.12), on TEST RATES", () => {
  const person = { gross: "200000.00", basic: "100000.00", pensionable: "150000.00" };

  test("annualised, pension and NHF reducing the taxable pay: every item worked by hand", () => {
    // Pension 5% of 150,000.00 = 7,500.00; NHF 2% of 100,000.00 = 2,000.00. Taxable a year: 2,400,000.00 less relief
    // (100,000.00 + 240,000.00), less 90,000.00 and 24,000.00 = 1,946,000.00; tax 100,000.00 + 189,200.00 = 289,200.00,
    // 24,100.00 a month. Employer pension 6% = 9,000.00; ITF and NSITF 1% of 200,000.00 = 2,000.00 each.
    const lines = calc.computeStatutory({ ...person, rates: TEST, conventions: REDUCING });
    expect(lines.map((l) => [l.kind, l.code, l.label, l.amount, l.base_amount])).toEqual([
      ["deduction", "pension_employee", "Pension", "7500.00", "150000.00"],
      ["deduction", "nhf", "NHF", "2000.00", "100000.00"],
      ["deduction", "paye", "PAYE", "24100.00", "162166.67"],
      ["employer", "pension_employer", "Employer Pension", "9000.00", "150000.00"],
      ["employer", "itf", "ITF", "2000.00", "200000.00"],
      ["employer", "nsitf", "NSITF", "2000.00", "200000.00"],
    ]);
    expect(lines.find((l) => l.code === "nhf").detail).toBe("2%");
  });

  test("monthly bands, nothing reducing the taxable pay: the same TEST bands read as monthly amounts", () => {
    // Relief 100,000.00 + 20,000.00; taxable 200,000.00 less 120,000.00 = 80,000.00; 10% = 8,000.00.
    const lines = calc.computeStatutory({ ...person, rates: TEST, conventions: { paye_basis: "monthly", pension_reduces_taxable: false, nhf_reduces_taxable: false } });
    expect(amountsOf(lines).paye).toBe("8000.00");
    expect(lines.find((l) => l.code === "paye").base_amount).toBe("80000.00");
  });

  test("each convention moves PAYE on its own", () => {
    const paye = (conventions) => amountsOf(calc.computeStatutory({ ...person, rates: TEST, conventions })).paye;
    const neither = paye({ paye_basis: "annualised", pension_reduces_taxable: false, nhf_reduces_taxable: false });
    const pensionOnly = paye({ paye_basis: "annualised", pension_reduces_taxable: true, nhf_reduces_taxable: false });
    const nhfOnly = paye({ paye_basis: "annualised", pension_reduces_taxable: false, nhf_reduces_taxable: true });
    // 2,060,000.00 taxable a year: 100,000.00 + 212,000.00 = 312,000.00, 26,000.00 a month. Pension takes 90,000.00 a
    // year off at 20% (1,500.00 a month); NHF 24,000.00 (400.00 a month).
    expect([neither, pensionOnly, nhfOnly]).toEqual(["26000.00", "24500.00", "25600.00"]);
  });

  test("the relief is a flat amount, a rate, or both", () => {
    const paye = (relief) => amountsOf(calc.computeStatutory({ ...person, rates: { paye: TEST.paye, ...(relief && { relief }) }, conventions: REDUCING })).paye;
    // No relief: 2,400,000.00 taxable, 380,000.00 a year. Flat 100,000.00: 2,300,000.00, 360,000.00. Rate 10%:
    // 2,160,000.00, 332,000.00. Both: 2,060,000.00, 312,000.00.
    expect(paye(null)).toBe("31666.67");
    expect(paye({ base: "gross", rate: "0", flat_amount: "100000.00" })).toBe("30000.00");
    expect(paye({ base: "gross", rate: "10", flat_amount: "0.00" })).toBe("27666.67");
    expect(paye(TEST.relief)).toBe("26000.00");
  });

  test("an item with no row is not computed, and with no PAYE table there is no PAYE line", () => {
    const lines = calc.computeStatutory({ ...person, rates: { pension_employee: TEST.pension_employee }, conventions: REDUCING });
    expect(lines.map((l) => l.code)).toEqual(["pension_employee"]);
    expect(calc.computeStatutory({ ...person, rates: {}, conventions: REDUCING })).toEqual([]);
  });

  test("the taxable pay never goes below nothing, and a band below the taxable pay is not taxed", () => {
    const small = calc.computeStatutory({ gross: "5000.00", basic: "5000.00", pensionable: "5000.00", rates: { paye: TEST.paye, relief: TEST.relief }, conventions: REDUCING });
    expect(small).toEqual([]);
    expect(calc.progressiveTax("1000000.00", TEST.paye.bands).toFixed(2)).toBe("100000.00");
    expect(calc.progressiveTax("1000001.00", TEST.paye.bands).toFixed(2)).toBe("100000.20");
    expect(calc.progressiveTax("0", TEST.paye.bands).toFixed(2)).toBe("0.00");
  });

  test("a line is rounded once, half up, from full precision", () => {
    const lines = calc.computeStatutory({ gross: "333333.33", basic: "333333.33", pensionable: "333333.33", rates: { pension_employee: { base: "pensionable", rate: "7.5" } }, conventions: REDUCING });
    // 7.5% of 333,333.33 is 24,999.99975.
    expect(amountsOf(lines).pension_employee).toBe("25000.00");
  });

  test("a convention left unset is a defect, never a default", () => {
    for (const missing of ["paye_basis", "pension_reduces_taxable", "nhf_reduces_taxable"])
      expect(() => calc.computeStatutory({ ...person, rates: TEST, conventions: { ...REDUCING, [missing]: null } })).toThrow(new RegExp(missing));
  });
});

describe("a payslip in advanced mode (§6.3 rule 4, §6.11 rule 6, §6.12 rule 2)", () => {
  const FULL = { workingDays: 26, daysPaid: 26, calendarDays: 31, calendarPaid: 31 };
  const split = [
    { id: "c-basic", code: "basic", label: "Basic", amount: "250000.00", pensionable: true },
    { id: "c-housing", code: "housing", label: "Housing", amount: "150000.00", pensionable: true },
    { id: "c-transport", code: "transport", label: "Transport", amount: "50000.00", pensionable: false },
  ];
  const base = { gross: "450000.00", part: FULL, overtime: [], deductions: {}, unpaidLeave: [], unpaidSuspension: [], instalments: [], adjustments: [] };

  test("the split makes the earnings, the statutory deductions come first, and employer charges stay out of the net", () => {
    const lines = calc.buildLines({ ...base, components: split, statutory: { rates: TEST, conventions: REDUCING } });
    expect(lines.map((l) => [l.position, l.kind, l.label, l.amount, l.source_id])).toEqual([
      [1, "earning", "Basic", "250000.00", "c-basic"],
      [2, "earning", "Housing", "150000.00", "c-housing"],
      [3, "earning", "Transport", "50000.00", "c-transport"],
      [4, "deduction", "Pension", "20000.00", null],
      [5, "deduction", "NHF", "5000.00", null],
      [6, "deduction", "PAYE", "66000.00", null],
      [7, "employer", "Employer Pension", "24000.00", null],
      [8, "employer", "ITF", "4500.00", null],
      [9, "employer", "NSITF", "4500.00", null],
    ]);
    expect(calc.totalsOf(lines)).toEqual({ earnings_total: "450000.00", deductions_total: "91000.00", employer_total: "33000.00", net_pay: "359000.00" });
  });

  test("a part month prorates each component, rounded once, and the bases follow what is paid", () => {
    const part = { workingDays: 26, daysPaid: 16, calendarDays: 31, calendarPaid: 18 };
    const pay = calc.componentPay(split, part);
    // 250,000.00 × 16 / 26 = 153,846.153…; 150,000.00 → 92,307.69; 50,000.00 → 30,769.23.
    expect(pay.lines.map((l) => l.amount)).toEqual(["153846.15", "92307.69", "30769.23"]);
    expect([pay.basic, pay.pensionable]).toEqual(["153846.15", "246153.84"]);
  });

  test("simple mode never computes a statutory line, whatever rates exist, and prints one Monthly Pay", () => {
    const lines = calc.buildLines({ ...base, components: split, statutory: null });
    expect(lines.map((l) => [l.code, l.label])).toEqual([["monthly_pay", "Monthly Pay"]]);
  });

  test("with no split in advanced mode, Monthly Pay is the basic and pensionable base", () => {
    const lines = calc.buildLines({ ...base, components: null, statutory: { rates: { pension_employee: TEST.pension_employee, nhf: TEST.nhf }, conventions: REDUCING } });
    expect(lines.map((l) => [l.label, l.amount, l.source_type])).toEqual([
      ["Monthly Pay", "450000.00", null],
      ["Pension", "22500.00", null],
      ["NHF", "9000.00", null],
    ]);
  });
});

describe("a version as it is entered (StatutoryRatesSave)", () => {
  const S = c.statutory.StatutoryRatesSave;
  const fields = (r) => Object.fromEntries(r.error.issues.map((i) => [i.path.join("."), i.message]));

  test("PAYE takes contiguous bands from nothing, only the last open", () => {
    expect(S.safeParse({ item: "paye", effective_from: "2026-12-01", bands: TEST.paye.bands.map(({ position, ...b }) => b), ...SOURCE }).success).toBe(true);
    const r = S.safeParse({
      item: "paye",
      effective_from: "2026-12-01",
      ...SOURCE,
      bands: [
        { band_from: "10.00", band_to: "100.00", rate: "5" },
        { band_from: "200.00", band_to: "150.00", rate: "10" },
        { band_from: "150.00", band_to: null, rate: "20" },
      ],
    });
    expect(fields(r)).toEqual({
      "bands.0.band_from": "Start at zero",
      "bands.1.band_from": "Start where last ends",
      "bands.1.band_to": "Above its start",
    });
    expect(fields(S.safeParse({ item: "paye", effective_from: "2026-12-01", ...SOURCE }))).toEqual({ bands: "Enter the bands" });
  });

  test("a rate is a percentage up to 100; the relief needs an amount or a rate; other items one rate", () => {
    const at = { effective_from: "2026-12-01", ...SOURCE };
    expect(fields(S.safeParse({ item: "nhf", ...at, rate: "101" }))).toEqual({ rate: "At most 100" });
    expect(fields(S.safeParse({ item: "nhf", ...at, rate: "two" }))).toEqual({ rate: "Enter a rate" });
    expect(fields(S.safeParse({ item: "nhf", ...at }))).toEqual({ rate: "Enter a rate" });
    expect(fields(S.safeParse({ item: "relief", ...at, rate: "0", flat_amount: "0.00" }))).toEqual({ flat_amount: "Enter an amount or rate" });
    expect(fields(S.safeParse({ item: "itf", ...at, rate: "1", flat_amount: "5.00" }))).toEqual({ flat_amount: "Only relief has one" });
    expect(fields(S.safeParse({ item: "itf", ...at, rate: "1", base: "basic" }))).toEqual({ base: "Not a base for this" });
  });

  test("every version names its source, or No Legal Source with a reason; never neither, never both (§6.12 rule 12)", () => {
    const at = { item: "nhf", rate: "2", effective_from: "2026-12-01" };
    // Neither: each missing part on its own field, carrying SOURCE_REQUIRED so the API answers with it.
    const none = S.safeParse(at);
    expect(fields(none)).toEqual({ source_title: "Name the source", source_section: "Name the section", source_checked_on: "Pick the day checked" });
    expect(none.error.issues.every((i) => i.params && i.params.code === "SOURCE_REQUIRED")).toBe(true);
    expect(fields(S.safeParse({ ...at, source_title: "TEST SOURCE" }))).toEqual({ source_section: "Name the section", source_checked_on: "Pick the day checked" });
    // An empty text field is not sent: it counts as missing.
    expect(fields(S.safeParse({ ...at, ...SOURCE, source_title: "  " }))).toEqual({ source_title: "Name the source" });
    expect(S.safeParse({ ...at, ...SOURCE }).success).toBe(true);
    expect(S.safeParse({ ...at, ...SOURCE, source_url: "https://example.test/test-source.pdf", source_document_id: "00000000-0000-4000-8000-000000000009" }).success).toBe(true);
    expect(fields(S.safeParse({ ...at, ...SOURCE, source_url: "javascript:alert(1)" }))).toEqual({ source_url: "Not a link" });
    expect(fields(S.safeParse({ ...at, ...SOURCE, source_url: "not a link" }))).toEqual({ source_url: "Not a link" });
    // No Legal Source: a reason of 10 to 500 characters and nothing of a source.
    expect(S.safeParse({ ...at, ...NO_SOURCE }).success).toBe(true);
    const noReason = S.safeParse({ ...at, no_legal_source: true });
    expect(fields(noReason)).toEqual({ no_source_reason: "Give a reason" });
    expect(noReason.error.issues[0].params).toEqual({ code: "SOURCE_REQUIRED" });
    expect(fields(S.safeParse({ ...at, no_legal_source: true, no_source_reason: "Too short" }))).toEqual({ no_source_reason: "At least 10 characters" });
    expect(fields(S.safeParse({ ...at, ...NO_SOURCE, source_title: "TEST SOURCE" }))).toEqual({ source_title: "Not with No Source" });
    expect(fields(S.safeParse({ ...at, ...SOURCE, no_source_reason: "A reason without the box ticked" }))).toEqual({ no_source_reason: "Only with No Source" });
    // A PAYE table names its source once, for every band.
    expect(fields(S.safeParse({ item: "paye", effective_from: "2026-12-01", bands: TEST.paye.bands.map(({ position, ...b }) => b) }))).toMatchObject({ source_title: "Name the source" });
  });

  test("the API answers a missing source with SOURCE_REQUIRED, and anything else refused with it as VALIDATION_FAILED", async () => {
    const { validator } = require("../../shared/http/validate");
    const refuse = (body) =>
      new Promise((resolve) => validator({ body: S })({ body, params: {}, query: {} }, {}, (err) => resolve(err ? { code: err.code, status: err.status, fields: err.fields } : null)));
    expect(await refuse({ item: "nhf", rate: "2", effective_from: "2026-12-01" })).toMatchObject({ code: "SOURCE_REQUIRED", status: 422, fields: { source_title: ["Name the source"] } });
    expect(await refuse({ item: "nhf", rate: "x", effective_from: "2026-12-01" })).toMatchObject({ code: "VALIDATION_FAILED", fields: { rate: ["Enter a rate"], source_title: ["Name the source"] } });
    expect(await refuse({ item: "nhf", rate: "2", effective_from: "2026-12-01", ...SOURCE })).toBeNull();
  });

  test("the rows written: the side is code, the base the item's own unless another allowed one is named", () => {
    const paye = rates.rowsOf({ item: "paye", effective_from: "2026-12-01", bands: TEST.paye.bands, ...SOURCE }, "u1");
    expect(paye.map((r) => [r.kind, r.base, r.position, r.band_from, r.band_to, r.source_title])).toEqual([
      ["employee", "taxable", 1, "0.00", "1000000.00", "TEST SOURCE, not a law"],
      ["employee", "taxable", 2, "1000000.00", null, "TEST SOURCE, not a law"],
    ]);
    expect(rates.rowsOf({ item: "pension_employer", rate: "6", ...SOURCE }, null)).toEqual([
      {
        item: "pension_employer",
        kind: "employer",
        base: "pensionable",
        rate: "6",
        no_legal_source: false,
        no_source_reason: null,
        source_title: "TEST SOURCE, not a law",
        source_section: "Test section 1",
        source_url: null,
        source_document_id: null,
        source_checked_on: "2026-11-10",
        created_by: null,
      },
    ]);
    // No Legal Source writes its reason and nothing of a source, as statutory_rate_source_check holds it.
    expect(rates.rowsOf({ item: "itf", rate: "1", ...NO_SOURCE }, null)[0]).toMatchObject({
      no_legal_source: true,
      no_source_reason: "Test rate for this file, not a law",
      source_title: null,
      source_section: null,
      source_checked_on: null,
    });
    expect(rates.rowsOf({ item: "nhf", rate: "2", base: "gross", ...SOURCE }, null)[0].base).toBe("gross");
    expect(rates.rowsOf({ item: "relief", flat_amount: "100.00", ...SOURCE }, null)[0]).toMatchObject({ rate: "0", flat_amount: "100.00" });
    expect(Object.keys(c.statutory.ITEM_BASES).sort()).toEqual(Object.keys(c.statutory.ITEM_KIND).sort());
  });

  test("a stored row reads as the contract's StatutoryRate", () => {
    const row = { statutory_rate_id: "00000000-0000-4000-8000-000000000001", item: "nhf", kind: "employee", base: "basic", rate: "2.500000", band_from: null, band_to: null, flat_amount: null, position: null, effective_from: "2026-12-01", effective_to: null, ...SOURCE, source_url: null, source_document_id: null, no_legal_source: false, no_source_reason: null, created_by_name: null, created_at: new Date("2026-11-10T09:00:00Z") };
    expect(c.statutory.StatutoryRate.parse(rates.present(row))).toMatchObject({ rate: "2.5", position: null, source_title: "TEST SOURCE, not a law", no_legal_source: false });
  });

  test("an unset PAYE basis reads as annualised; the two flags have no default (§13.2 item 32)", () => {
    const settings = require("../payroll/payroll.config.repo");
    expect(settings.REQUIRED_CONVENTIONS).toEqual(["pension_reduces_taxable", "nhf_reduces_taxable"]);
    expect(settings.conventionsOf({ paye_basis: null, pension_reduces_taxable: true, nhf_reduces_taxable: false })).toEqual({ paye_basis: "annualised", pension_reduces_taxable: true, nhf_reduces_taxable: false });
    expect(settings.conventionsOf({ paye_basis: "monthly", pension_reduces_taxable: null, nhf_reduces_taxable: null })).toEqual({ paye_basis: "monthly", pension_reduces_taxable: null, nhf_reduces_taxable: null });
    // An unset basis computes exactly as annualised does.
    const person = { gross: "200000.00", basic: "100000.00", pensionable: "150000.00" };
    const unset = calc.computeStatutory({ ...person, rates: TEST, conventions: settings.conventionsOf({ pension_reduces_taxable: true, nhf_reduces_taxable: true }) });
    expect(unset).toEqual(calc.computeStatutory({ ...person, rates: TEST, conventions: REDUCING }));
  });
});

describe("the statutory report (§6.12 rule 6)", () => {
  const run = {
    number: "PAY-2026-10",
    period: "2026-10-01",
    status: "approved",
    config_snapshot: {
      conventions: REDUCING,
      statutory_rates: [
        { item: "paye", base: "taxable", rate: "10", ...SOURCE, source_url: "https://example.test/test-source.pdf", no_legal_source: false, no_source_reason: null },
        { item: "pension_employee", base: "pensionable", rate: "5", ...NO_SOURCE },
        // A row of a snapshot taken before sources were kept: it has none of the source keys.
        { item: "itf", base: "annual_payroll", rate: "1" },
        { item: "relief", base: "gross", rate: "10", flat_amount: "100000.00", ...NO_SOURCE },
      ],
    },
  };
  const line = (code, kind, who, amount, base, extra = {}) => ({ code, kind, amount, base_amount: base, employee_name: who, staff_number: "T0001", detail: null, tax_id: null, pension_pin: null, nhf_number: null, ...extra });
  const lines = [
    line("paye", "deduction", "Ada Tester", "66000.00", "371666.67", { tax_id: "TIN-TEST" }),
    line("paye", "deduction", "Bola Tester", "39800.00", "240666.67"),
    line("pension_employee", "deduction", "Ada Tester", "20000.00", "400000.00", { pension_pin: "PEN-TEST" }),
    line("itf", "employer", "Ada Tester", "4500.00", "450000.00"),
  ];

  test("per item and per person, the base and the amount, the totals and the conventions, every value printed", () => {
    const vars = report.varsOf(run, lines);
    expect(c.statutory.StatutoryReportVars.parse(vars)).toEqual(vars);
    expect(vars).toMatchObject({
      number: "PAY-2026-10",
      period_label: "October 2026",
      status_label: "Approved",
      paye_basis_label: "Annualised",
      pension_reduces_label: "Yes",
      employee_total: "₦125,800.00",
      employer_total: "₦4,500.00",
    });
    expect(vars.items.map((i) => [i.label, i.kind_label, i.rate_label, i.base_label, i.number_label, i.total])).toEqual([
      ["PAYE", "Employee", "Progressive bands", "taxable pay", "Tax ID", "₦105,800.00"],
      ["Employee Pension", "Employee", "5%", "pensionable pay", "Pension PIN", "₦20,000.00"],
      ["ITF", "Employer", "1%", "payroll", null, "₦4,500.00"],
    ]);
    // Each item's source as the snapshot holds it; a row from before sources were kept reads as 6040 marked it.
    expect(vars.items.map((i) => [i.source_label, i.source_link])).toEqual([
      ["TEST SOURCE, not a law, Test section 1. Checked 10/11/2026", "https://example.test/test-source.pdf"],
      ["No Legal Source: Test rate for this file, not a law", null],
      ["No Legal Source: Entered before sources were required", null],
    ]);
    expect(vars.relief_source_label).toBe("No Legal Source: Test rate for this file, not a law");
    expect(report.varsOf({ ...run, config_snapshot: { ...run.config_snapshot, statutory_rates: [] } }, lines).relief_source_label).toBeNull();
    expect(vars.items[0].rows.map((r) => [r.employee_name, r.statutory_number, r.base, r.amount])).toEqual([
      ["Ada Tester", "TIN-TEST", "₦371,666.67", "₦66,000.00"],
      ["Bola Tester", null, "₦240,666.67", "₦39,800.00"],
    ]);
  });

  test("the template uses only declared variables, prints Not Set for a missing number, and escapes a name", async () => {
    const template = await templates.current({ query: async () => ({ rows: [] }) }, "document", "statutory-report");
    expect(variables.undeclared("document", "statutory-report", parse(template.body))).toEqual([]);
    const vars = report.varsOf(run, [...lines, line("nhf", "deduction", "<script>x</script>", "1.00", "50.00")]);
    const html = render(template.body, vars);
    expect(html).toContain("TIN-TEST");
    expect(html).toContain("Not Set");
    expect(html).not.toContain("<script>x");
    expect(html.match(/<section class="sr-item">/g)).toHaveLength(4);
    expect(html).toContain("Source: TEST SOURCE, not a law, Test section 1. Checked 10/11/2026 · https://example.test/test-source.pdf");
    expect(html).toContain("Relief Source");
    // An employer item has no person's number: no column for it.
    expect(html.indexOf("ITF")).toBeGreaterThan(-1);
  });
});

describe("the routes", () => {
  test("the rates are read with payroll view and entered with payroll edit and payroll.configure", () => {
    const mod = require("./statutory.routes");
    expect(mod.basePath).toBe("/statutory");
    expect(routesOf(mod.router).map((r) => [r.method, r.path, r.permission, r.capability || null])).toEqual([
      ["GET", "/rates", { key: "payroll", action: "view" }, null],
      ["GET", "/items", { key: "payroll", action: "view" }, null],
      ["POST", "/rates", { key: "payroll", action: "edit" }, "payroll.configure"],
      ["DELETE", "/rates/:item/versions/:effective_from", { key: "payroll", action: "edit" }, "payroll.configure"],
    ]);
  });

  test("the setting is changed with payroll.configure and the report asked for with payroll export", () => {
    const routes = routesOf(require("../payroll/payroll.routes").router);
    const find = (method, path) => routes.find((r) => r.method === method && r.path === path);
    expect(find("GET", "/settings")).toMatchObject({ permission: { key: "payroll", action: "view" } });
    expect(find("PATCH", "/settings")).toMatchObject({ permission: { key: "payroll", action: "edit" }, capability: "payroll.configure" });
    expect(find("DELETE", "/settings/versions/:effective_from")).toMatchObject({ permission: { key: "payroll", action: "edit" }, capability: "payroll.configure" });
    expect(find("POST", "/runs/:id/statutory-report")).toMatchObject({ permission: { key: "payroll", action: "export" } });
  });
});
