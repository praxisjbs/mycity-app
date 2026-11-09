"use strict";
/**
 * Payroll's calculation and its guard, with no database (docs/guides/payroll.md §6): the worked example of
 * §6.14 to the kobo, proration, rounding once, the totals as sums of lines, the pay date's month-end rule,
 * and the rule that every write function of a run refuses a run it must not touch (§6.9 rule 4). The run
 * itself, against the real migrations, is tests/integration/payroll-run.test.js.
 */
const calc = require("./payroll.calc");
const lock = require("./payroll.lock");
const run = require("./payroll.run");
const repo = require("./payroll.repo");
const payslips = require("../payslips/payslips.service");
const settings = require("./payroll.config.repo");
const m = require("../../shared/money/money");
const { applyMask } = require("../../shared/rbac/field-mask");

const FULL_OCTOBER = { workingDays: 26, daysPaid: 26, calendarDays: 31, calendarPaid: 31 };

/** The worked example's person: October 2026, ₦450,000.00 a month, paid all 26 working days. */
function workedExample(extra = {}) {
  return {
    gross: "450000.00",
    part: FULL_OCTOBER,
    overtime: [{ id: "ot-1", amount: "8000.00" }],
    deductions: {
      late: [
        { id: "late-1", amount: "1622.60" },
        { id: "late-2", amount: "1877.40" },
      ],
      absence: [{ id: "abs-1", amount: "17307.69" }],
    },
    unpaidLeave: [{ id: "lv-1", days: 2, from: "2026-10-12", to: "2026-10-13", amount: calc.daysAmount("450000.00", 26, 2) }],
    unpaidSuspension: [],
    instalments: [
      { id: "i-fine", code: "fine", amount: calc.instalmentShares("45000.00", 3)[0], detail: "QRY-0019, 1 of 3" },
      { id: "i-adv", code: "advance", amount: calc.instalmentShares("75000.00", 3)[0], detail: "1 of 3" },
    ],
    adjustments: [],
    ...extra,
  };
}

describe("the worked example (§6.14)", () => {
  const lines = calc.buildLines(workedExample());

  test("each line, to the kobo, in the order the slip prints them", () => {
    expect(lines.map((l) => [l.position, l.kind, l.code, l.label, l.amount])).toEqual([
      [1, "earning", "monthly_pay", "Monthly Pay", "450000.00"],
      [2, "earning", "overtime", "Overtime", "8000.00"],
      [3, "deduction", "lateness", "Lateness", "3500.00"],
      [4, "deduction", "absence", "Absence", "17307.69"],
      [5, "deduction", "unpaid_leave", "Unpaid Leave", "34615.38"],
      [6, "deduction", "fine", "Fine", "15000.00"],
      [7, "deduction", "advance", "Salary Advance Repayment", "25000.00"],
    ]);
  });

  test("earnings 458,000.00, deductions 95,423.07, net 362,576.93", () => {
    expect(calc.totalsOf(lines)).toEqual({
      earnings_total: "458000.00",
      deductions_total: "95423.07",
      employer_total: "0.00",
      net_pay: "362576.93",
    });
  });

  test("the lines say what they are: a count, the days and the span, the query and which share", () => {
    const detail = Object.fromEntries(lines.map((l) => [l.code, l.detail]));
    expect(detail).toMatchObject({
      lateness: "2 late arrivals",
      absence: "1 absence",
      unpaid_leave: "2 days, 12 to 13 October",
      fine: "QRY-0019, 1 of 3",
      advance: "1 of 3",
    });
  });

  test("a line with one source names it, and a group of the month's items names none", () => {
    const bySource = Object.fromEntries(lines.map((l) => [l.code, [l.source_type, l.source_id]]));
    expect(bySource.fine).toEqual(["payroll_deduction_instalment", "i-fine"]);
    expect(bySource.unpaid_leave).toEqual(["leave_request", "lv-1"]);
    expect(bySource.lateness).toEqual([null, null]);
    expect(bySource.monthly_pay).toEqual([null, null]);
  });

  test("compute twice, with nothing changed, is the same lines to the kobo", () => {
    expect(calc.buildLines(workedExample())).toEqual(lines);
  });

  test("the daily rate is rounded once, where an amount is written, never before", () => {
    // ₦450,000.00 / 26 = 17,307.6923… ; two days are 34,615.3846…, not twice the rounded day (34,615.38).
    expect(calc.daysAmount("450000.00", 26, 1)).toBe("17307.69");
    expect(calc.daysAmount("450000.00", 26, 2)).toBe("34615.38");
    expect(calc.daysAmount("450000.00", 26, 3)).toBe("51923.08");
    expect(calc.daysAmount("450000.00", 26, "0.5")).toBe("8653.85");
  });
});

