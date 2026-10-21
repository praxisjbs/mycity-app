import type { ApprovalInstance, ApprovalWaiting, AttendanceDay, FieldAssignment, AttendanceEvent, AttendanceException, AttendanceRecordRef, AttendanceToday, CheckIn, CheckInResult, DayDetail, DeviceState, EventType, ExceptionType, GeofenceVerdict, HomeLocation, HomeRequest, HomeStatus, LocationRequest, MyHome, PunchResult, PunchState, RegisterRow, ScheduleDay, ScheduleVersion, TemporarySite, WorkSchedule } from "@mycity/contract/contract.gen.ts";
import { formatDate, formatTime, todayIso } from "@mycity/ui";
import { at, created, fail, invalid, isoDaysAgo, isoDaysAhead, notFound, ok, paged, route, sid } from "../core";
import { byId, byKey, PEOPLE, SIGN_INS, type MockPerson } from "../data/people";
import { HISTORY, TODAY } from "../data/attendance";
import { lastDeviceOf, MAX_REGISTERED, registeredCount, sessionDevice } from "./devices";
import { peopleGrant, siteOf } from "./worksites";
import { exportFile } from "./shared";
import { placeOf } from "./maps";
import { attendanceRulesInForce } from "./policies";

/**
 * Attendance on the mock, in the contract's shapes (packages/contract/schemas/attendance.js): the
 * clock, the person's days, punches and exceptions, People's register, a day's evidence and the
 * decisions. The punch is judged here the way the API judges it (docs/guides/attendance.md §6):
 * the server's time, the distance to the worksite (for remote staff, the approved home) from the
 * reading sent, the accuracy, the device of the session, the policy's modes, one shift a day, and
 * the Idempotency-Key.
 *
 * The policy is the version in force below (version 2: the location on warn and the device on
 * warn, so a laptop sees both warnings, and 10 minutes' grace).
 */

/* ------------------------------------------------------------------ *
 * The policy, the shift and the clock
 * ------------------------------------------------------------------ */
const TZ = "Africa/Lagos";
const GRACE = 10;
/** The office's location mode, the device mode and the accuracy limit of the version in force (below). */
const POLICY_MODES = {
  get geofence_mode() {
    return inForceRules().office_geofence_mode;
  },
  get device_mode() {
    return inForceRules().device_mode;
  },
  get max_accuracy_m() {
    return inForceRules().max_accuracy_m;
  },
};
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
type Shift = ReturnType<typeof shiftOf>;
/**
 * A temporary site's own hours for a person's day (§6.11), or null. Set once the sites below are
 * built: the demonstration history, worked out before them, has none.
 */
let siteShift: (key: string, date: string) => Shift | null = () => null;
/** A person's shift on a day: a site's own hours, else the working week's. */
const shiftFor = (key: string, date: string): Shift => siteShift(key, date) ?? shiftOf(date);
const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const lateOf = (s: Shift, iso: string) => (s.starts_at ? Math.max(0, minutesOf(formatTime(iso)) - (minutesOf(s.starts_at) + GRACE)) : 0);
const overtimeOf = (s: Shift, iso: string) => (s.ends_at ? Math.max(0, minutesOf(formatTime(iso)) - minutesOf(s.ends_at)) : 0);

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
  outside_home: "medium",
  location_unverified: "low",
  unknown_device: "high",
  suspicious_timestamp: "medium",
  missing_clock_out: "medium",
  automatic_clock_out: "low",
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
    d = { key, attendance_day_id: sid(`day:${key}:${date}`), attendance_date: date, status: null, first_clock_in_at: null, last_clock_out_at: null, clock_out_automatic: false, worked_minutes: 0, late_minutes: 0, overtime_minutes: 0, closed_at: null, open_exceptions: 0 };
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
  d.clock_out_automatic = last?.source === "system";
  const shift = shiftFor(key, date);
  d.late_minutes = first ? lateOf(shift, first.occurred_at) : 0;
  d.worked_minutes = first && last ? Math.max(0, Math.floor((Date.parse(last.occurred_at) - Date.parse(first.occurred_at)) / 60000)) : 0;
  d.overtime_minutes = last ? overtimeOf(shift, last.occurred_at) : 0;
  if (d.status !== "leave") d.status = first ? (d.late_minutes > 0 ? "late" : "present") : d.closed_at && shift.working_day ? "absent" : null;
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
    attendance_check_in_id: null,
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

/** An automatic clock-out: the system's, with no location, device or device time (§6.14). */
const AUTOMATIC: Partial<Ev> = { source: "system", device_at: null, skew_seconds: null, latitude: null, longitude: null, accuracy_m: null, distance_m: null, worksite_name: null, geofence: "not_applied", location_reason: null, device_label: null, device_state: "none" };

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
    // Two shifts the clock watch closed: Cynthia's, and Bashir's, which he has explained (§6.14).
    const automatic = (key === "cynthia" && daysBack === 2) || (key === "bashir" && daysBack === 3);
    if (h.clock_out_at && !missedOut && !automatic) addEvent(key, h.date, "clock_out", h.clock_out_at);
    if (automatic) {
      const out = addEvent(key, h.date, "clock_out", new Date(`${h.date}T${shiftOf(h.date).ends_at ?? "17:00"}:00+01:00`).toISOString(), AUTOMATIC);
      if (key === "bashir") {
        const x = addException(key, h.date, "automatic_clock_out", out, `Clocked out automatically at ${formatTime(out.occurred_at)}`);
        Object.assign(x, { employee_note: "I left at four for the bank", employee_noted_at: out.occurred_at });
      }
    }
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
 * Remote staff's homes (docs/guides/attendance.md §6.10)
 * ------------------------------------------------------------------ */
const forbidden = () => fail(403, "FORBIDDEN", "You do not have access to this.");
const HOME_RADIUS_M = 100;
type Home = { id: string; key: string; status: HomeStatus; address: string; latitude: number; longitude: number; accuracy_m: number | null; requested_at: string; decided_at: string | null; decided_by: string | null; reason: string | null };
const HOMES: Home[] = [];

/** Invented homes for the demonstration's remote staff: two approved, one waiting, one moving, one rejected. */
(() => {
  const add = (key: string, status: HomeStatus, address: string, latitude: number, longitude: number, daysBack: number, decided: { by: string; reason?: string } | null) =>
    HOMES.push({ id: sid(`home:${key}:${status}:${daysBack}`), key, status, address, latitude, longitude, accuracy_m: 16, requested_at: at(daysBack, "19:10"), decided_at: decided ? at(daysBack - 1, "10:05") : null, decided_by: decided?.by ?? null, reason: decided?.reason ?? null });
  add("amara", "approved", "7 Sample Crescent, Surulere", 6.4969, 3.3553, 40, { by: "cynthia" });
  add("obinna", "approved", "22 Example Avenue, Gbagada", 6.5543, 3.3891, 32, { by: "cynthia" });
  add("ibrahim", "approved", "5 Placeholder Street, Yaba", 6.5095, 3.3711, 28, { by: "cynthia" });
  add("ibrahim", "pending", "18 Demo Close, Ikeja", 6.6018, 3.3515, 1, null);
  add("seyi", "pending", "3 Fixture Road, Ikoyi", 6.4549, 3.4246, 2, null);
  add("kemi", "rejected", "Somewhere in Lekki", 6.4474, 3.4723, 5, { by: "cynthia", reason: "Send the full street address please" });
})();

const homeOf = (key: string, status: HomeStatus) => HOMES.find((h) => h.key === key && h.status === status) ?? null;
const newestHome = (key: string) => HOMES.filter((h) => h.key === key).sort((a, b) => b.requested_at.localeCompare(a.requested_at))[0] ?? null;
const isRemote = (key: string) => byKey(key)?.work_pattern === "remote";

/* ------------------------------------------------------------------ *
 * Hybrid staff's weekly schedule (docs/guides/attendance.md §6.13)
 * ------------------------------------------------------------------ */
type MockSchedule = { id: string; key: string; office_days: number[]; effective_from: string; reason: string; set_by: string; set_at: string };
const SCHEDULES: MockSchedule[] = [];
/** Invented schedules for three hybrid people who do not sign in, and one waiting to start. */
(() => {
  const add = (key: string, office_days: number[], from: string, reason: string, n: number) =>
    SCHEDULES.push({ id: sid(`schedule:${key}:${from}`), key, office_days, effective_from: from, reason, set_by: "cynthia", set_at: at(n, "10:00") });
  add("tolu", [1, 2, 4], isoDaysAgo(30), "Team planning days at the office", 31);
  add("bashir", [2, 4], isoDaysAgo(20), "Partner meetings mid-week", 21);
  add("grace", [1, 3, 5], isoDaysAgo(14), "Office on partner review days", 15);
  add("tolu", [1, 2, 3], isoDaysAhead(7), "Planning moves to Wednesday", 1);
})();
/** The weekdays the organisation works: Monday to Saturday (shiftOf). */
const WORKING = [1, 2, 3, 4, 5, 6];
const weekdayOf = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay() || 7;
const scheduleOn = (key: string, date: string) =>
  SCHEDULES.filter((x) => x.key === key && x.effective_from <= date).sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0] ?? null;
const scheduleAfter = (key: string, date: string) =>
  SCHEDULES.filter((x) => x.key === key && x.effective_from > date).sort((a, b) => a.effective_from.localeCompare(b.effective_from))[0] ?? null;
/** A hybrid employee's home day: the schedule in force then leaves its weekday out. */
function homeDay(key: string, date: string) {
  if (byKey(key)?.work_pattern !== "hybrid") return false;
  const x = scheduleOn(key, date);
  return !!x && !x.office_days.includes(weekdayOf(date));
}
/** Each weekday's place (office, remote, off), as My Profile and the employee record show it. */
export function weekOf(key: string): ScheduleDay[] {
  const p = byKey(key)!;
  const x = p.work_pattern === "hybrid" ? scheduleOn(key, todayIso()) : null;
  return [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
    weekday,
    place: !WORKING.includes(weekday) ? "off" : p.work_pattern === "remote" || (x && !x.office_days.includes(weekday)) ? "remote" : "office",
  }));
}
/** Remote staff, and hybrid staff whose schedule leaves a working day for home, need an approved home. */
function needsHome(key: string) {
  const p = byKey(key);
  if (!p || p.work_pattern === "on_site") return false;
  if (p.work_pattern === "remote") return true;
  return [scheduleOn(key, todayIso()), scheduleAfter(key, todayIso())].some((x) => x && WORKING.some((d) => !x.office_days.includes(d)));
}

