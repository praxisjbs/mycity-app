// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import type { HomeActivityItem, HomeKpiCard, HomeKpiCell } from "@mycity/contract/contract.gen.ts";
import { figureOf } from "./cards";
import { Cell, momentOf } from "./KpiDetail";
import { activityLine } from "./labels";
import { openCards } from "./Overview";

/** How a card's figure, a record's cell and an activity line read (docs/guides/home.md §6, §10.1). */

const card = (over: Partial<HomeKpiCard>): HomeKpiCard => ({
  key: "headcount",
  title: "Headcount",
  unit: "count",
  value: 24,
  amount: null,
  denominator: null,
  measurable: true,
  caption: null,
  tone: null,
  trend: null,
  opens: true,
  module: "people",
  ...over,
});
const shown = (node: ReturnType<typeof figureOf>) => render(<>{node}</>).container.textContent;

describe("the cards the row shows", () => {
  it("leaves out a card whose module is Coming Soon in this build, whoever may see it (F14)", () => {
    const cards = [card({}), card({ key: "expenses_pending", title: "Expenses Awaiting Approval", unit: "money", value: null, amount: "747000.00", module: "expenses" })];
    expect(openCards(cards, (m) => m !== "expenses").map((c) => c.key)).toEqual(["headcount"]);
    expect(openCards(cards, () => true).map((c) => c.key)).toEqual(["headcount", "expenses_pending"]);
  });
});

describe("a card's figure", () => {
  it("is a count with thousands grouped", () => {
    expect(shown(figureOf(card({ value: 1250 })))).toBe("1,250");
  });

  it("keeps what a part is out of: 22 of 25", () => {
    expect(shown(figureOf(card({ unit: "pair", value: 22, denominator: 25 })))).toBe("22 of 25");
  });

  it("shows no figure for a ratio with nothing to measure, rather than a zero", () => {
    expect(shown(figureOf(card({ unit: "pair", value: 0, denominator: 0, measurable: false })))).not.toMatch(/\d/);
    expect(shown(figureOf(card({ unit: "pct", value: 0, denominator: 0, measurable: false })))).not.toMatch(/\d/);
  });

  it("is a percentage, days, or Naira in the short form KPI tiles use", () => {
    expect(shown(figureOf(card({ unit: "pct", value: 92, denominator: 3 })))).toBe("92%");
    expect(shown(figureOf(card({ unit: "days", value: 12 })))).toBe("12 days");
    expect(shown(figureOf(card({ unit: "days", value: 1 })))).toBe("1 day");
    expect(shown(figureOf(card({ unit: "money", value: null, amount: "9200000.00" })))).toBe("₦9.2M");
  });

  it("keeps a zero as a figure", () => {
    expect(shown(figureOf(card({ value: 0 })))).toBe("0");
  });
});

describe("a record's cell", () => {
  const cell = (c: HomeKpiCell | null) => render(<Cell cell={c} />).container.textContent;

  it("formats each kind at render time: dates day-first, money as Naira", () => {
    expect(cell({ kind: "date", date: "2026-10-13" })).toBe("13/10/2026");
    expect(cell({ kind: "money", amount: "820000.00" })).toBe("₦820,000.00");
    expect(cell({ kind: "number", value: 1234.5 })).toBe("1,234.5");
    expect(cell({ kind: "text", text: "Annual" })).toBe("Annual");
    expect(cell({ kind: "pill", tone: "warn", text: "Late" })).toBe("Late");
    expect(cell(null)).toBe("");
  });

  it("reads a moment as the time alone today, the day and time any other day", () => {
    expect(momentOf("2026-10-19T08:14:00Z", "2026-10-19")).toBe("09:14");
    expect(momentOf("2026-10-13T08:14:00Z", "2026-10-19")).toBe("13/10/2026 09:14");
  });
});

describe("Activity Today's lines", () => {
  const event = (over: Partial<HomeActivityItem>): HomeActivityItem => ({
    event_id: "00000000-0000-4000-a000-000000000009",
    event_key: "employee.created",
    module_key: "people",
    occurred_at: "2026-10-19T09:05:00Z",
    actor_name: "Cynthia Osakunih",
    subject: "Samuel Ade",
    link: null,
    ...over,
  });

  it("words each event the server's allow-list sends", () => {
    expect(activityLine(event({}))).toBe("Samuel Ade joined");
    expect(activityLine(event({ event_key: "leave_request.approved" }))).toBe("Leave approved for Samuel Ade");
    expect(activityLine(event({ event_key: "recognition.posted", module_key: "community" }))).toBe("Cynthia Osakunih recognised Samuel Ade");
  });

  it("shows nothing for a key it has no words for, never the raw key", () => {
    expect(activityLine(event({ event_key: "payroll.run_submitted" }))).toBeNull();
  });
});