describe("proration (§6.3 rule 1)", () => {
  test("a joiner on Wednesday 14 October has 16 of the 26 working days: ₦276,923.08", () => {
    const part = { workingDays: 26, daysPaid: 16, calendarDays: 31, calendarPaid: 18 };
    expect(calc.proratedPay("450000.00", part)).toBe("276923.08");
  });

  test("a person paid the whole month is paid the whole gross, never a daily rate times days", () => {
    expect(calc.proratedPay("450000.00", FULL_OCTOBER)).toBe("450000.00");
    expect(calc.proratedPay("333333.33", FULL_OCTOBER)).toBe("333333.33");
  });

  test("paidPart counts the person's own working days from the later of the 1st and the start to the earlier of the last and the leaving day", () => {
    const dates = [];
    for (let d = 1; d <= 31; d += 1) {
      const date = `2026-10-${String(d).padStart(2, "0")}`;
      const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
      if (weekday !== 0 && date !== "2026-10-01") dates.push(date);
    }
    const span = { first: "2026-10-01", last: "2026-10-31" };
    expect(dates).toHaveLength(26);
    expect(calc.paidPart(dates, { ...span, from: "2026-01-05", to: "2026-10-31" })).toEqual(FULL_OCTOBER);
    expect(calc.paidPart(dates, { ...span, from: "2026-10-14", to: "2026-10-31" })).toEqual({
      workingDays: 26,
      daysPaid: 16,
      calendarDays: 31,
      calendarPaid: 18,
    });
    // A leaver on Friday 16 October: 1 (a holiday) and Sundays are not days; 2 to 16 is 13 working days.
    expect(calc.paidPart(dates, { ...span, from: "2026-01-05", to: "2026-10-16" })).toMatchObject({ workingDays: 26, daysPaid: 13 });
    // Left before the month began, or starting after it: nothing is paid.
    expect(calc.paidPart(dates, { ...span, from: "2026-11-02", to: "2026-12-31" })).toMatchObject({ daysPaid: 0, calendarPaid: 0 });
  });

  test("a month with no working day prorates by calendar days, and pays nothing to someone with no day in it", () => {
    const off = { workingDays: 0, daysPaid: 0, calendarDays: 30, calendarPaid: 15 };
    expect(calc.proratedPay("300000.00", off)).toBe("150000.00");
    expect(calc.proratedPay("300000.00", { ...off, calendarPaid: 30 })).toBe("300000.00");
    expect(calc.proratedPay("300000.00", { ...off, calendarPaid: 0 })).toBe("0.00");
    // No daily rate, so nothing made from one.
    expect(calc.daysAmount("300000.00", 0, 2)).toBe("0.00");
  });
});

describe("spreading a deduction over months (§6.6 rule 3)", () => {
  test("₦10,000.00 over three is 3,333.34, 3,333.33, 3,333.33 and sums exactly", () => {
    const shares = calc.instalmentShares("10000.00", 3);
    expect(shares).toEqual(["3333.34", "3333.33", "3333.33"]);
    expect(m.toWire(m.sum(shares))).toBe("10000.00");
  });

  test.each([
    ["45000.00", 3],
    ["75000.00", 7],
    ["0.07", 12],
    ["1000000.01", 12],
    ["99.99", 2],
  ])("%s over %i months sums to the kobo", (total, months) => {
    const shares = calc.instalmentShares(total, months);
    expect(shares).toHaveLength(months);
    expect(m.toWire(m.sum(shares))).toBe(total);
  });
});