/** Where a person's punch is judged: their approved home when they work remotely, else their worksite. */
type Fence = { kind: "worksite" | "home" | "temporary_home" | "field" | "client_visit" | "temporary_site"; name: string; latitude: number; longitude: number; radius_m: number | null; sites?: MockSite[] };
function fenceOf(key: string): Fence | null {
  // An approved temporary site covering today decides the place before anything (§6.11), then a
  // field assignment or an approved work location request made before PR 4.
  const ts = siteOn(key, todayIso());
  if (ts) {
    const home = ts.purpose === "temporary_home";
    const sites = ts.locations.map((l) => ({ id: l.id, name: nameOfAddress(ts, l), address: l.address, latitude: l.latitude, longitude: l.longitude, radius_m: l.radius_m }));
    return { kind: home ? "temporary_home" : "temporary_site", name: home ? "Temporary Home" : ts.name, latitude: sites[0].latitude, longitude: sites[0].longitude, radius_m: sites.length === 1 ? sites[0].radius_m : null, sites };
  }
  const fa = fieldOn(key, todayIso());
  if (fa) return { kind: "field", name: fa.sites.map((x) => x.name).join(" or "), latitude: fa.sites[0].latitude, longitude: fa.sites[0].longitude, radius_m: fa.sites.length === 1 ? fa.sites[0].radius_m : null, sites: fa.sites };
  const r = approvedReqOn(key, todayIso());
  if (r?.request_type === "temporary_home") return { kind: "temporary_home", name: "Temporary Home", latitude: r.latitude!, longitude: r.longitude!, radius_m: HOME_RADIUS_M };
  if (r?.request_type === "client_visit" && r.site_latitude !== null)
    return { kind: "client_visit", name: "Client Visit", latitude: r.site_latitude, longitude: r.site_longitude!, radius_m: r.site_radius_m };
  if (r?.request_type === "remote_day") {
    const h = homeOf(key, "approved");
    return h ? { kind: "home", name: "Home", latitude: h.latitude, longitude: h.longitude, radius_m: HOME_RADIUS_M } : null;
  }
  if (r) return null;
  if (isRemote(key) || homeDay(key, todayIso())) {
    const h = homeOf(key, "approved");
    return h ? { kind: "home", name: "Home", latitude: h.latitude, longitude: h.longitude, radius_m: HOME_RADIUS_M } : null;
  }
  const site = siteOf(key);
  return site ? { kind: "worksite", name: site.name, latitude: site.latitude, longitude: site.longitude, radius_m: site.radius_m } : null;
}

/** Today's approved remote day or client visit with no fence: the approval is the check. */
function approvedDayOf(key: string): { name: string } | null {
  if (siteOn(key, todayIso()) || fieldOn(key, todayIso())) return null;
  const r = approvedReqOn(key, todayIso());
  if (!r || r.request_type === "temporary_home" || (r.request_type === "client_visit" && r.site_latitude !== null) || (r.request_type === "remote_day" && homeOf(key, "approved"))) return null;
  return { name: r.request_type === "remote_day" ? "Remote Day" : "Client Visit" };
}

const asLocation = (h: Home | null): HomeLocation | null =>
  h && { attendance_home_id: h.id, status: h.status, home_address: h.address, home_latitude: h.latitude, home_longitude: h.longitude, accuracy_m: h.accuracy_m, radius_m: HOME_RADIUS_M, requested_at: h.requested_at, decided_at: h.decided_at, decision_reason: h.reason };

function myHome(key: string): MyHome {
  const newest = newestHome(key);
  return { needed: needsHome(key), approved: asLocation(homeOf(key, "approved")), pending: asLocation(homeOf(key, "pending")), rejected: asLocation(newest?.status === "rejected" ? newest : null), max_accuracy_m: POLICY_MODES.max_accuracy_m };
}

/** A home as People read it: the address and the point only for scope all. */
function homeOut(h: Home, all: boolean): HomeRequest {
  const approved = homeOf(h.key, "approved");
  return {
    attendance_home_id: h.id,
    employee: person(byKey(h.key)!),
    status: h.status,
    home_address: all ? h.address : null,
    home_latitude: all ? h.latitude : null,
    home_longitude: all ? h.longitude : null,
    accuracy_m: h.accuracy_m,
    radius_m: HOME_RADIUS_M,
    distance_from_approved_m: approved && approved.id !== h.id ? distanceM(h, approved) : null,
    requested_at: h.requested_at,
    decided_at: h.decided_at,
    decided_by_name: h.decided_by ? (byKey(h.decided_by)?.display_name ?? null) : null,
    decision_reason: h.reason,
  };
}

route("GET /api/v1/attendance/me/home", (req) => ok(myHome(req.user!)));

route("POST /api/v1/attendance/me/home", (req) => {
  const key = req.user!;
  const b = req.body as { home_address: unknown; home_latitude: number; home_longitude: number; accuracy_m: number };
  if (!needsHome(key)) return fail(422, "HOME_NOT_NEEDED", "Only staff who work from home set a home location.");
  // Picked, pinned or the device's location (F27): never typed.
  const place = placeOf(b.home_address);
  if (!place) return invalid({ home_address: ["Pick an address"] });
  if (b.accuracy_m > POLICY_MODES.max_accuracy_m) return fail(422, "HOME_READING_WEAK", "The location reading was not accurate enough.", { accuracy_m: ["Reading too weak"] });
  const waiting = homeOf(key, "pending");
  if (waiting) waiting.status = "superseded";
  HOMES.push({ id: sid(`home:${key}:${Date.now()}`), key, status: "pending", address: place.line, latitude: b.home_latitude, longitude: b.home_longitude, accuracy_m: b.accuracy_m, requested_at: new Date().toISOString(), decided_at: null, decided_by: null, reason: null });
  return created(myHome(key));
});

route("GET /api/v1/attendance/homes", (req) => {
  const g = peopleGrant(req.user!, "view");
  if (!g.may) return forbidden();
  const waitingFirst = (a: HomeRequest, b: HomeRequest) => Number(b.status === "pending") - Number(a.status === "pending") || b.requested_at.localeCompare(a.requested_at);
  const rows = HOMES.filter((h) => g.sees(h.key)).map((h) => homeOut(h, g.all));
  return paged(rows, req, {
    search: (h) => [h.employee.display_name],
    filters: { status: (h, v) => h.status === v, employee_id: (h, v) => h.employee.employee_id === v },
    sort: { waiting: waitingFirst, requested_at: (a, b) => a.requested_at.localeCompare(b.requested_at) },
  });
});

route("GET /api/v1/attendance/homes/:id", (req) => {
  const g = peopleGrant(req.user!, "view");
  if (!g.may) return forbidden();
  const h = HOMES.find((x) => x.id === req.params.id);
  return h && g.sees(h.key) ? ok(homeOut(h, g.all)) : notFound();
});

route("POST /api/v1/attendance/homes/:id/decision", (req) => {
  const g = peopleGrant(req.user!, "approve");
  if (!g.may || !g.all) return forbidden();
  const h = HOMES.find((x) => x.id === req.params.id);
  if (!h) return notFound();
  if (h.key === req.user) return fail(403, "OWN_RECORD", "Someone else decides your own home location");
  if (h.status !== "pending") return fail(409, "HOME_DECIDED", "This home location was already decided");
  const b = req.body as { decision: "approve" | "reject"; reason?: string | null };
  if (b.decision === "reject" && (b.reason ?? "").trim().length < 10) return invalid({ reason: ["At least 10 characters"] });
  if (b.decision === "approve") {
    const old = homeOf(h.key, "approved");
    if (old) old.status = "superseded";
  }
  Object.assign(h, { status: b.decision === "approve" ? "approved" : "rejected", decided_at: new Date().toISOString(), decided_by: req.user!, reason: b.decision === "reject" ? b.reason!.trim() : null });
  return ok(homeOut(h, true));
});

/* ------------------------------------------------------------------ *
 * The person's own clock
 * ------------------------------------------------------------------ */
const ON_LEAVE = new Set(TODAY.filter((t) => t.status === "leave").map((t) => t.person.user_key));

