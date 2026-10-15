import { describe, expect, it } from "vitest";
import {
  formatBytes,
  formatCount,
  formatDate,
  formatDateTime,
  formatMoney,
  formatMoneyShort,
  formatMonth,
  formatTime,
  formatWhen,
  initials,
  isNegative,
  monthName,
  parseDayFirst,
  plural,
  todayIso,
} from "./format";

describe("dates, day-first in Lagos time", () => {
  it("formats an ISO date and a timestamp day-first", () => {
    expect(formatDate("2026-10-13")).toBe("13/10/2026");
    expect(formatDate("2026-10-13T23:30:00Z")).toBe("14/10/2026"); // Lagos is UTC+1
    expect(formatDate(null)).toBe("");
    expect(formatTime("2026-10-13T08:14:00Z")).toBe("09:14");
    expect(formatDateTime("2026-10-13T08:14:00Z")).toBe("13/10/2026 09:14");
  });

  it("reads lists of messages as today, yesterday or a date", () => {
    const now = new Date("2026-10-13T12:00:00Z");
    expect(formatWhen("2026-10-13T08:14:00Z", now)).toBe("09:14");
    expect(formatWhen("2026-10-12T08:14:00Z", now)).toBe("Yesterday");
    expect(formatWhen("2026-10-01T08:14:00Z", now)).toBe("01/10/2026");
  });

  it("names months and today", () => {
    expect(formatMonth("2026-10")).toBe("October 2026");
    expect(monthName(0)).toBe("January");
    expect(todayIso(new Date("2026-10-13T23:30:00Z"))).toBe("2026-10-14");
  });

  it("parses day-first text and refuses impossible dates", () => {
    expect(parseDayFirst("13/10/2026")).toBe("2026-10-13");
    expect(parseDayFirst("1.2.26")).toBe("2026-02-01");
    expect(parseDayFirst("31/02/2026")).toBeNull();
    expect(parseDayFirst("2026-10-13")).toBeNull();
  });
});

describe("money, from the string digits", () => {
  it("formats Naira with kobo, never through a float", () => {
    expect(formatMoney("1250000.00")).toBe("₦1,250,000.00");
    expect(formatMoney("12345678901234567.89")).toBe("₦12,345,678,901,234,567.89");
    expect(formatMoney("-50.5")).toBe("−₦50.50");
    expect(formatMoney("1250000.00", { kobo: false })).toBe("₦1,250,000");
    expect(formatMoney("")).toBe("");
  });

  it("shortens for KPI tiles", () => {
    expect(formatMoneyShort("1250000.00")).toBe("₦1.2M");
    expect(formatMoneyShort("850000")).toBe("₦850K");
    expect(formatMoneyShort("2000000000")).toBe("₦2B");
    expect(formatMoneyShort("-950")).toBe("−₦950");
  });

  it("tells a negative amount from its string", () => {
    expect(isNegative("-0.00")).toBe(false);
    expect(isNegative("-1.00")).toBe(true);
    expect(isNegative("1.00")).toBe(false);
  });
});

describe("counts and names", () => {
  it("formats counts, plurals, sizes and initials", () => {
    expect(formatCount(1234567)).toBe("1,234,567");
    expect(plural(1, "employee")).toBe("1 employee");
    expect(plural(1200, "employee")).toBe("1,200 employees");
    expect(formatBytes(86016)).toBe("84 KB");
    expect(formatBytes(1153434)).toBe("1.1 MB");
    expect(initials("Cynthia Osakunih")).toBe("CO");
    expect(initials("Tobi")).toBe("T");
  });
});
