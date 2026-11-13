"use strict";
/**
 * The statutory engine and its figures, with no database (docs/guides/payroll.md §6.12, §6.14, §6.16): the worked
 * advanced example to the kobo; PAYE on the year to date with the bands scaled to the months elapsed (a steady earner,
 * a joiner, a refund); rent relief to date; the minimum-wage exemption; NHF by choice; pension's floor of basic,
 * housing and transport; an item with no row not computed; employer lines out of the net; the save's checks (its legal
 * source among them, the retired relief refused); the report with its sources, remittances and State groups; and the
 * routes' grants. The runs against the real migrations are tests/integration/payroll-advanced.test.js.
 *
 * THE FIGURES HERE ARE TEST FIGURES: round numbers invented for this file so the expected amounts can be worked by hand.
 * Their shapes follow §6.16 (a year's bands from nothing, a rate of pensionable pay, NHF on gross, a rate of the year's
 * rent with a cap, a month's minimum wage), but none is Nigerian law, none is in any seed, and none may be copied into
 * one (§6.12 rule 5). Their source is a TEST SOURCE, labelled so: no instrument says any of them.
 */
const c = require("@mycity/contract");
const m = require("../../shared/money/money");
const calc = require("../payroll/payroll.calc");
const rates = require("./statutory.rates");
const report = require("./statutory.report");
const rent = require("../organisation/employee.rent");
const { routesOf } = require("../../http/route");
const { render, parse } = require("../../shared/documents/render");
const variables = require("../../shared/templates/variables");
const templates = require("../../shared/templates/template-store");

/**
 * TEST FIGURES (invented, never the law's): a year's PAYE bands of 0% to 600,000.00, 10% to 2,400,000.00 and 20% above;
 * pension 5% from the person and 7% from MyCity; NHF 2%; ITF and NSITF 0.5%; rent relief 10% of the year's rent, at most
 * 300,000.00; a minimum wage of 50,000.00 a month.
 */
const TEST = Object.freeze({
  paye: {
    base: "taxable",
    bands: [
      { band_from: "0.00", band_to: "600000.00", rate: "0", position: 1 },
      { band_from: "600000.00", band_to: "2400000.00", rate: "10", position: 2 },
      { band_from: "2400000.00", band_to: null, rate: "20", position: 3 },
    ],
  },
  pension_employee: { base: "pensionable", rate: "5" },
  pension_employer: { base: "pensionable", rate: "7" },
  nhf: { base: "gross", rate: "2" },
  itf: { base: "annual_payroll", rate: "0.5" },
  nsitf: { base: "annual_payroll", rate: "0.5" },
  rent_relief: { base: "rent", rate: "10", flat_amount: "300000.00" },
  minimum_wage: { base: "gross", flat_amount: "50000.00" },
});
/** A TEST SOURCE, labelled: no instrument says any of the test figures; it only satisfies the rule that every version names one. */
const SOURCE = Object.freeze({ source_title: "TEST SOURCE, not a law", source_section: "Test section 1", source_checked_on: "2026-11-10" });
const NO_SOURCE = Object.freeze({ no_legal_source: true, no_source_reason: "Test rate for this file, not a law" });
const amountsOf = (lines) => Object.fromEntries(lines.map((l) => [l.code, l.amount]));
const rows = (lines) => lines.map((l) => [l.kind, l.code, l.label, l.amount, l.base_amount]);

/**
 * The worked example of §6.14 (advanced): October 2026, month 10 of the year, a person on 450,000.00 a month who chose NHF,
 * paid the same since January (their year to date: 9 × 418,500.00 taxable, 9 × 58,700.00 PAYE), who declared
 * 1,200,000.00 of rent for 2026 in October.
 */
const OCTOBER = Object.freeze({
  gross: "450000.00",
  pensionable: "450000.00",
  rate_of_pay: "450000.00",
  nhf_contributes: true,
  month: 10,
  to_date: { taxable_pay: "3766500.00", tax: "528300.00" },
  year_rent: "1200000.00",
  rates: TEST,
});

/** The same person with no rent declared and nothing to date, for the months of a year. */
const STEADY = Object.freeze({ ...OCTOBER, year_rent: null, to_date: calc.NOTHING_TO_DATE });