/** GET /attendance/me/today for a demonstration account; Home's mock reads it for the clock-in prompt. */
export function todayOf(key: string): AttendanceToday {
  const p = byKey(key)!;
  const date = todayIso();
  const fence = fenceOf(key);
  const approvedDay = approvedDayOf(key);
  const fromHome = isRemote(key) || homeDay(key, date);
  const homeState = fromHome ? (homeOf(key, "approved") ? "approved" : homeOf(key, "pending") ? "pending" : "none") : null;
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
    clock_out_automatic: outEv?.source === "system",
    // The mock has no sessions: every session it serves is the day's first (§6.14), and the device's mark keeps it to once.
    sign_in_prompt: !onLeave && !inEv && shiftFor(key, date).working_day,
    review: evs.some((e) => e.validation_state === "review"),
    shift: shiftFor(key, date),
    work_pattern: p.work_pattern,
    location: approvedDay
      ? { kind: "approved_day", name: approvedDay.name, radius_m: null, home_state: homeState }
      : fence
        ? { kind: fence.kind, name: fence.name, radius_m: fence.radius_m, home_state: homeState }
        : { kind: fromHome ? "remote" : "none", name: null, radius_m: null, home_state: homeState },
    policy: POLICY_MODES,
    device: { state: dev.status, label: dev.label, registered_count: count, can_register: dev.status !== "registered" && count < MAX_REGISTERED },
    temporary_site: todaySite(key, date),
    check_ins: siteOn(key, date) ? checkInsOn(key, date) : [],
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
      return `you were ${ev.distance_m} m from ${ev.worksite_name === "Client Visit" ? "the client's site" : ev.worksite_name}`;
    case "outside_home":
      return `you were ${ev.distance_m} m from your approved home`;
    case "location_unverified":
      if (ev.location_reason === "no_home") return "you have no approved home location yet";
      if (ev.location_reason === "no_worksite") return "you have no office assigned yet";
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
  const fence = fenceOf(key);
  const reading = b.latitude !== null && b.longitude !== null ? { latitude: b.latitude, longitude: b.longitude } : null;
  // On a temporary site's or a field assignment's day, the address the reading is nearest judges it (§6.11).
  const nearest = fence?.sites && reading
    ? [...fence.sites].sort((x, y) => {
        const dx = distanceM(reading, x), dy = distanceM(reading, y);
        return Number(dy <= y.radius_m) - Number(dx <= x.radius_m) || (dx - x.radius_m) - (dy - y.radius_m);
      })[0]
    : fence?.sites?.[0];
  const site = fence && nearest ? { ...fence, name: nearest.name, latitude: nearest.latitude, longitude: nearest.longitude, radius_m: nearest.radius_m } : fence;
  const approvedDay = approvedDayOf(key);
  const point = b.latitude !== null && b.longitude !== null ? { latitude: b.latitude, longitude: b.longitude } : null;
  const accuracy = point && b.accuracy_m !== null ? (b.accuracy_m <= GOOD_ACCURACY_M ? "good" : b.accuracy_m <= POLICY_MODES.max_accuracy_m ? "fair" : "poor") : null;
  let geofence: GeofenceVerdict;
  let locationReason: string | null = null;
  let distance: number | null = null;
  if (approvedDay) [geofence, locationReason] = ["not_applied", "approved_request"];
  else if (!site && (p.work_pattern === "remote" || homeDay(key, date))) [geofence, locationReason] = ["unverified", "no_home"];
  else if (!site) [geofence, locationReason] = ["unverified", "no_worksite"];
  else if (!point) [geofence, locationReason] = ["unverified", b.location_error || "no_location"];
  else {
    distance = distanceM(point, site);
    if (accuracy === "poor") [geofence, locationReason] = ["unverified", "poor_accuracy"];
    else geofence = distance <= (site.radius_m ?? 0) ? "inside" : "outside";
  }
  const reasons: ExceptionType[] = [];
  const mode = POLICY_MODES.geofence_mode as string;
  let fenceResult: PunchState = "accepted";
  if (mode !== "off" && geofence === "outside") {
    fenceResult = mode === "block" ? "rejected" : "review";
    reasons.push(site?.kind === "worksite" || site?.kind === "field" || site?.kind === "client_visit" || site?.kind === "temporary_site" ? "outside_worksite" : "outside_home");
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
    worksite_name: site?.name ?? approvedDay?.name ?? null,
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
          ? `${distance} m from ${site!.kind === "client_visit" ? "the client's site" : site!.name}, radius ${site!.radius_m} m`
          : r === "outside_home"
            ? `${distance} m from the ${site!.kind === "temporary_home" ? "temporary" : "approved"} home, radius ${site!.radius_m} m`
          : r === "location_unverified"
            ? locationReason === "no_home"
              ? "No approved home"
              : locationReason === "no_worksite"
              ? "No office assigned"
              : locationReason === "poor_accuracy" && b.accuracy_m
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
    worksite_name: site?.name ?? approvedDay?.name ?? null,
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

route("POST /api/v1/attendance/me/events/:id/explanation", (req) => {
  const ev = EVENTS.find((e) => e.attendance_event_id === req.params.id && e.key === req.user);
  if (!ev) return notFound();
  if (ev.source !== "system" || ev.event_type !== "clock_out") return fail(422, "NOT_AUTOMATIC", "Only an automatic clock-out is explained here");
  if (EXCS.some((x) => x.attendance_event_id === ev.attendance_event_id && x.exception_type === "automatic_clock_out"))
    return fail(409, "ALREADY_EXPLAINED", "You have already explained this clock-out");
  const note = String(req.body.employee_note ?? "").trim();
  if (!note) return invalid({ employee_note: ["Required"] });
  const x = addException(ev.key, ev.work_date, "automatic_clock_out", ev, `Clocked out automatically at ${formatTime(ev.occurred_at)}`);
  Object.assign(x, { employee_note: note, employee_noted_at: new Date().toISOString(), created_at: new Date().toISOString() });
  recompute(ev.key, ev.work_date);
  return created(exOut(x));
});

route("POST /api/v1/attendance/me/export", (req) => {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(req.body.month ?? ""))) return invalid({ month: ["Pick a month"] });
  return exportFile(req.user!, "my-attendance");
});

route("GET /api/v1/attendance/me/records/:id", (req) => {
  const r = recordRef(req.params.id);
  return r && byId(r.employee_id)?.user_key === req.user ? ok(r) : notFound();
});

/* ------------------------------------------------------------------ *
 * People · Attendance: the register, a day, the exceptions
 * ------------------------------------------------------------------ */

