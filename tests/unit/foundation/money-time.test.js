"use strict";
const m = require("../../../src/shared/money/money");
const lagos = require("../../../src/shared/time/lagos");
const df = require("../../../src/shared/time/day-first");
const ww = require("../../../src/shared/time/working-week");
const rec = require("../../../src/shared/time/recurrence");

describe("money", () => {
  test("exact where floats are not: 0.1 + 0.2", () => {
    expect(m.toWire(m.money("0.10").plus(m.money("0.20")))).toBe("0.30");
  });

  test("half-up to the kobo", () => {
    expect(m.toWire("2.005")).toBe("2.01");
    expect(m.toWire("-2.005")).toBe("-2.01");
    expect(m.toWire("1250000")).toBe("1250000.00");
  });

  test("refuses fractional JS numbers and junk", () => {
    expect(() => m.money(0.1)).toThrow(/fractional/);
    expect(() => m.money("12,000")).toThrow(/not an amount/);
    expect(() => m.money("")).toThrow();
    expect(m.toWire(m.money(5))).toBe("5.00");
  });

  test("percentOf and sum", () => {
    expect(m.toWire(m.percentOf("200000.00", "7.5"))).toBe("15000.00");
    expect(m.toWire(m.sum(["1.10", "2.20", "3.30"]))).toBe("6.60");
    expect(m.toWire(m.sum([]))).toBe("0.00");
  });

  test.each([
    ["100.00", [1, 1, 1], ["33.34", "33.33", "33.33"]],
    ["0.05", [1, 1], ["0.03", "0.02"]],
    ["10.00", [3, 1], ["7.50", "2.50"]],
    ["-100.00", [1, 1, 1], ["-33.34", "-33.33", "-33.33"]],
    ["1000.00", [0, 2, 1], ["0.00", "666.67", "333.33"]],
  ])("allocate(%s, %j) adds up to the kobo", (total, weights, expected) => {
    const parts = m.allocate(total, weights);
    expect(parts).toEqual(expected);
    expect(m.toWire(m.sum(parts))).toBe(m.toWire(total));
  });

  test("formatNaira for people", () => {
    expect(m.formatNaira("1250000")).toBe("₦1,250,000.00");
    expect(m.formatNaira("-500.5")).toBe("-₦500.50");
    expect(m.formatNaira("999.999", { symbol: false })).toBe("1,000.00");
  });
});

describe("Lagos time", () => {
  test("00:30 in Lagos is still the previous UTC day, and today() knows it", () => {
    const at = new Date("2026-10-13T23:30:00Z"); // 00:30 on 14/10 in Lagos
    expect(lagos.dateOf(at)).toBe("2026-10-14");
    expect(lagos.timeOf(at)).toBe("00:30");
  });

  test("instant() is the UTC time an hour earlier", () => {
    expect(lagos.instant("2026-10-14", "09:00").toISOString()).toBe("2026-10-14T08:00:00.000Z");
    expect(lagos.endOfDayExclusive("2026-10-14").toISOString()).toBe("2026-10-14T23:00:00.000Z");
  });

  test("month arithmetic clamps to the month's end", () => {
    expect(lagos.addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(lagos.addMonths("2028-01-31", 1)).toBe("2028-02-29");
    expect(lagos.monthBounds("2026-02-10")).toEqual({ first: "2026-02-01", last: "2026-02-28" });
  });

  test("weekday and impossible dates", () => {
    expect(lagos.weekday("2026-10-12")).toBe(1);
    expect(lagos.weekday("2026-10-18")).toBe(7);
    expect(lagos.isDate("2026-02-30")).toBe(false);
    expect(() => lagos.addDays("2026-02-30", 1)).toThrow();
  });
});

describe("day-first", () => {
  test("formats for people", () => {
    expect(df.formatDate("2026-10-09")).toBe("09/10/2026");
    expect(df.formatDateTime(new Date("2026-10-09T13:05:00Z"))).toBe("09/10/2026 14:05");
    expect(df.formatLongDate("2026-10-09")).toBe("9 October 2026");
    expect(df.formatMonth("2026-10-01")).toBe("October 2026");
    expect(df.formatDate(null)).toBe("");
  });

  test.each([
    ["9/10/2026", "2026-10-09"],
    ["09-10-2026", "2026-10-09"],
    ["09.10.2026", "2026-10-09"],
    ["2026-10-09", "2026-10-09"],
    ["31/02/2026", null],
    ["10/9/26", null],
    ["October 9", null],
  ])("parseDayFirst(%s)", (input, expected) => {
    expect(df.parseDayFirst(input)).toBe(expected);
  });
});

describe("working week", () => {
  const cal = ww.makeCalendar({ days: [1, 2, 3, 4, 5], holidays: [{ holiday_date: "2026-10-01", name: "Independence Day" }] });

  test("weekends and holidays are not worked, and say why", () => {
    expect(ww.isWorkingDay("2026-10-01", cal)).toBe(false);
    expect(ww.whyNotWorking("2026-10-01", cal)).toBe("Independence Day");
    expect(ww.whyNotWorking("2026-10-03", cal)).toBe("weekend");
    expect(ww.whyNotWorking("2026-10-02", cal)).toBeNull();
  });

  test("adding working days skips weekends and holidays", () => {
    expect(ww.addWorkingDays("2026-09-30", 1, cal)).toBe("2026-10-02"); // over the holiday
    expect(ww.addWorkingDays("2026-10-02", 1, cal)).toBe("2026-10-05"); // Friday to Monday
    expect(ww.addWorkingDays("2026-10-05", -1, cal)).toBe("2026-10-02");
  });

  test("counting October 2026: 22 weekdays less one holiday", () => {
    expect(ww.countWorkingDays("2026-10-01", "2026-10-31", cal)).toBe(21);
    expect(ww.countWorkingDays("2026-10-31", "2026-10-01", cal)).toBe(0);
  });

  test("a six-day week is a setting, not code", () => {
    const six = ww.makeCalendar({ days: [1, 2, 3, 4, 5, 6] });
    expect(ww.isWorkingDay("2026-10-03", six)).toBe(true);
  });

  test("business days are Monday to Friday, not holidays, even in a six-day working week (performance.md G2)", () => {
    const six = ww.makeCalendar({ days: [1, 2, 3, 4, 5, 6], holidays: ["2027-01-01", "2026-12-25", "2026-12-28"] });
    expect(ww.isBusinessDay("2026-11-07", six)).toBe(false); // a worked Saturday is not a business day
    expect(ww.isBusinessDay("2027-01-01", six)).toBe(false);
    // MyCity's own reporting deadlines: the 3rd business day of each month.
    expect(ww.nthBusinessDay("2026-11", 3, six)).toBe("2026-11-04");
    expect(ww.nthBusinessDay("2026-12", 3, six)).toBe("2026-12-03");
    expect(ww.nthBusinessDay("2027-01", 3, six)).toBe("2027-01-06");
    expect(ww.nthBusinessDay("2026-11", 2, six)).toBe("2026-11-03");
    expect(ww.addBusinessDays("2026-11-04", 2, six)).toBe("2026-11-06");
    expect(ww.addBusinessDays("2026-11-06", 1, six)).toBe("2026-11-09"); // Friday to Monday
    expect(ww.addBusinessDays("2026-11-09", -1, six)).toBe("2026-11-06");
    expect(ww.countBusinessDays("2026-12-21", "2026-12-31", six)).toBe(7); // less Christmas and the 28th
    expect(() => ww.nthBusinessDay("2026-11-01", 1, six)).toThrow(/YYYY-MM/);
  });

  test("loadCalendar reads the settings, and defaults to Monday to Friday on an empty table", async () => {
    ww.invalidateCalendar();
    const client = { query: jest.fn().mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] }) };
    const c = await ww.loadCalendar(client, { now: 1 });
    expect([...c.days]).toEqual([1, 2, 3, 4, 5]);
    ww.invalidateCalendar();
  });
});