/** Run a person through months of a year, carrying their year to date as Compute does. */
function throughTheYear(person, months) {
  let toDate = { taxable_pay: "0.00", tax: "0.00" };
  return months.map((month) => {
    const r = calc.computeStatutory({ ...person, month, to_date: toDate });
    const paid = amountsOf(r.lines);
    const tax = m.money(paid.paye || "0").minus(m.money(paid.paye_refund || "0"));
    toDate = {
      taxable_pay: m.toWire(m.money(toDate.taxable_pay).plus(r.taxable_pay === null ? "0" : r.taxable_pay)),
      tax: m.toWire(m.money(toDate.tax).plus(tax)),
    };
    return { month, paye: paid.paye || null, refund: paid.paye_refund || null, to_date: toDate };
  });
}

describe("computeStatutory (§6.12, §6.14), on TEST FIGURES", () => {
  test("the worked example: October, a year to date, rent relief caught up, every line to the kobo", () => {
    // Pension 5% and NHF 2% of 450,000.00: 22,500.00 and 9,000.00; the month's taxable pay 418,500.00 (NTA s.30(2)(a)).
    // To date 3,766,500.00 + 418,500.00 = 4,185,000.00, less rent relief to date: 10% of 1,200,000.00 = 120,000.00 a
    // year, × 10/12 = 100,000.00, so 4,085,000.00. The bands × 10/12: 0% to 500,000.00, 10% to 2,000,000.00 (150,000.00),
    // 20% above (417,000.00): 567,000.00 to date, less 528,300.00 already deducted: PAYE 38,700.00. MyCity's 7%:
    // 31,500.00; ITF and NSITF 0.5% of 450,000.00: 2,250.00 each.
    const r = calc.computeStatutory(OCTOBER);
    expect(rows(r.lines)).toEqual([
      ["deduction", "pension_employee", "Pension", "22500.00", "450000.00"],
      ["deduction", "nhf", "NHF", "9000.00", "450000.00"],
      ["deduction", "paye", "PAYE", "38700.00", "418500.00"],
      ["employer", "pension_employer", "Employer Pension", "31500.00", "450000.00"],
      ["employer", "itf", "ITF", "2250.00", "450000.00"],
      ["employer", "nsitf", "NSITF", "2250.00", "450000.00"],
    ]);
    expect(r.taxable_pay).toBe("418500.00");
    // Without the rent, the month's PAYE is the steady 58,700.00: the relief to date saved 100,000.00 × 20%.
    expect(amountsOf(calc.computeStatutory({ ...OCTOBER, year_rent: null }).lines).paye).toBe("58700.00");
  });

  test("a steady earner pays the same each month, and the year's deductions are the year's tax (NTAA s.51(7))", () => {
    const year = throughTheYear(STEADY, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect([...new Set(year.map((y) => y.paye))]).toEqual(["58700.00"]);
    // 12 × 418,500.00 = 5,022,000.00 on the year's bands: 180,000.00 + 524,400.00.
    expect(year[11].to_date).toEqual({ taxable_pay: "5022000.00", tax: "704400.00" });
    expect(calc.progressiveTax("5022000.00", TEST.paye.bands).toFixed(2)).toBe("704400.00");
  });

  test("a joiner in October with no certificate starts at nothing, and lands on the year's tax by December", () => {
    // October: 418,500.00 sits inside the 0% band × 10/12 (500,000.00), so no PAYE line. November: 837,000.00 against
    // 0% to 550,000.00 and 10% above: 28,700.00. December: 1,255,500.00 on the year's bands is 65,550.00, less 28,700.00.
    const year = throughTheYear(STEADY, [10, 11, 12]);
    expect(year.map((y) => [y.month, y.paye])).toEqual([
      [10, null],
      [11, "28700.00"],
      [12, "36850.00"],
    ]);
    expect(year[2].to_date.tax).toBe(calc.progressiveTax("1255500.00", TEST.paye.bands).toFixed(2));
  });

  test("a fall in the cumulative tax is paid back as a PAYE Refund, never a negative line (reg 4(2))", () => {
    // November, the same person on 60,000.00: pension 3,000.00, NHF 1,200.00, taxable 55,800.00; to date 4,240,800.00
    // less rent relief × 11/12 (110,000.00) = 4,130,800.00; the bands × 11/12 give 165,000.00 + 386,160.00 = 551,160.00,
    // below the 567,000.00 already deducted: a refund of 15,840.00.
    const r = calc.computeStatutory({
      ...OCTOBER,
      gross: "60000.00",
      pensionable: "60000.00",
      rate_of_pay: "60000.00",
      month: 11,
      to_date: { taxable_pay: "4185000.00", tax: "567000.00" },
    });
    expect(rows(r.lines)).toEqual([
      ["deduction", "pension_employee", "Pension", "3000.00", "60000.00"],
      ["deduction", "nhf", "NHF", "1200.00", "60000.00"],
      ["earning", "paye_refund", "PAYE Refund", "15840.00", "55800.00"],
      ["employer", "pension_employer", "Employer Pension", "4200.00", "60000.00"],
      ["employer", "itf", "ITF", "300.00", "60000.00"],
      ["employer", "nsitf", "NSITF", "300.00", "60000.00"],
    ]);
    expect(r.lines.every((l) => !m.isNegative(l.amount))).toBe(true);
  });

  test("the minimum wage exempts PAYE and keeps the month out of the year to date; NHF reads the same measure", () => {
    const at = (pay, extra = {}) => calc.computeStatutory({ ...OCTOBER, gross: pay, pensionable: pay, rate_of_pay: pay, ...extra });
    // At the wage: no PAYE (and no refund, whatever was deducted before), NHF due ("the minimum wage and above").
    const atWage = at("50000.00");
    expect(amountsOf(atWage.lines)).toEqual({ pension_employee: "2500.00", nhf: "1000.00", pension_employer: "3500.00", itf: "250.00", nsitf: "250.00" });
    expect(atWage.taxable_pay).toBeNull();
    // Below it: no NHF either.
    expect(Object.keys(amountsOf(at("49999.99").lines))).toEqual(["pension_employee", "pension_employer", "itf", "nsitf"]);
    // The test is the rate of pay, not the month's earnings: a part month never exempts a higher earner (40,000.00 paid
    // of 450,000.00: pension 2,000.00 and NHF 800.00 come off, and PAYE is worked).
    const part = calc.computeStatutory({ ...STEADY, gross: "40000.00", pensionable: "40000.00", month: 1 });
    expect(part.taxable_pay).toBe("37200.00");
    // With no wage in force NHF cannot be told and is not taken; PAYE is computed and Compute reports the wage missing.
    const { minimum_wage: _wage, ...noWage } = TEST;
    expect(Object.keys(amountsOf(calc.computeStatutory({ ...OCTOBER, rates: noWage }).lines))).toEqual([
      "pension_employee",
      "paye",
      "pension_employer",
      "itf",
      "nsitf",
    ]);
  });

  test("NHF only for a person who chose it; their taxable pay is not reduced by an NHF they do not pay", () => {
    const r = calc.computeStatutory({ ...OCTOBER, nhf_contributes: false });
    expect(r.lines.find((l) => l.code === "nhf")).toBeUndefined();
    expect(r.taxable_pay).toBe("427500.00");
  });

  test("an item with no row is not computed: ITF under 25 employees is never entered, so there is no ITF line", () => {
    const { itf: _itf, ...noItf } = TEST;
    expect(Object.keys(amountsOf(calc.computeStatutory({ ...OCTOBER, rates: noItf }).lines))).toEqual([
      "pension_employee",
      "nhf",
      "paye",
      "pension_employer",
      "nsitf",
    ]);
    expect(calc.computeStatutory({ ...OCTOBER, rates: {} })).toEqual({ lines: [], taxable_pay: null });
    // A row naming a base its item no longer allows (one saved before PR 11 on basic pay) is not computed either.
    expect(amountsOf(calc.computeStatutory({ ...OCTOBER, rates: { nhf: { base: "basic", rate: "2" } } }).lines)).toEqual({});
  });

  test("the bands scale to the months elapsed; rent relief is its rate of the year's rent, at most its cap", () => {
    expect(calc.scaledBands(TEST.paye.bands, 6).map((b) => [b.band_from.toFixed(2), b.band_to === null ? null : b.band_to.toFixed(2), b.rate])).toEqual([
      ["0.00", "300000.00", "0"],
      ["300000.00", "1200000.00", "10"],
      ["1200000.00", null, "20"],
    ]);
    expect(calc.rentReliefOf(TEST.rent_relief, "1200000.00").toFixed(2)).toBe("120000.00");
    expect(calc.rentReliefOf(TEST.rent_relief, "5000000.00").toFixed(2)).toBe("300000.00");
    expect(calc.rentReliefOf(undefined, "1200000.00").toFixed(2)).toBe("0.00");
    expect(calc.rentReliefOf(TEST.rent_relief, null).toFixed(2)).toBe("0.00");
  });

  test("the year's rent is the rent pro-rated by the months it covers (the Guidelines para 9.5)", () => {
    // Two years' rent from January 2026: half to each year. Six months from July 2025: three in 2026.
    expect(rent.yearRentOf({ rent_paid: "2000000.00", covers_from: "2026-01-01", covers_to: "2027-12-01" }, 2026).toFixed(2)).toBe("1000000.00");
    expect(rent.yearRentOf({ rent_paid: "600000.00", covers_from: "2025-10-01", covers_to: "2026-03-01" }, 2026).toFixed(2)).toBe("300000.00");
    expect(rent.yearRentOf({ rent_paid: "600000.00", covers_from: "2025-01-01", covers_to: "2025-12-01" }, 2026).isZero()).toBe(true);
  });

  test("a run lists what it cannot compute without: a PAYE table, the minimum wage beside PAYE or NHF, a base no longer allowed", () => {
    expect(calc.statutoryMissing({ rates: TEST, misbased: [] })).toEqual([]);
    expect(calc.statutoryMissing({ rates: { pension_employee: TEST.pension_employee }, misbased: [] })).toEqual(["paye"]);
    const { minimum_wage: _wage, ...noWage } = TEST;
    expect(calc.statutoryMissing({ rates: noWage, misbased: [] })).toEqual(["minimum_wage"]);
    expect(calc.statutoryMissing({ rates: { nhf: TEST.nhf }, misbased: ["pension_employee"] })).toEqual(["paye", "minimum_wage", "pension_employee"]);
  });

  test("a line is rounded once, half up, from full precision; the month is checked", () => {
    const r = calc.computeStatutory({ ...STEADY, gross: "333333.33", pensionable: "333333.33", rates: { pension_employee: { base: "pensionable", rate: "7.5" } } });
    expect(rows(r.lines)).toEqual([["deduction", "pension_employee", "Pension", "25000.00", "333333.33"]]);
    expect(() => calc.computeStatutory({ ...OCTOBER, month: 13 })).toThrow(/month is 1 to 12/);
    expect(calc.progressiveTax("0", TEST.paye.bands).toFixed(2)).toBe("0.00");
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
  const statutory = { rates: TEST, month: 10, nhf_contributes: true, to_date: OCTOBER.to_date, year_rent: null };

  test("the split makes the earnings, pension's base is never less than basic, housing and transport, employer charges stay out of the net", () => {
    // Transport is not marked pensionable, yet the base is 450,000.00: basic, housing and transport (s.120).
    const { lines, taxable_pay: taxable } = calc.payslipOf({ ...base, components: split, statutory });
    expect(lines.map((l) => [l.position, l.kind, l.label, l.amount, l.source_id])).toEqual([
      [1, "earning", "Basic", "250000.00", "c-basic"],
      [2, "earning", "Housing", "150000.00", "c-housing"],
      [3, "earning", "Transport", "50000.00", "c-transport"],
      [4, "deduction", "Pension", "22500.00", null],
      [5, "deduction", "NHF", "9000.00", null],
      [6, "deduction", "PAYE", "58700.00", null],
      [7, "employer", "Employer Pension", "31500.00", null],
      [8, "employer", "ITF", "2250.00", null],
      [9, "employer", "NSITF", "2250.00", null],
    ]);
    expect(taxable).toBe("418500.00");
    expect(calc.totalsOf(lines)).toEqual({ earnings_total: "450000.00", deductions_total: "90200.00", employer_total: "36000.00", net_pay: "359800.00" });
  });

  test("a part month prorates each component, rounded once, and the pensionable pay follows what is paid", () => {
    const part = { workingDays: 26, daysPaid: 16, calendarDays: 31, calendarPaid: 18 };
    const pay = calc.componentPay(split, part);
    // 250,000.00 × 16 / 26 = 153,846.153…; 150,000.00 → 92,307.69; 50,000.00 → 30,769.23. The floor of the three is above
    // the two marked pensionable, so it is the base.
    expect(pay.lines.map((l) => l.amount)).toEqual(["153846.15", "92307.69", "30769.23"]);
    expect([pay.basic, pay.pensionable]).toEqual(["153846.15", "276923.07"]);
    // A split that marks more than the floor keeps what it marks.
    const generous = calc.componentPay([...split, { id: "c-x", code: "leave", label: "Leave", amount: "100000.00", pensionable: true }], FULL);
    expect(generous.pensionable).toBe("500000.00");
  });

  test("a PAYE Refund is an earning beside Monthly Pay; overtime raises the taxable pay of its month", () => {
    const refund = calc.payslipOf({
      ...base,
      gross: "60000.00",
      components: null,
      statutory: { ...statutory, month: 11, to_date: { taxable_pay: "4185000.00", tax: "567000.00" }, year_rent: "1200000.00" },
    });
    expect(refund.lines.map((l) => [l.kind, l.label, l.amount])).toEqual([
      ["earning", "Monthly Pay", "60000.00"],
      ["earning", "PAYE Refund", "15840.00"],
      ["deduction", "Pension", "3000.00"],
      ["deduction", "NHF", "1200.00"],
      ["employer", "Employer Pension", "4200.00"],
      ["employer", "ITF", "300.00"],
      ["employer", "NSITF", "300.00"],
    ]);
    expect(calc.totalsOf(refund.lines)).toMatchObject({ earnings_total: "75840.00", deductions_total: "4200.00", net_pay: "71640.00" });
    // 8,000.00 of overtime: gross 458,000.00; pension 22,500.00 (Monthly Pay is the pensionable base, overtime is not);
    // NHF 2% of the gross, 9,160.00; taxable 426,340.00.
    const overtime = calc.payslipOf({ ...base, components: null, overtime: [{ id: "o1", amount: "8000.00" }], statutory });
    expect(overtime.taxable_pay).toBe("426340.00");
  });

  test("simple mode never computes a statutory line, whatever figures exist, and prints one Monthly Pay", () => {
    const simple = calc.payslipOf({ ...base, components: split, statutory: null });
    expect(simple.lines.map((l) => [l.code, l.label])).toEqual([["monthly_pay", "Monthly Pay"]]);
    expect(simple.taxable_pay).toBeNull();
    expect(calc.buildLines({ ...base, components: split, statutory: null })).toEqual(simple.lines);
  });

  test("with no split in advanced mode, Monthly Pay is the pensionable base", () => {
    const lines = calc.buildLines({ ...base, components: null, statutory: { ...statutory, rates: { pension_employee: TEST.pension_employee, nhf: TEST.nhf, minimum_wage: TEST.minimum_wage } } });
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

  test("a rate is a percentage up to 100; rent relief takes a rate and its cap, the minimum wage an amount; the old relief is refused", () => {
    const at = { effective_from: "2026-12-01", ...SOURCE };
    expect(fields(S.safeParse({ item: "nhf", ...at, rate: "101" }))).toEqual({ rate: "At most 100" });
    expect(fields(S.safeParse({ item: "nhf", ...at, rate: "two" }))).toEqual({ rate: "Enter a rate" });
    expect(fields(S.safeParse({ item: "nhf", ...at }))).toEqual({ rate: "Enter a rate" });
    expect(fields(S.safeParse({ item: "rent_relief", ...at, rate: "10" }))).toEqual({ flat_amount: "Enter the cap" });
    expect(fields(S.safeParse({ item: "rent_relief", ...at, rate: "0", flat_amount: "300000.00" }))).toEqual({ rate: "Enter a rate" });
    expect(S.safeParse({ item: "rent_relief", ...at, rate: "10", flat_amount: "300000.00" }).success).toBe(true);
    expect(S.safeParse({ item: "minimum_wage", ...at, flat_amount: "50000.00" }).success).toBe(true);
    expect(fields(S.safeParse({ item: "minimum_wage", ...at }))).toEqual({ flat_amount: "Enter an amount" });
    expect(fields(S.safeParse({ item: "minimum_wage", ...at, flat_amount: "50000.00", rate: "1" }))).toEqual({ rate: "Not for this item" });
    expect(fields(S.safeParse({ item: "itf", ...at, rate: "1", flat_amount: "5.00" }))).toEqual({ flat_amount: "Not for this item" });
    // The bases §6.16 cites, and no other: NHF on gross pay, pension never on basic alone, ITF on payroll.
    for (const item of ["itf", "nhf", "pension_employee", "pension_employer"])
      expect(fields(S.safeParse({ item, ...at, rate: "1", base: "basic" }))).toEqual({ base: "Not a base for this" });
    expect(S.safeParse({ item: "pension_employee", ...at, rate: "1", base: "gross" }).success).toBe(true);
    // The Consolidated Relief Allowance's shape is retired (§13.1 item 41): naming it is refused on the item.
    expect(Object.keys(fields(S.safeParse({ item: "relief", ...at, rate: "10", flat_amount: "100.00" })))).toEqual(["item"]);
    expect(c.statutory.StatutoryItem.options).not.toContain("relief");
    expect(c.statutory.RETIRED_ITEMS).toEqual(["relief"]);
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
      ["employee", "taxable", 1, "0.00", "600000.00", "TEST SOURCE, not a law"],
      ["employee", "taxable", 2, "600000.00", "2400000.00", "TEST SOURCE, not a law"],
      ["employee", "taxable", 3, "2400000.00", null, "TEST SOURCE, not a law"],
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
    expect(rates.rowsOf({ item: "nhf", rate: "2", ...SOURCE }, null)[0].base).toBe("gross");
    expect(rates.rowsOf({ item: "rent_relief", rate: "10", flat_amount: "300000.00", ...SOURCE }, null)[0]).toMatchObject({ kind: "employee", base: "rent", rate: "10", flat_amount: "300000.00" });
    expect(rates.rowsOf({ item: "minimum_wage", flat_amount: "50000.00", ...SOURCE }, null)[0]).toMatchObject({ kind: "employee", base: "gross", rate: "0", flat_amount: "50000.00" });
    expect(Object.keys(c.statutory.ITEM_BASES).sort()).toEqual(Object.keys(c.statutory.ITEM_KIND).sort());
    expect(Object.keys(c.statutory.ITEM_KIND).sort()).toEqual([...c.statutory.StatutoryItem.options].sort());
  });

  test("a stored row reads as the contract's StatutoryRate", () => {
    const row = { statutory_rate_id: "00000000-0000-4000-8000-000000000001", item: "nhf", kind: "employee", base: "basic", rate: "2.500000", band_from: null, band_to: null, flat_amount: null, position: null, effective_from: "2026-12-01", effective_to: null, ...SOURCE, source_url: null, source_document_id: null, no_legal_source: false, no_source_reason: null, created_by_name: null, created_at: new Date("2026-11-10T09:00:00Z") };
    expect(c.statutory.StatutoryRate.parse(rates.present(row))).toMatchObject({ rate: "2.5", position: null, source_title: "TEST SOURCE, not a law", no_legal_source: false });
  });

  test("the conventions left the setting: the law settles them, so no setting names one (§6.12 rule 14)", () => {
    const settings = require("../payroll/payroll.config.repo");
    expect(Object.keys(settings.DEFAULTS)).toEqual(["payroll_setting_id", "advanced_enabled", "pay_day", "require_bank_details", "effective_from", "effective_to"]);
    for (const key of ["paye_basis", "pension_reduces_taxable", "nhf_reduces_taxable"])
      expect(c.payroll.PayrollSettingsChange.safeParse({ effective_from: "2026-12-01", [key]: true }).success).toBe(false);
  });
});

describe("the statutory report (§6.12 rule 6)", () => {
  const run = {
    number: "PAY-2026-10",
    period: "2026-10-01",
    status: "approved",
    config_snapshot: {
      paye_method: "cumulative",
      statutory_rates: [
        { item: "paye", base: "taxable", rate: "10", ...SOURCE, source_url: "https://example.test/test-source.pdf", no_legal_source: false, no_source_reason: null },
        { item: "pension_employee", base: "pensionable", rate: "5", ...NO_SOURCE },
        // A row of a snapshot taken before sources were kept: it has none of the source keys.
        { item: "itf", base: "annual_payroll", rate: "0.5" },
        { item: "rent_relief", base: "rent", rate: "10", flat_amount: "300000.00", ...SOURCE, no_legal_source: false, no_source_reason: null },
      ],
    },
  };
  const line = (code, kind, who, amount, base, extra = {}) => ({ code, kind, amount, base_amount: base, employee_name: who, staff_number: "T0001", detail: null, tax_id: null, pension_pin: null, nhf_number: null, state_of_residence: null, ...extra });
  // As reportLines reads them: by code, then State (none last), then staff number.
  const lines = [
    line("paye", "deduction", "Ada Tester", "38700.00", "418500.00", { tax_id: "TIN-TEST", state_of_residence: "lagos" }),
    line("paye", "deduction", "Bola Tester", "12000.00", "200000.00", { state_of_residence: "ogun" }),
    line("paye", "deduction", "Chidi Tester", "5000.00", "100000.00"),
    line("paye_refund", "earning", "Dayo Tester", "1500.00", "50000.00", { state_of_residence: "lagos" }),
    line("pension_employee", "deduction", "Ada Tester", "22500.00", "450000.00", { pension_pin: "PEN-TEST" }),
    line("itf", "employer", "Ada Tester", "2250.00", "450000.00"),
  ];

  test("per item and per person, PAYE by State, each item's source and remittance, the totals net of refunds", () => {
    const vars = report.varsOf(run, lines);
    expect(c.statutory.StatutoryReportVars.parse(vars)).toEqual(vars);
    expect(vars).toMatchObject({ run_number: "PAY-2026-10", period_label: "October 2026", status_label: "Approved", employee_total: "₦76,700.00", employer_total: "₦2,250.00" });
    expect(vars.items.map((i) => [i.label, i.kind_label, i.rate_label, i.base_label, i.number_label, i.total])).toEqual([
      ["PAYE", "Employee", "Cumulative bands", "taxable pay", "Tax ID", "₦55,700.00"],
      ["PAYE Refund", "Employee", "Cumulative bands", "taxable pay", "Tax ID", "₦1,500.00"],
      ["Employee Pension", "Employee", "5%", "pensionable pay", "Pension PIN", "₦22,500.00"],
      ["ITF", "Employer", "0.5%", "payroll", null, "₦2,250.00"],
    ]);
    // PAYE goes to the State each person lives in: one group a State, a person with none under Not Set.
    expect(vars.items[0].groups.map((g) => [g.label, g.rows.map((r) => r.employee_name), g.total])).toEqual([
      ["Lagos", ["Ada Tester"], "₦38,700.00"],
      ["Ogun", ["Bola Tester"], "₦12,000.00"],
      ["Not Set", ["Chidi Tester"], "₦5,000.00"],
    ]);
    expect(vars.items[2].groups).toEqual([{ label: null, rows: [{ employee_name: "Ada Tester", staff_number: "T0001", statutory_number: "PEN-TEST", base: "₦450,000.00", amount: "₦22,500.00" }], total: null }]);
    // Each item's source as the snapshot holds it (PAYE Refund the PAYE table's); a row from before sources reads as 6040 marked it.
    expect(vars.items.map((i) => [i.source_label, i.source_link])).toEqual([
      ["TEST SOURCE, not a law, Test section 1. Checked 10/11/2026", "https://example.test/test-source.pdf"],
      ["TEST SOURCE, not a law, Test section 1. Checked 10/11/2026", "https://example.test/test-source.pdf"],
      ["No Legal Source: Test rate for this file, not a law", null],
      ["No Legal Source: Entered before sources were required", null],
    ]);
    expect(vars.items.map((i) => i.remit_label)).toEqual([
      expect.stringMatching(/^By 10\/11\/2026, to the Internal Revenue Service of the State each person lives in \(Operation of PAYE Regulations 2002, reg 7\(1\)/),
      expect.stringMatching(/^Paid back to each person in this run/),
      "Within 7 working days of pay day, with the employer's share (Pension Reform Act 2014, s.11(3))",
      "The year's contribution, by 1 April 2027 (Industrial Training Fund Act, s.16 as inserted in 2011)",
    ]);
    expect(vars.rules.map((r) => r.label)).toEqual(["PAYE", "Taxable Pay", "Rent Relief", "Minimum Wage"]);
    expect(vars.rules[2].value).toBe("10% of the year's rent declared, at most ₦300,000.00. Source: TEST SOURCE, not a law, Test section 1. Checked 10/11/2026");
    expect(vars.rules[3].value).toBe("Not in force");
  });

  test("a run computed before PR 11 prints the conventions it was computed with", () => {
    const old = { ...run, config_snapshot: { conventions: { paye_basis: "annualised", pension_reduces_taxable: true, nhf_reduces_taxable: false }, statutory_rates: [{ item: "relief", base: "gross", rate: "10", flat_amount: "100.00", ...NO_SOURCE }] } };
    expect(report.varsOf(old, []).rules).toEqual([
      { label: "PAYE Basis", value: "Annualised" },
      { label: "Pension Reduces Taxable Pay", value: "Yes" },
      { label: "NHF Reduces Taxable Pay", value: "No" },
      { label: "Relief Source", value: "No Legal Source: Test rate for this file, not a law" },
    ]);
  });

  test("the template uses only declared variables, prints Not Set for a missing number, the remittances and the States, and escapes a name", async () => {
    const template = await templates.current({ query: async () => ({ rows: [] }) }, "document", "statutory-report");
    expect(variables.undeclared("document", "statutory-report", parse(template.body))).toEqual([]);
    const vars = report.varsOf(run, [...lines, line("nhf", "deduction", "<script>x</script>", "1.00", "50.00")]);
    // As the document engine renders it: its own number (null for an export) is laid over the data's.
    const html = render(template.body, { ...vars, number: null });
    expect(html).toContain("October 2026 · PAY-2026-10 · Approved");
    expect(html).toContain("TIN-TEST");
    expect(html).toContain("Not Set");
    expect(html).not.toContain("<script>x");
    expect(html.match(/<section class="sr-item">/g)).toHaveLength(5);
    expect(html).toContain("Source: TEST SOURCE, not a law, Test section 1. Checked 10/11/2026 · https://example.test/test-source.pdf");
    expect(html).toContain("Remit: By 10/11/2026");
    expect(html).toContain('<p class="sr-group">Ogun</p>');
    expect(html).toContain("Rent Relief");
  });
});

describe("the routes", () => {
  test("the rates and a person's Pay to Date are read with payroll view and entered with payroll edit and payroll.configure", () => {
    const mod = require("./statutory.routes");
    expect(mod.basePath).toBe("/statutory");
    expect(routesOf(mod.router).map((r) => [r.method, r.path, r.permission, r.capability || null])).toEqual([
      ["GET", "/rates", { key: "payroll", action: "view" }, null],
      ["GET", "/items", { key: "payroll", action: "view" }, null],
      ["POST", "/rates", { key: "payroll", action: "edit" }, "payroll.configure"],
      ["DELETE", "/rates/:item/versions/:effective_from", { key: "payroll", action: "edit" }, "payroll.configure"],
      ["GET", "/employees/:employee_id/pay-to-date", { key: "payroll", action: "view" }, null],
      ["PUT", "/employees/:employee_id/pay-to-date/:year", { key: "payroll", action: "edit" }, "payroll.configure"],
      ["DELETE", "/employees/:employee_id/pay-to-date/:year", { key: "payroll", action: "edit" }, "payroll.configure"],
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

  test("a person's declared rent is read with people view and declared with people edit", () => {
    const routes = routesOf(require("../organisation/organisation.routes").router);
    const find = (method, path) => routes.find((r) => r.method === method && r.path === path);
    expect(find("GET", "/employees/:id/rent-declarations")).toMatchObject({ permission: { key: "people", action: "view" } });
    expect(find("PUT", "/employees/:id/rent-declarations/:year")).toMatchObject({ permission: { key: "people", action: "edit" } });
    expect(find("DELETE", "/employees/:id/rent-declarations/:year")).toMatchObject({ permission: { key: "people", action: "edit" } });
  });
});
