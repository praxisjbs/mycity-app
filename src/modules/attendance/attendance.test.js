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
const { decideGeofence } = require("./attendance.geofence");
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

  test("outside: off accepts with the evidence, warn reviews, block rejects", () => {
    const point = north(340);
    expect(judge({ point, mode: "off" })).toMatchObject({ verdict: "outside", result: "accepted", exception: null, distance_m: 340 });
    expect(judge({ point, mode: "warn" })).toMatchObject({ verdict: "outside", result: "review", exception: "outside_worksite" });
    expect(judge({ point, mode: "block" })).toMatchObject({ verdict: "outside", result: "rejected", exception: null });
  });

  test("no reading (permission denied, unavailable) is unverified: reviewed under warn and block, never rejected", () => {
    for (const location_error of ["denied", "unavailable", "timeout", "unsupported", null]) {
      const warn = judge({ point: null, location_error, mode: "warn" });
      expect(warn).toMatchObject({ verdict: "unverified", reason: location_error || "no_location", result: "review", exception: "location_unverified", retry_location: true });
      expect(judge({ point: null, location_error, mode: "block" })).toMatchObject({ result: "review" });
      expect(judge({ point: null, location_error, mode: "off" })).toMatchObject({ result: "accepted", exception: null });
    }
  });

  test("a reading worse than the policy's accuracy is unverified, with the distance kept; fair accuracy still counts", () => {
    expect(judge({ accuracy_m: 180 })).toMatchObject({ verdict: "unverified", reason: "poor_accuracy", accuracy: "poor", result: "review", distance_m: 40 });
    expect(judge({ accuracy_m: 180, mode: "block" })).toMatchObject({ result: "review" });
    expect(judge({ accuracy_m: 75 })).toMatchObject({ verdict: "inside", accuracy: "fair", result: "accepted" });
  });

  test("someone not remote with no worksite is not judged on location", () => {
    expect(judge({ expected: null, mode: "block" })).toMatchObject({ verdict: "not_applied", reason: "no_worksite", result: "accepted" });
    expect(judge({ expected: null, work_pattern: "hybrid", mode: "block" })).toMatchObject({ verdict: "not_applied" });
  });

  test("a remote employee is judged against their approved home: inside, the boundary, outside", () => {
    const remote = (over) => judge({ work_pattern: "remote", expected: HOME, ...over });
    expect(remote({ point: north(60) })).toMatchObject({
      verdict: "inside", result: "accepted", place: "home", home_id: "h-1", worksite_id: null, worksite_name: "Home", distance_m: 60,
    });
    expect(remote({ point: north(100) })).toMatchObject({ verdict: "inside", result: "accepted" });
    expect(remote({ point: north(101), mode: "warn" })).toMatchObject({ verdict: "outside", result: "review", exception: "outside_home", worksite_id: null });
    expect(remote({ point: north(2500), mode: "block" })).toMatchObject({ verdict: "outside", result: "rejected", exception: null });
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

  test("a weekday, a Saturday, a Sunday and a public holiday", () => {
    expect(rules.shiftFor("2026-10-16", cal, policy)).toEqual({ working_day: true, starts_at: "09:00", ends_at: "17:00", grace_minutes: 5, off_reason: null });
    expect(rules.shiftFor("2026-10-17", cal, policy)).toMatchObject({ working_day: true, ends_at: "15:00" });
    expect(rules.shiftFor("2026-10-18", cal, policy)).toMatchObject({ working_day: false, starts_at: null, off_reason: "weekend" });
    expect(rules.shiftFor("2026-10-01", cal, policy)).toMatchObject({ working_day: false, off_reason: "Independence Day" });
  });

  const late = (utc, grace = 5) =>
    lateness.minutesLate({ expectedStart: "09:00", firstClockInAt: new Date(utc), graceMinutes: grace, date: "2026-10-16", timeZone: TZ });

  test("inside the grace is not late; after it, late by the minutes past it", () => {
    expect(late("2026-10-16T07:55:00Z")).toBe(0); // 08:55
    expect(late("2026-10-16T08:05:00Z")).toBe(0); // 09:05, the last minute of grace
    expect(late("2026-10-16T08:06:00Z")).toBe(1); // 09:06
    expect(late("2026-10-16T09:20:00Z")).toBe(75); // 10:20, 75 minutes after 09:05
    expect(late("2026-10-16T08:06:00Z", 0)).toBe(6);
  });

  test("on a UTC host a Lagos 09:30 is still 09:30", () => {
    expect(late("2026-10-16T08:30:00Z", 0)).toBe(30);
  });

  test("overtime is after the day's end, past midnight included; nothing without a clock-out", () => {
    const over = (utc, end = "17:00") =>
      lateness.minutesOvertime({ expectedEnd: end, lastClockOutAt: utc ? new Date(utc) : null, date: "2026-10-16", timeZone: TZ });
    expect(over("2026-10-16T16:30:00Z")).toBe(30); // 17:30
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
      overtime: lateness.minutesOvertime,
      ...over,
    });
  const at = (event_type, utc) => ({ event_type, occurred_at: new Date(utc) });

  test("a day's figures: present, late, worked and overtime minutes", () => {
    expect(project({ events: [at("clock_in", "2026-10-16T07:58:00Z"), at("clock_out", "2026-10-16T16:30:00Z")] })).toMatchObject({
      status: "present",
      worked_minutes: 8 * 60 + 32,
      late_minutes: 0,
      overtime_minutes: 30,
    });
    expect(project({ events: [at("clock_in", "2026-10-16T08:40:00Z")] })).toMatchObject({ status: "late", late_minutes: 35, worked_minutes: 0 });
  });

  test("leave beats a punch; a closed working day with no clock-in is absent; an open one has no status yet", () => {
    expect(project({ onLeave: true, events: [at("clock_in", "2026-10-16T08:40:00Z")] })).toMatchObject({ status: "leave", late_minutes: 0 });
    expect(project({ closed: true })).toMatchObject({ status: "absent" });
    expect(project({})).toMatchObject({ status: null });
  });

  test("a punch on a Sunday is present and never late; a closed Sunday with none is not absent", () => {
    const sunday = (over) => project({ shift: rules.shiftFor("2026-10-18", cal, policy), date: "2026-10-18", ...over });
    expect(sunday({ events: [at("clock_in", "2026-10-18T10:00:00Z")] })).toMatchObject({ status: "present", late_minutes: 0 });
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
        overtime: lateness.minutesOvertime,
      }),
    ).toMatchObject({ status: "late", late_minutes: 25, overtime_minutes: 60 }); // 09:30 in, 16:00 out
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
    expect(detailOf("location_unverified", { reason: "denied" })).toBe("No location: location was not shared");
    expect(detailOf("location_unverified", { reason: "poor_accuracy", accuracy_m: 180.4 })).toBe("Reading accurate to 180 m");
    expect(detailOf("unknown_device", { device_label: "Chrome on Android" })).toBe("Unregistered device: Chrome on Android");
    expect(detailOf("suspicious_timestamp", { skew_seconds: -540 })).toBe("Device clock 9 min ahead");
    expect(detailOf("missing_clock_out", { clock_in_at: "2026-10-16T07:58:00Z", timezone: TZ })).toBe("Clocked in 08:58, no clock-out");
  });
});

