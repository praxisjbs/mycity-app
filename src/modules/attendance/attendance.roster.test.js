"use strict";
/**
 * Attendance: the roster's reading of a day, without a database. Which days are worked and
 * their hours (the module's own rules.shiftFor), the register's statuses in Home's words, a
 * day as the module records it (rules.projectDay with its lateness) read back by the
 * roster, what a person's days add up to, and the ranges a read over several days refuses. The roster's SQL, its scope and its agreement
 * with the register run against Postgres in tests/integration/attendance-roster.test.js.
 */
const c = require("@mycity/contract");
const lagos = require("../../shared/time/lagos");
const workingWeek = require("../../shared/time/working-week");
const lateness = require("./attendance.lateness");
const rules = require("./attendance.rules");
const roster = require("./attendance.roster");

// Monday to Saturday as MyCity works it (A22), Saturday's shift shorter, one public holiday.
const cal = workingWeek.makeCalendar({
  days: [1, 2, 3, 4, 5, 6],
  holidays: [{ holiday_date: "2026-10-01", name: "Independence Day" }],
  hours: {
    1: { starts_at: "09:00", ends_at: "17:00" },
    2: { starts_at: "09:00", ends_at: "17:00" },
    3: { starts_at: "09:00", ends_at: "17:00" },
    4: { starts_at: "09:00", ends_at: "17:00" },
    5: { starts_at: "09:00", ends_at: "17:00" },
    6: { starts_at: "10:00", ends_at: "15:00" },
  },
});

const FRIDAY = "2026-10-02";
const SATURDAY = "2026-10-03";
const SUNDAY = "2026-10-04";
const TZ = "Africa/Lagos";
const at = (date, hhmm, seconds = 0) => new Date(lagos.instant(date, hhmm).getTime() + seconds * 1000);

/** A worked day with no record, for someone on site; each test changes one thing. */
const fact = (patch = {}) => ({ day_status: null, on_leave: false, working_day: true, work_pattern: "on_site", ...patch });

/** A day as the attendance module records it: its counted punches, through its own rules. */
function recorded(date, clockIns, { grace = 0, onLeave = false, closed = false } = {}) {
  return rules.projectDay({
    events: clockIns.map((occurred_at) => ({ event_type: "clock_in", occurred_at })),
    shift: rules.shiftFor(date, cal, { grace_minutes: grace }),
    date,
    timeZone: TZ,
    onLeave,
    closed,
    late: lateness.minutesLate,
    overtime: lateness.minutesOvertime,
  });
}

describe("the day", () => {
  test("a weekday is worked on its own hours, as the attendance module's shift reads them", () => {
    expect(roster.dayOf(FRIDAY, cal)).toEqual({ date: FRIDAY, working_day: true, starts_at: "09:00", ends_at: "17:00" });
    const shift = rules.shiftFor(FRIDAY, cal, rules.DEFAULT_POLICY);
    expect(roster.dayOf(FRIDAY, cal)).toMatchObject({ starts_at: shift.starts_at, ends_at: shift.ends_at });
  });

  test("Saturday is worked, on its own shorter shift", () => {
    expect(roster.dayOf(SATURDAY, cal)).toMatchObject({ working_day: true, starts_at: "10:00", ends_at: "15:00" });
  });

  test("a rest day and a public holiday are not worked and have no shift", () => {
    for (const date of [SUNDAY, "2026-10-01"])
      expect(roster.dayOf(date, cal)).toMatchObject({ working_day: false, starts_at: null, ends_at: null });
  });

  test("a calendar with no hours set falls back to the default week", () => {
    expect(roster.dayOf(FRIDAY, workingWeek.makeCalendar())).toMatchObject({ starts_at: "09:00", ends_at: "17:00" });
  });

  test("yesterday is the last working day: Saturday on a Monday, and before a holiday after one", () => {
    expect(roster.yesterdayOf("2026-10-05", cal).date).toBe(SATURDAY);
    expect(roster.yesterdayOf(FRIDAY, cal).date).toBe("2026-09-30");
    expect(roster.yesterdayOf("2026-09-30", cal).date).toBe("2026-09-29");
  });

  test("a date that is not a real day is refused", () => {
    expect(() => roster.dayOf("2026-02-30", cal)).toThrow(TypeError);
  });
});