function registerRows(date: string, viewer: string): Array<RegisterRow & { key: string; working: boolean }> {
  const g = peopleGrant(viewer, "view");
  return PEOPLE.filter((p) => g.sees(p.user_key) && p.start_date <= date).map((p) => {
    // A site with its own hours works its days for its people (§6.11).
    const shift = shiftFor(p.user_key, date);
    const day = DAYS.get(dk(p.user_key, date));
    // The person's own latest punch: an automatic clock-out has no location or device to show.
    const evs = activeOn(p.user_key, date).filter((e) => e.source !== "system");
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
      expected_location: fieldOn(p.user_key, date)?.sites.map((x) => x.name).join(" or ") ?? (p.work_pattern === "remote" || homeDay(p.user_key, date) ? (homeOf(p.user_key, "approved") ? "Home" : "Remote") : (site?.name ?? null)),
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
  const fence = fenceOf(p.user_key);
  const { grace_minutes, working_day, starts_at, ends_at } = shiftFor(p.user_key, date);
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
    expected_location: fence ? { name: fence.name, radius_m: fence.radius_m } : approvedDayOf(p.user_key) ? { name: approvedDayOf(p.user_key)!.name, radius_m: null } : null,
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
  const takesTime = x.exception_type === "missing_clock_out" || x.exception_type === "automatic_clock_out";
  if (b.decision === "add_clock_out" && !takesTime) return fail(422, "DECISION_INVALID", "Only a missing or automatic clock-out takes a time", { decision: ["Not for this"] });
  if (b.decision === "reject" && !x.attendance_event_id) return fail(422, "DECISION_INVALID", "There is no punch to reject", { decision: ["Not for this"] });
  if (b.decision === "reject" && x.exception_type === "automatic_clock_out") return fail(422, "DECISION_INVALID", "Keep or correct an automatic clock-out", { decision: ["Not for this"] });
  if (b.decision === "add_clock_out") {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(b.clock_out_time ?? "")) return invalid({ clock_out_time: ["Give the time"] });
    const iso = new Date(`${x.work_date}T${b.clock_out_time}:00+01:00`).toISOString();
    const first = activeOn(x.key, x.work_date).find((e) => e.event_type === "clock_in");
    if (!first || iso <= first.occurred_at) return fail(422, "CLOCK_OUT_TIME", "Give a time after the clock-in", { clock_out_time: ["After the clock-in"] });
    // People's time stands in place of an automatic clock-out, which stops counting.
    if (x.exception_type === "automatic_clock_out") {
      const auto = EVENTS.find((e) => e.attendance_event_id === x.attendance_event_id);
      if (auto) auto.excluded = true;
    }
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
  return exportFile(req.user!, "attendance-register");
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

/* ------------------------------------------------------------------ *
 * Work location requests made before PR 4 (docs/guides/attendance.md §6.11): read, cancelled and
 * decided, never made
 * ------------------------------------------------------------------ */
type ReqType = LocationRequest["request_type"];
type MockReq = {
  id: string; number: string; key: string; request_type: ReqType; starts_on: string; ends_on: string; address: string | null;
  latitude: number | null; longitude: number | null; accuracy_m: number | null;
  site_latitude: number | null; site_longitude: number | null; site_radius_m: number | null; reason: string; status: LocationRequest["status"];
  stage: Stage | null; wid: string; requested_at: string; decided_at: string | null; cancelled_at: string | null; cancel_reason: string | null;
  /** The moves on its approval, oldest first: who, at which stage, and why. */
  trail: Array<{ stage: Stage; decision: "approve" | "reject" | "cancel"; by: string; reason: string | null; at: string }>;
};
type Stage = "line_manager" | "operations_people";
const STAGE_NAME = { line_manager: "Line Manager", operations_people: "Operations & People" } as const;
const LOC_REQS: MockReq[] = [];
let reqSeq = 0;
const addReq = (r: Omit<MockReq, "id" | "number" | "wid" | "decided_at" | "cancelled_at" | "cancel_reason" | "trail" | "site_latitude" | "site_longitude" | "site_radius_m"> & Partial<MockReq>) => {
  reqSeq += 1;
  const row: MockReq = { id: sid(`wlr:${reqSeq}`), number: `WLR-${String(reqSeq).padStart(4, "0")}`, wid: sid(`wlr-flow:${reqSeq}`), decided_at: null, cancelled_at: null, cancel_reason: null, trail: [], site_latitude: null, site_longitude: null, site_radius_m: null, ...r };
  LOC_REQS.unshift(row);
  return row;
};
/** Who decides the first stage: the line manager, or the CEO for someone with none. */
const lineManagerOf = (key: string) => byKey(key)?.manager ?? "ifeoma";
/** Invented requests for the demonstration: one waiting on each stage, one approved, one rejected, one cancelled. */
(() => {
  addReq({ key: "bashir", request_type: "client_visit", starts_on: isoDaysAgo(3), ends_on: isoDaysAgo(3), address: "Partner office, 4 Example Road, Victoria Island", latitude: null, longitude: null, accuracy_m: null, site_latitude: 6.4281, site_longitude: 3.4219, site_radius_m: 200, reason: "Quarterly review with a partner on their site", status: "approved", stage: null, requested_at: at(9, "10:12"), decided_at: at(8, "09:40"), trail: [{ stage: "line_manager", decision: "approve", by: lineManagerOf("bashir"), reason: null, at: at(9, "15:02") }, { stage: "operations_people", decision: "approve", by: "cynthia", reason: null, at: at(8, "09:40") }] });
  addReq({ key: "kemi", request_type: "temporary_home", starts_on: isoDaysAhead(4), ends_on: isoDaysAhead(20), address: "Flat 3, 11 Sample Crescent, Ikeja", latitude: 6.6018, longitude: 3.3515, accuracy_m: 18, reason: "Staying with family while my flat is repaired", status: "submitted", stage: "operations_people", requested_at: at(2, "18:05"), trail: [{ stage: "line_manager", decision: "approve", by: lineManagerOf("kemi"), reason: null, at: at(1, "09:20") }] });
  addReq({ key: "chidera", request_type: "remote_day", starts_on: isoDaysAhead(2), ends_on: isoDaysAhead(2), address: null, latitude: null, longitude: null, accuracy_m: null, reason: "Waiting in for a delivery in the morning", status: "submitted", stage: "line_manager", requested_at: at(1, "16:30") });
  addReq({ key: "obinna", request_type: "client_visit", starts_on: isoDaysAhead(6), ends_on: isoDaysAhead(7), address: "Client site, 22 Placeholder Avenue, Lekki", latitude: null, longitude: null, accuracy_m: null, site_latitude: 6.4474, site_longitude: 3.4723, site_radius_m: 150, reason: "On-site setup for a client's new office", status: "rejected", stage: null, requested_at: at(4, "11:00"), decided_at: at(3, "09:15"), trail: [{ stage: "line_manager", decision: "reject", by: lineManagerOf("obinna"), reason: "The team is short that week", at: at(3, "09:15") }] });
  addReq({ key: "seyi", request_type: "client_visit", starts_on: isoDaysAhead(10), ends_on: isoDaysAhead(10), address: "Client office, 3 Fixture Road, Ikoyi", latitude: null, longitude: null, accuracy_m: null, site_latitude: 6.4549, site_longitude: 3.4246, site_radius_m: 200, reason: "Workshop with a client's engineering team", status: "cancelled", stage: null, requested_at: at(5, "14:20"), cancelled_at: at(4, "08:00"), cancel_reason: "Moved online", trail: [{ stage: "line_manager", decision: "cancel", by: "seyi", reason: "Moved online", at: at(4, "08:00") }] });
})();

/** The approved request covering a person's day, if any (two never overlap). */
const approvedReqOn = (key: string, date: string) => LOC_REQS.find((r) => r.key === key && r.status === "approved" && r.starts_on <= date && r.ends_on >= date) ?? null;

/**
 * Does the stage the request waits at wait on this login? The line manager (the CEO for someone
 * with none), then Operations & People; never their own. As on the API, the CEO is not waited on
 * at a stage that does not name them.
 */
function canDecideReq(r: MockReq, user: string) {
  if (r.status !== "submitted" || r.key === user) return false;
  if (r.stage === "line_manager") return lineManagerOf(r.key) === user;
  return SIGN_INS[user]?.view === "operations";
}

const reqOut = (r: MockReq, user: string, place: boolean): LocationRequest => ({
  location_request_id: r.id, number: r.number, employee: person(byKey(r.key)!), request_type: r.request_type, starts_on: r.starts_on, ends_on: r.ends_on,
  days: Math.round((Date.parse(`${r.ends_on}T12:00:00Z`) - Date.parse(`${r.starts_on}T12:00:00Z`)) / 86400_000) + 1,
  address: r.address, home_latitude: place ? r.latitude : null, home_longitude: place ? r.longitude : null, accuracy_m: r.accuracy_m,
  site_latitude: r.site_latitude, site_longitude: r.site_longitude, site_radius_m: r.site_radius_m,
  reason: r.reason, status: r.status, workflow_instance_id: r.wid, waiting_on: r.status === "submitted" && r.stage ? STAGE_NAME[r.stage] : null,
  can_decide: canDecideReq(r, user), requested_at: r.requested_at, decided_at: r.decided_at, cancelled_at: r.cancelled_at, cancel_reason: r.cancel_reason,
});

route("GET /api/v1/attendance/me/requests", (req) => {
  const rows = LOC_REQS.filter((r) => r.key === req.user).map((r) => reqOut(r, req.user!, true));
  // Newest first unless sorted by the first day, as the API lists them.
  const newest = (a: LocationRequest, b: LocationRequest) => b.requested_at.localeCompare(a.requested_at);
  return paged(rows, req, { filters: { status: (r, v) => r.status === v }, sort: { newest, starts_on: (a, b) => a.starts_on.localeCompare(b.starts_on) } });
});
route("GET /api/v1/attendance/me/requests/:id", (req) => {
  const r = LOC_REQS.find((x) => x.id === req.params.id && x.key === req.user);
  return r ? ok(reqOut(r, req.user!, true)) : notFound();
});
route("POST /api/v1/attendance/me/requests/:id/cancel", (req) => {
  const r = LOC_REQS.find((x) => x.id === req.params.id && x.key === req.user);
  if (!r) return notFound();
  const waiting = r.status === "submitted";
  if (!waiting && !(r.status === "approved" && r.starts_on > todayIso())) return fail(409, "REQUEST_NOT_CANCELLABLE", "This request can no longer be cancelled");
  const why = String((req.body as { reason?: string }).reason ?? "").trim() || null;
  if (waiting && r.stage) r.trail.push({ stage: r.stage, decision: "cancel", by: r.key, reason: why, at: new Date().toISOString() });
  Object.assign(r, { status: "cancelled", stage: null, cancelled_at: new Date().toISOString(), cancel_reason: why });
  return ok(reqOut(r, req.user!, true));
});
route("GET /api/v1/attendance/requests", (req) => {
  const g = peopleGrant(req.user!, "view");
  if (!g.may) return forbidden();
  const waitingFirst = (a: LocationRequest, b: LocationRequest) => Number(b.status === "submitted") - Number(a.status === "submitted") || b.requested_at.localeCompare(a.requested_at);
  const rows = LOC_REQS.filter((r) => g.sees(r.key)).map((r) => reqOut(r, req.user!, g.all));
  return paged(rows, req, {
    search: (r) => [r.number, r.employee.display_name],
    filters: { status: (r, v) => r.status === v, request_type: (r, v) => r.request_type === v, employee_id: (r, v) => r.employee.employee_id === v },
    sort: { waiting: waitingFirst, starts_on: (a, b) => a.starts_on.localeCompare(b.starts_on), requested_at: (a, b) => a.requested_at.localeCompare(b.requested_at) },
  });
});
route("GET /api/v1/attendance/requests/:id", (req) => {
  const g = peopleGrant(req.user!, "view");
  if (!g.may) return forbidden();
  const r = LOC_REQS.find((x) => x.id === req.params.id);
  return r && g.sees(r.key) ? ok(reqOut(r, req.user!, g.all)) : notFound();
});

/**
 * The approval's own routes (POST /workflow/instances/:id/approve|reject) for a temporary site or a
 * work location request: the leave mock answers them and passes on an id that is not a leave approval.
 */
export function decideLocationRequest(user: string, wid: string, approve: boolean, reason?: string | null) {
  const site = decideTemp(user, wid, approve, reason);
  if (site) return site;
  const r = LOC_REQS.find((x) => x.wid === wid);
  if (!r || r.status !== "submitted") return null;
  if (!canDecideReq(r, user)) return fail(403, "PERMISSION_DENIED", "You are not an approver for this stage");
  if (!approve && !String(reason ?? "").trim()) return invalid({ reason: ["is required"] });
  r.trail.push({ stage: r.stage!, decision: approve ? "approve" : "reject", by: user, reason: String(reason ?? "").trim() || null, at: new Date().toISOString() });
  if (approve && r.stage === "line_manager") {
    r.stage = "operations_people";
    return ok({ workflow_instance_id: wid, state: "pending", stage_name: STAGE_NAME.operations_people });
  }
  Object.assign(r, { status: approve ? "approved" : "rejected", stage: null, decided_at: new Date().toISOString() });
  return ok({ workflow_instance_id: wid, state: r.status, stage_name: null });
}

/** The sites and requests whose stage waits on this login, for GET /workflow/mine (Home's Need You). */
export function locationRequestsWaitingOn(user: string): ApprovalWaiting[] {
  return tempWaitingOn(user).concat(LOC_REQS.filter((r) => canDecideReq(r, user)).map((r) => {
    const who = byKey(r.key)!;
    const entered = r.trail[r.trail.length - 1]?.at ?? r.requested_at;
    const due = new Date(Date.parse(entered) + 48 * 3600_000).toISOString();
    return {
      workflow_instance_id: r.wid, definition_key: "attendance.location_request", definition_name: "Work Location Request", module_key: "people",
      entity_type: "attendance_location_request", entity_id: r.id, subject_employee_id: who.employee_id, subject_name: who.display_name,
      current_stage: r.stage!, stage_name: STAGE_NAME[r.stage!], context: { days: reqOut(r, user, false).days }, stage_entered_at: entered, stage_due_at: due,
      overdue: Date.parse(due) < Date.now(), opened_by: null, opened_by_name: who.display_name, opened_at: r.requested_at, link: `/people?tab=worksites&request=${r.id}`,
    };
  }));
}

const STAGES: Stage[] = ["line_manager", "operations_people"];
const STATE_OF: Record<MockReq["status"], ApprovalInstance["state"]> = { submitted: "pending", approved: "approved", rejected: "rejected", cancelled: "cancelled" };

/**
 * GET /workflow/instances/:id for a temporary site or a work location request: its route and its
 * moves, read by the people it is about and by those who decide it; the leave mock passes on any other id.
 */
export function locationRequestInstance(user: string, wid: string): ApprovalInstance | null {
  if (TEMP.some((x) => x.wid === wid)) return tempInstance(user, wid);
  const r = LOC_REQS.find((x) => x.wid === wid);
  const view = SIGN_INS[user]?.view;
  if (!r || !(r.key === user || lineManagerOf(r.key) === user || view === "operations" || view === "ceo")) return null;
  const who = byKey(r.key)!;
  const last = r.trail[r.trail.length - 1]?.at ?? r.requested_at;
  const stateOf = (k: Stage): ApprovalInstance["route"][number]["state"] => {
    const move = r.trail.find((t) => t.stage === k);
    if (move) return move.decision === "approve" ? "done" : "stopped";
    if (r.status === "submitted") return r.stage === k ? "now" : "todo";
    return "skipped";
  };
  return {
    workflow_instance_id: r.wid, definition_key: "attendance.location_request", definition_name: "Work Location Request", version: 1, module_key: "people",
    entity_type: "attendance_location_request", entity_id: r.id, subject_employee_id: who.employee_id, subject_name: who.display_name,
    state: STATE_OF[r.status], current_stage: r.stage, stage_name: r.stage ? STAGE_NAME[r.stage] : null,
    context: { days: reqOut(r, user, false).days }, stage_entered_at: last,
    stage_due_at: r.status === "submitted" ? new Date(Date.parse(last) + 48 * 3600_000).toISOString() : null,
    opened_by: null, opened_by_name: who.display_name, opened_at: r.requested_at, completed_at: r.decided_at ?? r.cancelled_at,
    route: STAGES.map((k) => ({
      key: k, name: STAGE_NAME[k], state: stateOf(k),
      approvers: [k === "line_manager" ? { type: "manager_of_subject", value: null, label: "Line Manager" } : { type: "role", value: "operations_people", label: "Operations & People" }],
    })),
    decisions: r.trail.map((t, i) => ({
      workflow_decision_id: sid(`${r.wid}:${i}`), stage_key: t.stage, stage_name: STAGE_NAME[t.stage], actor_id: byKey(t.by)?.employee_id ?? null,
      actor_name: byKey(t.by)?.display_name ?? null, decision: t.decision, reason: t.reason, decided_at: t.at,
    })),
    can_decide: canDecideReq(r, user), can_withdraw: false, can_reassign: false, link: null,
  };
}

/* ------------------------------------------------------------------ *
 * Field assignments made before PR 4 (docs/guides/attendance.md §6.12): read, cancelled and
 * changed, never made
 * ------------------------------------------------------------------ */
type MockSite = { id: string; name: string; address: string | null; latitude: number; longitude: number; radius_m: number };
type MockField = {
  id: string; number: string; name: string; client: string; note: string | null; starts_on: string; ends_on: string;
  status: "active" | "cancelled"; sites: MockSite[]; by: string; assigned_at: string; cancelled_at: string | null; cancel_reason: string | null;
  members: Array<{ key: string; added_at: string; removed_at: string | null; removed_reason: string | null }>;
};
const FIELD: MockField[] = [];
let fieldSeq = 0;
const addField = (f: Omit<MockField, "id" | "number" | "status" | "cancelled_at" | "cancel_reason" | "members"> & { keys: string[] }) => {
  fieldSeq += 1;
  const { keys, ...rest } = f;
  const row: MockField = {
    id: sid(`fa:${fieldSeq}`), number: `FA-${String(fieldSeq).padStart(4, "0")}`, status: "active", cancelled_at: null, cancel_reason: null,
    members: keys.map((key) => ({ key, added_at: f.assigned_at, removed_at: null, removed_reason: null })), ...rest,
  };
  FIELD.unshift(row);
  return row;
};
const site = (n: number, name: string, address: string, latitude: number, longitude: number, radius_m: number): MockSite => ({ id: sid(`fa-site:${fieldSeq + 1}:${n}`), name, address, latitude, longitude, radius_m });
/** Invented assignments for the demonstration: one done, one in progress today, one to come. */
(() => {
  addField({ keys: ["obinna"], name: "Venue Check", client: "Sample Events Ltd", note: null, starts_on: isoDaysAgo(10), ends_on: isoDaysAgo(9), sites: [site(1, "Event Grounds", "1 Example Parade, Ikeja", 6.6018, 3.3515, 300)], by: "ifeoma", assigned_at: at(14, "10:00") });
  addField({ keys: ["adedotun", "grace"], name: "Stand Build", client: "Example Expo", note: "Badges at the gate", starts_on: isoDaysAgo(1), ends_on: isoDaysAhead(1), sites: [site(1, "Expo Hall", "9 Example Road, Victoria Island", 6.4281, 3.4219, 300)], by: "cynthia", assigned_at: at(3, "15:30") });
  addField({ keys: ["bashir"], name: "Partner Visits", client: "Placeholder Bank", note: null, starts_on: isoDaysAhead(5), ends_on: isoDaysAhead(6), sites: [site(1, "Partner Office", "4 Sample Close, Ikoyi", 6.4549, 3.4246, 200), site(2, "Branch Office", "22 Fixture Avenue, Yaba", 6.5095, 3.3711, 200)], by: "cynthia", assigned_at: at(1, "09:10") });
})();

const onIt = (f: MockField, key: string) => f.members.some((m) => m.key === key && !m.removed_at);
/** The active assignment a person is still on today, if any (one a day). */
const fieldOn = (key: string, date: string) => FIELD.find((f) => f.status === "active" && f.starts_on <= date && f.ends_on >= date && onIt(f, key)) ?? null;
const stateOf = (f: MockField): FieldAssignment["state"] => {
  const today = todayIso();
  return f.status === "cancelled" ? "cancelled" : f.starts_on > today ? "upcoming" : f.ends_on < today ? "done" : "in_progress";
};
/** May this login change it: people approve over everyone still on it, active, not over, and not on it themselves. */
const canChange = (f: MockField, user: string) => {
  const g = peopleGrant(user, "approve");
  const active = f.members.filter((m) => !m.removed_at);
  return g.may && f.status === "active" && f.ends_on >= todayIso() && !onIt(f, user) && active.every((m) => g.sees(m.key));
};
const fieldOut = (f: MockField, user: string): FieldAssignment => ({
  field_assignment_id: f.id, number: f.number, name: f.name, client: f.client, note: f.note, starts_on: f.starts_on, ends_on: f.ends_on,
  days: Math.round((Date.parse(`${f.ends_on}T12:00:00Z`) - Date.parse(`${f.starts_on}T12:00:00Z`)) / 86400_000) + 1,
  status: f.status, state: stateOf(f),
  sites: f.sites.map((x, i) => ({ field_site_id: x.id, position: i + 1, name: x.name, address: x.address, latitude: x.latitude, longitude: x.longitude, radius_m: x.radius_m })),
  members: [...f.members].sort((a, b) => Number(!!a.removed_at) - Number(!!b.removed_at)).map((m) => ({ employee: person(byKey(m.key)!), added_at: m.added_at, removed_at: m.removed_at, removed_reason: m.removed_reason })),
  people: f.members.filter((m) => !m.removed_at).length,
  assigned_by_name: byKey(f.by)?.display_name ?? null, assigned_at: f.assigned_at, cancelled_at: f.cancelled_at, cancel_reason: f.cancel_reason,
  can_change: canChange(f, user),
});
const ORDER: Record<FieldAssignment["state"], number> = { in_progress: 0, upcoming: 1, done: 2, cancelled: 3 };
const currentFirst = (a: FieldAssignment, b: FieldAssignment) => ORDER[a.state] - ORDER[b.state] || (a.state === "done" ? b.ends_on.localeCompare(a.ends_on) : a.starts_on.localeCompare(b.starts_on));
const fieldPage = (rows: FieldAssignment[], req: Parameters<typeof paged>[1]) =>
  paged(rows, req, {
    search: (r) => [r.number, r.name, r.client, ...r.members.map((m) => m.employee.display_name)],
    filters: { state: (r, v) => r.state === v, employee_id: (r, v) => r.members.some((m) => m.employee.employee_id === v) },
    sort: { current: currentFirst, starts_on: (a, b) => a.starts_on.localeCompare(b.starts_on) },
  });

route("GET /api/v1/attendance/me/field-assignments", (req) =>
  fieldPage(FIELD.filter((f) => f.members.some((m) => m.key === req.user)).map((f) => fieldOut(f, req.user!)), req),
);
route("GET /api/v1/attendance/me/field-assignments/:id", (req) => {
  const f = FIELD.find((x) => x.id === req.params.id && x.members.some((m) => m.key === req.user));
  return f ? ok(fieldOut(f, req.user!)) : notFound();
});
route("GET /api/v1/attendance/field-assignments", (req) => {
  const g = peopleGrant(req.user!, "view");
  if (!g.may) return forbidden();
  return fieldPage(FIELD.filter((f) => f.members.some((m) => g.sees(m.key))).map((f) => fieldOut(f, req.user!)), req);
});
route("GET /api/v1/attendance/field-assignments/:id", (req) => {
  const g = peopleGrant(req.user!, "view");
  if (!g.may) return forbidden();
  const f = FIELD.find((x) => x.id === req.params.id);
  return f && f.members.some((m) => g.sees(m.key)) ? ok(fieldOut(f, req.user!)) : notFound();
});
/** Cancel or take someone off: the same grant over everyone still on it, while it runs. */
function changeable(user: string, id: string) {
  const g = peopleGrant(user, "approve");
  const f = FIELD.find((x) => x.id === id);
  if (!g.may) return { error: fail(403, "PERMISSION_DENIED", "You need people approve to change it.") };
  if (!f || !f.members.some((m) => g.sees(m.key))) return { error: notFound() };
  if (onIt(f, user)) return { error: fail(403, "OWN_RECORD", "Someone else changes your field assignment") };
  if (!f.members.filter((m) => !m.removed_at).every((m) => g.sees(m.key))) return { error: fail(403, "FORBIDDEN", "Someone on it is outside your team") };
  if (f.status !== "active") return { error: fail(409, "ASSIGNMENT_CANCELLED", "This field assignment is cancelled") };
  if (f.ends_on < todayIso()) return { error: fail(409, "ASSIGNMENT_ENDED", "This field assignment has ended") };
  return { f };
}
route("POST /api/v1/attendance/field-assignments/:id/cancel", (req) => {
  const reason = String((req.body as { reason?: string }).reason ?? "").trim();
  if (reason.length < 10) return invalid({ reason: ["At least 10 characters"] });
  const { f, error } = changeable(req.user!, req.params.id);
  if (!f) return error;
  Object.assign(f, { status: "cancelled", cancelled_at: new Date().toISOString(), cancel_reason: reason });
  return ok(fieldOut(f, req.user!));
});
route("POST /api/v1/attendance/field-assignments/:id/remove", (req) => {
  const b = req.body as { employee_id: string; reason?: string };
  const reason = String(b.reason ?? "").trim();
  if (reason.length < 10) return invalid({ reason: ["At least 10 characters"] });
  const { f, error } = changeable(req.user!, req.params.id);
  if (!f) return error;
  const m = f.members.find((x) => byKey(x.key)?.employee_id === b.employee_id && !x.removed_at);
  if (!m) return fail(409, "NOT_ON_ASSIGNMENT", "That person is not on this field assignment", { employee_id: ["Not on it"] });
  if (f.members.filter((x) => !x.removed_at).length === 1) return fail(409, "ASSIGNMENT_LAST_PERSON", "Cancel the field assignment instead");
  Object.assign(m, { removed_at: new Date().toISOString(), removed_reason: reason });
  return ok(fieldOut(f, req.user!));
});

/* ------------------------------------------------------------------ *
 * Temporary sites (docs/guides/attendance.md §6.11) and check-ins (§6.12)
 * ------------------------------------------------------------------ */
type Purpose = TemporarySite["purpose"];
type MockLoc = { id: string; position: number; name: string | null; address: string; latitude: number; longitude: number; radius_m: number; timezone: string };
type MockTemp = {
  id: string; number: string; purpose: Purpose; name: string; description: string; starts_on: string; ends_on: string; status: TemporarySite["status"];
  hours: TemporarySite["hours"]; starts_at: string | null; ends_at: string | null;
  locations: MockLoc[]; by: string; submitted_at: string; wid: string | null; approved_at: string | null; approved_by: string | null;
  cancelled_at: string | null; cancel_reason: string | null;
  members: Array<{ key: string; added_at: string; removed_at: string | null; removed_reason: string | null }>;
  /** The moves on its approval, oldest first. */
  trail: Array<{ decision: "approve" | "reject" | "cancel"; by: string; reason: string | null; at: string }>;
};
const TEMP: MockTemp[] = [];
let tempSeq = 0;
const spanOf = (from: string, to: string) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86400_000) + 1;
const loc = (n: number, name: string | null, address: string, latitude: number, longitude: number, radius_m: number, timezone = TZ): MockLoc => ({
  id: sid(`ts-loc:${tempSeq + 1}:${n}`), position: n, name, address, latitude, longitude, radius_m, timezone,
});
const addTemp = (t: Omit<MockTemp, "id" | "number" | "wid" | "members" | "trail" | "approved_at" | "approved_by" | "cancelled_at" | "cancel_reason" | "hours" | "starts_at" | "ends_at"> & Partial<MockTemp> & { keys: string[] }) => {
  tempSeq += 1;
  const { keys, ...rest } = t;
  const row: MockTemp = {
    id: sid(`ts:${tempSeq}`), number: `TS-${String(tempSeq).padStart(4, "0")}`, wid: t.by === "cynthia" && t.status === "approved" ? null : sid(`ts-flow:${tempSeq}`),
    approved_at: null, approved_by: null, cancelled_at: null, cancel_reason: null, trail: [], hours: "usual", starts_at: null, ends_at: null,
    members: keys.map((key) => ({ key, added_at: t.submitted_at, removed_at: null, removed_reason: null })), ...rest,
  };
  TEMP.unshift(row);
  return row;
};
/** Invented sites for the demonstration: one in progress, one waiting abroad, one to come, a Temporary Home, one done. */
(() => {
  addTemp({ keys: ["bashir", "tolu"], by: "bashir", purpose: "training_attending", name: "Partner Training Week", description: "Three days of partner training at their offices; the out-of-station letter is on file.", starts_on: isoDaysAgo(1), ends_on: isoDaysAhead(1), status: "approved", submitted_at: at(5, "10:00"), approved_at: at(4, "09:30"), approved_by: "cynthia", trail: [{ decision: "approve", by: "cynthia", reason: null, at: at(4, "09:30") }], locations: [loc(1, "Hall", "Partner Hall, 1 Example Road, Victoria Island", 6.4281, 3.4219, 200), loc(2, "Annex", "Partner Annex, 9 Example Road, Victoria Island", 6.43, 3.425, 150)] });
  addTemp({ keys: ["kemi", "obinna"], by: "kemi", purpose: "out_of_station", name: "Gaborone Partner Training", description: "A week training a partner's team in Gaborone; travel and the out-of-station letter are approved.", starts_on: isoDaysAhead(10), ends_on: isoDaysAhead(14), status: "submitted", submitted_at: at(1, "14:10"), locations: [loc(1, "Venue", "Main Mall, Sample Plot 1, Gaborone", -24.6545, 25.9086, 300, "Africa/Gaborone")] });
  addTemp({ keys: ["grace"], by: "cynthia", purpose: "exhibition", name: "Expo Stand", description: "Staffing our stand at the trade fair for the whole of the second day.", starts_on: isoDaysAhead(6), ends_on: isoDaysAhead(6), status: "approved", submitted_at: at(2, "11:00"), approved_at: at(2, "11:00"), approved_by: "cynthia", locations: [loc(1, null, "Expo Hall, 3 Fixture Road, Ikoyi", 6.4549, 3.4246, 250)] });
  addTemp({ keys: ["tolu"], by: "tolu", purpose: "temporary_home", name: "Ibadan Stay", description: "Working from my family's home in Ibadan while my flat is repaired after the flood.", starts_on: isoDaysAhead(20), ends_on: isoDaysAhead(27), status: "submitted", submitted_at: at(0, "08:20"), locations: [loc(1, null, "Flat 2, 7 Sample Street, Bodija, Ibadan", 7.4352, 3.9133, 150)] });
  addTemp({ keys: ["seyi"], by: "seyi", purpose: "client_visit", name: "Client Setup", description: "Setting up a client's new office network over two days on their site.", starts_on: isoDaysAgo(12), ends_on: isoDaysAgo(11), status: "approved", submitted_at: at(16, "09:00"), approved_at: at(15, "10:00"), approved_by: "cynthia", trail: [{ decision: "approve", by: "cynthia", reason: null, at: at(15, "10:00") }], locations: [loc(1, null, "Client office, 22 Placeholder Avenue, Lekki", 6.4474, 3.4723, 200)] });
})();

const onSite = (t: MockTemp, key: string) => t.members.some((m) => m.key === key && !m.removed_at);
/** The approved site a person is still on, covering a day (one a day). */
const siteOn = (key: string, date: string) => TEMP.find((t) => t.status === "approved" && t.starts_on <= date && t.ends_on >= date && onSite(t, key)) ?? null;
siteShift = (key, date) => {
  const t = siteOn(key, date);
  return t && t.hours === "site" && t.starts_at && t.ends_at ? { working_day: true, starts_at: t.starts_at, ends_at: t.ends_at, grace_minutes: GRACE, off_reason: null } : null;
};
/** An address's name on the punch and the check-in: Temporary Home, the site's name, or the site and the address's label. */
const nameOfAddress = (t: MockTemp, l: MockLoc) => (t.purpose === "temporary_home" ? "Temporary Home" : t.locations.length === 1 ? t.name : `${t.name}, ${l.name ?? `Address ${l.position}`}`);
const tempState = (t: MockTemp): TemporarySite["state"] => {
  const today = todayIso();
  if (t.status !== "approved") return t.status;
  return t.starts_on > today ? "upcoming" : t.ends_on < today ? "done" : "in_progress";
};
/** Operations & People decide it, never someone on it; as on the API, the CEO is not waited on. */
const canDecideTemp = (t: MockTemp, user: string) => t.status === "submitted" && !onSite(t, user) && SIGN_INS[user]?.view === "operations";
const canChangeTemp = (t: MockTemp, user: string) => {
  const g = peopleGrant(user, "approve");
  return g.may && g.all && ["submitted", "approved"].includes(t.status) && t.ends_on >= todayIso() && !onSite(t, user);
};
const tempOut = (t: MockTemp, user: string): TemporarySite => {
  const home = t.purpose === "temporary_home";
  const g = peopleGrant(user, "view");
  // A Temporary Home's line and point: its people, its submitter and scope all only.
  const place = !home || t.members.some((m) => m.key === user) || t.by === user || g.all;
  return {
    temporary_site_id: t.id, number: t.number, purpose: t.purpose, name: t.name, description: t.description, starts_on: t.starts_on, ends_on: t.ends_on,
    days: spanOf(t.starts_on, t.ends_on), hours: t.hours, starts_at: t.starts_at, ends_at: t.ends_at, status: t.status, state: tempState(t),
    locations: t.locations.map((l) => ({
      temporary_site_location_id: l.id, position: l.position, name: l.name, radius_m: l.radius_m, timezone: l.timezone,
      address: home ? null : l.address, latitude: home ? null : l.latitude, longitude: home ? null : l.longitude,
      home_address: home && place ? l.address : null, home_latitude: home && place ? l.latitude : null, home_longitude: home && place ? l.longitude : null,
    })),
    members: [...t.members].sort((a, b) => Number(!!a.removed_at) - Number(!!b.removed_at)).map((m) => ({ employee: person(byKey(m.key)!), added_at: m.added_at, removed_at: m.removed_at, removed_reason: m.removed_reason })),
    people: t.members.filter((m) => !m.removed_at).length,
    submitted_by_name: byKey(t.by)?.display_name ?? null, submitted_at: t.submitted_at, workflow_instance_id: t.wid,
    waiting_on: t.status === "submitted" ? "Operations & People" : null,
    approved_at: t.approved_at, approved_by_name: t.approved_by ? (byKey(t.approved_by)?.display_name ?? null) : null,
    cancelled_at: t.cancelled_at, cancel_reason: t.cancel_reason,
    can_decide: canDecideTemp(t, user), can_change: canChangeTemp(t, user), can_withdraw: t.status === "submitted" && t.by === user,
  };
};
const TEMP_ORDER: Record<TemporarySite["state"], number> = { submitted: 0, in_progress: 1, upcoming: 2, done: 3, rejected: 4, withdrawn: 4, cancelled: 4 };
const tempFirst = (a: TemporarySite, b: TemporarySite) => TEMP_ORDER[a.state] - TEMP_ORDER[b.state] || (TEMP_ORDER[a.state] >= 3 ? b.ends_on.localeCompare(a.ends_on) : a.starts_on.localeCompare(b.starts_on));
const tempPage = (rows: TemporarySite[], req: Parameters<typeof paged>[1]) =>
  paged(rows, req, {
    search: (r) => [r.number, r.name, ...r.members.map((m) => m.employee.display_name)],
    filters: { state: (r, v) => r.state === v, status: (r, v) => r.status === v, purpose: (r, v) => r.purpose === v, employee_id: (r, v) => r.members.some((m) => m.employee.employee_id === v) },
    sort: { current: tempFirst, starts_on: (a, b) => a.starts_on.localeCompare(b.starts_on) },
  });

/** The day's site on the clock panel: no coordinates. */
function todaySite(key: string, date: string): AttendanceToday["temporary_site"] {
  const t = siteOn(key, date);
  return t && { temporary_site_id: t.id, number: t.number, name: t.name, purpose: t.purpose, locations: t.locations.map((l) => ({ temporary_site_location_id: l.id, position: l.position, name: l.name, address: t.purpose === "temporary_home" ? null : l.address, radius_m: l.radius_m })) };
}

/** Add Work Site and Add Temporary Site: the contract's checks the API makes, then the site. */
function createTemp(user: string, body: unknown, direct: boolean) {
  const b = body as {
    hours?: TemporarySite["hours"]; starts_at?: string | null; ends_at?: string | null;
    purpose?: Purpose; name?: string; description?: string; starts_on?: string; ends_on?: string; locations?: Array<{ address?: unknown; name?: string; radius_m?: number }>; employee_ids?: string[];
  };
  const fields: Record<string, string[]> = {};
  const hours = b.hours ?? "usual";
  if (hours === "site") {
    if (!b.starts_at) fields.starts_at = ["Pick a start"];
    if (!b.ends_at) fields.ends_at = ["Pick an end"];
    else if (b.starts_at && b.ends_at <= b.starts_at) fields.ends_at = ["Ends before it starts"];
  } else if (b.starts_at || b.ends_at) fields.starts_at = ["Only for Site Hours"];
  if (!b.purpose) fields.purpose = ["Choose one"];
  if (!b.name || b.name.trim().length < 3) fields.name = ["At least 3 characters"];
  if (!b.description || b.description.trim().length < 30) fields.description = ["At least 30 characters"];
  if (!b.starts_on) fields.starts_on = ["Required"];
  if (!b.ends_on) fields.ends_on = ["Required"];
  if (b.starts_on && b.ends_on && b.ends_on < b.starts_on) fields.ends_on = ["Ends before it starts"];
  else if (b.starts_on && b.ends_on && spanOf(b.starts_on, b.ends_on) > 90) fields.ends_on = ["At most 90 days"];
  if (!b.employee_ids?.length) fields.employee_ids = ["Pick someone"];
  const locs = b.locations ?? [];
  if (!locs.length) fields.locations = ["Add an address"];
  if (b.purpose === "temporary_home" && locs.length > 1) fields.locations = ["One address only"];
  // Each address is picked or pinned (F27): never typed, and it must carry a point.
  const picked = locs.map((x) => (x.address === undefined ? null : placeOf(x.address)));
  locs.forEach((x, i) => {
    if (!picked[i] || picked[i]!.view.lat === null) fields[`locations.${i}.address`] = ["Pick an address"];
    if (typeof x.radius_m !== "number" || x.radius_m < 150 || x.radius_m > 500) fields[`locations.${i}.radius_m`] = [typeof x.radius_m === "number" && x.radius_m > 500 ? "At most 500 m" : "At least 150 m"];
  });
  if (Object.keys(fields).length) return invalid(fields);
  const today = todayIso();
  if (b.starts_on! < today) return fail(422, "SITE_IN_THE_PAST", "Pick a first day from today on", { starts_on: ["Already past"] });
  if (b.starts_on! > isoDaysAhead(90)) return fail(422, "SITE_TOO_FAR", "Pick a first day within 90 days", { starts_on: ["Too far ahead"] });
  const keys = b.employee_ids!.map((id) => byId(id)?.user_key).filter((k): k is string => !!k);
  if (direct && keys.includes(user)) return fail(403, "OWN_RECORD", "Add a site you are on from Home, for approval", { employee_ids: ["Not yourself"] });
  const clash = TEMP.find((t) => ["submitted", "approved"].includes(t.status) && t.starts_on <= b.ends_on! && t.ends_on >= b.starts_on! && keys.some((k) => onSite(t, k)));
  if (clash) {
    const who = keys.find((k) => onSite(clash, k))!;
    return fail(409, "SITE_OVERLAPS", `${byKey(who)!.display_name} is already on ${clash.number}`, { starts_on: ["Overlaps another site"] });
  }
  const now = new Date().toISOString();
  const t = addTemp({
    keys, by: user, purpose: b.purpose!, name: b.name!.trim(), description: b.description!.trim(), starts_on: b.starts_on!, ends_on: b.ends_on!,
    hours, starts_at: hours === "site" ? b.starts_at! : null, ends_at: hours === "site" ? b.ends_at! : null,
    status: direct ? "approved" : "submitted", submitted_at: now, ...(direct && { approved_at: now, approved_by: user }),
    locations: locs.map((x, i) => loc(i + 1, x.name?.trim() || null, picked[i]!.line, picked[i]!.view.lat!, picked[i]!.view.lon!, x.radius_m!)),
  });
  if (direct) t.wid = null;
  return created(tempOut(t, user));
}

route("GET /api/v1/attendance/me/temporary-sites", (req) => tempPage(TEMP.filter((t) => t.by === req.user || t.members.some((m) => m.key === req.user)).map((t) => tempOut(t, req.user!)), req));
route("GET /api/v1/attendance/me/temporary-sites/:id", (req) => {
  const t = TEMP.find((x) => x.id === req.params.id && (x.by === req.user || x.members.some((m) => m.key === req.user)));
  return t ? ok(tempOut(t, req.user!)) : notFound();
});
route("POST /api/v1/attendance/me/temporary-sites", (req) => createTemp(req.user!, req.body, false));
route("POST /api/v1/attendance/me/temporary-sites/:id/withdraw", (req) => {
  const t = TEMP.find((x) => x.id === req.params.id && x.by === req.user);
  if (!t) return notFound();
  const reason = String((req.body as { reason?: string }).reason ?? "").trim();
  if (reason.length < 10) return invalid({ reason: ["At least 10 characters"] });
  if (t.status !== "submitted") return fail(409, "SITE_NOT_WAITING", "This site no longer waits on approval");
  t.trail.push({ decision: "cancel", by: req.user!, reason, at: new Date().toISOString() });
  Object.assign(t, { status: "withdrawn", cancelled_at: new Date().toISOString(), cancel_reason: reason });
  return ok(tempOut(t, req.user!));
});
route("GET /api/v1/attendance/temporary-sites", (req) => {
  const g = peopleGrant(req.user!, "view");
  if (!g.may) return forbidden();
  return tempPage(TEMP.filter((t) => t.members.some((m) => g.sees(m.key))).map((t) => tempOut(t, req.user!)), req);
});
route("GET /api/v1/attendance/temporary-sites/:id", (req) => {
  const g = peopleGrant(req.user!, "view");
  if (!g.may) return forbidden();
  const t = TEMP.find((x) => x.id === req.params.id);
  return t && t.members.some((m) => g.sees(m.key)) ? ok(tempOut(t, req.user!)) : notFound();
});
route("POST /api/v1/attendance/temporary-sites", (req) => {
  const g = peopleGrant(req.user!, "approve");
  if (!g.may) return fail(403, "PERMISSION_DENIED", "You need people approve to add a temporary site.");
  if (!g.all) return fail(403, "FORBIDDEN", "Only People with access to everyone add one directly");
  return createTemp(req.user!, req.body, true);
});
/** Cancel or take someone off: People with access to everyone, never on it, until its last day. */
function changeableTemp(user: string, id: string) {
  const g = peopleGrant(user, "approve");
  const t = TEMP.find((x) => x.id === id);
  if (!g.may || !g.all) return { error: fail(403, "FORBIDDEN", "Only People with access to everyone change temporary sites") };
  if (!t) return { error: notFound() };
  if (onSite(t, user)) return { error: fail(403, "OWN_RECORD", "Someone else changes a site you are on") };
  if (t.ends_on < todayIso()) return { error: fail(409, "SITE_ENDED", "This temporary site has ended") };
  return { t };
}
route("POST /api/v1/attendance/temporary-sites/:id/cancel", (req) => {
  const reason = String((req.body as { reason?: string }).reason ?? "").trim();
  if (reason.length < 10) return invalid({ reason: ["At least 10 characters"] });
  const { t, error } = changeableTemp(req.user!, req.params.id);
  if (!t) return error;
  if (t.status !== "approved") return fail(409, "SITE_NOT_APPROVED", "Only an approved site is cancelled; decide a waiting one");
  Object.assign(t, { status: "cancelled", cancelled_at: new Date().toISOString(), cancel_reason: reason });
  return ok(tempOut(t, req.user!));
});
route("POST /api/v1/attendance/temporary-sites/:id/remove", (req) => {
  const b = req.body as { employee_id: string; reason?: string };
  const reason = String(b.reason ?? "").trim();
  if (reason.length < 10) return invalid({ reason: ["At least 10 characters"] });
  const { t, error } = changeableTemp(req.user!, req.params.id);
  if (!t) return error;
  if (!["submitted", "approved"].includes(t.status)) return fail(409, "SITE_CLOSED", "This temporary site is closed");
  const m = t.members.find((x) => byKey(x.key)?.employee_id === b.employee_id && !x.removed_at);
  if (!m) return fail(409, "NOT_ON_SITE", "That person is not on this site", { employee_id: ["Not on it"] });
  if (t.members.filter((x) => !x.removed_at).length === 1) return fail(409, "SITE_LAST_PERSON", "Cancel the site instead");
  Object.assign(m, { removed_at: new Date().toISOString(), removed_reason: reason });
  return ok(tempOut(t, req.user!));
});

/** A site's approval, decided by the approval's own routes (organisation's mock passes the id on). */
function decideTemp(user: string, wid: string, approve: boolean, reason?: string | null) {
  const t = TEMP.find((x) => x.wid === wid);
  if (!t || t.status !== "submitted") return null;
  if (!canDecideTemp(t, user)) return fail(403, "PERMISSION_DENIED", "You are not an approver for this stage");
  if (!approve && !String(reason ?? "").trim()) return invalid({ reason: ["is required"] });
  const now = new Date().toISOString();
  t.trail.push({ decision: approve ? "approve" : "reject", by: user, reason: String(reason ?? "").trim() || null, at: now });
  Object.assign(t, approve ? { status: "approved", approved_at: now, approved_by: user } : { status: "rejected", cancelled_at: now, cancel_reason: String(reason).trim() });
  return ok({ workflow_instance_id: wid, state: t.status, stage_name: null });
}
const tempWaitingOn = (user: string): ApprovalWaiting[] =>
  TEMP.filter((t) => canDecideTemp(t, user)).map((t) => {
    const who = byKey(t.by)!;
    const due = new Date(Date.parse(t.submitted_at) + 48 * 3600_000).toISOString();
    return {
      workflow_instance_id: t.wid!, definition_key: "attendance.temporary_site", definition_name: "Temporary Site", module_key: "people",
      entity_type: "attendance_temporary_site", entity_id: t.id, subject_employee_id: who.employee_id, subject_name: who.display_name,
      current_stage: "operations_people", stage_name: "Operations & People", context: { days: spanOf(t.starts_on, t.ends_on) }, stage_entered_at: t.submitted_at, stage_due_at: due,
      overdue: Date.parse(due) < Date.now(), opened_by: null, opened_by_name: who.display_name, opened_at: t.submitted_at, link: `/people?tab=worksites&site=${t.id}`,
    };
  });
const TEMP_FLOW: Record<MockTemp["status"], ApprovalInstance["state"]> = { submitted: "pending", approved: "approved", rejected: "rejected", withdrawn: "cancelled", cancelled: "approved" };
function tempInstance(user: string, wid: string): ApprovalInstance | null {
  const t = TEMP.find((x) => x.wid === wid);
  const view = SIGN_INS[user]?.view;
  if (!t || !(t.by === user || t.members.some((m) => m.key === user) || view === "operations" || view === "ceo")) return null;
  const who = byKey(t.by)!;
  const move = t.trail[0];
  const done = t.trail[t.trail.length - 1]?.at ?? null;
  return {
    workflow_instance_id: wid, definition_key: "attendance.temporary_site", definition_name: "Temporary Site", version: 1, module_key: "people",
    entity_type: "attendance_temporary_site", entity_id: t.id, subject_employee_id: who.employee_id, subject_name: who.display_name,
    state: TEMP_FLOW[t.status], current_stage: t.status === "submitted" ? "operations_people" : null, stage_name: t.status === "submitted" ? "Operations & People" : null,
    context: { days: spanOf(t.starts_on, t.ends_on) }, stage_entered_at: t.submitted_at,
    stage_due_at: t.status === "submitted" ? new Date(Date.parse(t.submitted_at) + 48 * 3600_000).toISOString() : null,
    opened_by: null, opened_by_name: who.display_name, opened_at: t.submitted_at, completed_at: t.status === "submitted" ? null : done,
    route: [{
      key: "operations_people", name: "Operations & People",
      state: t.status === "submitted" ? "now" : move?.decision === "approve" ? "done" : move ? "stopped" : "skipped",
      approvers: [{ type: "role", value: "operations_people", label: "Operations & People" }],
    }],
    decisions: t.trail.map((x, i) => ({
      workflow_decision_id: sid(`${wid}:${i}`), stage_key: "operations_people", stage_name: "Operations & People", actor_id: byKey(x.by)?.employee_id ?? null,
      actor_name: byKey(x.by)?.display_name ?? null, decision: x.decision, reason: x.reason, decided_at: x.at,
    })),
    can_decide: canDecideTemp(t, user), can_withdraw: false, can_reassign: false, link: null,
  };
}

type MockCheckIn = CheckIn & { key: string; idem: string; body: string };
const CHECK_INS: MockCheckIn[] = [];
const checkInOut = ({ key: _k, idem: _i, body: _b, ...c }: MockCheckIn): CheckIn => c;
const checkInsOn = (key: string, date: string) => CHECK_INS.filter((c) => c.key === key && c.work_date === date).sort((a, b) => a.occurred_at.localeCompare(b.occurred_at)).map(checkInOut);

/** POST /attendance/check-ins, as the API makes one: matched to the nearest address, never the shift. */
route("POST /api/v1/attendance/check-ins", (req) => {
  const key = req.user!;
  const idem = req.idempotency_key;
  if (!idem) return fail(428, "IDEMPOTENCY_KEY_REQUIRED", "Send an Idempotency-Key with every check-in.");
  const reply = (c: MockCheckIn, replayed: boolean): ReturnType<typeof ok> => {
    const out = checkInOut(c);
    const message = !out.flagged ? `Checked in at ${out.location_name}.` : out.verdict === "outside" ? `Checked in ${Math.round(out.distance_m ?? 0)} m from ${out.location_name}. People will review it.` : `Checked in at ${out.location_name}. People will review it: your location could not be confirmed.`;
    const res: CheckInResult = { check_in: out, message, replayed, today: todayOf(key) };
    return replayed ? ok(res) : created(res);
  };
  const seen = CHECK_INS.find((c) => c.key === key && c.idem === idem);
  if (seen) return reply(seen, true);
  const b = req.body as { device_at: string; latitude: number | null; longitude: number | null; accuracy_m: number | null; location_error?: string | null };
  if ((b.latitude === null) !== (b.longitude === null)) return invalid({ longitude: ["Send both coordinates or neither"] });
  const date = todayIso();
  const t = siteOn(key, date);
  if (!t) return fail(422, "NO_TEMPORARY_SITE", "Check In is for a temporary site's day.");
  const evs = activeOn(key, date);
  if (!evs.some((e) => e.event_type === "clock_in") || evs.some((e) => e.event_type === "clock_out")) return fail(409, "NOT_CLOCKED_IN", "Clock in before you check in.");
  if (CHECK_INS.filter((c) => c.key === key && c.work_date === date).length >= 20) return fail(422, "CHECK_IN_LIMIT", "At most 20 check-ins a day.");
  const point = b.latitude !== null && b.longitude !== null ? { latitude: b.latitude, longitude: b.longitude } : null;
  const nearest = point
    ? [...t.locations].sort((x, y) => {
        const dx = distanceM(point, x), dy = distanceM(point, y);
        return Number(dy <= y.radius_m) - Number(dx <= x.radius_m) || (dx - x.radius_m) - (dy - y.radius_m);
      })[0]
    : t.locations[0];
  const recent = CHECK_INS.find((c) => c.key === key && c.temporary_site_location_id === nearest.id && Date.now() - Date.parse(c.occurred_at) < 5 * 60_000);
  if (recent) return reply(recent, true);
  const distance = point ? distanceM(point, nearest) : null;
  const poor = point && b.accuracy_m !== null && b.accuracy_m > POLICY_MODES.max_accuracy_m;
  const verdict: CheckIn["verdict"] = !point || poor ? "unverified" : distance! <= nearest.radius_m ? "inside" : "outside";
  const home = t.purpose === "temporary_home";
  const mode = (home ? inForceRules().home_geofence_mode : inForceRules().site_geofence_mode) as string;
  const flag: ExceptionType | null = mode === "off" || verdict === "inside" ? null : verdict === "outside" ? (home ? "outside_home" : "outside_worksite") : "location_unverified";
  const now = new Date().toISOString();
  const c: MockCheckIn = {
    key, idem, body: JSON.stringify(b),
    attendance_check_in_id: sid(`check-in:${key}:${now}`), work_date: date, occurred_at: now, temporary_site_location_id: nearest.id, position: nearest.position,
    location_name: nearest.name ?? (home ? "Temporary Home" : t.locations.length === 1 ? t.name : `Address ${nearest.position}`), address: home ? null : nearest.address, home_address: home ? nearest.address : null,
    distance_m: distance, accuracy_m: point ? b.accuracy_m : null, verdict, location_reason: !point ? b.location_error || "no_location" : poor ? "poor_accuracy" : null, flagged: !!flag,
  };
  CHECK_INS.push(c);
  if (flag) {
    const x = addException(key, date, flag, null, `Check-in: ${verdict === "outside" ? `${distance} m from ${c.location_name}, radius ${nearest.radius_m} m` : "location not confirmed"}`);
    x.attendance_check_in_id = c.attendance_check_in_id;
    x.created_at = now;
    recompute(key, date);
  }
  return reply(c, false);
});
route("GET /api/v1/attendance/me/check-ins", (req) => {
  const date = String(req.query.date ?? todayIso());
  return paged(checkInsOn(req.user!, date), req);
});
route("GET /api/v1/attendance/check-ins", (req) => {
  const g = peopleGrant(req.user!, "view");
  if (!g.may) return forbidden();
  const p = byId(String(req.query.employee_id ?? ""));
  if (!p || !g.sees(p.user_key)) return notFound();
  return paged(checkInsOn(p.user_key, String(req.query.date ?? todayIso())), req);
});

/* ------------------------------------------------------------------ *
 * A person's week: People · Employees, the record's Attendance tab (§6.13)
 * ------------------------------------------------------------------ */
const versionOut = (x: MockSchedule | null): ScheduleVersion | null =>
  x && { attendance_schedule_id: x.id, office_days: [...x.office_days].sort((a, b) => a - b), effective_from: x.effective_from, reason: x.reason, set_by_name: byKey(x.set_by)?.display_name ?? null, set_at: x.set_at };
function scheduleOut(key: string, viewer: string): WorkSchedule {
  const p = byKey(key)!;
  const site = siteOf(key);
  const hybrid = p.work_pattern === "hybrid";
  const edit = peopleGrant(viewer, "edit");
  return {
    employee: person(p),
    work_pattern: p.work_pattern,
    worksite: site ? { worksite_id: site.worksite_id, name: site.name, radius_m: site.radius_m } : null,
    home_state: needsHome(key) ? (homeOf(key, "approved") ? "approved" : homeOf(key, "pending") ? "pending" : "none") : null,
    week: weekOf(key),
    current: hybrid ? versionOut(scheduleOn(key, todayIso())) : null,
    next: hybrid ? versionOut(scheduleAfter(key, todayIso())) : null,
    can_edit: hybrid && key !== viewer && edit.may && edit.sees(key),
  };
}
route("GET /api/v1/attendance/schedules/:employee_id", (req) => {
  const g = peopleGrant(req.user!, "view");
  if (!g.may) return forbidden();
  const p = byId(req.params.employee_id);
  return p && g.sees(p.user_key) ? ok(scheduleOut(p.user_key, req.user!)) : notFound();
});
route("POST /api/v1/attendance/schedules/:employee_id", (req) => {
  const g = peopleGrant(req.user!, "edit");
  if (!g.may) return forbidden();
  const p = byId(req.params.employee_id);
  if (!p || !g.sees(p.user_key)) return notFound();
  const b = req.body as { office_days?: number[]; effective_from?: string; reason?: string };
  const days = Array.isArray(b.office_days) ? b.office_days : [];
  const fields: Record<string, string[]> = {};
  if (!days.length) fields.office_days = ["Pick an office day"];
  else if (new Set(days).size !== days.length) fields.office_days = ["Each day once"];
  if (!b.effective_from) fields.effective_from = ["Pick the first day"];
  if (String(b.reason ?? "").trim().length < 10) fields.reason = ["At least 10 characters"];
  if (Object.keys(fields).length) return invalid(fields);
  if (p.user_key === req.user) return fail(403, "OWN_RECORD", "Someone else sets your work schedule");
  if (p.work_pattern !== "hybrid") return fail(422, "SCHEDULE_NOT_NEEDED", "Only hybrid staff have a weekly schedule.", { office_days: ["Not hybrid"] });
  if (b.effective_from! < todayIso()) return fail(422, "SCHEDULE_IN_THE_PAST", "Pick a first day from today on", { effective_from: ["Already past"] });
  if (b.effective_from! > isoDaysAhead(90)) return fail(422, "SCHEDULE_TOO_FAR", "Pick a first day within 90 days", { effective_from: ["Too far ahead"] });
  if (days.some((d) => !WORKING.includes(d))) return fail(422, "SCHEDULE_DAY_NOT_WORKED", "Pick office days the organisation works", { office_days: ["Not a working day"] });
  if (WORKING.every((d) => days.includes(d))) return fail(422, "SCHEDULE_NO_HOME_DAY", "Every working day at the office is on site: change the work pattern", { office_days: ["Leave a home day"] });
  const same = SCHEDULES.find((x) => x.key === p.user_key && x.effective_from === b.effective_from);
  const row = { office_days: [...days].sort((a, c) => a - c), reason: String(b.reason).trim(), set_by: req.user!, set_at: new Date().toISOString() };
  if (same) Object.assign(same, row);
  else SCHEDULES.push({ id: sid(`schedule:${p.user_key}:${b.effective_from}`), key: p.user_key, effective_from: b.effective_from!, ...row });
  return created(scheduleOut(p.user_key, req.user!));
});

/** The rules a punch today is judged by: the Attendance policy's version in force (policies' mock). */
const inForceRules = attendanceRulesInForce;

/** Read by Payroll's mock. The pay rules join the policy with payroll (M6): no deduction tiers are on yet. */
export const deductionTiersOn = () => false;
