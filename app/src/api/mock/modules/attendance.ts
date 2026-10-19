import type { AttendanceDay, AttendanceEvent, AttendanceException, AttendanceRecordRef, AttendanceToday, DayDetail, DeviceState, EventType, ExceptionType, GeofenceVerdict, PunchResult, PunchState, RegisterRow } from "@mycity/contract/contract.gen.ts";
import { formatDate, formatTime, todayIso } from "@mycity/ui";
import { audit } from "../data/audit";
import type { AttendancePolicy, LocationRequest, PolicySetting } from "@/api/types/attendance";
import { at, created, fail, invalid, isoDaysAgo, isoDaysAhead, notFound, ok, paged, route, sid } from "../core";
import { byId, byKey, PEOPLE, ref, refKey, teamOf, type MockPerson } from "../data/people";
import { HISTORY, TODAY } from "../data/attendance";
import { lastDeviceOf, MAX_REGISTERED, registeredCount, sessionDevice } from "./devices";
import { peopleGrant, siteOf, WORKSITES } from "./worksites";

/**
 * Attendance on the mock, in the contract's shapes (packages/contract/schemas/attendance.js): the
 * clock, the person's days, punches and exceptions, People's register, a day's evidence and the
 * decisions. The punch is judged here the way the API judges it (docs/guides/attendance.md §6):
 * the server's time, the distance to the worksite from the reading sent, the accuracy, the device
 * of the session, the policy's modes, one shift a day, and the Idempotency-Key.
 *
 * The policy is a business choice; the mock runs the geofence on warn and the device on warn,
 * so a laptop sees both warnings.
 */

/* ------------------------------------------------------------------ *
 * The policy, the shift and the clock
 * ------------------------------------------------------------------ */
const TZ = "Africa/Lagos";
const GRACE = 10;
const POLICY_MODES = { geofence_mode: "warn", device_mode: "warn", max_accuracy_m: 100 } as const;
const GOOD_ACCURACY_M = 50;
const FUTURE_TOLERANCE_S = 120;

type Ev = AttendanceEvent & { key: string };
type Day = AttendanceDay & { key: string };
type Ex = AttendanceException & { key: string };

const person = (p: MockPerson) => ({ employee_id: p.employee_id, display_name: p.display_name, job_title: p.job_title, department: p.department, photo_url: null });

/** A day's shift on the working week: Monday to Friday 09:00 to 17:00, Saturday to 15:00, Sunday off. */
export function shiftOf(date: string) {
  const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
  if (dow === 0) return { working_day: false, starts_at: null, ends_at: null, grace_minutes: GRACE, off_reason: "Sunday" };
  return { working_day: true, starts_at: "09:00", ends_at: dow === 6 ? "15:00" : "17:00", grace_minutes: GRACE, off_reason: null };
}
const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const lateOf = (date: string, iso: string) => {
  const s = shiftOf(date);
  return s.starts_at ? Math.max(0, minutesOf(formatTime(iso)) - (minutesOf(s.starts_at) + GRACE)) : 0;
};
const overtimeOf = (date: string, iso: string) => {
  const s = shiftOf(date);
  return s.ends_at ? Math.max(0, minutesOf(formatTime(iso)) - minutesOf(s.ends_at)) : 0;
};

/** Metres between two points, on a sphere the size of the Earth. */
function distanceM(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLng = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * 6371008.8 * Math.asin(Math.sqrt(h)));
}

const SEVERITY: Record<ExceptionType, "low" | "medium" | "high"> = {
  outside_worksite: "medium",
  location_unverified: "low",
  unknown_device: "high",
  suspicious_timestamp: "medium",
  missing_clock_out: "medium",
};
const LOCATION_REASON: Record<string, string> = {
  denied: "location was not shared",
  unavailable: "no location reading",
  timeout: "the location reading timed out",
  unsupported: "the device cannot share its location",
  no_location: "no location reading",
  poor_accuracy: "the reading was not accurate enough",
};

/* ------------------------------------------------------------------ *
 * The records: days, punches and exceptions
 * ------------------------------------------------------------------ */
const DAYS = new Map<string, Day>();
const EVENTS: Ev[] = [];
const EXCS: Ex[] = [];
const dk = (key: string, date: string) => `${key}|${date}`;
let seq = 0;

function dayOf(key: string, date: string): Day {
  let d = DAYS.get(dk(key, date));
  if (!d) {
    d = { key, attendance_day_id: sid(`day:${key}:${date}`), attendance_date: date, status: null, first_clock_in_at: null, last_clock_out_at: null, worked_minutes: 0, late_minutes: 0, overtime_minutes: 0, closed_at: null, open_exceptions: 0 };
    DAYS.set(dk(key, date), d);
  }
  return d;
}

const isActive = (e: Ev) => !e.excluded && (e.validation_state === "accepted" || e.validation_state === "review");
const activeOn = (key: string, date: string) => EVENTS.filter((e) => e.key === key && e.work_date === date && isActive(e)).sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
const openCount = (dayId: string) => EXCS.filter((x) => x.attendance_day_id === dayId && x.status === "open").length;

/** A day worked out again from its punches, the way the API's projection does it. */
function recompute(key: string, date: string) {
  const d = dayOf(key, date);
  const evs = activeOn(key, date);
  const first = evs.find((e) => e.event_type === "clock_in") ?? null;
  const last = [...evs].reverse().find((e) => e.event_type === "clock_out") ?? null;
  d.first_clock_in_at = first?.occurred_at ?? null;
  d.last_clock_out_at = last?.occurred_at ?? null;
  d.late_minutes = first ? lateOf(date, first.occurred_at) : 0;
  d.worked_minutes = first && last ? Math.max(0, Math.floor((Date.parse(last.occurred_at) - Date.parse(first.occurred_at)) / 60000)) : 0;
  d.overtime_minutes = last ? overtimeOf(date, last.occurred_at) : 0;
  if (d.status !== "leave") d.status = first ? (d.late_minutes > 0 ? "late" : "present") : d.closed_at && shiftOf(date).working_day ? "absent" : null;
  d.open_exceptions = openCount(d.attendance_day_id);
  return d;
}