describe("the register's statuses in Home's words", () => {
  test("the vocabulary is the contract's", () => {
    expect(roster.STATUSES).toEqual(c.dashboard.HomeRosterStatus.options);
    expect(roster.STATUSES).toEqual(["on_leave", "late", "on_site", "remote", "field", "absent", "not_in"]);
  });

  test("a recorded day keeps its status, whatever else holds", () => {
    expect(roster.statusOf(fact({ day_status: "leave" }))).toBe("on_leave");
    expect(roster.statusOf(fact({ day_status: "late", on_leave: true }))).toBe("late");
    expect(roster.statusOf(fact({ day_status: "absent" }))).toBe("absent");
    expect(roster.statusOf(fact({ day_status: "present", working_day: false }))).toBe("on_site");
  });

  test("present is remote only for someone who works remotely; hybrid and on site are on site", () => {
    expect(roster.statusOf(fact({ day_status: "present", work_pattern: "remote" }))).toBe("remote");
    expect(roster.statusOf(fact({ day_status: "present", work_pattern: "hybrid" }))).toBe("on_site");
    expect(roster.statusOf(fact({ day_status: "present", work_pattern: "on_site" }))).toBe("on_site");
    expect(roster.statusOf(fact({ day_status: "late", work_pattern: "remote" }))).toBe("late");
  });

  test("present on a field assignment's day is field, whatever the work pattern; late stays late", () => {
    expect(roster.statusOf(fact({ day_status: "present", field_day: true }))).toBe("field");
    expect(roster.statusOf(fact({ day_status: "present", work_pattern: "remote", field_day: true }))).toBe("field");
    expect(roster.statusOf(fact({ day_status: "present", remote_day: true, field_day: true }))).toBe("field");
    expect(roster.statusOf(fact({ day_status: "late", field_day: true }))).toBe("late");
    expect(roster.statusOf(fact({ field_day: true }))).toBe("not_in");
  });

  test("with nothing recorded: granted leave, else not in on a working day, else nothing", () => {
    expect(roster.statusOf(fact({ on_leave: true }))).toBe("on_leave");
    expect(roster.statusOf(fact({ on_leave: true, working_day: false }))).toBe("on_leave");
    expect(roster.statusOf(fact())).toBe("not_in");
    expect(roster.statusOf(fact({ working_day: false }))).toBeNull();
  });

  test("a record whose only punch a decision excluded has no status, and reads as nothing recorded", () => {
    expect(roster.statusOf(fact({ day_status: null }))).toBe("not_in");
  });
});

