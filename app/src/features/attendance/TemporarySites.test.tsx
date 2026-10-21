// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { AttendanceEvent, CheckIn } from "@mycity/contract/contract.gen.ts";
import { formatTime } from "@mycity/ui";
import { axe, axeMatchers } from "@mycity/ui/testing";
import { checkInLine, DayRoute } from "./TemporarySites";

/**
 * A temporary site's day as People and the person read it (docs/guides/attendance.md §6.12, §10):
 * the clock-in, each check-in with its address and verdict, then the clock-out, in time order; a
 * day with no check-ins shows nothing more than its punches.
 */

expect.extend(axeMatchers);
afterEach(cleanup);

const punch = (event_type: "clock_in" | "clock_out", occurred_at: string, over: Partial<AttendanceEvent> = {}) =>
  ({ attendance_event_id: `${event_type}-${occurred_at}`, event_type, occurred_at, worksite_name: "Partner Training Week, Hall", excluded: false, ...over }) as AttendanceEvent;
const stop = (occurred_at: string, over: Partial<CheckIn> = {}): CheckIn => ({
  attendance_check_in_id: `check-in-${occurred_at}`,
  work_date: "2026-10-21",
  occurred_at,
  temporary_site_location_id: "00000000-0000-4000-a000-000000000010",
  position: 2,
  location_name: "Partner Training Week, Annex",
  address: "Partner Annex, 9 Example Road",
  home_address: null,
  distance_m: 40,
  accuracy_m: 12,
  verdict: "inside",
  location_reason: null,
  flagged: false,
  ...over,
});

describe("a day's route", () => {
  it("puts the check-ins between the punches, in time order, each with its address and verdict", async () => {
    const { container } = render(
      <DayRoute
        punches={[punch("clock_out", "2026-10-21T16:05:00.000Z"), punch("clock_in", "2026-10-21T07:58:00.000Z"), punch("clock_in", "2026-10-21T07:50:00.000Z", { excluded: true })]}
        checkIns={[stop("2026-10-21T13:20:00.000Z", { verdict: "outside", distance_m: 1450, flagged: true }), stop("2026-10-21T10:02:00.000Z")]}
      />,
    );
    const route = screen.getByRole("list", { name: "Route" });
    const items = within(route).getAllByRole("listitem").map((li) => li.textContent ?? "");
    expect(items).toHaveLength(4);
    expect(items[0]).toContain("Clock In");
    expect(items[0]).toContain(formatTime("2026-10-21T07:58:00.000Z"));
    expect(items[1]).toContain("Check-In, Partner Training Week, Annex");
    expect(items[1]).toContain("Partner Annex, 9 Example Road · Inside");
    expect(items[2]).toContain("Flagged, 1.4 km away");
    expect(items[3]).toContain("Clock Out");
    expect(await axe(container)).toHaveNoViolations();
  });

  it("shows nothing on a day with no check-ins", () => {
    const { container } = render(<DayRoute punches={[punch("clock_in", "2026-10-21T07:58:00.000Z")]} checkIns={[]} />);
    expect(container.textContent).toBe("");
  });

  it("reads a Temporary Home's check-in by its own line, and one it could not place as Flagged", () => {
    expect(checkInLine(stop("2026-10-21T10:00:00.000Z", { address: null, home_address: "Flat 2, 7 Sample Street", verdict: "unverified", distance_m: null, flagged: true }))).toBe("Flat 2, 7 Sample Street · Flagged");
    expect(checkInLine(stop("2026-10-21T10:00:00.000Z", { verdict: "unverified", flagged: false }))).toBe("Partner Annex, 9 Example Road · Recorded");
  });
});
