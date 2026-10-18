import { describe, expect, it } from "vitest";
import type { HomeOverview } from "@mycity/contract/contract.gen.ts";
import { reloadsFor, showsOthers } from "./refresh";

/** An Overview with only what the rule reads; the rest is never looked at. */
const overview = (o: Partial<Pick<HomeOverview, "clocked_in" | "chart" | "donut" | "cards">>) =>
  ({ clocked_in: null, chart: null, donut: null, cards: [], ...o }) as unknown as HomeOverview;
const card = (key: string) => ({ key }) as HomeOverview["cards"][number];

describe("an Overview that shows other people's attendance", () => {
  it("is one with the date line, the attendance chart, the On Time donut or an attendance card", () => {
    expect(showsOthers(overview({ clocked_in: { present: 3, expected: 5 } }))).toBe(true);
    expect(showsOthers(overview({ chart: { kind: "attendance_days" } as HomeOverview["chart"] }))).toBe(true);
    expect(showsOthers(overview({ donut: { kind: "on_time" } as HomeOverview["donut"] }))).toBe(true);
    for (const key of ["attendance_today", "team_present", "team_on_site", "team_remote", "team_flags"])
      expect([key, showsOthers(overview({ cards: [card(key)] }))]).toEqual([key, true]);
  });

  it("is not a staff or partnerships Overview of their own work, nor one not loaded yet", () => {
    expect(showsOthers(overview({ cards: [card("my_attendance_30d"), card("partnerships_active")] }))).toBe(false);
    expect(showsOthers(undefined)).toBe(false);
  });
});

describe("whether a punch reads the Overview again", () => {
  const ops = overview({ clocked_in: { present: 3, expected: 5 } });
  const staff = overview({ cards: [card("my_attendance_30d")] });

  it("reads it again for someone else's punch on an Overview that shows it", () => {
    expect(reloadsFor({ employee_id: "e-2" }, ops, "e-1")).toBe(true);
  });

  it("leaves the reader's own punch to their clock state", () => {
    expect(reloadsFor({ employee_id: "e-1" }, ops, "e-1")).toBe(false);
  });

  it("ignores every punch on an Overview that shows no one else's attendance", () => {
    expect(reloadsFor({ employee_id: "e-2" }, staff, "e-1")).toBe(false);
  });
});