describe("recurrence", () => {
  test("weekly on Monday and Wednesday", () => {
    expect(rec.occurrences({ freq: "weekly", by_weekday: [3, 1] }, "2026-10-14", { to: "2026-10-27" }))
      .toEqual(["2026-10-14", "2026-10-19", "2026-10-21", "2026-10-26"]);
  });

  test("monthly on the 31st falls back to the month's last day; -1 is always the last day", () => {
    expect(rec.occurrences({ freq: "monthly", by_month_day: 31 }, "2026-01-31", { to: "2026-04-30" }))
      .toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
    expect(rec.occurrences({ freq: "monthly", by_month_day: -1 }, "2026-10-14", { to: "2026-12-31" }))
      .toEqual(["2026-10-31", "2026-11-30", "2026-12-31"]);
  });

  test("count and until end a rule", () => {
    expect(rec.occurrences({ freq: "weekly", interval: 2, count: 3 }, "2026-10-14", { to: "2027-12-31" }))
      .toEqual(["2026-10-14", "2026-10-28", "2026-11-11"]);
    expect(rec.occurrences({ freq: "yearly", until: "2028-12-31" }, "2026-10-14", { to: "2040-01-01" }))
      .toEqual(["2026-10-14", "2027-10-14", "2028-10-14"]);
  });

  test("working days only: daily skips non-working days, monthly moves to the next working day", () => {
    const cal = ww.makeCalendar({ holidays: ["2026-10-01"] });
    expect(rec.occurrences({ freq: "daily", working_days_only: true }, "2026-09-30", { to: "2026-10-05", calendar: cal }))
      .toEqual(["2026-09-30", "2026-10-02", "2026-10-05"]);
    expect(rec.occurrences({ freq: "monthly", by_month_day: 1, working_days_only: true }, "2026-10-01", { to: "2026-11-30", calendar: cal }))
      .toEqual(["2026-10-02", "2026-11-02"]); // 1 Nov 2026 is a Sunday
  });

  test("nextAfter", () => {
    expect(rec.nextAfter({ freq: "weekly", by_weekday: [3] }, "2026-10-14", "2026-10-14")).toBe("2026-10-21");
    expect(rec.nextAfter({ freq: "daily", count: 2 }, "2026-10-14", "2026-10-15")).toBeNull();
  });

  test("a bad rule is refused before it is saved", () => {
    expect(rec.validateRule({ freq: "hourly" })).toEqual([expect.stringMatching(/freq/)]);
    expect(rec.validateRule({ freq: "weekly", by_month_day: 3 })).toEqual([expect.stringMatching(/by_month_day is for monthly/)]);
    expect(rec.validateRule({ freq: "daily", until: "2026-12-31", count: 3 })).toEqual([expect.stringMatching(/not both/)]);
    expect(rec.validateRule({ freq: "monthly", by_month_day: -1 })).toEqual([]);
  });
});