describe("the routes", () => {
  const routes = routesOf(require("./attendance.routes").router);
  /** A body's fields, through any refinements around it. */
  const shapeOf = (schema) => (schema.shape ? schema.shape : shapeOf(schema._def.schema));

  test("the person's own routes are self and name no employee; People's carry the people grant", () => {
    expect(routes.length).toBeGreaterThan(10);
    for (const r of routes) {
      if (r.path.startsWith("/me") || r.path === "/punches") {
        expect(r.contract.self).toBe(true);
        expect(r.path).not.toMatch(/employee_id/);
        if (r.contract.body) expect(Object.keys(shapeOf(r.contract.body))).not.toContain("employee_id");
      } else {
        expect(r.permission && r.permission.key).toBe("people");
      }
    }
  });

  test("a work location request names no employee or status; People read requests, and decide them in the approval", () => {
    const send = routes.find((r) => r.method === "POST" && r.path === "/me/requests");
    expect(Object.keys(shapeOf(send.contract.body)).sort()).toEqual([
      "accuracy_m", "address", "ends_on", "home_latitude", "home_longitude", "reason", "request_type", "starts_on",
    ]);
    expect(routes.find((r) => r.method === "GET" && r.path === "/requests").permission).toMatchObject({ key: "people", action: "view" });
    expect(routes.some((r) => /decision|approve/.test(r.path) && r.path.startsWith("/requests"))).toBe(false);
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

  test("lists page through the contract's controls, with no page size", () => {
    for (const r of routes.filter((x) => x.method === "GET" && x.contract.response && x.contract.response.shape && x.contract.response.shape.page)) {
      const keys = Object.keys(r.contract.query.shape);
      expect(keys).toContain("page");
      for (const k of ["limit", "offset", "per_page", "page_size"]) expect(keys).not.toContain(k);
    }
  });
});
