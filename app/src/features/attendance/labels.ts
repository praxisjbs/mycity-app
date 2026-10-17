import type { AttendanceDay, DeviceStatus, ExceptionType, GeofenceVerdict, PunchState, RegisterStatus } from "@mycity/contract/contract.gen.ts";

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
  location_unverified: "Location Unverified",
  unknown_device: "Unknown Device",
  suspicious_timestamp: "Device Time Ahead",
  missing_clock_out: "Missing Clock-Out",
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

export const DEVICE_STATUS_HELP = "New: seen on a punch, not registered. Registered: one of your three. Removed: taken off, and it can be registered again.";

export const PATTERN: Record<string, string> = { on_site: "On Site", hybrid: "Hybrid", remote: "Remote" };

/** The last six months, newest first, as the month picker offers them. */
export function recentMonths(today: string, count = 6): string[] {
  const [y, m] = today.slice(0, 7).split("-").map(Number);
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  });
}
