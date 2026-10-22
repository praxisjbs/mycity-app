"use strict";
/**
 * Attendance: the pure rules (docs/guides/attendance.md §6). The punch end to end, with
 * the lock, idempotency, the database backstop, exceptions, scope and the day-close,
 * runs against Postgres in tests/integration/attendance.test.js.
 *
 * Every person, place and coordinate here is invented. The worksite is a fictional office
 * at 6.500000, 3.400000 with a 100 m fence; the instants are written in UTC and read in
 * Africa/Lagos (UTC+1), so a test also proves the host's zone is never used.
 */
const workingWeek = require("../../shared/time/working-week");
const geo = require("../../shared/geo/geo");
const guard = require("./attendance.clock-guard");
const { decideGeofence, judgeReading } = require("./attendance.geofence");
const lateness = require("./attendance.lateness");
const rules = require("./attendance.rules");
const { detailOf } = require("./attendance.reconcile");
const { messageOf } = require("./attendance.service");
const { routesOf } = require("../../http/route");

const TZ = "Africa/Lagos";
const OFFICE = { kind: "worksite", worksite_id: "w-1", name: "Testbed Office", latitude: 6.5, longitude: 3.4, radius_m: 100 };
const HOME = { kind: "home", attendance_home_id: "h-1", worksite_id: null, name: "Home", latitude: 6.5, longitude: 3.4, radius_m: 100 };

/** A point `metres` north of the office (one degree of latitude is about 111,195 m). */
const north = (metres) => ({ latitude: 6.5 + metres / 111_195, longitude: 3.4 });

/* ------------------------------------------------------------------ *
 * The clock guard
 * ------------------------------------------------------------------ */