describe("totals are the sums of the lines (§6.8)", () => {
  test("a negative net is reported as it is, never capped", () => {
    const lines = calc.buildLines({
      gross: "10000.00",
      part: FULL_OCTOBER,
      deductions: { absence: [{ id: "a", amount: "15000.00" }] },
    });
    expect(calc.totalsOf(lines)).toMatchObject({ earnings_total: "10000.00", deductions_total: "15000.00", net_pay: "-5000.00" });
  });

  test("no salary is a payslip with no lines", () => {
    expect(calc.buildLines({ gross: null, part: FULL_OCTOBER })).toEqual([]);
    expect(calc.totalsOf([])).toEqual({ earnings_total: "0.00", deductions_total: "0.00", employer_total: "0.00", net_pay: "0.00" });
  });

  test("a line has no negative amount and a line of nothing is left off", () => {
    const lines = calc.buildLines(workedExample({ adjustments: [{ id: "x", kind: "earning", label: "Nothing", amount: "0.00" }] }));
    expect(lines.every((l) => m.compare(l.amount, "0") > 0)).toBe(true);
    expect(lines.map((l) => l.label)).not.toContain("Nothing");
  });

  test("an adjustment is a line with the label as typed, an earning among the earnings and a deduction among the deductions", () => {
    const lines = calc.buildLines(
      workedExample({
        adjustments: [
          { id: "b", kind: "earning", label: "Correction: September Overtime", amount: "2500.00" },
          { id: "c", kind: "deduction", label: "Damaged Laptop", amount: "10000.00" },
        ],
      }),
    );
    const find = (label) => lines.find((l) => l.label === label);
    expect(find("Correction: September Overtime")).toMatchObject({ kind: "earning", code: "adjustment_earning", source_type: "payroll_adjustment", source_id: "b" });
    expect(find("Damaged Laptop")).toMatchObject({ kind: "deduction", code: "adjustment_deduction", source_id: "c" });
    expect(find("Correction: September Overtime").position).toBeLessThan(find("Lateness").position);
    expect(find("Damaged Laptop").position).toBeGreaterThan(find("Salary Advance Repayment").position);
    // ₦362,576.93, plus the earning 2,500.00, less the deduction 10,000.00.
    expect(calc.totalsOf(lines).net_pay).toBe("355076.93");
  });

  test("a payslip can never disagree with its own lines, however the inputs are shaped", () => {
    // A small deterministic generator: the same cases every run.
    let seed = 20261009;
    const next = (n) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    const money = (max) => `${next(max)}.${String(next(100)).padStart(2, "0")}`;
    for (let i = 0; i < 200; i += 1) {
      const lines = calc.buildLines({
        gross: money(900000),
        part: { workingDays: 20 + next(7), daysPaid: 0, calendarDays: 30, calendarPaid: 30 },
        overtime: Array.from({ length: next(3) }, (_, k) => ({ id: `o${k}`, amount: money(20000) })),
        deductions: {
          late: Array.from({ length: next(4) }, (_, k) => ({ id: `l${k}`, amount: money(3000) })),
          absence: Array.from({ length: next(2) }, (_, k) => ({ id: `a${k}`, amount: money(30000) })),
        },
        unpaidLeave: [],
        unpaidSuspension: [],
        instalments: Array.from({ length: next(3) }, (_, k) => ({ id: `i${k}`, code: next(2) ? "fine" : "advance", amount: money(40000), detail: null })),
        adjustments: Array.from({ length: next(3) }, (_, k) => ({ id: `j${k}`, kind: next(2) ? "earning" : "deduction", label: `Adj ${k}`, amount: money(9000) })),
      });
      const t = calc.totalsOf(lines);
      const earn = m.sum(lines.filter((l) => l.kind === "earning").map((l) => l.amount));
      const ded = m.sum(lines.filter((l) => l.kind === "deduction").map((l) => l.amount));
      expect(t.earnings_total).toBe(m.toWire(earn));
      expect(t.deductions_total).toBe(m.toWire(ded));
      expect(t.net_pay).toBe(m.toWire(earn.minus(ded)));
      expect(lines.map((l) => l.position)).toEqual(lines.map((_, k) => k + 1));
    }
  });

  test("a run's totals are the sums of its payslips', and an excluded one counts for nothing", () => {
    const slip = (status, earn, ded, net) => ({ status, earnings_total: earn, deductions_total: ded, employer_total: "0.00", net_pay: net });
    expect(
      calc.sumTotals([slip("draft", "450000.00", "87423.07", "362576.93"), slip("draft", "276923.08", "0.00", "276923.08"), slip("excluded", "999.00", "1.00", "998.00")]),
    ).toEqual({
      headcount: 2,
      earnings_total: "726923.08",
      deductions_total: "87423.07",
      net_total: "639500.01",
      employer_total: "0.00",
    });
  });
});

describe("the pay date (§6.11 rule 1)", () => {
  test("the pay day is the month's own day, or its last when it is past the end", () => {
    expect(calc.payDate("2026-10-01", 30)).toBe("2026-10-30");
    expect(calc.payDate("2026-02-01", 30)).toBe("2026-02-28");
    expect(calc.payDate("2028-02-01", 30)).toBe("2028-02-29");
    expect(calc.payDate("2026-04-01", 31)).toBe("2026-04-30");
    expect(calc.payDate("2026-05-01", 31)).toBe("2026-05-31");
    expect(calc.payDate("2026-03-01", 1)).toBe("2026-03-01");
  });

  test("with no setting the run is simple, the pay day is 30 and bank details are a warning", async () => {
    const empty = { query: async () => ({ rows: [] }) };
    const setting = await settings.settingOn(empty, "2026-10-01");
    expect(setting).toMatchObject({ advanced_enabled: false, require_bank_details: false, pay_day: null, paye_basis: null });
    expect(settings.payDayOf(setting)).toBe(30);
    expect(settings.payDayOf({ pay_day: 25 })).toBe(25);
    expect(settings.DEFAULT_PAY_DAY).toBe(30);
  });
});

