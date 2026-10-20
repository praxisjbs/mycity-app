// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import type { AttendanceToday } from "@mycity/contract/contract.gen.ts";
import { claimStart, closeDue, noteShown, promptDue, remindIn, workplaceNow } from "./prompts";

/**
 * When the clock panel opens by itself (docs/guides/attendance.md §6.14): the start and closing
 * prompts on the workplace's clock, and the marks that keep each to its once or its reminder.
 * Instants are written in UTC and read in Africa/Lagos (UTC+1).
 */

const today = (over: Partial<AttendanceToday> = {}): AttendanceToday => ({
  date: "2026-10-19",
  timezone: "Africa/Lagos",
  server_time: "2026-10-19T08:00:00.000Z",
  state: "not_clocked_in",
  unavailable_reason: null,
  leave: null,
  clock_in_at: null,
  clock_out_at: null,
  clock_out_automatic: false,
  sign_in_prompt: false,
  review: false,
  shift: { working_day: true, starts_at: "09:00", ends_at: "17:00", grace_minutes: 0, off_reason: null },
  work_pattern: "on_site",
  location: { kind: "worksite", name: "Testbed Office", radius_m: 100, home_state: null },
  policy: { geofence_mode: "warn", device_mode: "off", max_accuracy_m: 100 },
  device: { state: "registered", label: "Chrome", registered_count: 1, can_register: false },
  ...over,
});
const at = (iso: string) => new Date(iso);

beforeEach(() => localStorage.clear());

describe("the workplace's clock", () => {
  it("reads the date and the minutes in the workplace's zone, not the device's", () => {
    expect(workplaceNow(at("2026-10-19T23:30:00Z"), "Africa/Lagos")).toEqual({ date: "2026-10-20", minutes: 30 });
    expect(workplaceNow(at("2026-10-19T08:05:00Z"), "Africa/Lagos")).toEqual({ date: "2026-10-19", minutes: 545 });
  });
});

describe("which prompt is due", () => {
  it("the start prompt from the start for an hour, for someone not clocked in", () => {
    expect(promptDue(today(), at("2026-10-19T07:59:00Z"))).toBeNull();
    expect(promptDue(today(), at("2026-10-19T08:00:00Z"))).toBe("start");
    expect(promptDue(today(), at("2026-10-19T08:59:00Z"))).toBe("start");
    expect(promptDue(today(), at("2026-10-19T09:00:00Z"))).toBeNull();
    expect(promptDue(today({ state: "unavailable" }), at("2026-10-19T08:10:00Z"))).toBeNull();
  });

  it("the closing prompt from the end while clocked in, overnight too; none on a day not worked", () => {
    const inside = today({ state: "clocked_in", clock_in_at: "2026-10-19T08:01:00Z" });
    expect(promptDue(inside, at("2026-10-19T15:59:00Z"))).toBeNull();
    expect(promptDue(inside, at("2026-10-19T16:00:00Z"))).toBe("close");
    // A shift still open after midnight is still past its end.
    expect(promptDue(inside, at("2026-10-19T23:30:00Z"))).toBe("close");
    const late = today({ state: "clocked_in", shift: { working_day: true, starts_at: "22:00", ends_at: "06:00", grace_minutes: 0, off_reason: null } });
    expect(promptDue(late, at("2026-10-19T23:30:00Z"))).toBeNull();
    expect(promptDue(late, at("2026-10-20T05:00:00Z"))).toBe("close");
    expect(promptDue(today({ state: "clocked_in", shift: { working_day: false, starts_at: null, ends_at: null, grace_minutes: 0, off_reason: "Sunday" } }), at("2026-10-19T20:00:00Z"))).toBeNull();
    expect(promptDue(today({ state: "clocked_out" }), at("2026-10-19T17:00:00Z"))).toBeNull();
  });
});

describe("the marks", () => {
  it("the start prompt opens once a person and day, and not after the panel was shown since the start", () => {
    expect(claimStart("u-1", "2026-10-19")).toBe(true);
    expect(claimStart("u-1", "2026-10-19")).toBe(false);
    expect(claimStart("u-2", "2026-10-19")).toBe(true);
    noteShown("u-3", today(), at("2026-10-19T08:20:00Z"));
    expect(claimStart("u-3", "2026-10-19")).toBe(false);
    // Shown before the start: the start prompt still opens at the start.
    noteShown("u-4", today(), at("2026-10-19T07:40:00Z"));
    expect(claimStart("u-4", "2026-10-19")).toBe(true);
  });

  it("the closing prompt waits for its reminder, and a new day starts clean", () => {
    expect(closeDue("u-1", "2026-10-19", at("2026-10-19T16:00:00Z"))).toBe(true);
    remindIn("u-1", "2026-10-19", at("2026-10-19T16:00:00Z"), 30);
    expect(closeDue("u-1", "2026-10-19", at("2026-10-19T16:29:00Z"))).toBe(false);
    expect(closeDue("u-1", "2026-10-19", at("2026-10-19T16:30:00Z"))).toBe(true);
    remindIn("u-1", "2026-10-19", at("2026-10-19T16:30:00Z"));
    expect(closeDue("u-1", "2026-10-19", at("2026-10-19T16:44:00Z"))).toBe(false);
    expect(closeDue("u-1", "2026-10-20", at("2026-10-20T16:01:00Z"))).toBe(true);
    expect(closeDue("u-2", "2026-10-19", at("2026-10-19T16:31:00Z"))).toBe(true);
  });
});