function addEvent(key: string, date: string, type: EventType, iso: string, extra: Partial<Ev> = {}): Ev {
  const p = byKey(key)!;
  const site = p.work_pattern === "remote" ? null : siteOf(key);
  const dev = lastDeviceOf(key);
  const e: Ev = {
    key,
    attendance_event_id: sid(`event:${key}:${date}:${type}:${(seq += 1)}`),
    event_type: type,
    work_date: date,
    occurred_at: iso,
    device_at: iso,
    skew_seconds: 0,
    validation_state: "accepted",
    source: "pwa",
    latitude: site ? Number((site.latitude + 0.00012).toFixed(6)) : null,
    longitude: site ? Number((site.longitude - 0.0001).toFixed(6)) : null,
    accuracy_m: site ? 14 : null,
    distance_m: site ? 17 : null,
    worksite_name: site?.name ?? null,
    geofence: site ? "inside" : "not_applied",
    location_reason: site ? null : p.work_pattern === "remote" ? "remote" : "no_worksite",
    device_label: dev?.label ?? null,
    device_state: dev?.status ?? "none",
    reasons: [],
    note: null,
    excluded: false,
    recorded_by_name: null,
    reason: null,
    ...extra,
  };
  EVENTS.push(e);
  return e;
}

function addException(key: string, date: string, type: ExceptionType, ev: Ev | null, detail: string, decided?: { outcome: "accepted" | "rejected" | "corrected"; by: string; resolution: string }) {
  const p = byKey(key)!;
  const d = dayOf(key, date);
  const x: Ex = {
    key,
    attendance_exception_id: sid(`exception:${key}:${date}:${type}`),
    attendance_day_id: d.attendance_day_id,
    attendance_event_id: ev?.attendance_event_id ?? null,
    employee: person(p),
    work_date: date,
    exception_type: type,
    severity: SEVERITY[type],
    status: decided ? "resolved" : "open",
    outcome: decided?.outcome ?? null,
    detail,
    employee_note: null,
    employee_noted_at: null,
    resolution: decided?.resolution ?? null,
    reviewed_at: decided ? new Date(Date.parse(ev?.occurred_at ?? `${date}T12:00:00Z`) + 3 * 3600_000).toISOString() : null,
    reviewed_by_name: decided ? (byKey(decided.by)?.display_name ?? null) : null,
    created_at: ev?.occurred_at ?? new Date(`${date}T23:30:00Z`).toISOString(),
  };
  EXCS.push(x);
  return x;
}