describe("the salary mask reaches a run (§6.13)", () => {
  test("the run's totals and an adjustment's amount are masked by the names the mask governs", () => {
    const masked = applyMask(
      { number: "PAY-2026-10", gross_pay: "1.00", total_deductions: "1.00", net_pay: "1.00", employer_cost: "1.00", headcount: 3, nested: { pay_amount: "5.00", amount: "9.00" } },
      new Set(["gross_pay", "total_deductions", "net_pay", "employer_cost", "pay_amount"]),
    );
    expect(masked).toEqual({
      number: "PAY-2026-10",
      gross_pay: null,
      total_deductions: null,
      net_pay: null,
      employer_cost: null,
      headcount: 3,
      nested: { pay_amount: null, amount: "9.00" },
    });
  });
});

describe("every write function of a run hits the guard (§6.9 rule 4)", () => {
  /** The writes the run, the lock and the payslips' mail and downloads make, by name. */
  const { emailAll, markEmailed, unmarkEmailed, emailCopy, exportAll } = payslips;
  const functions = { ...run, applyApproval: lock.applyApproval, returnToDraft: lock.returnToDraft, emailAll, markEmailed, unmarkEmailed, emailCopy, exportAll };
  const runWith = (status) => ({ payroll_run_id: "00000000-0000-4000-8000-000000000001", status });
  const REFUSED = {
    editable: [
      ["approved", "RUN_NOT_EDITABLE"],
      ["paid", "RUN_NOT_EDITABLE"],
      ["submitted", "RUN_NOT_EDITABLE"],
    ],
    computed: [
      ["draft", "RUN_NOT_COMPUTED"],
      ["submitted", "RUN_NOT_EDITABLE"],
      ["approved", "RUN_NOT_EDITABLE"],
    ],
    approved: [
      ["draft", "NOT_APPROVED"],
      ["computed", "NOT_APPROVED"],
      ["submitted", "NOT_APPROVED"],
      ["paid", "NOT_APPROVED"],
    ],
    published: [
      ["draft", "NOT_APPROVED"],
      ["computed", "NOT_APPROVED"],
      ["submitted", "NOT_APPROVED"],
    ],
    submitted: [
      ["draft", "RUN_NOT_SUBMITTED"],
      ["computed", "RUN_NOT_SUBMITTED"],
      ["approved", "RUN_NOT_SUBMITTED"],
      ["paid", "RUN_NOT_SUBMITTED"],
    ],
  };

  afterEach(() => jest.restoreAllMocks());

  test("every function the run, the lock and the payslips' mail and downloads export is a registered write, and every registered write is exported", () => {
    expect(Object.keys(functions).sort()).toEqual([...lock.WRITES.keys()].sort());
  });

  test("every guard a write names is one of the six", () => {
    for (const guard of lock.WRITES.values()) expect(["none", "editable", "computed", "approved", "published", "submitted"]).toContain(guard);
  });

  const writes = [...lock.WRITES.entries()].filter(([, guard]) => guard !== "none");
  test.each(writes)("%s (guard %s) refuses every run it must not touch, before it does anything", async (name, guard) => {
    for (const [status, code] of REFUSED[guard]) {
      const spy = jest.spyOn(repo, "lockRun");
      spy.mockClear();
      spy.mockResolvedValue(runWith(status));
      const client = { query: jest.fn() };
      await expect(functions[name](client, "00000000-0000-4000-8000-000000000001", {})).rejects.toMatchObject({ code, status: 409 });
      expect(spy).toHaveBeenCalledTimes(1);
      // It locked the row and was refused: nothing else ran.
      expect(client.query).not.toHaveBeenCalled();
    }
  });

  test.each(writes)("%s (guard %s) answers 404 for a run that does not exist", async (name) => {
    jest.spyOn(repo, "lockRun").mockResolvedValue(null);
    await expect(functions[name]({ query: jest.fn() }, "00000000-0000-4000-8000-000000000001", {})).rejects.toMatchObject({ status: 404 });
  });

  test("assertEditable lets a Draft and a Computed run through and refuses the rest", () => {
    expect(() => lock.assertEditable(runWith("draft"))).not.toThrow();
    expect(() => lock.assertEditable(runWith("computed"))).not.toThrow();
    for (const status of ["submitted", "approved", "paid"])
      expect(() => lock.assertEditable(runWith(status))).toThrow(expect.objectContaining({ code: "RUN_NOT_EDITABLE", status: 409 }));
  });

  test("a write defined twice, or against an unknown guard, is a defect", () => {
    expect(() => lock.defineWrite("computeRun", "editable", async () => null)).toThrow(/already defined/);
    expect(() => lock.defineWrite("somethingNew", "whenever", async () => null)).toThrow(/not a guard/);
  });
});