describe("a day as the attendance module records it", () => {
  const read = (projection, patch = {}) => roster.statusOf(fact({ day_status: projection.status, ...patch }));

  test("grace is the module's: inside it is on time, after it late by the minutes past it", () => {
    expect(read(recorded(FRIDAY, [at(FRIDAY, "09:05")], { grace: 5 }))).toBe("on_site");
    const late = recorded(FRIDAY, [at(FRIDAY, "09:07")], { grace: 5 });
    expect(read(late)).toBe("late");
    expect(late.late_minutes).toBe(2);
  });

  test("lateness is in whole minutes of the workplace's clock: 09:00:59 is on time", () => {
    expect(read(recorded(FRIDAY, [at(FRIDAY, "09:00", 59)]))).toBe("on_site");
    expect(recorded(FRIDAY, [at(FRIDAY, "09:01")]).late_minutes).toBe(1);
  });

  test("Saturday is judged against its own start", () => {
    expect(read(recorded(SATURDAY, [at(SATURDAY, "09:45")]))).toBe("on_site");
    expect(read(recorded(SATURDAY, [at(SATURDAY, "10:01")]))).toBe("late");
  });

  test("leave wins over a clock-in; a closed working day with none is absent; an open one not in", () => {
    expect(read(recorded(FRIDAY, [at(FRIDAY, "11:00")], { onLeave: true }))).toBe("on_leave");
    expect(read(recorded(FRIDAY, [], { closed: true }))).toBe("absent");
    expect(read(recorded(FRIDAY, []))).toBe("not_in");
  });

  test("a clock-in on a day that is not worked is present and never late", () => {
    const sunday = recorded(SUNDAY, [at(SUNDAY, "11:00")]);
    expect(sunday).toMatchObject({ status: "present", late_minutes: 0 });
    expect(read(sunday, { working_day: false })).toBe("on_site");
    expect(read(recorded(SUNDAY, [], { closed: true }), { working_day: false })).toBeNull();
  });
});

describe("what a person's days add up to", () => {
  test("a recorded day counts as My Attendance counts it; a day with no record counts as nothing", () => {
    expect(roster.outcomeOf("present")).toBe("on_time");
    expect(roster.outcomeOf("late")).toBe("late");
    expect(roster.outcomeOf("absent")).toBe("absent");
    expect(roster.outcomeOf("leave")).toBe("on_leave");
    expect(roster.outcomeOf(null)).toBeNull();
  });

  test("the totals are My Attendance's figures, with leave apart from the days expected", () => {
    const totals = roster.totalsOf({ days_present: 5, late_days: 2, absent_days: 1, leave_days: 3 });
    expect(totals).toEqual({ expected: 6, on_time: 3, late: 2, absent: 1, on_leave: 3 });
    expect(totals.expected).toBe(totals.on_time + totals.late + totals.absent);
  });
});

describe("everyone's days over a range", () => {
  const never = { query: jest.fn() };
  const ALL = { scope: "all", scope_ids: null };

  test("more than a month, a range that ends before it starts, or a day that is not real is refused before anything is read", async () => {
    await expect(roster.month(never, { from: "2026-10-01", to: "2026-11-01" }, ALL, {})).rejects.toMatchObject({
      code: "ATTENDANCE_RANGE",
      status: 422,
      fields: { to: ["More than 31 days"] },
    });
    await expect(roster.month(never, { from: "2026-10-05", to: "2026-10-04" }, ALL, {})).rejects.toMatchObject({
      code: "ATTENDANCE_RANGE",
      fields: { to: ["Before the first day"] },
    });
    await expect(roster.month(never, { from: "2026-02-30", to: "2026-03-01" }, ALL, {})).rejects.toThrow(TypeError);
    expect(never.query).not.toHaveBeenCalled();
  });

  test("a whole month of 31 days is one range", async () => {
    const client = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    const result = await roster.month(client, { from: "2026-10-01", to: "2026-10-31" }, ALL, {});
    expect(result).toEqual({ data: [], page: { number: 1, size: 25, total: 0, pages: 0, has_next: false } });
    expect(client.query).toHaveBeenCalledTimes(1);
  });
});

describe("one person's days", () => {
  const never = { query: jest.fn() };

  test("more than a month, or a range that ends before it starts, is refused before anything is read", async () => {
    await expect(
      roster.personal(never, { employee_id: "x", from: "2026-10-01", to: "2026-11-01" }),
    ).rejects.toMatchObject({ code: "ATTENDANCE_RANGE", status: 422, fields: { to: ["More than 31 days"] } });
    await expect(
      roster.personal(never, { employee_id: "x", from: "2026-10-05", to: "2026-10-04" }),
    ).rejects.toMatchObject({ code: "ATTENDANCE_RANGE", status: 422, fields: { to: ["Before the first day"] } });
    expect(never.query).not.toHaveBeenCalled();
  });
});
