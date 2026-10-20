import type { AttendanceDay, CheckIn, DeviceStatus, ExceptionType, FieldAssignmentState, GeofenceVerdict, HomeStatus, LocationRequestStatus, LocationRequestType, PunchState, RegisterStatus, SchedulePlace, TemporarySitePurpose, TemporarySiteState } from "@mycity/contract/contract.gen.ts";

/**
 * The words and tones the attendance screens show for the API's values (docs/guides/attendance.md
 * §10), in one place so ESS and People say the same thing.
 */
type Tone = "ok" | "warn" | "err" | "info" | "neutral";
type Shown = { tone: Tone; text: string };

export const REGISTER_STATUS: Record<RegisterStatus, Shown> = {
  present: { tone: "ok", text: "Present" },
  late: { tone: "warn", text: "Late" },
  absent: { tone: "err", text: "Absent" },
  leave: { tone: "info", text: "On Leave" },
  not_in: { tone: "neutral", text: "Not In" },
  off: { tone: "neutral", text: "Day Off" },
};

/** Minutes as hours and minutes: 485 is "8h 05m". */
export const hours = (m: number) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;

/** How late: minutes under an hour, hours and minutes after that. */
export const lateBy = (m: number) => (m < 60 ? `${m}m` : hours(m));

/** A day's own status; null is a day with no punch that counts. */
export const dayStatus = (d: Pick<AttendanceDay, "status" | "late_minutes">): Shown =>
  d.status === "late" ? { tone: "warn", text: `Late ${lateBy(d.late_minutes)}` } : d.status ? REGISTER_STATUS[d.status] : { tone: "neutral", text: "Not Counted" };

export const EXCEPTION_TYPE: Record<ExceptionType, string> = {
  outside_worksite: "Outside Worksite",
  outside_home: "Outside Home",
  location_unverified: "Location Unverified",
  unknown_device: "Unknown Device",
  suspicious_timestamp: "Device Time Ahead",
  missing_clock_out: "Missing Clock-Out",
  automatic_clock_out: "Automatic Clock-Out",
};

export const PUNCH_STATE: Record<PunchState, Shown> = {
  accepted: { tone: "ok", text: "Accepted" },
  review: { tone: "warn", text: "Review" },
  rejected: { tone: "err", text: "Not Counted" },
};

export const VERDICT: Record<GeofenceVerdict, string> = {
  inside: "Inside",
  outside: "Outside",
  unverified: "Unverified",
  not_applied: "Not Checked",
};

/** New is a device seen on a punch and not registered (`observed`). */
export const DEVICE_STATUS: Record<DeviceStatus, Shown> = {
  registered: { tone: "ok", text: "Registered" },
  observed: { tone: "warn", text: "New" },
  removed: { tone: "neutral", text: "Removed" },
};

/** A remote employee's home location, as My Attendance and People's Homes show it. */
export const HOME_STATUS: Record<HomeStatus, Shown> = {
  pending: { tone: "warn", text: "Waiting" },
  approved: { tone: "ok", text: "Approved" },
  rejected: { tone: "err", text: "Rejected" },
  superseded: { tone: "neutral", text: "Replaced" },
};

/** A work location request's kind and where it stands, as ESS and People's Requests show them. */
export const REQUEST_TYPE: Record<LocationRequestType, string> = {
  temporary_home: "Temporary Home",
  remote_day: "Remote Day",
  client_visit: "Client Visit",
};
export const REQUEST_STATUS: Record<LocationRequestStatus, Shown> = {
  submitted: { tone: "warn", text: "Waiting" },
  approved: { tone: "ok", text: "Approved" },
  rejected: { tone: "err", text: "Rejected" },
  cancelled: { tone: "neutral", text: "Cancelled" },
};
/** Where a field assignment stands today. */
export const ASSIGNMENT_STATE: Record<FieldAssignmentState, Shown> = {
  in_progress: { tone: "ok", text: "In Progress" },
  upcoming: { tone: "info", text: "Upcoming" },
  done: { tone: "neutral", text: "Done" },
  cancelled: { tone: "neutral", text: "Cancelled" },
};

/** Why people work at a temporary site, in the contract's order (§6.11). */
export const SITE_PURPOSE: Record<TemporarySitePurpose, string> = {
  client_visit: "Client Visit",
  partner_meeting: "Partner Meeting",
  training_delivering: "Training (Delivering)",
  training_attending: "Training (Attending)",
  event: "Event",
  conference: "Conference",
  workshop: "Workshop",
  exhibition: "Exhibition",
  market_activation: "Market Activation",
  field_survey: "Field Survey",
  site_inspection: "Site Inspection",
  media_engagement: "Media Engagement",
  government_visit: "Government Visit",
  out_of_station: "Out-of-Station Assignment",
  coworking_space: "Coworking Space",
  temporary_home: "Temporary Home",
  other: "Other",
};
/** Where a temporary site stands today. */
export const SITE_STATE: Record<TemporarySiteState, Shown> = {
  submitted: { tone: "warn", text: "Awaiting Approval" },
  upcoming: { tone: "info", text: "Upcoming" },
  in_progress: { tone: "ok", text: "In Progress" },
  done: { tone: "neutral", text: "Done" },
  rejected: { tone: "err", text: "Rejected" },
  withdrawn: { tone: "neutral", text: "Withdrawn" },
  cancelled: { tone: "neutral", text: "Cancelled" },
};
/** A check-in against the address it was matched to; flagged ones went to People. */
export const checkInShown = (c: Pick<CheckIn, "flagged" | "verdict">): Shown =>
  c.flagged ? { tone: "warn", text: "Flagged" } : c.verdict === "inside" ? { tone: "ok", text: "Inside" } : { tone: "neutral", text: "Recorded" };

export const REQUEST_TYPE_HELP = "Temporary Home: clock in at another home, within 100 m. Remote Day: work away from the office. Client Visit: work at a client's site.";

export const DEVICE_STATUS_HELP = "New: seen on a punch, not registered. Registered: one of your three. Removed: taken off, and it can be registered again.";

export const PATTERN: Record<string, string> = { on_site: "On Site", hybrid: "Hybrid", remote: "Remote" };

/** Where a person works on a day of their week (§6.13). */
export const PLACE: Record<SchedulePlace, Shown> = {
  office: { tone: "ok", text: "Office" },
  remote: { tone: "info", text: "Remote" },
  off: { tone: "neutral", text: "Off" },
};

/** The weekdays by ISO number, as the week and the schedule name them. */
export const WEEKDAY: Record<number, string> = { 1: "Monday", 2: "Tuesday", 3: "Wednesday", 4: "Thursday", 5: "Friday", 6: "Saturday", 7: "Sunday" };

/** Office days in short: "Mon, Tue, Thu". */
export const officeDaysText = (days: number[]) => [...days].sort((a, b) => a - b).map((d) => WEEKDAY[d].slice(0, 3)).join(", ");

/** The home of someone who works from home on some days, as the record's Attendance tab shows it. */
export const HOME_STATE: Record<"approved" | "pending" | "none", Shown> = {
  approved: { tone: "ok", text: "Approved" },
  pending: { tone: "warn", text: "Waiting" },
  none: { tone: "neutral", text: "Not Set" },
};

/** The last six months, newest first, as the month picker offers them. */
export function recentMonths(today: string, count = 6): string[] {
  const [y, m] = today.slice(0, 7).split("-").map(Number);
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  });
}