describe("the clock guard", () => {
  const ev = (event_type, validation_state = "accepted") => ({ event_type, validation_state });
  const decide = (events, eventType) => guard.evaluateClockTransition({ events, eventType });

  test("no earlier event: a clock-in is allowed and a clock-out refused", () => {
    expect(decide([], "clock_in")).toEqual({ allowed: true, reason: null, message: null });
    expect(decide([], "clock_out")).toMatchObject({ allowed: false, reason: "NOT_CLOCKED_IN" });
  });

  test("after a clock-in: a second clock-in is refused, a clock-out allowed", () => {
    expect(decide([ev("clock_in")], "clock_in")).toMatchObject({ allowed: false, reason: "ALREADY_CLOCKED_IN" });
    expect(decide([ev("clock_in")], "clock_out")).toMatchObject({ allowed: true });
  });

  test("after a clock-out: a second clock-out is refused, and so is another clock-in (one shift a day)", () => {
    const done = [ev("clock_in"), ev("clock_out")];
    expect(decide(done, "clock_out")).toMatchObject({ allowed: false, reason: "ALREADY_CLOCKED_OUT" });
    expect(decide(done, "clock_in")).toMatchObject({ allowed: false, reason: "SHIFT_DONE" });
  });

  test("a punch under review counts as made; a rejected attempt never does", () => {
    expect(decide([ev("clock_in", "review")], "clock_in")).toMatchObject({ reason: "ALREADY_CLOCKED_IN" });
    expect(decide([ev("clock_in", "review")], "clock_out")).toMatchObject({ allowed: true });
    expect(decide([ev("clock_in", "rejected")], "clock_in")).toMatchObject({ allowed: true });
    expect(decide([ev("clock_in", "rejected")], "clock_out")).toMatchObject({ reason: "NOT_CLOCKED_IN" });
    expect(decide([ev("clock_in"), ev("clock_out", "rejected")], "clock_out")).toMatchObject({ allowed: true });
  });

  test("a punch People rejected frees its slot: the person clocks in, or out, again", () => {
    const excluded = (event_type) => ({ event_type, validation_state: "review", excluded: true });
    expect(decide([excluded("clock_in")], "clock_in")).toMatchObject({ allowed: true });
    expect(decide([excluded("clock_in")], "clock_out")).toMatchObject({ allowed: false, reason: "NOT_CLOCKED_IN" });
    expect(decide([excluded("clock_in"), ev("clock_in")], "clock_in")).toMatchObject({ reason: "ALREADY_CLOCKED_IN" });
    expect(decide([ev("clock_in"), excluded("clock_out")], "clock_out")).toMatchObject({ allowed: true });
    expect(decide([ev("clock_in"), excluded("clock_out")], "clock_in")).toMatchObject({ reason: "ALREADY_CLOCKED_IN" });
    expect(guard.isOpen([ev("clock_in"), excluded("clock_out")])).toBe(true);
    expect(guard.isOpen([excluded("clock_in")])).toBe(false);
  });

  test("a clock-out still counting after its clock-in was rejected ends the day", () => {
    const day = [{ event_type: "clock_in", validation_state: "review", excluded: true }, ev("clock_out")];
    expect(decide(day, "clock_in")).toMatchObject({ allowed: false, reason: "SHIFT_DONE" });
    expect(decide(day, "clock_out")).toMatchObject({ allowed: false, reason: "NOT_CLOCKED_IN" });
  });

  test("an unknown action is refused, and the messages carry no dashes", () => {
    expect(decide([], "break")).toMatchObject({ allowed: false, reason: "INVALID_EVENT_TYPE" });
    for (const m of Object.values(guard.MESSAGES)) expect(m).not.toMatch(/[–—]|--/);
  });

  test("isOpen: an active clock-in with no clock-out", () => {
    expect(guard.isOpen([ev("clock_in")])).toBe(true);
    expect(guard.isOpen([ev("clock_in"), ev("clock_out")])).toBe(false);
    expect(guard.isOpen([ev("clock_in", "rejected")])).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * The geofence
 * ------------------------------------------------------------------ */

describe("the geofence", () => {
  const judge = (over) =>
    decideGeofence({
      mode: "warn",
      point: north(40),
      accuracy_m: 20,
      location_error: null,
      expected: OFFICE,
      work_pattern: "on_site",
      max_accuracy_m: 100,
      ...over,
    });

  test("inside the radius is accepted, the distance worked out on the server", () => {
    const r = judge({ point: north(40) });
    expect(r).toMatchObject({ verdict: "inside", result: "accepted", exception: null, accuracy: "good" });
    expect(r.distance_m).toBe(40);
  });

  test("exactly on the boundary is inside", () => {
    const point = north(100);
    expect(geo.distanceM(point, OFFICE)).toBe(100);
    expect(judge({ point })).toMatchObject({ verdict: "inside", result: "accepted" });
  });

  test("outside: off accepts with the evidence, warn reviews, block rejects and opens the exception", () => {
    const point = north(340);
    expect(judge({ point, mode: "off" })).toMatchObject({ verdict: "outside", result: "accepted", exception: null, distance_m: 340 });
    expect(judge({ point, mode: "warn" })).toMatchObject({ verdict: "outside", result: "review", exception: "outside_worksite" });
    expect(judge({ point, mode: "block" })).toMatchObject({ verdict: "outside", result: "rejected", exception: "outside_worksite" });
  });

  test("no reading (permission denied, unavailable) is unverified: reviewed under warn and block, never rejected", () => {
    for (const location_error of ["denied", "unavailable", "timeout", "unsupported", "insecure", null]) {
      const warn = judge({ point: null, location_error, mode: "warn" });
      expect(warn).toMatchObject({ verdict: "unverified", reason: location_error || "no_location", result: "review", exception: "location_unverified", retry_location: true });
      expect(judge({ point: null, location_error, mode: "block" })).toMatchObject({ result: "review" });
      expect(judge({ point: null, location_error, mode: "off" })).toMatchObject({ result: "accepted", exception: null });
    }
  });

  test("a day from home while Home Location is off is not checked, under every mode, whatever was read (§1.3)", () => {
    for (const mode of ["off", "warn", "block"])
      for (const point of [north(40), north(5000), null]) {
        const r = judge({ mode, point, expected: null, work_pattern: "remote", home_day: true, unchecked: true });
        expect(r).toMatchObject({
          verdict: "not_applied",
          reason: "home_location_off",
          result: "accepted",
          exception: null,
          distance_m: null,
          accuracy: null,
          place: null,
          home_id: null,
          retry_location: false,
        });
      }
    // On, the same remote day with no approved home is reviewed, as before.
    expect(judge({ point: north(40), expected: null, work_pattern: "remote", home_day: true })).toMatchObject({
      verdict: "unverified",
      reason: "no_home",
      result: "review",
    });
  });

  test("the reading rule, every case: inside, outside, at the edge, too rough (judgeReading)", () => {
    const r = (d, a) => judgeReading({ distance_m: d, accuracy_m: a, radius_m: 100, max_accuracy_m: 100 });
    // Inside: the centre within the radius and the reading as fine as the policy asks, the boundaries included.
    expect(r(40, 20)).toEqual({ verdict: "inside", reason: null });
    expect(r(100, 20)).toEqual({ verdict: "inside", reason: null });
    expect(r(100, 100)).toEqual({ verdict: "inside", reason: null });
    // Outside: even the nearest point the reading allows is beyond the fence, however rough it is.
    expect(r(130, 20)).toEqual({ verdict: "outside", reason: null });
    expect(r(5000, 1500)).toEqual({ verdict: "outside", reason: null });
    // Unclear at the edge: the circle crosses the fence; d - a exactly the radius is not outside.
    expect(r(101, 20)).toEqual({ verdict: "unverified", reason: "edge" });
    expect(r(120, 20)).toEqual({ verdict: "unverified", reason: "edge" });
    expect(r(180, 80)).toEqual({ verdict: "unverified", reason: "edge" });
    // Unclear and too rough: rougher than the policy's accuracy, inside the radius or across it.
    expect(r(40, 101)).toEqual({ verdict: "unverified", reason: "poor_accuracy" });
    expect(r(150, 1200)).toEqual({ verdict: "unverified", reason: "poor_accuracy" });
  });

  test("an edge reading is unclear: reviewed under warn and block, never refused, with its distance", () => {
    for (const mode of ["warn", "block"])
      expect(judge({ point: north(115), accuracy_m: 30, mode })).toMatchObject({
        verdict: "unverified", reason: "edge", result: "review", exception: "location_unverified", distance_m: 115, retry_location: true,
      });
    expect(judge({ point: north(115), accuracy_m: 30, mode: "off" })).toMatchObject({ verdict: "unverified", reason: "edge", result: "accepted", exception: null });
  });

  test("a rough reading whose whole circle is beyond the fence is outside, and refused under block", () => {
    expect(judge({ point: north(3000), accuracy_m: 1500, mode: "block" })).toMatchObject({
      verdict: "outside", accuracy: "poor", result: "rejected", exception: "outside_worksite", distance_m: 3000,
    });
    expect(judge({ point: north(1200), accuracy_m: 1500, mode: "block" })).toMatchObject({ verdict: "unverified", reason: "poor_accuracy", result: "review" });
  });

  test("coordinates with no accuracy, or an accuracy of 0 or less, are no reading", () => {
    for (const accuracy_m of [null, undefined, 0, -5]) {
      const r = judge({ point: north(10), accuracy_m, mode: "block" });
      expect(r).toMatchObject({
        verdict: "unverified", reason: "no_accuracy", accuracy: null, distance_m: null, result: "review", exception: "location_unverified", retry_location: true,
      });
    }
    expect(judge({ point: north(5000), accuracy_m: 0, mode: "block" })).toMatchObject({ verdict: "unverified", reason: "no_accuracy", result: "review" });
  });

  test("a temporary site's addresses: the nearest judges the punch under the reading rule; a Temporary Home is judged as a home", () => {
    const a1 = { field_site_id: "loc-1", name: "Gaborone Hall", latitude: OFFICE.latitude, longitude: OFFICE.longitude, radius_m: 150 };
    const a2 = { field_site_id: "loc-2", name: "Depot", latitude: OFFICE.latitude + 0.05, longitude: OFFICE.longitude, radius_m: 150 };
    const SITE = {
      kind: "temporary_site", place: "temporary_site", worksite_id: null, attendance_home_id: null, temporary_site_id: "ts-1",
      name: "Partner Training", latitude: a1.latitude, longitude: a1.longitude, radius_m: null, sites: [a1, a2],
    };
    expect(judge({ expected: SITE, point: north(100) })).toMatchObject({ verdict: "inside", site_id: "loc-1", worksite_name: "Gaborone Hall", radius_m: 150, place: "temporary_site" });
    expect(judge({ expected: SITE, point: north(160), accuracy_m: 30, mode: "block" })).toMatchObject({ verdict: "unverified", reason: "edge", result: "review", site_id: "loc-1" });
    expect(judge({ expected: SITE, point: north(900), mode: "block" })).toMatchObject({ verdict: "outside", result: "rejected", exception: "outside_worksite", site_id: "loc-1" });
    expect(judge({ expected: SITE, point: north(100), accuracy_m: 400 })).toMatchObject({ verdict: "unverified", reason: "poor_accuracy" });
    const TEMP_HOME = { ...SITE, kind: "temporary_home", place: "temporary_home", name: "Temporary Home", sites: [{ ...a1, name: "Temporary Home" }] };
    expect(judge({ expected: TEMP_HOME, point: north(900), mode: "block" })).toMatchObject({
      verdict: "outside", result: "rejected", exception: "outside_home", outside: "outside_home", place: "temporary_home", worksite_id: null,
    });
    expect(judge({ expected: TEMP_HOME, point: north(160), accuracy_m: 30, mode: "warn" })).toMatchObject({ verdict: "unverified", reason: "edge", exception: "location_unverified" });
  });

  test("a reading worse than the policy's accuracy is unverified, with the distance kept; fair accuracy still counts", () => {
    expect(judge({ accuracy_m: 180 })).toMatchObject({ verdict: "unverified", reason: "poor_accuracy", accuracy: "poor", result: "review", distance_m: 40 });
    expect(judge({ accuracy_m: 180, mode: "block" })).toMatchObject({ result: "review" });
    expect(judge({ accuracy_m: 75 })).toMatchObject({ verdict: "inside", accuracy: "fair", result: "accepted" });
  });

  test("someone expected at an office with none assigned is reviewed under warn and block, never rejected", () => {
    for (const work_pattern of ["on_site", "hybrid"])
      for (const mode of ["warn", "block"])
        expect(judge({ expected: null, work_pattern, point: north(5000), mode })).toMatchObject({
          verdict: "unverified", reason: "no_worksite", result: "review", exception: "location_unverified",
          retry_location: false, distance_m: null, place: null,
        });
    expect(judge({ expected: null, mode: "off" })).toMatchObject({ verdict: "unverified", reason: "no_worksite", result: "accepted", exception: null });
  });

  test("a hybrid employee's home day is judged as a remote employee's: the approved home, or no_home without one", () => {
    expect(judge({ work_pattern: "hybrid", home_day: true, expected: HOME, point: north(60) })).toMatchObject({
      verdict: "inside", place: "home", home_id: "h-1", worksite_id: null,
    });
    expect(judge({ work_pattern: "hybrid", home_day: true, expected: HOME, point: north(400), mode: "block" })).toMatchObject({
      verdict: "outside", result: "rejected", outside: "outside_home", exception: "outside_home",
    });
    expect(judge({ work_pattern: "hybrid", home_day: true, expected: null, mode: "block" })).toMatchObject({
      verdict: "unverified", reason: "no_home", result: "review", exception: "location_unverified",
    });
  });

  test("a client visit with a site is fenced on it, as a field site is, and names the visit", () => {
    const VISIT = {
      kind: "client_visit", place: "client_visit", worksite_id: null, attendance_home_id: null, location_request_id: "r-3",
      name: "Client Visit", latitude: OFFICE.latitude, longitude: OFFICE.longitude, radius_m: 200,
    };
    expect(judge({ expected: VISIT, work_pattern: "remote", point: north(150) })).toMatchObject({
      verdict: "inside", result: "accepted", place: "client_visit", request_id: "r-3", worksite_id: null, home_id: null,
      worksite_name: "Client Visit", radius_m: 200,
    });
    expect(judge({ expected: VISIT, point: north(420), mode: "warn" })).toMatchObject({
      verdict: "outside", result: "review", exception: "outside_worksite", distance_m: 420,
    });
    expect(judge({ expected: VISIT, point: north(420), mode: "block" })).toMatchObject({ result: "rejected", outside: "outside_worksite" });
  });

  test("a remote employee is judged against their approved home: inside, the boundary, outside", () => {
    const remote = (over) => judge({ work_pattern: "remote", expected: HOME, ...over });
    expect(remote({ point: north(60) })).toMatchObject({
      verdict: "inside", result: "accepted", place: "home", home_id: "h-1", worksite_id: null, worksite_name: "Home", distance_m: 60,
    });
    expect(remote({ point: north(100) })).toMatchObject({ verdict: "inside", result: "accepted" });
    expect(remote({ point: north(130), mode: "warn" })).toMatchObject({ verdict: "outside", result: "review", exception: "outside_home", worksite_id: null });
    expect(remote({ point: north(2500), mode: "block" })).toMatchObject({ verdict: "outside", result: "rejected", exception: "outside_home" });
    // Just past the radius with a 20 m reading: the circle crosses the fence, so it is unclear.
    expect(remote({ point: north(101), mode: "block" })).toMatchObject({ verdict: "unverified", reason: "edge", result: "review", exception: "location_unverified" });
    expect(remote({ point: null, location_error: "denied", mode: "block" })).toMatchObject({
      verdict: "unverified", result: "review", exception: "location_unverified", retry_location: true,
    });
  });

  test("a remote employee with no approved home is reviewed under warn and block, never rejected", () => {
    for (const mode of ["warn", "block"]) {
      const r = judge({ work_pattern: "remote", expected: null, point: north(5000), mode });
      expect(r).toMatchObject({ verdict: "unverified", reason: "no_home", result: "review", exception: "location_unverified", retry_location: false, place: null });
    }
    expect(judge({ work_pattern: "remote", expected: null, point: null, mode: "block" })).toMatchObject({ reason: "no_home", result: "review" });
    expect(judge({ work_pattern: "remote", expected: null, mode: "off" })).toMatchObject({ result: "accepted", exception: null });
  });

  test("on an approved remote day or client visit with no fence the approval is the check, under every mode", () => {
    const approved = { location_request_id: "r-1", place: "client_visit", name: "Client Visit" };
    for (const mode of ["off", "warn", "block"]) {
      expect(judge({ expected: null, approved, point: north(9000), mode })).toMatchObject({
        verdict: "not_applied", reason: "approved_request", result: "accepted", exception: null, place: "client_visit",
        worksite_name: "Client Visit", request_id: "r-1", worksite_id: null, distance_m: null,
      });
    }
    expect(judge({ expected: null, approved, point: null, location_error: "denied", mode: "block" })).toMatchObject({ result: "accepted", retry_location: false });
    expect(judge({ expected: null, approved: { ...approved, place: "remote_day", name: "Remote Day" }, work_pattern: "remote", mode: "block" }))
      .toMatchObject({ verdict: "not_applied", reason: "approved_request", place: "remote_day" });
  });

  test("a temporary home is fenced like a home and names itself", () => {
    const TEMP = { ...HOME, kind: "temporary_home", place: "temporary_home", attendance_home_id: null, location_request_id: "r-2", name: "Temporary Home" };
    expect(judge({ work_pattern: "remote", expected: TEMP, point: north(40) })).toMatchObject({
      verdict: "inside", result: "accepted", place: "temporary_home", request_id: "r-2", home_id: null, worksite_name: "Temporary Home",
    });
    expect(judge({ work_pattern: "remote", expected: TEMP, point: north(400), mode: "warn" })).toMatchObject({ exception: "outside_home", outside: "outside_home" });
    expect(judge({ work_pattern: "remote", expected: TEMP, point: north(400), mode: "block" })).toMatchObject({ result: "rejected", outside: "outside_home" });
  });

  test("a hybrid employee is judged against their worksite", () => {
    expect(judge({ work_pattern: "hybrid", point: north(340) })).toMatchObject({
      verdict: "outside", result: "review", exception: "outside_worksite", place: "worksite", worksite_id: "w-1", home_id: null,
    });
  });

  test("a field assignment's day is judged at the nearer of its sites, named by it, as a worksite is", () => {
    const near = { field_site_id: "s-1", name: "Venue Hall", latitude: OFFICE.latitude, longitude: OFFICE.longitude, radius_m: 200 };
    const far = { field_site_id: "s-2", name: "Depot Yard", latitude: OFFICE.latitude + 0.05, longitude: OFFICE.longitude, radius_m: 300 };
    const FIELD = {
      kind: "field", place: "field", worksite_id: null, attendance_home_id: null, field_assignment_id: "fa-1",
      name: "Venue Hall or Depot Yard", latitude: near.latitude, longitude: near.longitude, radius_m: null, sites: [near, far],
    };
    expect(judge({ expected: FIELD, point: north(150) })).toMatchObject({
      verdict: "inside", result: "accepted", place: "field", worksite_id: null, worksite_name: "Venue Hall",
      assignment_id: "fa-1", site_id: "s-1", radius_m: 200,
    });
    // Beyond every site: outside the nearer one, as outside a worksite.
    const out = judge({ expected: FIELD, point: north(900), mode: "warn" });
    expect(out).toMatchObject({ verdict: "outside", exception: "outside_worksite", worksite_name: "Venue Hall", site_id: "s-1" });
    expect(judge({ expected: FIELD, point: north(900), mode: "block" })).toMatchObject({ result: "rejected", outside: "outside_worksite" });
    // A remote employee sent out is judged at the site, never as at home.
    expect(judge({ expected: FIELD, work_pattern: "remote", point: north(150) })).toMatchObject({ verdict: "inside", home_id: null });
    // No reading: unverified against the first site, never rejected.
    expect(judge({ expected: FIELD, point: null, location_error: "denied", mode: "block" })).toMatchObject({
      verdict: "unverified", result: "review", worksite_name: "Venue Hall",
    });
  });
});

/* ------------------------------------------------------------------ *
 * Time
 * ------------------------------------------------------------------ */

describe("the workplace clock", () => {
  test("the work date is the workplace's: 23:30 UTC is the next day in Lagos", () => {
    expect(rules.localDate(new Date("2026-10-15T23:30:00Z"), TZ)).toBe("2026-10-16");
    expect(rules.localDate(new Date("2026-10-15T22:59:00Z"), TZ)).toBe("2026-10-15");
    expect(rules.localTime(new Date("2026-10-15T23:30:00Z"), TZ)).toBe("00:30");
  });

  test("another zone is read in that zone; an unknown zone falls back to Lagos", () => {
    expect(rules.localTime(new Date("2026-07-01T12:00:00Z"), "Europe/London")).toBe("13:00");
    expect(rules.localTime(new Date("2026-07-01T12:00:00Z"), "Not/AZone")).toBe("13:00");
    expect(rules.isTimeZone("Africa/Lagos")).toBe(true);
    expect(rules.isTimeZone("Not/AZone")).toBe(false);
  });

  test("minutes into a work date count past midnight for a late shift", () => {
    expect(rules.minutesIntoDay(new Date("2026-10-16T08:05:00Z"), "2026-10-16", TZ)).toBe(9 * 60 + 5);
    expect(rules.minutesIntoDay(new Date("2026-10-16T23:30:00Z"), "2026-10-16", TZ)).toBe(24 * 60 + 30);
  });

  test("zonedInstant is the inverse: 09:00 in Lagos is 08:00Z, and in London in summer 08:00Z too", () => {
    expect(rules.zonedInstant("2026-10-16", "09:00", TZ).toISOString()).toBe("2026-10-16T08:00:00.000Z");
    expect(rules.zonedInstant("2026-07-01", "09:00", "Europe/London").toISOString()).toBe("2026-07-01T08:00:00.000Z");
  });

  test("a device clock ahead of the server is held for review; behind is a delayed submission", () => {
    const server_at = new Date("2026-10-16T08:00:00Z");
    expect(rules.timeCheck({ server_at, device_at: "2026-10-16T07:59:50Z" })).toEqual({ skew_seconds: 10, future: false, delayed: false });
    expect(rules.timeCheck({ server_at, device_at: "2026-10-16T08:01:30Z" })).toMatchObject({ skew_seconds: -90, future: false });
    expect(rules.timeCheck({ server_at, device_at: "2026-10-16T08:09:00Z" })).toMatchObject({ skew_seconds: -540, future: true });
    expect(rules.timeCheck({ server_at, device_at: "2026-10-16T07:40:00Z" })).toMatchObject({ skew_seconds: 1200, delayed: true, future: false });
    expect(rules.timeCheck({ server_at, device_at: null })).toEqual({ skew_seconds: null, future: false, delayed: false });
  });

  test("the strictest result wins", () => {
    expect(rules.strictest("accepted", "accepted")).toBe("accepted");
    expect(rules.strictest("accepted", "review", "accepted")).toBe("review");
    expect(rules.strictest("review", "rejected", "accepted")).toBe("rejected");
  });
});

describe("the shift and lateness", () => {
  // MyCity's week (A22): Monday to Friday 09:00 to 17:00, Saturday 09:00 to 15:00, and a holiday.
  const hours = {};
  for (const d of [1, 2, 3, 4, 5]) hours[d] = { starts_at: "09:00", ends_at: "17:00" };
  hours[6] = { starts_at: "09:00", ends_at: "15:00" };
  const cal = workingWeek.makeCalendar({
    days: [1, 2, 3, 4, 5, 6],
    holidays: [{ holiday_date: "2026-10-01", name: "Independence Day" }],
    hours,
  });
  const policy = { grace_minutes: 5 };

  test("a weekday, a Saturday, a Sunday and a public holiday, by the working week while no version sets hours", () => {
    expect(rules.shiftFor("2026-10-16", cal, policy)).toEqual({
      working_day: true,
      starts_at: "09:00",
      ends_at: "17:00",
      grace_minutes: 5,
      early_grace_minutes: 0,
      off_reason: null,
      place: "office",
      attendance_work_schedule_id: null,
    });
    expect(rules.shiftFor("2026-10-17", cal, policy)).toMatchObject({ working_day: true, ends_at: "15:00" });
    expect(rules.shiftFor("2026-10-18", cal, policy)).toMatchObject({ working_day: false, starts_at: null, off_reason: "Day Off" });
    expect(rules.shiftFor("2026-10-01", cal, policy)).toMatchObject({ working_day: false, off_reason: "Independence Day" });
  });

  // The company hours a version sets (§6.15's suggested hours, with Saturday off for the test).
  const HOURS = [1, 2, 3, 4, 5, 6, 7].map((weekday) =>
    weekday <= 5
      ? { weekday, working: true, starts_at: "08:00", ends_at: "16:00" }
      : { weekday, working: false, starts_at: null, ends_at: null },
  );

  test("a version's company hours replace the working week; a remote pattern works them from home", () => {
    const withHours = { ...policy, hours: HOURS };
    expect(rules.shiftFor("2026-10-16", cal, withHours)).toMatchObject({ working_day: true, starts_at: "08:00", ends_at: "16:00" });
    expect(rules.shiftFor("2026-10-17", cal, withHours)).toMatchObject({ working_day: false, off_reason: "Day Off" });
    expect(rules.shiftFor("2026-10-16", cal, withHours, { pattern: "remote" })).toMatchObject({ place: "remote" });
    expect(rules.shiftFor("2026-10-16", cal, withHours, { pattern: "hybrid" })).toMatchObject({ place: "office" });
  });

  test("a person's schedule wins: its own hours, a blank day on the company hours, Off, and never a holiday", () => {
    const day = (working, starts_at = null, ends_at = null, place = "office") => ({ working, starts_at, ends_at, place });
    const schedule = {
      attendance_work_schedule_id: "s-1",
      days: [
        day(true, "10:00", "14:00", "remote"), // Monday, part time from home
        day(false),
        day(true), // Wednesday, the company hours
        day(true),
        day(true),
        day(true, "09:00", "13:00"), // Saturday, worked although the company is off
        day(true), // Sunday, blank on a day the company does not work: Off
      ],
    };
    const on = (date, p = { ...policy, hours: HOURS }) => rules.shiftFor(date, cal, p, { schedule, pattern: "on_site" });
    expect(on("2026-10-12")).toMatchObject({ working_day: true, starts_at: "10:00", ends_at: "14:00", place: "remote", attendance_work_schedule_id: "s-1" });
    expect(on("2026-10-13")).toMatchObject({ working_day: false, off_reason: "Day Off" });
    expect(on("2026-10-14")).toMatchObject({ working_day: true, starts_at: "08:00", ends_at: "16:00", place: "office" });
    expect(on("2026-10-17")).toMatchObject({ working_day: true, starts_at: "09:00", ends_at: "13:00" });
    expect(on("2026-10-18")).toMatchObject({ working_day: false });
    expect(rules.shiftFor("2026-10-01", cal, policy, { schedule })).toMatchObject({ working_day: false, off_reason: "Independence Day" });
  });

  test("a day judged once is read back from what it recorded, with the judging version's grace", () => {
    const day = { shift_working: true, shift_starts_at: "09:00:00", shift_ends_at: "17:00:00", attendance_work_schedule_id: "s-1" };
    expect(rules.recordedShift(day, { grace_minutes: 10, early_grace_minutes: 5 })).toEqual({
      working_day: true,
      starts_at: "09:00",
      ends_at: "17:00",
      grace_minutes: 10,
      early_grace_minutes: 5,
      off_reason: null,
      place: null,
      attendance_work_schedule_id: "s-1",
    });
    expect(rules.recordedShift({ shift_working: false }, { grace_minutes: 0 })).toMatchObject({ working_day: false, starts_at: null });
  });

  const late = (utc, grace = 5) =>
    lateness.minutesLate({ expectedStart: "09:00", firstClockInAt: new Date(utc), graceMinutes: grace, date: "2026-10-16", timeZone: TZ });

  test("inside the grace is not late; after it, late from the start (T2)", () => {
    expect(late("2026-10-16T07:55:00Z")).toBe(0); // 08:55
    expect(late("2026-10-16T08:05:00Z")).toBe(0); // 09:05, the last minute of grace
    expect(late("2026-10-16T08:06:00Z")).toBe(6); // 09:06: 6 minutes from 09:00
    expect(late("2026-10-16T08:12:00Z")).toBe(12); // 09:12, grace 5: 12 minutes late
    expect(late("2026-10-16T09:20:00Z")).toBe(80); // 10:20
    expect(late("2026-10-16T08:06:00Z", 0)).toBe(6);
  });

  test("on a UTC host a Lagos 09:30 is still 09:30", () => {
    expect(late("2026-10-16T08:30:00Z", 0)).toBe(30);
  });

  const early = (utc, grace = 5) =>
    lateness.minutesEarly({ expectedEnd: "17:00", lastClockOutAt: new Date(utc), graceMinutes: grace, date: "2026-10-16", timeZone: TZ });

  test("leaving early counts to the end once past the early grace (T5)", () => {
    expect(early("2026-10-16T15:50:00Z")).toBe(10); // 16:50, grace 5: 10 minutes early
    expect(early("2026-10-16T15:55:00Z")).toBe(0); // 16:55, within the grace
    expect(early("2026-10-16T16:10:00Z")).toBe(0); // after the end
    expect(early("2026-10-16T15:59:00Z", 0)).toBe(1);
  });

  test("overtime counts every minute past the end once past after_minutes; nothing without a clock-out", () => {
    const over = (utc, after = 30) =>
      lateness.minutesOvertime({ expectedEnd: "17:00", lastClockOutAt: utc ? new Date(utc) : null, afterMinutes: after, date: "2026-10-16", timeZone: TZ });
    expect(over("2026-10-16T16:45:00Z")).toBe(45); // 17:45 after 30: 45 minutes
    expect(over("2026-10-16T16:20:00Z")).toBe(0); // 17:20 after 30: none
    expect(over("2026-10-16T16:20:00Z", 0)).toBe(20);
    expect(over("2026-10-16T15:00:00Z")).toBe(0); // 16:00
    expect(over("2026-10-16T23:10:00Z")).toBe(7 * 60 + 10); // 00:10 the next day
    expect(over(null)).toBe(0);
    expect(lateness.minutesLate({ expectedStart: null, firstClockInAt: new Date(), date: "2026-10-16", timeZone: TZ })).toBe(0);
  });

  const project = (over) =>
    rules.projectDay({
      events: [],
      shift: rules.shiftFor("2026-10-16", cal, policy),
      date: "2026-10-16",
      timeZone: TZ,
      onLeave: false,
      closed: false,
      late: lateness.minutesLate,
      early: lateness.minutesEarly,
      overtime: lateness.minutesOvertime,
      ...over,
    });
  const at = (event_type, utc, source = "pwa") => ({ event_type, occurred_at: new Date(utc), source });

  test("a day's figures: present, late, worked, early and overtime minutes", () => {
    expect(project({ events: [at("clock_in", "2026-10-16T07:58:00Z"), at("clock_out", "2026-10-16T16:30:00Z")] })).toMatchObject({
      status: "present",
      worked_minutes: 8 * 60 + 32,
      late_minutes: 0,
      early_minutes: 0,
      overtime_minutes: 30,
      system_clock_out: false,
    });
    expect(project({ events: [at("clock_in", "2026-10-16T08:40:00Z")] })).toMatchObject({ status: "late", late_minutes: 40, worked_minutes: 0 });
    expect(project({ events: [at("clock_in", "2026-10-16T07:58:00Z"), at("clock_out", "2026-10-16T15:30:00Z")] })).toMatchObject({
      status: "present",
      early_minutes: 30,
      overtime_minutes: 0,
    });
    expect(
      project({ overtimeAfter: 30, events: [at("clock_in", "2026-10-16T07:58:00Z"), at("clock_out", "2026-10-16T16:20:00Z")] }),
    ).toMatchObject({ overtime_minutes: 0 });
  });

  test("a System Clock-Out counts to the end, is never early and never overtime; one People add stands in for the person's", () => {
    const system = project({ events: [at("clock_in", "2026-10-16T07:58:00Z"), at("clock_out", "2026-10-16T17:30:00Z", "system")] });
    expect(system).toMatchObject({ worked_minutes: 8 * 60 + 2, early_minutes: 0, overtime_minutes: 0, system_clock_out: true });
    // A clock-in after the end has no worked minutes when the system clocks it out.
    expect(project({ events: [at("clock_in", "2026-10-16T16:30:00Z"), at("clock_out", "2026-10-16T17:30:00Z", "system")] })).toMatchObject({
      worked_minutes: 0,
    });
    const admin = project({ events: [at("clock_in", "2026-10-16T07:58:00Z"), at("clock_out", "2026-10-16T18:00:00Z", "admin")] });
    expect(admin).toMatchObject({ worked_minutes: 10 * 60 + 2, overtime_minutes: 120, system_clock_out: false });
    expect(project({ events: [at("clock_in", "2026-10-16T07:58:00Z"), at("clock_out", "2026-10-16T15:00:00Z", "admin")] })).toMatchObject({
      early_minutes: 60,
    });
  });

  test("someone with no login is never absent", () => {
    expect(project({ closed: true, expected: false })).toMatchObject({ status: null });
  });

  test("leave beats a punch; a closed working day with no clock-in is absent; an open one has no status yet", () => {
    expect(project({ onLeave: true, events: [at("clock_in", "2026-10-16T08:40:00Z")] })).toMatchObject({ status: "leave", late_minutes: 0 });
    expect(project({ closed: true })).toMatchObject({ status: "absent" });
    expect(project({})).toMatchObject({ status: null });
  });

  test("a punch on a Sunday is present and never late, every worked minute overtime; a closed Sunday with none is not absent", () => {
    const sunday = (over) => project({ shift: rules.shiftFor("2026-10-18", cal, policy), date: "2026-10-18", ...over });
    expect(sunday({ events: [at("clock_in", "2026-10-18T09:00:00Z"), at("clock_out", "2026-10-18T12:30:00Z")] })).toMatchObject({
      status: "present",
      late_minutes: 0,
      early_minutes: 0,
      worked_minutes: 210,
      overtime_minutes: 210,
    });
    expect(sunday({ closed: true })).toMatchObject({ status: null });
  });

  test("a Saturday is judged against 09:00 to 15:00 (MILESTONES §6 definition of done)", () => {
    const saturday = rules.shiftFor("2026-10-17", cal, policy);
    expect(
      rules.projectDay({
        events: [at("clock_in", "2026-10-17T08:30:00Z"), at("clock_out", "2026-10-17T15:00:00Z")],
        shift: saturday,
        date: "2026-10-17",
        timeZone: TZ,
        onLeave: false,
        closed: false,
        late: lateness.minutesLate,
        early: lateness.minutesEarly,
        overtime: lateness.minutesOvertime,
      }),
    ).toMatchObject({ status: "late", late_minutes: 30, overtime_minutes: 60 }); // 09:30 in, 16:00 out
  });
});

/* ------------------------------------------------------------------ *
 * What a person and People read
 * ------------------------------------------------------------------ */

describe("what a person reads", () => {
  const row = (validation_state, reasons, extra = {}) => ({
    event_type: "clock_in",
    validation_state,
    occurred_at: new Date("2026-10-16T07:58:00Z"),
    validation: {
      reasons,
      time: { timezone: TZ },
      geofence: { distance_m: 340, worksite_name: "Testbed Office", reason: null },
      ...extra,
    },
  });

  test("the punch's message names the result and why, in the workplace's time", () => {
    expect(messageOf(row("accepted", []))).toBe("Clocked in at 08:58.");
    expect(messageOf(row("review", ["outside_worksite"]))).toBe(
      "Clocked in at 08:58. People will review it: you were 340 m from Testbed Office.",
    );
    expect(messageOf(row("rejected", ["unknown_device"]))).toBe("Not counted: this device is not registered.");
    expect(messageOf(row("review", ["outside_home"]))).toBe(
      "Clocked in at 08:58. People will review it: you were 340 m from your approved home.",
    );
    expect(
      messageOf(row("review", ["location_unverified"], { geofence: { reason: "no_home", distance_m: null, worksite_name: null } })),
    ).toBe("Clocked in at 08:58. People will review it: you have no approved home location yet.");
    expect(
      messageOf(row("rejected", ["outside_home"], { geofence: { distance_m: 400, place: "temporary_home", worksite_name: "Temporary Home" } })),
    ).toBe("Not counted: you were 400 m from your temporary home.");
    expect(
      messageOf(row("review", ["location_unverified"], { geofence: { reason: "no_worksite", distance_m: null, worksite_name: null } })),
    ).toBe("Clocked in at 08:58. People will review it: you have no office assigned yet.");
    expect(
      messageOf(row("rejected", ["outside_worksite"], { geofence: { distance_m: 420, place: "client_visit", worksite_name: "Client Visit" } })),
    ).toBe("Not counted: you were 420 m from the client's site.");
  });

  test("a Location Unclear punch says why: a rough reading, at the edge, no reading", () => {
    const unclear = (reason) => messageOf(row("review", ["location_unverified"], { geofence: { reason, distance_m: 115, worksite_name: "Testbed Office" } }));
    expect(unclear("poor_accuracy")).toBe("Clocked in at 08:58. People will review it: your location reading was too rough.");
    expect(unclear("edge")).toBe("Clocked in at 08:58. People will review it: your location reading was at the edge of the fence.");
    expect(unclear("no_accuracy")).toBe("Clocked in at 08:58. People will review it: your location could not be checked.");
    expect(unclear("denied")).toBe("Clocked in at 08:58. People will review it: your location could not be checked.");
  });

  test("an exception's detail comes from its evidence", () => {
    expect(detailOf("outside_worksite", { distance_m: 340, worksite_name: "Testbed Office", radius_m: 100 })).toBe(
      "340 m from Testbed Office, radius 100 m",
    );
    expect(detailOf("outside_home", { distance_m: 2400, worksite_name: "Home", radius_m: 100 })).toBe(
      "2400 m from the approved home, radius 100 m",
    );
    expect(detailOf("outside_home", { distance_m: 400, place: "temporary_home", radius_m: 100 })).toBe(
      "400 m from the temporary home, radius 100 m",
    );
    expect(detailOf("location_unverified", { reason: "no_home" })).toBe("No approved home");
    expect(detailOf("location_unverified", { reason: "no_worksite" })).toBe("No office assigned");
    expect(detailOf("outside_worksite", { distance_m: 420, place: "client_visit", worksite_name: "Client Visit", radius_m: 200 })).toBe(
      "420 m from the client's site, radius 200 m",
    );
    expect(detailOf("location_unverified", { reason: "denied" })).toBe("No reading: location was not shared");
    expect(detailOf("location_unverified", { reason: "no_accuracy" })).toBe("No reading: the reading had no accuracy");
    expect(detailOf("location_unverified", { reason: "insecure" })).toBe("No reading: the page was not on its secure address");
    expect(detailOf("location_unverified", { reason: "poor_accuracy", accuracy_m: 180.4 })).toBe("Rough reading: accurate to 180 m");
    expect(detailOf("location_unverified", { reason: "edge", distance_m: 115, worksite_name: "Testbed Office", radius_m: 100, accuracy_m: 30 })).toBe(
      "At the edge: 115 m from Testbed Office, radius 100 m, accurate to 30 m",
    );
    expect(detailOf("outside_worksite", { distance_m: 340, worksite_name: "Testbed Office", radius_m: 100, refused: true })).toBe(
      "Refused: 340 m from Testbed Office, radius 100 m",
    );
    expect(detailOf("unknown_device", { device_label: "Chrome on Android", refused: true })).toBe("Refused: Unregistered device: Chrome on Android");
    expect(detailOf("unknown_device", { device_label: "Chrome on Android" })).toBe("Unregistered device: Chrome on Android");
    expect(detailOf("suspicious_timestamp", { skew_seconds: -540 })).toBe("Device clock 9 min ahead");
    expect(detailOf("missing_clock_out", { clock_in_at: "2026-10-16T07:58:00Z", timezone: TZ })).toBe("Clocked in 08:58, no clock-out");
    expect(detailOf("automatic_clock_out", { clock_out_at: "2026-10-16T16:00:00Z", timezone: TZ })).toBe("System Clock-Out at 17:00");
    expect(detailOf("automatic_clock_out", { clock_out_at: "2026-10-16T17:30:00Z", timezone: TZ, real_time: "17:40" })).toBe(
      "System Clock-Out at 18:30; real time 17:40",
    );
  });
});

describe("the clock watch", () => {
  const { clockOutPlan, shiftEnd, shiftStart } = require("./attendance.clock-watch");
  const end = new Date("2026-10-16T16:00:00Z"); // 17:00 in Lagos
  const clockInAt = new Date("2026-10-16T07:55:00Z");
  const plan = (now, over = {}) => clockOutPlan({ shiftEnd: end, clockInAt, now: new Date(now), every: 30, after: 90, ...over });
  const slot = (n, utc) => ({ reminder: { slot: n, at: new Date(utc) }, systemAt: null, evening: false });

  test("a shift starts and ends in the workplace's zone; an end before the start is the next morning", () => {
    const day = { working_day: true, starts_at: "09:00", ends_at: "17:00" };
    expect(shiftStart("2026-10-16", day, TZ).toISOString()).toBe("2026-10-16T08:00:00.000Z");
    expect(shiftEnd("2026-10-16", day, TZ).toISOString()).toBe("2026-10-16T16:00:00.000Z");
    expect(shiftEnd("2026-10-16", { working_day: true, starts_at: "22:00", ends_at: "06:00" }, TZ).toISOString()).toBe(
      "2026-10-17T05:00:00.000Z",
    );
    expect(shiftEnd("2026-10-18", { working_day: false, starts_at: null, ends_at: null }, TZ)).toBeNull();
    expect(shiftStart("2026-10-18", { working_day: false, starts_at: null }, TZ)).toBeNull();
  });

  test("a reminder every 30 minutes from the end: 17:00, 17:30, 18:00, then the System Clock-Out at 18:30 (T13)", () => {
    expect(plan("2026-10-16T15:59:00Z")).toEqual({ reminder: null, systemAt: null, evening: false });
    expect(plan("2026-10-16T16:00:00Z")).toEqual(slot(1, "2026-10-16T16:00:00Z"));
    expect(plan("2026-10-16T16:04:00Z")).toEqual(slot(1, "2026-10-16T16:00:00Z"));
    expect(plan("2026-10-16T16:31:00Z")).toEqual(slot(2, "2026-10-16T16:30:00Z"));
    expect(plan("2026-10-16T17:29:00Z")).toEqual(slot(3, "2026-10-16T17:00:00Z"));
    expect(plan("2026-10-16T17:30:00Z")).toEqual({ reminder: null, systemAt: new Date("2026-10-16T17:30:00Z"), evening: false });
    // A late run still clocks out at the moment, not when it ran.
    expect(plan("2026-10-16T19:05:00Z").systemAt).toEqual(new Date("2026-10-16T17:30:00Z"));
    expect(plan("2026-10-16T16:20:00Z", { shiftEnd: null })).toEqual({ reminder: null, systemAt: null, evening: false });
  });

  test("no reminder whose time came before the clock-in; an evening start gets neither", () => {
    const inAt = new Date("2026-10-16T16:40:00Z"); // 17:40, after the end
    expect(plan("2026-10-16T16:45:00Z", { clockInAt: inAt })).toEqual({ reminder: null, systemAt: null, evening: false });
    expect(plan("2026-10-16T17:05:00Z", { clockInAt: inAt })).toEqual(slot(3, "2026-10-16T17:00:00Z"));
    expect(plan("2026-10-16T17:35:00Z", { clockInAt: inAt }).systemAt).toEqual(new Date("2026-10-16T17:30:00Z"));
    const evening = new Date("2026-10-16T17:30:00Z"); // 18:30, at the System Clock-Out's moment
    expect(plan("2026-10-16T19:00:00Z", { clockInAt: evening })).toEqual({ reminder: null, systemAt: null, evening: true });
  });

  test("the policy's figures set the interval and the moment", () => {
    expect(plan("2026-10-16T16:50:00Z", { every: 45, after: 60 })).toEqual(slot(2, "2026-10-16T16:45:00Z"));
    expect(plan("2026-10-16T17:00:00Z", { every: 45, after: 60 }).systemAt).toEqual(new Date("2026-10-16T17:00:00Z"));
  });
});

describe("a person's week", () => {
  const schedules = require("./attendance.schedule");
  const cal = workingWeek.makeCalendar({ days: [1, 2, 3, 4, 5, 6], holidays: [], hours: {} });
  const HOURS = [1, 2, 3, 4, 5, 6, 7].map((weekday) =>
    weekday <= 5 ? { weekday, working: true, starts_at: "09:00", ends_at: "17:00" } : { weekday, working: false, starts_at: null, ends_at: null },
  );
  const places = (week) => week.map(schedules.placeOf);

  test("with no schedule: the company hours at the place the pattern gives; hybrid is at the office", () => {
    expect(places(schedules.weekFrom(null, "on_site", cal, HOURS))).toEqual(["office", "office", "office", "office", "office", "off", "off"]);
    expect(places(schedules.weekFrom(null, "remote", cal, HOURS))).toEqual(["remote", "remote", "remote", "remote", "remote", "off", "off"]);
    expect(places(schedules.weekFrom(null, "hybrid", cal, null))).toEqual(["office", "office", "office", "office", "office", "office", "off"]);
    expect(schedules.weekFrom(null, "on_site", cal, HOURS)[0]).toEqual({
      weekday: 1, working: true, starts_at: "09:00", ends_at: "17:00", place: "office", company_hours: true,
    });
  });

  test("a schedule's days: its own hours, a blank day on the company hours, Off, and a blank day the company does not work", () => {
    const d = (working, starts_at = null, ends_at = null, place = "office") => ({ weekday: 0, working, starts_at, ends_at, place });
    const days = [d(true, "10:00", "14:00", "remote"), d(true), d(false), d(true, null, null, "remote"), d(true), d(true), d(false)];
    const week = schedules.weekFrom(days, "on_site", cal, HOURS);
    expect(places(week)).toEqual(["remote", "office", "off", "remote", "office", "off", "off"]);
    expect(week[0]).toMatchObject({ starts_at: "10:00", ends_at: "14:00", company_hours: false });
    expect(week[1]).toMatchObject({ starts_at: "09:00", ends_at: "17:00", company_hours: true });
  });

  test("a working day with no hours on a weekday the company does not work is refused on that day (gap l)", () => {
    const d = (weekday, working, starts_at = null, ends_at = null) => ({ weekday, working, starts_at, ends_at, place: working ? "office" : null });
    const days = [d(1, true), d(2, true), d(3, true), d(4, true), d(5, true), d(6, true), d(7, true, "09:00", "13:00")];
    expect(schedules.checkDays(days, cal, HOURS)).toEqual({ "days.5.starts_at": ["Give the hours"] });
    expect(schedules.checkDays(days, cal, null)).toEqual({});
  });
});

describe("pending deductions and overtime", () => {
  const pay = require("./attendance.pay");
  const m = require("../../shared/money/money");
  // ₦300,000 over 20 working days is ₦15,000 a day; over 8 hours, ₦1,875 an hour.
  const daily = pay.dailyRate("300000.00", 20);
  const hourly = pay.hourlyRate(daily, 8 * 60);

  test("the daily and hourly rates, and none with no gross or no working day", () => {
    expect(m.toWire(daily)).toBe("15000.00");
    expect(m.toWire(hourly)).toBe("1875.00");
    expect(pay.dailyRate(null, 20)).toBeNull();
    expect(pay.dailyRate("300000.00", 0)).toBeNull();
    expect(pay.hourlyRate(null, 480)).toBeNull();
    expect(pay.shiftMinutes({ working_day: true, starts_at: "09:00", ends_at: "15:00" })).toBe(360);
    expect(pay.shiftMinutes({ working_day: false })).toBe(0);
  });

  test("each deduction method, rounded to the kobo once (T4)", () => {
    expect(pay.deductionAmount("pro_rata", { daily, hourly, minutes: 12 })).toBe("375.00");
    expect(pay.deductionAmount("pro_rata", { daily, hourly: pay.hourlyRate(pay.dailyRate("250000.00", 22), 480), minutes: 7 })).toBe(
      "165.72",
    );
    expect(pay.deductionAmount("per_hour", { daily, hourly, minutes: 61, amount: "2000.00" })).toBe("4000.00");
    expect(pay.deductionAmount("per_hour", { daily, hourly, minutes: 60, amount: "2000.00" })).toBe("2000.00");
    expect(pay.deductionAmount("per_day", { daily, hourly, minutes: 200, amount: "2500.00" })).toBe("2500.00");
    expect(pay.deductionAmount("daily_rate", { daily, hourly, minutes: 480 })).toBe("15000.00");
  });

  test("with no gross set a salary-derived amount is empty, a fixed one is not", () => {
    expect(pay.deductionAmount("pro_rata", { daily: null, hourly: null, minutes: 12 })).toBeNull();
    expect(pay.deductionAmount("daily_rate", { daily: null, hourly: null, minutes: 480 })).toBeNull();
    expect(pay.deductionAmount("per_day", { daily: null, hourly: null, minutes: 12, amount: "1000.00" })).toBe("1000.00");
  });

  test("overtime at a multiple or a fixed amount an hour, prorated to the minute", () => {
    expect(pay.overtimeAmount("multiplier", { hourly, minutes: 45, multiplier: 1.5 })).toBe("2109.38");
    expect(pay.overtimeAmount("multiplier", { hourly, minutes: 60, multiplier: 2 })).toBe("3750.00");
    expect(pay.overtimeAmount("per_hour", { hourly: null, minutes: 90, multiplier: 1, amount: "1500.00" })).toBe("2250.00");
    expect(pay.overtimeAmount("multiplier", { hourly: null, minutes: 60, multiplier: 1.5 })).toBeNull();
  });

  test("the approval method: pending, confirmed, held to a pre-approval, and the monthly cap", () => {
    expect(pay.overtimeOutcome({ approval: "manager_after", minutes: 90, preApproved: null, capLeft: 600 })).toEqual({
      status: "pending", confirmed_minutes: null, reason: null,
    });
    expect(pay.overtimeOutcome({ approval: "automatic", minutes: 90, preApproved: null, capLeft: 600 })).toEqual({
      status: "confirmed", confirmed_minutes: 90, reason: null,
    });
    expect(pay.overtimeOutcome({ approval: "pre_approved", minutes: 90, preApproved: null, capLeft: 600 })).toEqual({
      status: "cut", confirmed_minutes: 0, reason: "Not pre-approved",
    });
    expect(pay.overtimeOutcome({ approval: "pre_approved", minutes: 90, preApproved: 60, capLeft: 600 })).toEqual({
      status: "confirmed", confirmed_minutes: 60, reason: "Beyond pre-approval",
    });
    expect(pay.overtimeOutcome({ approval: "pre_approved", minutes: 45, preApproved: 60, capLeft: 600 })).toEqual({
      status: "confirmed", confirmed_minutes: 45, reason: null,
    });
    expect(pay.overtimeOutcome({ approval: "automatic", minutes: 90, preApproved: null, capLeft: 30 })).toEqual({
      status: "confirmed", confirmed_minutes: 30, reason: "Monthly cap",
    });
    expect(pay.overtimeOutcome({ approval: "automatic", minutes: 90, preApproved: null, capLeft: 0 })).toEqual({
      status: "cut", confirmed_minutes: 0, reason: "Monthly cap",
    });
  });

  test("what a day qualifies for under the version that judged it: never leave, an Off day's deduction or a holiday", () => {
    const c = require("@mycity/contract");
    const r = {
      ...c.attendance.AttendanceRules.parse({}),
      late_deduction: { on: true, method: "pro_rata", amount: null },
      early_deduction: { on: true, method: "per_day", amount: "1000.00" },
      absence_deduction: { on: true },
      overtime: { ...c.attendance.AttendanceRules.parse({}).overtime, on: true },
    };
    const work = { working_day: true, starts_at: "09:00", ends_at: "17:00" };
    const day = (over) => ({ status: "present", late_minutes: 0, early_minutes: 0, overtime_minutes: 0, ...over });
    expect(Object.keys(pay.qualifies(day({ status: "late", late_minutes: 12, early_minutes: 10, overtime_minutes: 45 }), work, r))).toEqual([
      "late", "early_departure", "overtime",
    ]);
    expect(pay.qualifies(day({ status: "absent" }), work, r)).toEqual({
      absence: { minutes: 480, method: "daily_rate", rest_day: false, amount: null },
    });
    expect(pay.qualifies(day({ status: "leave", late_minutes: 12 }), work, r)).toEqual({});
    expect(pay.qualifies(day({ overtime_minutes: 120 }), { working_day: false }, r)).toEqual({
      overtime: { minutes: 120, method: "multiplier", rest_day: true, amount: null },
    });
    const off = { ...r, late_deduction: { on: false, method: "pro_rata", amount: null } };
    expect(pay.qualifies(day({ status: "late", late_minutes: 12 }), work, off)).toEqual({});
  });
});

describe("the consequence rules' words", () => {
  const engine = require("./attendance.rules-engine");
  const breach = (over) => ({ rule: "late", period: "month", count: 3, minutes: 41, reached: "count", days: ["2026-10-02", "2026-10-06", "2026-10-09"], raise_query: false, ...over });

  test("an alert counts what was reached, Query Due first while the query waits on M3", () => {
    expect(engine.wordsOf(breach(), "Ada Obi")).toEqual({
      title: "Ada Obi: 3 late arrivals this month",
      trigger: "Late on 02/10/2026, 06/10/2026 and 09/10/2026",
    });
    expect(engine.wordsOf(breach({ raise_query: true }), "Ada Obi").title).toBe("Query Due: Ada Obi, 3 late arrivals this month");
    expect(engine.wordsOf(breach({ reached: "hours", minutes: 300, count: 2 }), "Ada Obi").title).toBe("Ada Obi: 5 hours late this month");
    expect(engine.wordsOf(breach({ rule: "absence", period: "week", count: 1, days: ["2026-10-06"] }), "Ada Obi")).toEqual({
      title: "Ada Obi: 1 absence this week",
      trigger: "Absent on 06/10/2026",
    });
    expect(engine.wordsOf(breach({ rule: "location_flag", period: "days_30", days: ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"], count: 4 }), "Ada Obi").trigger).toBe(
      "Outside on 4 days, last on 04/10/2026",
    );
  });

  test("each rule is the policy's", () => {
    expect(Object.values(engine.RULES).map((r) => r.key)).toEqual(["late_rule", "early_rule", "absence_rule", "forgotten_rule", "location_rule"]);
    expect(engine.BY_POLICY_KEY.forgotten_rule).toBe("forgotten_clock_out");
  });
});

describe("the routes", () => {
  const routes = routesOf(require("./attendance.routes").router);
  /** A body's fields, through any refinements around it. */
  const shapeOf = (schema) => (schema.shape ? schema.shape : shapeOf(schema._def.schema));

  test("the person's own routes are self and name no employee; People's carry the people grant", () => {
    expect(routes.length).toBeGreaterThan(10);
    for (const r of routes) {
      if (r.path.startsWith("/me") || r.path === "/punches" || (r.method === "POST" && r.path === "/check-ins")) {
        expect(r.contract.self).toBe(true);
        expect(r.path).not.toMatch(/employee_id/);
        if (r.contract.body) expect(Object.keys(shapeOf(r.contract.body))).not.toContain("employee_id");
      } else {
        expect(r.permission && r.permission.key).toBe("people");
      }
    }
  });

  test("a work location request takes no new entry from PR 4; People still read requests, and decide them in the approval", () => {
    expect(routes.some((r) => r.method === "POST" && r.path === "/me/requests")).toBe(false);
    expect(routes.find((r) => r.method === "POST" && r.path === "/me/requests/:id/cancel").contract.self).toBe(true);
    expect(routes.find((r) => r.method === "GET" && r.path === "/requests").permission).toMatchObject({ key: "people", action: "view" });
    expect(routes.some((r) => /decision|approve/.test(r.path) && r.path.startsWith("/requests"))).toBe(false);
  });

  test("a temporary site: anyone sends one, People add, cancel and change one under approve, read under view; decided in its approval", () => {
    const by = (method, path) => routes.find((r) => r.method === method && r.path === path);
    for (const path of ["/temporary-sites", "/temporary-sites/:id/cancel", "/temporary-sites/:id/remove"])
      expect(by("POST", path).permission).toMatchObject({ key: "people", action: "approve" });
    for (const path of ["/temporary-sites", "/temporary-sites/:id", "/check-ins"])
      expect(by("GET", path).permission).toMatchObject({ key: "people", action: "view" });
    for (const [method, path] of [["GET", "/me/temporary-sites"], ["POST", "/me/temporary-sites"], ["GET", "/me/temporary-sites/:id"],
      ["POST", "/me/temporary-sites/:id/withdraw"], ["POST", "/check-ins"], ["GET", "/me/check-ins"]])
      expect(by(method, path).contract.self).toBe(true);
    expect(Object.keys(shapeOf(by("POST", "/me/temporary-sites").contract.body)).sort()).toEqual([
      "description", "employee_ids", "ends_at", "ends_on", "hours", "locations", "name", "purpose", "starts_at", "starts_on",
    ]);
    expect(routes.some((r) => /decision|approve/.test(r.path) && r.path.startsWith("/temporary-sites"))).toBe(false);
  });

  test("a check-in carries no distance, flag, site, device or employee: the server works those out", () => {
    const send = routes.find((r) => r.method === "POST" && r.path === "/check-ins");
    expect(Object.keys(shapeOf(send.contract.body)).sort()).toEqual(["accuracy_m", "device_at", "latitude", "location_error", "longitude"]);
  });

  test("a home request carries no employee or status, and only People decide one", () => {
    const send = routes.find((r) => r.method === "POST" && r.path === "/me/home");
    expect(Object.keys(send.contract.body.shape).sort()).toEqual(["accuracy_m", "home_address", "home_latitude", "home_longitude"]);
    const decide = routes.find((r) => r.method === "POST" && r.path === "/homes/:id/decision");
    expect(decide.permission).toMatchObject({ key: "people", action: "approve" });
  });

  test("a punch carries no distance, inside flag, device or employee: the server works those out", () => {
    const punch = routes.find((r) => r.method === "POST" && r.path === "/punches");
    const keys = Object.keys(punch.contract.body._def.schema.shape);
    expect(keys.sort()).toEqual(["accuracy_m", "device_at", "event_type", "latitude", "location_error", "longitude", "note"]);
  });

  test("a field assignment takes no new entry from PR 4; one in force is still cancelled and changed under people approve", () => {
    const by = (method, path) => routes.find((r) => r.method === method && r.path === path);
    expect(by("POST", "/field-assignments")).toBeUndefined();
    for (const path of ["/field-assignments/:id/cancel", "/field-assignments/:id/remove"])
      expect(by("POST", path).permission).toMatchObject({ key: "people", action: "approve" });
    for (const path of ["/field-assignments", "/field-assignments/:id"])
      expect(by("GET", path).permission).toMatchObject({ key: "people", action: "view" });
    expect(by("GET", "/me/field-assignments").contract.self).toBe(true);
  });

  test("a schedule is read under people view and set under people edit, naming the person in the path only", () => {
    const by = (method, path) => routes.find((r) => r.method === method && r.path === path);
    expect(by("GET", "/schedules/:employee_id").permission).toMatchObject({ key: "people", action: "view" });
    expect(by("POST", "/schedules/:employee_id").permission).toMatchObject({ key: "people", action: "edit" });
    expect(Object.keys(by("POST", "/schedules/:employee_id").contract.body.shape).sort()).toEqual(["days", "effective_from", "reason"]);
    expect(by("GET", "/me/schedule").contract.self).toBe(true);
  });

  test("pay items are read under people view and decided under people approve; my own are self", () => {
    const by = (method, path) => routes.find((r) => r.method === method && r.path === path);
    expect(by("GET", "/pay-items").permission).toMatchObject({ key: "people", action: "view" });
    for (const path of ["/pay-items/waive", "/pay-items/:id/overtime", "/overtime-approvals"])
      expect(by("POST", path).permission).toMatchObject({ key: "people", action: "approve" });
    expect(by("GET", "/me/pay-items").contract.self).toBe(true);
    expect(Object.keys(shapeOf(by("POST", "/me/events/:id/explanation").contract.body)).sort()).toEqual(["employee_note", "real_time"]);
  });

  test("the policy is no longer this module's to serve: it lives under /policies", () => {
    expect(routes.some((r) => r.path.startsWith("/policy") || r.path.startsWith("/me/policy"))).toBe(false);
  });

  test("lists page through the contract's controls, with no page size", () => {
    for (const r of routes.filter((x) => x.method === "GET" && x.contract.response && x.contract.response.shape && x.contract.response.shape.page)) {
      const keys = Object.keys(r.contract.query.shape);
      expect(keys).toContain("page");
      for (const k of ["limit", "offset", "per_page", "page_size"]) expect(keys).not.toContain(k);
    }
  });
});

/* ------------------------------------------------------------------ *
 * The Attendance policy's rules (§6.1, §6.15)
 * ------------------------------------------------------------------ */

describe("the Attendance policy's rules", () => {
  const type = require("./attendance.policy-type");
  const c = require("@mycity/contract");
  const RULES = {
    ...c.attendance.AttendanceRules.parse({}),
    grace_minutes: 10,
    office_geofence_mode: "block",
    home_geofence_mode: "warn",
    site_geofence_mode: "off",
    device_mode: "warn",
  };

  test("each place has its own location mode; an unknown place is a bug", () => {
    expect(rules.forPlace(RULES, "office").geofence_mode).toBe("block");
    expect(rules.forPlace(RULES, "home").geofence_mode).toBe("warn");
    expect(rules.forPlace(RULES, "site").geofence_mode).toBe("off");
    expect(rules.forPlace(rules.DEFAULT_POLICY, "home").geofence_mode).toBe("warn");
    expect(() => rules.forPlace(RULES, "garden")).toThrow(/not a place/);
  });

  test("before any version the defaults apply: Flag everywhere, devices off, a 150 m home", () => {
    expect(rules.DEFAULT_POLICY).toMatchObject({
      policy_version_id: null,
      grace_minutes: 0,
      office_geofence_mode: "warn",
      home_geofence_mode: "warn",
      device_mode: "off",
      home_radius_m: 150,
      max_accuracy_m: 100,
    });
  });

  test("every rule is shown now: what changed is the rules that differ, in the worksheet's order, as lines", () => {
    expect(type.VISIBLE).toEqual(Object.keys(c.attendance.AttendanceRules.shape).filter((k) => type.VISIBLE.includes(k)));
    expect(type.VISIBLE.length).toBe(Object.keys(c.attendance.AttendanceRules.shape).length);
    const next = {
      ...RULES,
      home_radius_m: 200,
      grace_minutes: 5,
      late_rule: { ...RULES.late_rule, on: true },
      late_deduction: { on: true, method: "per_hour", amount: "2000.00" },
      hours: type.SUGGESTED_HOURS,
    };
    expect(type.changed(RULES, next)).toEqual(["hours", "grace_minutes", "late_rule", "late_deduction", "home_radius_m"]);
    expect(type.changeLines(RULES, next)).toEqual([
      "Company Hours: The Working Week to Mon to Fri 09:00 to 17:00, Sat 09:00 to 15:00, Sun Off",
      "Grace Minutes: 10 minutes to 5 minutes",
      "Late Arrivals: Off to 3 in a month or 5 hours, Alert, Raise Query",
      "Late Deduction: Off to Fixed per Hour, ₦2,000.00",
      "Home Radius: 150 m to 200 m",
    ]);
    expect(type.changed(null, next)).toEqual([]);
  });

  test("staff read every section as sentences, PR 1's sections as they were, the values filled in and a changed section tagged", () => {
    const sections = type.sections({ ...RULES, office_geofence_mode: "warn" }, ["grace_minutes"]);
    expect(sections.map((s) => s.key)).toEqual([
      "hours", "clocking_in", "late", "early", "absence", "forgotten", "location_flags", "overtime",
      "office", "home", "site", "location", "devices", "clock_prompts",
    ]);
    const byKey = Object.fromEntries(sections.map((s) => [s.key, s]));
    expect(["clocking_in", "office", "home", "site", "location", "devices"].map((k) => byKey[k].title)).toEqual([
      "Clocking In", "At the Office", "Working From Home", "At a Temporary Site", "Your Location", "Your Devices",
    ]);
    expect(byKey.clocking_in.sentences.map((x) => x.text)).toEqual([
      "You have a grace period of 10 minutes after your start time.",
      "A clock-in after it counts as late from your start time.",
    ]);
    expect(byKey.clocking_in.sentences[0].changed).toBe(true);
    expect(byKey.office.sentences[0].changed).toBe(false);
    expect(byKey.hours.sentences.map((x) => x.text)).toContain("Where your own work schedule differs, your schedule applies.");
    expect(byKey.late.sentences.map((x) => x.text)).toEqual([
      "Late arrivals do not count toward a limit.",
      "Late arrivals do not lead to a deduction.",
    ]);
    expect(type.sections({ ...RULES, office_geofence_mode: "block" }).find((x) => x.key === "office").sentences[0].text).toMatch(/refused/);
  });

  test("a first draft starts from the suggested values, every consequence rule off with its figures filled in (T5)", () => {
    const s = type.suggestions();
    expect(c.attendance.AttendanceRulesDraft.safeParse(s).success).toBe(true);
    expect(s).toMatchObject({
      grace_minutes: 5,
      early_grace_minutes: 5,
      device_mode: "warn",
      home_radius_m: 150,
      late_rule: { on: false, count: 3, period: "month", hours: 5, alert: true, query: true },
      absence_rule: { on: false, count: 2 },
      forgotten_rule: { on: false, alert: true, query: false },
      overtime: { on: false, after_minutes: 30, approval: "manager_after", multiplier: 1.5, rest_day_multiplier: 2, monthly_cap_hours: 20 },
      clock_out_reminder_minutes: 30,
      system_clock_out_after_minutes: 90,
    });
    expect(s.hours.map((d) => (d.working ? `${d.starts_at}-${d.ends_at}` : "off"))).toEqual([
      "09:00-17:00", "09:00-17:00", "09:00-17:00", "09:00-17:00", "09:00-17:00", "09:00-15:00", "off",
    ]);
  });

  test("a fixed amount is refused outside ₦1 to ₦1,000,000, on its own field", () => {
    const s = type.suggestions();
    const draft = (over) => c.attendance.AttendanceRulesDraft.safeParse({ ...s, ...over });
    const paths = (r) => (r.success ? [] : r.error.issues.map((i) => i.path.join(".")));
    expect(paths(draft({ late_deduction: { on: true, method: "per_day", amount: "0.00" } }))).toEqual(["late_deduction.amount"]);
    expect(paths(draft({ early_deduction: { on: true, method: "per_hour", amount: "1000000.01" } }))).toEqual(["early_deduction.amount"]);
    expect(paths(draft({ late_deduction: { on: true, method: "per_day", amount: "1000000.00" } }))).toEqual([]);
    expect(paths(draft({ overtime: { ...s.overtime, on: true, method: "per_hour", amount: "0.50" } }))).toEqual(["overtime.amount"]);
    expect(paths(draft({ late_deduction: { on: true, method: "per_day", amount: null } }))).toEqual(["late_deduction.amount"]);
  });

  test("a home's check and radius are checked only while Home Location is on, as the worksheet shows them (§1.3)", () => {
    const s = type.suggestions();
    expect(s.home_location).toEqual({ on: false });
    const draft = (over) => c.attendance.AttendanceRulesDraft.safeParse({ ...s, ...over });
    const paths = (r) => (r.success ? [] : r.error.issues.map((i) => i.path.join(".")));
    // An older version's Off and 100 m are kept, hidden, while it is off: the draft still saves.
    expect(paths(draft({ home_geofence_mode: "off", home_radius_m: 100 }))).toEqual([]);
    const on = { home_location: { on: true } };
    expect(paths(draft({ ...on, home_radius_m: 100 }))).toEqual(["home_radius_m"]);
    expect(paths(draft({ ...on, home_geofence_mode: "off" }))).toEqual(["home_geofence_mode"]);
    expect(paths(draft({ ...on, home_geofence_mode: "block", home_radius_m: 150 }))).toEqual([]);
    // A temporary site is Flag or Refuse whatever the switch says.
    expect(paths(draft({ site_geofence_mode: "off" }))).toEqual(["site_geofence_mode"]);
  });

  test("a temporary site's sentences cover its addresses and check-ins, and always end with where to add one", () => {
    const site = (mode) => type.sections({ ...RULES, site_geofence_mode: mode }).find((x) => x.key === "site").sentences.map((x) => x.text);
    expect(site("warn")).toEqual([
      "At a temporary site, a clock-in or check-in outside its addresses is accepted and sent for review.",
      "Working somewhere else? Add it from Home, or ask People.",
    ]);
    expect(site("block")).toEqual([
      "At a temporary site, a clock-in outside its addresses is refused, and People see it.",
      "A check-in outside them is sent for review.",
      "Working somewhere else? Add it from Home, or ask People.",
    ]);
    expect(site("off")[0]).toBe("At a temporary site, your location is recorded with each clock-in and check-in. Nothing is flagged.");
    expect(site("off").at(-1)).toBe("Working somewhere else? Add it from Home, or ask People.");
    expect(type.RULE_LABEL.site_geofence_mode).toBe("Temporary Site Check");
    expect(type.changeLines({ ...RULES, site_geofence_mode: "warn" }, { ...RULES, site_geofence_mode: "block" })).toEqual([
      "Temporary Site Check: Flag to Refuse",
    ]);
    // Every sentence a person reads keeps to 20 words (FRONTEND_GUIDE §5.3).
    for (const mode of ["off", "warn", "block"]) for (const t of site(mode)) expect(t.split(/\s+/).length).toBeLessThanOrEqual(20);
  });
});

describe("a temporary site's hours (§6.11)", () => {
  const { siteShift } = require("./attendance.sites");
  const sunday = { working_day: false, starts_at: null, ends_at: null, grace_minutes: 10, early_grace_minutes: 5, off_reason: "Off", place: null, attendance_work_schedule_id: null };

  test("Site Hours make the day worked from its start to its end, the policy's grace kept", () => {
    expect(siteShift({ hours: "site", starts_at: "11:00", ends_at: "15:00" }, sunday)).toEqual({
      ...sunday,
      working_day: true,
      starts_at: "11:00",
      ends_at: "15:00",
      off_reason: null,
    });
  });

  test("the Usual Shift, or no site, keeps the person's own shift", () => {
    expect(siteShift({ hours: "usual", starts_at: null, ends_at: null }, sunday)).toBe(sunday);
    expect(siteShift(null, sunday)).toBe(sunday);
  });
});