/** The demonstration history: 45 days of punches, the exceptions they opened, and today so far. */
(() => {
  const today = isoDaysAgo(0);
  const signedIn = new Set(["cynthia", "ifeoma", "ngozi", "chidera"]);
  for (const h of HISTORY) {
    const key = h.person.user_key;
    const daysBack = Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${h.date}T12:00:00Z`)) / 86400_000);
    const d = dayOf(key, h.date);
    d.closed_at = at(daysBack - 1, "01:30");
    if (h.status === "leave") {
      d.status = "leave";
      continue;
    }
    if (!h.clock_in_at) {
      recompute(key, h.date);
      continue;
    }
    const review = h.status === "review";
    const inEv = addEvent(key, h.date, "clock_in", h.clock_in_at, review ? { validation_state: "review", geofence: "outside", distance_m: 260, reasons: ["outside_worksite"] } : {});
    if (review) {
      const site = siteOf(key);
      addException(key, h.date, "outside_worksite", inEv, `260 m from ${site?.name ?? "the office"}, radius ${site?.radius_m ?? 100} m`, daysBack > 7 ? { outcome: "accepted", by: "cynthia", resolution: "Client meeting agreed in advance" } : undefined);
    }
    const missedOut = key === "emeka" && daysBack === 1;
    if (h.clock_out_at && !missedOut) addEvent(key, h.date, "clock_out", h.clock_out_at);
    if (missedOut) addException(key, h.date, "missing_clock_out", null, `Clocked in ${formatTime(h.clock_in_at)}, no clock-out`);
    if (key === "bashir" && daysBack === 2) {
      inEv.validation_state = "review";
      Object.assign(inEv, { latitude: null, longitude: null, accuracy_m: null, distance_m: null, geofence: "unverified", location_reason: "denied", reasons: ["location_unverified"] });
      addException(key, h.date, "location_unverified", inEv, "No location: location was not shared");
    }
    recompute(key, h.date);
  }
  for (const t of TODAY) {
    const key = t.person.user_key;
    if (signedIn.has(key)) continue;
    if (t.status === "leave") {
      dayOf(key, today).status = "leave";
      continue;
    }
    if (!t.clock_in || t.status === "absent" || t.status === "suspended") continue;
    const iso = at(0, t.clock_in);
    if (Date.parse(iso) > Date.now()) continue;
    const unknown = t.status === "new_device";
    const ev = addEvent(key, today, "clock_in", iso, unknown ? { validation_state: "review", device_label: "Pixel 7 · Chrome", device_state: "observed", reasons: ["unknown_device"] } : {});
    if (unknown) addException(key, today, "unknown_device", ev, "Unregistered device: Pixel 7 · Chrome");
    recompute(key, today);
  }
  for (const d of DAYS.values()) d.open_exceptions = openCount(d.attendance_day_id);
})();

/* ------------------------------------------------------------------ *
 * The person's own clock
 * ------------------------------------------------------------------ */
const ON_LEAVE = new Set(TODAY.filter((t) => t.status === "leave").map((t) => t.person.user_key));

/** GET /attendance/me/today for a demonstration account; Home's mock reads it for the clock-in prompt. */
export function todayOf(key: string): AttendanceToday {
  const p = byKey(key)!;
  const date = todayIso();
  const site = p.work_pattern === "remote" ? null : siteOf(key);
  const evs = activeOn(key, date);
  const inEv = evs.find((e) => e.event_type === "clock_in");
  const outEv = evs.find((e) => e.event_type === "clock_out");
  const onLeave = ON_LEAVE.has(key) || p.status === "on_leave";
  const dev = sessionDevice(key);
  const count = registeredCount(key);
  return {
    date,
    timezone: TZ,
    server_time: new Date().toISOString(),
    state: onLeave ? "unavailable" : outEv ? "clocked_out" : inEv ? "clocked_in" : "not_clocked_in",
    unavailable_reason: onLeave ? "leave" : null,
    leave: onLeave ? { starts_on: isoDaysAgo(1), ends_on: isoDaysAhead(2), leave_type_name: "Annual" } : null,
    clock_in_at: inEv?.occurred_at ?? null,
    clock_out_at: outEv?.occurred_at ?? null,
    review: evs.some((e) => e.validation_state === "review"),
    shift: shiftOf(date),
    work_pattern: p.work_pattern,
    location: p.work_pattern === "remote" ? { kind: "remote", name: null, radius_m: null } : site ? { kind: "worksite", name: site.name, radius_m: site.radius_m } : { kind: "none", name: null, radius_m: null },
    policy: POLICY_MODES,
    device: { state: dev.status, label: dev.label, registered_count: count, can_register: dev.status !== "registered" && count < MAX_REGISTERED },
  };
}

route("GET /api/v1/attendance/me/today", (req) => ok(todayOf(req.user!)));

const GUARD_MESSAGES = {
  ALREADY_CLOCKED_IN: "You are already clocked in.",
  SHIFT_DONE: "You have clocked out for today.",
  NOT_CLOCKED_IN: "You have not clocked in yet.",
  ALREADY_CLOCKED_OUT: "You have already clocked out.",
} as const;

function reasonText(code: ExceptionType, ev: Ev, accuracy: number | null) {
  switch (code) {
    case "outside_worksite":
      return `you were ${ev.distance_m} m from ${ev.worksite_name}`;
    case "location_unverified":
      return ev.location_reason === "poor_accuracy" && accuracy ? "your location reading was not accurate enough" : "your location could not be checked";
    case "unknown_device":
      return "this device is not registered";
    case "suspicious_timestamp":
      return "this device's clock is ahead";
    default:
      return code;
  }
}

function messageOf(ev: Ev) {
  const action = ev.event_type === "clock_in" ? "Clocked in" : "Clocked out";
  const at = formatTime(ev.occurred_at);
  if (ev.validation_state === "accepted") return `${action} at ${at}.`;
  const why = ev.reasons.map((r) => reasonText(r, ev, ev.accuracy_m)).join(" and ");
  if (ev.validation_state === "review") return `${action} at ${at}. People will review it: ${why}.`;
  return `Not counted: ${why}.`;
}

const strictest = (...states: PunchState[]): PunchState => (states.includes("rejected") ? "rejected" : states.includes("review") ? "review" : "accepted");
const REPLAYS = new Map<string, { body: string; result: PunchResult }>();

route("POST /api/v1/attendance/punches", (req) => {
  const key = req.user!;
  const idem = req.idempotency_key;
  if (!idem) return fail(428, "IDEMPOTENCY_KEY_REQUIRED", "Send an Idempotency-Key with every punch.");
  const bodyText = JSON.stringify(req.body);
  const seen = REPLAYS.get(`${key}:${idem}`);
  if (seen) {
    if (seen.body !== bodyText) return fail(422, "IDEMPOTENCY_KEY_REUSED", "This Idempotency-Key was used for a different request. Use a new key.");
    return created({ ...seen.result, replayed: true });
  }
  const b = req.body as { event_type: EventType; device_at: string; latitude: number | null; longitude: number | null; accuracy_m: number | null; location_error?: string | null; note?: string };
  if (b.event_type !== "clock_in" && b.event_type !== "clock_out") return invalid({ event_type: ["Pick clock in or out"] });
  if ((b.latitude === null) !== (b.longitude === null)) return invalid({ longitude: ["Send both coordinates or neither"] });
  const p = byKey(key)!;
  if (ON_LEAVE.has(key) || p.status === "on_leave") return fail(422, "ON_LEAVE", `You are on Annual leave from ${formatDate(isoDaysAgo(1))} to ${formatDate(isoDaysAhead(2))}.`);

  const date = todayIso();
  const evs = activeOn(key, date);
  const hasIn = evs.some((e) => e.event_type === "clock_in");
  const hasOut = evs.some((e) => e.event_type === "clock_out");
  if (b.event_type === "clock_in" && hasIn) return fail(409, hasOut ? "SHIFT_DONE" : "ALREADY_CLOCKED_IN", hasOut ? GUARD_MESSAGES.SHIFT_DONE : GUARD_MESSAGES.ALREADY_CLOCKED_IN);
  if (b.event_type === "clock_out" && !hasIn) return fail(409, "NOT_CLOCKED_IN", GUARD_MESSAGES.NOT_CLOCKED_IN);
  if (b.event_type === "clock_out" && hasOut) return fail(409, "ALREADY_CLOCKED_OUT", GUARD_MESSAGES.ALREADY_CLOCKED_OUT);

  const now = new Date().toISOString();
  const site = p.work_pattern === "remote" ? null : siteOf(key);
  const point = b.latitude !== null && b.longitude !== null ? { latitude: b.latitude, longitude: b.longitude } : null;
  const accuracy = point && b.accuracy_m !== null ? (b.accuracy_m <= GOOD_ACCURACY_M ? "good" : b.accuracy_m <= POLICY_MODES.max_accuracy_m ? "fair" : "poor") : null;
  let geofence: GeofenceVerdict;
  let locationReason: string | null = null;
  let distance: number | null = null;
  if (p.work_pattern === "remote") [geofence, locationReason] = ["not_applied", "remote"];
  else if (!site) [geofence, locationReason] = ["not_applied", "no_worksite"];
  else if (!point) [geofence, locationReason] = ["unverified", b.location_error || "no_location"];
  else {
    distance = distanceM(point, site);
    if (accuracy === "poor") [geofence, locationReason] = ["unverified", "poor_accuracy"];
    else geofence = distance <= site.radius_m ? "inside" : "outside";
  }
  const reasons: ExceptionType[] = [];
  const mode = POLICY_MODES.geofence_mode as string;
  let fenceResult: PunchState = "accepted";
  if (mode !== "off" && geofence === "outside") {
    fenceResult = mode === "block" ? "rejected" : "review";
    reasons.push("outside_worksite");
  } else if (mode !== "off" && geofence === "unverified") {
    fenceResult = "review";
    reasons.push("location_unverified");
  }
  const dev = sessionDevice(key);
  const known = dev.status === "registered";
  const deviceMode = POLICY_MODES.device_mode as string;
  let deviceResult: PunchState = "accepted";
  if (deviceMode !== "off" && !known) {
    deviceResult = deviceMode === "block" ? "rejected" : "review";
    reasons.push("unknown_device");
  }
  const skew = Math.round((Date.parse(now) - Date.parse(b.device_at)) / 1000);
  let timeResult: PunchState = "accepted";
  if (skew < -FUTURE_TOLERANCE_S) {
    timeResult = "review";
    reasons.push("suspicious_timestamp");
  }
  const state = strictest(fenceResult, deviceResult, timeResult);
  const ev: Ev = {
    key,
    attendance_event_id: sid(`event:${key}:${now}`),
    event_type: b.event_type,
    work_date: date,
    occurred_at: now,
    device_at: b.device_at,
    skew_seconds: skew,
    validation_state: state,
    source: "pwa",
    latitude: point?.latitude ?? null,
    longitude: point?.longitude ?? null,
    accuracy_m: point ? b.accuracy_m : null,
    distance_m: distance,
    worksite_name: site?.name ?? null,
    geofence,
    location_reason: locationReason,
    device_label: dev.label,
    device_state: dev.status as DeviceState,
    reasons,
    note: b.note?.trim() || null,
    excluded: false,
    recorded_by_name: null,
    reason: null,
  };
  EVENTS.push(ev);
  dev.last_punch_at = now;
  if (state !== "rejected") {
    for (const r of reasons) {
      const detail =
        r === "outside_worksite"
          ? `${distance} m from ${site!.name}, radius ${site!.radius_m} m`
          : r === "location_unverified"
            ? locationReason === "poor_accuracy" && b.accuracy_m
              ? `Reading accurate to ${Math.round(b.accuracy_m)} m`
              : `No location: ${LOCATION_REASON[locationReason ?? ""] ?? "no location reading"}`
            : r === "unknown_device"
              ? `Unregistered device: ${dev.label}`
              : `Device clock ${Math.max(1, Math.round(Math.abs(skew) / 60))} min ahead`;
      addException(key, date, r, ev, detail);
    }
    recompute(key, date);
  }
  const result: PunchResult = {
    attendance_event_id: ev.attendance_event_id,
    event_type: ev.event_type,
    validation_state: state,
    occurred_at: now,
    device_at: b.device_at,
    work_date: date,
    reasons,
    distance_m: distance,
    worksite_name: site?.name ?? null,
    message: messageOf(ev),
    replayed: false,
    today: todayOf(key),
  };
  REPLAYS.set(`${key}:${idem}`, { body: bodyText, result });
  return created(result);
});

/* ------------------------------------------------------------------ *
 * The person's own records (ESS · My Attendance)
 * ------------------------------------------------------------------ */
const monthOf = (q: Record<string, string>) => q.month ?? todayIso().slice(0, 7);
const dayOut = ({ key: _k, ...d }: Day): AttendanceDay => ({ ...d, open_exceptions: openCount(d.attendance_day_id) });
const exOut = ({ key: _k, ...x }: Ex): AttendanceException => x;
const evOut = ({ key: _k, ...e }: Ev, coordinates: boolean): AttendanceEvent => (coordinates ? e : { ...e, latitude: null, longitude: null });
const byNewest = (a: Day, b: Day) => b.attendance_date.localeCompare(a.attendance_date);
const exOrder = (a: Ex, b: Ex) => Number(a.status !== "open") - Number(b.status !== "open") || b.created_at.localeCompare(a.created_at);

route("GET /api/v1/attendance/me", (req) => {
  const month = monthOf(req.query);
  const status = req.query.status;
  const wanted = (s: string | null | undefined) => !status || (status === "present" ? s === "present" || s === "late" : s === status);
  const rows = [...DAYS.values()].filter((d) => d.key === req.user && d.attendance_date.startsWith(month) && (d.status || d.first_clock_in_at) && wanted(d.status)).sort(byNewest).map(dayOut);
  const { month: _m, status: _s, ...query } = req.query;
  return paged(rows, { ...req, query }, req.query.sort ? { sort: { attendance_date: (a, b) => a.attendance_date.localeCompare(b.attendance_date) } } : {});
});

route("GET /api/v1/attendance/me/summary", (req) => {
  const month = monthOf(req.query);
  const mine = [...DAYS.values()].filter((d) => d.key === req.user && d.attendance_date.startsWith(month));
  return ok({
    month,
    days_present: mine.filter((d) => d.status === "present" || d.status === "late").length,
    late_days: mine.filter((d) => d.status === "late").length,
    absent_days: mine.filter((d) => d.status === "absent").length,
    leave_days: mine.filter((d) => d.status === "leave").length,
    worked_minutes: mine.reduce((a, d) => a + d.worked_minutes, 0),
    late_minutes: mine.reduce((a, d) => a + d.late_minutes, 0),
    open_exceptions: EXCS.filter((x) => x.key === req.user && x.status === "open" && x.work_date.startsWith(month)).length,
  });
});

route("GET /api/v1/attendance/me/events", (req) => {
  if (!req.query.date) return invalid({ date: ["Required"] });
  const rows = EVENTS.filter((e) => e.key === req.user && e.work_date === req.query.date).sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
  return paged(rows.map((e) => evOut(e, false)), req, { filters: { date: () => true } });
});

route("GET /api/v1/attendance/me/exceptions", (req) =>
  paged(EXCS.filter((x) => x.key === req.user).sort(exOrder).map(exOut), req, { filters: { status: (x, v) => x.status === v } }),
);

route("POST /api/v1/attendance/me/exceptions/:id/explanation", (req) => {
  const x = EXCS.find((e) => e.attendance_exception_id === req.params.id && e.key === req.user);
  if (!x) return notFound();
  if (x.status !== "open") return fail(409, "EXCEPTION_DECIDED", "This exception was already decided");
  const note = String(req.body.employee_note ?? "").trim();
  if (!note) return invalid({ employee_note: ["Required"] });
  Object.assign(x, { employee_note: note, employee_noted_at: new Date().toISOString() });
  return ok(exOut(x));
});

route("POST /api/v1/attendance/me/export", (req) => {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(req.body.month ?? ""))) return invalid({ month: ["Pick a month"] });
  return ok({ queued: true, email: byKey(req.user)!.work_email });
});

route("GET /api/v1/attendance/me/records/:id", (req) => {
  const r = recordRef(req.params.id);
  return r && byId(r.employee_id)?.user_key === req.user ? ok(r) : notFound();
});

/* ------------------------------------------------------------------ *
 * People · Attendance: the register, a day, the exceptions
 * ------------------------------------------------------------------ */
const forbidden = () => fail(403, "FORBIDDEN", "You do not have access to this.");

function registerRows(date: string, viewer: string): Array<RegisterRow & { key: string; working: boolean }> {
  const g = peopleGrant(viewer, "view");
  const shift = shiftOf(date);
  return PEOPLE.filter((p) => g.sees(p.user_key) && p.start_date <= date).map((p) => {
    const day = DAYS.get(dk(p.user_key, date));
    const evs = activeOn(p.user_key, date);
    const last = evs[evs.length - 1] ?? null;
    const site = siteOf(p.user_key);
    return {
      key: p.user_key,
      working: shift.working_day,
      employee: person(p),
      work_pattern: p.work_pattern,
      date,
      status: day?.status ?? (shift.working_day ? "not_in" : "off"),
      attendance_day_id: day?.attendance_day_id ?? null,
      clock_in_at: day?.first_clock_in_at ?? null,
      clock_out_at: day?.last_clock_out_at ?? null,
      worked_minutes: day?.worked_minutes ?? 0,
      late_minutes: day?.late_minutes ?? 0,
      expected_location: p.work_pattern === "remote" ? "Remote" : (site?.name ?? null),
      location_verdict: last?.geofence ?? null,
      device_label: last?.device_label ?? null,
      device_state: last?.device_state ?? null,
      open_exceptions: day ? openCount(day.attendance_day_id) : 0,
    };
  });
}
const stripRow = ({ key: _k, working: _w, ...r }: RegisterRow & { key: string; working: boolean }): RegisterRow => r;

route("GET /api/v1/attendance/register", (req) => {
  if (!peopleGrant(req.user!, "view").may) return forbidden();
  const date = req.query.date ?? todayIso();
  const rows = registerRows(date, req.user!).sort((a, b) => a.employee.display_name.localeCompare(b.employee.display_name)).map(stripRow);
  const { date: _d, ...query } = req.query;
  return paged(rows, { ...req, query }, {
    search: (r) => [r.employee.display_name, r.employee.department, r.expected_location],
    filters: { status: (r, v) => r.status === v },
    sort: {
      display_name: (a, b) => a.employee.display_name.localeCompare(b.employee.display_name),
      clock_in_at: (a, b) => (a.clock_in_at ?? "~").localeCompare(b.clock_in_at ?? "~"),
      status: (a, b) => a.status.localeCompare(b.status),
    },
  });
});

route("GET /api/v1/attendance/summary", (req) => {
  if (!peopleGrant(req.user!, "view").may) return forbidden();
  const date = req.query.date ?? todayIso();
  const rows = registerRows(date, req.user!);
  const n = (s: string) => rows.filter((r) => r.status === s).length;
  return ok({
    date,
    expected: rows.filter((r) => r.working && r.status !== "leave").length,
    present: n("present"),
    late: n("late"),
    absent: n("absent"),
    on_leave: n("leave"),
    not_in: n("not_in"),
    open_exceptions: rows.reduce((a, r) => a + r.open_exceptions, 0),
  });
});

route("GET /api/v1/attendance/register/:employee_id", (req) => {
  const g = peopleGrant(req.user!, "view");
  if (!g.may) return forbidden();
  const p = byId(req.params.employee_id);
  if (!p || !g.sees(p.user_key)) return notFound();
  const date = req.query.date ?? todayIso();
  const row = registerRows(date, req.user!).find((r) => r.key === p.user_key);
  if (!row) return notFound();
  const day = DAYS.get(dk(p.user_key, date));
  const site = siteOf(p.user_key);
  const { grace_minutes, working_day, starts_at, ends_at } = shiftOf(date);
  const out: DayDetail = {
    employee: row.employee,
    date,
    work_pattern: p.work_pattern,
    status: row.status,
    attendance_day_id: row.attendance_day_id,
    shift: { working_day, starts_at, ends_at, grace_minutes },
    clock_in_at: row.clock_in_at,
    clock_out_at: row.clock_out_at,
    worked_minutes: row.worked_minutes,
    late_minutes: row.late_minutes,
    overtime_minutes: day?.overtime_minutes ?? 0,
    closed: !!day?.closed_at,
    expected_location: p.work_pattern === "remote" || !site ? null : { name: site.name, radius_m: site.radius_m },
    policy: { geofence_mode: POLICY_MODES.geofence_mode, device_mode: POLICY_MODES.device_mode },
    open_exceptions: row.open_exceptions,
  };
  return ok(out);
});

route("GET /api/v1/attendance/events", (req) => {
  const g = peopleGrant(req.user!, "view");
  if (!g.may) return forbidden();
  const p = byId(req.query.employee_id);
  if (!p || !g.sees(p.user_key)) return notFound();
  if (!req.query.date) return invalid({ date: ["Required"] });
  const rows = EVENTS.filter((e) => e.key === p.user_key && e.work_date === req.query.date).sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
  return paged(rows.map((e) => evOut(e, g.all)), req, { filters: { employee_id: () => true, date: () => true } });
});

route("GET /api/v1/attendance/exceptions", (req) => {
  const g = peopleGrant(req.user!, "view");
  if (!g.may) return forbidden();
  const rows = EXCS.filter((x) => g.sees(x.key)).sort(exOrder).map(exOut);
  return paged(rows, req, {
    search: (x) => [x.employee.display_name, x.detail],
    filters: {
      status: (x, v) => x.status === v,
      exception_type: (x, v) => x.exception_type === v,
      date: (x, v) => x.work_date === v,
      employee_id: (x, v) => x.employee.employee_id === v,
    },
  });
});

route("POST /api/v1/attendance/exceptions/:id/decision", (req) => {
  const g = peopleGrant(req.user!, "approve");
  if (!g.may) return forbidden();
  const x = EXCS.find((e) => e.attendance_exception_id === req.params.id && g.sees(e.key));
  if (!x) return notFound();
  if (!g.all) return fail(403, "FORBIDDEN", "Only People with access to everyone decide attendance exceptions");
  if (x.key === req.user) return fail(403, "OWN_RECORD", "Someone else decides your own attendance");
  if (x.status !== "open") return fail(409, "EXCEPTION_DECIDED", "This exception was already decided");
  const b = req.body as { decision: "accept" | "reject" | "add_clock_out"; resolution: string; clock_out_time?: string };
  if (String(b.resolution ?? "").trim().length < 10) return invalid({ resolution: ["At least 10 characters"] });
  if (b.decision === "add_clock_out" && x.exception_type !== "missing_clock_out") return fail(422, "DECISION_INVALID", "Only a missing clock-out takes a time", { decision: ["Not for this"] });
  if (b.decision === "reject" && !x.attendance_event_id) return fail(422, "DECISION_INVALID", "There is no punch to reject", { decision: ["Not for this"] });
  if (b.decision === "add_clock_out") {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(b.clock_out_time ?? "")) return invalid({ clock_out_time: ["Give the time"] });
    const iso = new Date(`${x.work_date}T${b.clock_out_time}:00+01:00`).toISOString();
    const first = activeOn(x.key, x.work_date).find((e) => e.event_type === "clock_in");
    if (!first || iso <= first.occurred_at) return fail(422, "CLOCK_OUT_TIME", "Give a time after the clock-in", { clock_out_time: ["After the clock-in"] });
    addEvent(x.key, x.work_date, "clock_out", iso, { source: "admin", device_at: null, skew_seconds: null, latitude: null, longitude: null, accuracy_m: null, distance_m: null, geofence: "not_applied", location_reason: null, device_label: null, device_state: "none", recorded_by_name: byKey(req.user)!.display_name, reason: b.resolution.trim() });
  }
  if (b.decision === "reject") {
    const ev = EVENTS.find((e) => e.attendance_event_id === x.attendance_event_id);
    if (ev) ev.excluded = true;
  }
  Object.assign(x, {
    status: "resolved",
    outcome: b.decision === "accept" ? "accepted" : b.decision === "reject" ? "rejected" : "corrected",
    resolution: b.resolution.trim(),
    reviewed_at: new Date().toISOString(),
    reviewed_by_name: byKey(req.user)!.display_name,
  });
  recompute(x.key, x.work_date);
  return ok(exOut(x));
});

route("POST /api/v1/attendance/export", (req) => {
  if (!peopleGrant(req.user!, "export").may) return forbidden();
  const b = req.body as { from?: string; to?: string };
  if (!b.from || !b.to) return invalid({ ...(!b.from && { from: ["Required"] }), ...(!b.to && { to: ["Required"] }) });
  if (b.to < b.from) return invalid({ to: ["Ends before it starts"] });
  if ((Date.parse(`${b.to}T00:00:00Z`) - Date.parse(`${b.from}T00:00:00Z`)) / 86400_000 > 30) return invalid({ to: ["At most 31 days"] });
  return ok({ queued: true, email: byKey(req.user)!.work_email });
});

function recordRef(id: string): AttendanceRecordRef | null {
  const day = [...DAYS.values()].find((d) => d.attendance_day_id === id);
  const x = EXCS.find((e) => e.attendance_exception_id === id);
  const d = day ?? (x ? DAYS.get(dk(x.key, x.work_date)) : undefined);
  if (!d) return null;
  return { attendance_day_id: d.attendance_day_id, attendance_exception_id: x?.attendance_exception_id ?? null, employee_id: byKey(d.key)!.employee_id, date: d.attendance_date };
}

route("GET /api/v1/attendance/records/:id", (req) => {
  const g = peopleGrant(req.user!, "view");
  if (!g.may) return forbidden();
  const r = recordRef(req.params.id);
  return r && g.sees(byId(r.employee_id)!.user_key) ? ok(r) : notFound();
});

/** The arrangement the INTERIM employee setup tab shows, until approved homes and field days exist. */
const ARR: Record<string, "Remote" | "Hybrid" | "Field" | "Office-only"> = { hybrid: "Hybrid", remote: "Remote", on_site: "Office-only" };
const arrOf = (key: string) => (key === "adedotun" || key === "grace" ? "Field" : ARR[byKey(key)!.work_pattern]);
const PROFILE: Record<string, string> = { Remote: "Remote · approved home geofence", Hybrid: "Hybrid · office and home days", Field: "Field · assignment first", "Office-only": "Office-only · worksite geofence" };

/* ------------------------------------------------------------------ *
 * Work location requests
 * ------------------------------------------------------------------ */
const REQUESTS = [
  ["chidera", "Temporary home-location change", 2, 6, "Yaba, Lagos", "12 Herbert Macaulay Way, Yaba", "Staying with family while my flat is repaired", "Awaiting HR", "I know about this and support it"],
  ["amara", "Remote day", 1, 1, "Surulere, Lagos", null, "Plumber visit, will work from home", "Awaiting manager", null],
  ["bashir", "Client visit", 0, 0, "Eko Hotels, VI", "Plot 1415 Adetokunbo Ademola, VI", "Re-engagement meeting with Eko Hotels", "Approved", "Supported"],
  ["cynthia", "Temporary home-location change", 9, 12, "Lekki Phase 1", "4 Admiralty Way, Lekki", "Home renovation", "Awaiting HR", null],
  ["kemi", "Remote day", -14, -14, "Ikorodu, Lagos", null, "Hospital appointment in the morning", "Expired", null],
  ["obinna", "Field correction", -3, -3, "Ikeja", null, "Clocked in from the client site by mistake", "Rejected", null],
].map((r, i) => ({
  request_id: sid(`lr:${i}`), number: `LR-${String(58 - i).padStart(4, "0")}`, employee: refKey(r[0] as string), key: r[0] as string, type: r[1] as LocationRequest["type"],
  from: (r[2] as number) >= 0 ? isoDaysAhead(r[2] as number) : isoDaysAgo(-(r[2] as number)), to: (r[3] as number) >= 0 ? isoDaysAhead(r[3] as number) : isoDaysAgo(-(r[3] as number)),
  area: r[4] as string, address: r[5] as string | null, radius_m: 100, reason: r[6] as string, evidence: null as string | null, status: r[7] as LocationRequest["status"], manager_note: r[8] as string | null, hr_note: null as string | null,
  history: [{ at: at(2 + i, "10:12"), by: byKey(r[0] as string)!.display_name, text: "Submitted" }],
}));
route("GET /api/v1/attendance/location-requests", (req) => {
  const scope = req.query.scope ?? "all";
  const team = new Set(teamOf(req.user!).map((p) => p.user_key));
  const rows = REQUESTS.filter((r) => (scope === "own" ? r.key === req.user : scope === "team" ? team.has(r.key) : true));
  return paged(rows, { ...req, query: Object.fromEntries(Object.entries(req.query).filter(([k]) => k !== "scope")) }, { search: (r) => [r.number, r.employee.display_name, r.area, r.reason], filters: { status: (r, v) => r.status === v } });
});
route("POST /api/v1/attendance/location-requests", (req) => {
  const b = req.body as { type: string; from: string; to: string; address: string; reason: string; evidence?: string };
  const fields: Record<string, string[]> = {};
  if (!b.from) fields.from = ["Pick the first day"];
  if (!b.to) fields.to = ["Pick the last day"];
  if (b.from && b.to && b.to < b.from) fields.to = ["Ends before it starts"];
  if (!b.address || b.address.length < 6) fields.address = ["Enter the address"];
  if (!b.reason || b.reason.length < 10) fields.reason = ["Write at least 10 characters"];
  if (Object.keys(fields).length) return invalid(fields);
  const p = byKey(req.user)!;
  const r = { request_id: sid(`lr:${Date.now()}`), number: `LR-${String(59 + REQUESTS.length).padStart(4, "0")}`, employee: ref(p)!, key: p.user_key, type: b.type as LocationRequest["type"], from: b.from, to: b.to, area: b.address.split(",").slice(-2).join(",").trim() || b.address, address: b.address, radius_m: 100, reason: b.reason, evidence: b.evidence ?? null, status: "Awaiting manager" as LocationRequest["status"], manager_note: null as string | null, hr_note: null as string | null, history: [{ at: new Date().toISOString(), by: p.display_name, text: "Submitted" }] };
  REQUESTS.unshift(r);
  return created(r);
});
/* ------------------------------------------------------------------ *
 * The offices the INTERIM employee setup tab offers (People · Employees)
 * ------------------------------------------------------------------ */
route("GET /api/v1/attendance/worksites", (req) =>
  paged(
    WORKSITES.filter((w) => w.active).map((w) => ({ location_id: w.worksite_id, name: w.name, type: "Office" as const, address: w.address ?? "", radius_m: w.radius_m, assigned: "", attendance_today: 0, dates: "Onwards", mode: "Warn", status: "Active", status_tone: "ok" as const, map: null })),
    req,
    { search: (r) => [r.name, r.address], filters: { type: (r, v) => r.type === v } },
  ),
);

/* ------------------------------------------------------------------ *
 * Policy: versions, a draft, publishing, acknowledgment
 * ------------------------------------------------------------------ */
const POLICY_START = 4;
const SETTINGS: PolicySetting[] = [
  { key: "wk_start", section: "Working Day", label: "Shift Start", help: "The default start time. A person's schedule can differ.", kind: "time", value: "09:00" },
  { key: "grace", section: "Working Day", label: "Grace Minutes", help: "Minutes after the start before a clock-in counts as late.", kind: "number", value: 10, min: 0, max: 60 },
  { key: "sat_half", section: "Working Day", label: "Saturday Half Day", help: "The working week is set per day (A22).", kind: "bool", value: true },
  { key: "late_rule", section: "Lateness", label: "Lates Before a Query", help: "How many late arrivals in 30 days raise a query automatically in Queries & Sanctions.", kind: "number", value: 3, min: 1, max: 10 },
  { key: "mode_remote", section: "Location Verification", label: "Remote Outside Home", help: "What happens when a remote employee clocks in outside the 100 m home geofence.", kind: "mode", value: "warn", options: ["record", "warn", "block"] },
  { key: "mode_hybrid", section: "Location Verification", label: "Hybrid Outside Location", help: "Office days check the office, remote days check the home.", kind: "mode", value: "warn", options: ["record", "warn", "block"] },
  { key: "mode_office", section: "Location Verification", label: "Office-Only Outside Office", help: "Office-only staff must be inside their assigned office geofence.", kind: "mode", value: "block", options: ["record", "warn", "block"] },
  { key: "mode_field", section: "Location Verification", label: "Field Outside Assignment", help: "An approved field assignment overrides office and home for its window.", kind: "mode", value: "warn", options: ["record", "warn", "block"] },
  { key: "radius_remote", section: "Location Verification", label: "Home Geofence Radius", help: "Fixed at 100 m for registered and temporary homes.", kind: "locked", value: "100 m · fixed" },
  { key: "good_acc", section: "Location Verification", label: "GPS Accuracy, Metres", help: "A reading at or better than this is used as it is.", kind: "number", value: 50, min: 10, max: 200 },
  { key: "dev_record", section: "Devices", label: "Record Device on Punch", help: "Devices are recorded so the policy can be tightened later without losing history.", kind: "bool", value: true },
  { key: "dev_warn_new", section: "Devices", label: "Warn on New Device", help: "Accept the punch from an unenrolled device with a warning, and send it for review.", kind: "bool", value: true },
  { key: "dev_block_unenrolled", section: "Devices", label: "Block Unenrolled Devices", help: "Refuse punches from a device People have not enrolled.", kind: "bool", value: false },
  { key: "deduction_tiers", section: "Payroll", label: "Lateness Deduction Tiers", help: "When on, reviewed late arrivals carry a computed deduction (10%, 20%, 30% of the day by the hour). A person still accepts each one in Payroll.", kind: "bool", value: false },
  { key: "ack_blocks", section: "Acknowledgment", label: "Read Before Clock-In", help: "When on, Clock In waits until the employee acknowledges the latest version.", kind: "bool", value: false },
];
const POLICY = {
  current: {
    version: POLICY_START, published_at: at(6, "11:20"), published_by: "Cynthia Osakunih", summary: "Saturday half day added; Office-only staff now blocked outside the office.",
    changes: ["Saturday is a half day, 09:00 to 15:00", "Office-only: outside the office is now blocked, not warned", "Grace period stays at 10 minutes"],
    settings: SETTINGS, acknowledged_at: null as string | null, draft: null as AttendancePolicy["draft"],
  } as AttendancePolicy,
  acknowledged: new Set(["cynthia", "ifeoma", "tolu", "bashir", "seyi"]),
  history: [
    { version: 3, published_at: at(48, "10:00"), published_by: "Cynthia Osakunih", summary: "Device recording switched on for everyone.", changes: ["Record Device on Punch"] },
    { version: 2, published_at: at(96, "09:30"), published_by: "Cynthia Osakunih", summary: "Field assignments introduced.", changes: ["An approved field assignment overrides office and home"] },
    { version: 1, published_at: at(140, "12:00"), published_by: "Ifeoma Chukwu", summary: "First attendance policy.", changes: ["Geofenced clock-in for every arrangement"] },
  ],
};
const withAck = (user: string, p: AttendancePolicy): AttendancePolicy => ({ ...p, acknowledged_at: POLICY.acknowledged.has(user) && p.version === POLICY.current.version ? at(5, "09:02") : p.version < POLICY.current.version ? at(50, "09:00") : null });
route("GET /api/v1/attendance/policies/current", (req) => ok(withAck(req.user!, POLICY.current)));
route("GET /api/v1/attendance/policies", (req) =>
  paged([POLICY.current, ...POLICY.history.map((h) => ({ ...h, settings: [], acknowledged_at: null, draft: null }))].map((p) => withAck(req.user!, p as AttendancePolicy)), req, { search: (r) => [r.summary, String(r.version)] }),
);
route("PATCH /api/v1/attendance/policies/draft", (req) => {
  const changes = (req.body.settings ?? {}) as Record<string, string | number | boolean>;
  const base = POLICY.current.draft?.settings ?? SETTINGS.map((s) => ({ ...s }));
  const next = base.map((s) => (s.key in changes && s.kind !== "locked" ? { ...s, value: changes[s.key] } : s));
  const changed = next.filter((s) => SETTINGS.find((o) => o.key === s.key)!.value !== s.value).map((s) => s.key);
  POLICY.current.draft = changed.length ? { changed_keys: changed, settings: next } : null;
  Object.keys(changes).forEach((k) => {
    const f = SETTINGS.find((o) => o.key === k);
    if (f) audit(byKey(req.user)!.display_name, "Policy draft changed", `Attendance policy draft · ${f.label}`, String(f.value), String(changes[k]), "Not published, nobody notified", "Attendance");
  });
  return ok(POLICY.current);
});
route("POST /api/v1/attendance/policies/draft/discard", () => {
  POLICY.current.draft = null;
  return ok(POLICY.current);
});
route("POST /api/v1/attendance/policies/publish", (req) => {
  const d = POLICY.current.draft;
  if (!d) return fail(409, "NO_DRAFT", "There is nothing to publish.");
  const summary = String(req.body.summary ?? "").trim();
  if (summary.length < 10) return invalid({ summary: ["Write at least 10 characters"] });
  POLICY.history.unshift({ version: POLICY.current.version, published_at: POLICY.current.published_at, published_by: POLICY.current.published_by, summary: POLICY.current.summary, changes: POLICY.current.changes });
  d.settings.forEach((s) => (SETTINGS.find((o) => o.key === s.key)!.value = s.value));
  POLICY.current = { ...POLICY.current, version: POLICY.current.version + 1, published_at: new Date().toISOString(), published_by: byKey(req.user)!.display_name, summary, changes: d.changed_keys.map((k) => SETTINGS.find((s) => s.key === k)!.label), draft: null };
  POLICY.acknowledged = new Set([req.user!]);
  audit(byKey(req.user)!.display_name, "Policy published", "Attendance policy", `v${POLICY.current.version - 1}`, `v${POLICY.current.version}`, summary, "Attendance");
  return ok(POLICY.current);
});
route("GET /api/v1/attendance/policies/:version/acknowledgements", (req) =>
  paged(
    PEOPLE.filter((p) => p.status !== "suspended").map((p, i) => ({ employee: refKey(p.user_key), read_at: POLICY.acknowledged.has(p.user_key) || i % 3 === 0 ? at(5, "09:00") : null, acknowledged_at: POLICY.acknowledged.has(p.user_key) ? at(5, "09:02") : null })).sort((a, b) => Number(!!b.acknowledged_at) - Number(!!a.acknowledged_at)),
    req,
    { search: (r) => [r.employee.display_name] },
  ),
);
route("POST /api/v1/attendance/policies/:version/acknowledge", (req) => {
  POLICY.acknowledged.add(req.user!);
  return ok(withAck(req.user!, POLICY.current));
});

/* ------------------------------------------------------------------ *
 * A person's attendance setup (People · Employees)
 * ------------------------------------------------------------------ */
const SETUP_OVERRIDES = new Map<string, { arrangement?: string; schedule?: Record<string, "Office" | "Remote">; history: Array<{ title: string; when: string; text: string }> }>();
route("GET /api/v1/attendance/setup/:employee_id", (req) => {
  const p = byId(req.params.employee_id);
  if (!p) return notFound();
  const o = SETUP_OVERRIDES.get(p.user_key);
  const arr = (o?.arrangement as ReturnType<typeof arrOf> | undefined) ?? arrOf(p.user_key);
  const home = arr === "Remote" || arr === "Hybrid";
  const tmp = REQUESTS.find((r) => r.key === p.user_key && r.type === "Temporary home-location change");
  return ok({
    employee: ref(p)!, arrangement: arr, primary_location: arr === "Remote" ? "Approved home" : arr === "Field" ? "Field assignment first" : p.worksite,
    office: p.worksite === "Remote" ? "MTN Head Office, Ikoyi" : p.worksite, office_radius_m: 120,
    home_area: home ? ["Lekki", "Surulere", "Gbagada", "Yaba", "Ikeja"][PEOPLE.indexOf(p) % 5] : null,
    home_address: home ? `${10 + PEOPLE.indexOf(p)} Adebayo Street, ${["Lekki", "Surulere", "Gbagada", "Yaba", "Ikeja"][PEOPLE.indexOf(p) % 5]}, Lagos` : null,
    home_radius_m: home ? 100 : null, field_assignment_today: null,
    temporary_location: tmp ? { tone: tmp.status === "Approved" ? "ok" : tmp.status === "Awaiting HR" || tmp.status === "Awaiting manager" ? "warn" : "neutral", text: `${tmp.status} · ${tmp.area}` } : { tone: "neutral", text: "None" },
    schedule: arr === "Hybrid" ? (o?.schedule ?? { Mon: "Office", Tue: "Office", Wed: "Remote", Thu: "Office", Fri: "Office", Sat: "Remote" }) : null,
    profile: `${PROFILE[arr]} · policy v${POLICY.current.version}`,
    history: o?.history ?? [{ title: `Arrangement set to ${arr}`, when: `${p.start_date.split("-").reverse().join("/")} · Cynthia Osakunih`, text: "On joining." }],
  });
});
route("PATCH /api/v1/attendance/setup/:employee_id", (req) => {
  const p = byId(req.params.employee_id);
  if (!p) return notFound();
  if (String(req.body.reason ?? "").trim().length < 5) return invalid({ reason: ["Give a reason"] });
  const o = SETUP_OVERRIDES.get(p.user_key) ?? { history: [] };
  const before = o.arrangement ?? arrOf(p.user_key);
  if (req.body.arrangement) o.arrangement = String(req.body.arrangement);
  if (req.body.schedule) o.schedule = req.body.schedule as Record<string, "Office">;
  o.history.unshift({ title: `Arrangement: ${before} → ${o.arrangement ?? before}`, when: `Just now · ${byKey(req.user)!.display_name}`, text: String(req.body.reason) });
  SETUP_OVERRIDES.set(p.user_key, o);
  return ok({ ok: true });
});

/** Read by Payroll: is the lateness tier setting on in the published policy? */
export const deductionTiersOn = () => SETTINGS.find((x) => x.key === "deduction_tiers")?.value === true;
