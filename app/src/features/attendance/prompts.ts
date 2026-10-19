import type { AttendanceToday } from "@mycity/contract/contract.gen.ts";

/**
 * When the clock panel opens by itself (docs/guides/attendance.md §6.14): at the shift's start for
 * someone not yet clocked in, and at its end for someone still clocked in. The times are the
 * workplace's, read on the server's clock (`server_time`), never this device's.
 *
 *   start   once a day on each device: when the app is open at the start or comes to the front
 *           within START_WINDOW_MIN after it, and not once the panel has been shown since the
 *           start (noteShown: the sign-in prompt, Clock In)
 *   close   at the end, and again after each Remind Me while the person is still clocked in. An
 *           unanswered prompt that is closed comes back after the shortest choice
 *
 * The marks are kept in this device's storage per person and workplace day, and in memory for a
 * browser that refuses storage.
 */

export type PromptKind = "start" | "close";

/** How long after the start the start prompt may still open. */
export const START_WINDOW_MIN = 60;
/** Remind Me's choices, in minutes; the first is also what closing the prompt means. */
export const REMIND_CHOICES = [15, 30, 60] as const;

const START_KEY = "mc-clock-start";
const CLOSE_KEY = "mc-clock-close";
const memory = new Map<string, string>();

function read(key: string): string | null {
  try {
    const v = localStorage.getItem(key);
    if (v !== null) return v;
  } catch {
    /* storage refused (a private window): the mark in memory holds while the page is open */
  }
  return memory.get(key) ?? null;
}

function write(key: string, value: string) {
  memory.set(key, value);
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage refused: kept in memory */
  }
}

/** "HH:MM" → minutes since midnight; null for anything else. */
const minutesOf = (hhmm: string | null) => {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm ?? "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/** The workplace's date and minutes since its midnight at an instant. */
export function workplaceNow(now: Date, timeZone: string): { date: string; minutes: number } {
  // @date-format:parts read by name below, never shown to a person
  const f = new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const p: Record<string, string> = {};
  for (const part of f.formatToParts(now)) p[part.type] = part.value;
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: (Number(p.hour) % 24) * 60 + Number(p.minute) };
}

/** Minutes from the start of `date` at the workplace to now: tomorrow's 08:00 is 1920. */
function minutesInto(date: string, now: Date, timeZone: string): number {
  const w = workplaceNow(now, timeZone);
  const days = Math.round((Date.parse(`${w.date}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 86_400_000);
  return days * 1440 + w.minutes;
}

/** Which prompt the clock's state and the time call for, before the marks are read. Pure. */
export function promptDue(t: AttendanceToday, now: Date): PromptKind | null {
  if (!t.shift.working_day) return null;
  const start = minutesOf(t.shift.starts_at);
  const at = minutesInto(t.date, now, t.timezone);
  if (t.state === "not_clocked_in" && start !== null) return at >= start && at < start + START_WINDOW_MIN ? "start" : null;
  if (t.state === "clocked_in") {
    let end = minutesOf(t.shift.ends_at);
    if (end === null) return null;
    // An end at or before the start is the next morning's (a late shift).
    if (start !== null && end <= start) end += 1440;
    return at >= end ? "close" : null;
  }
  return null;
}

const markOf = (userId: string, date: string) => `${userId}|${date}`;

/** True the first time the start prompt is due for this person and day on this device. */
export function claimStart(userId: string, date: string): boolean {
  const mark = markOf(userId, date);
  if (read(START_KEY) === mark) return false;
  write(START_KEY, mark);
  return true;
}

/** The panel was shown: once past the start, the start prompt has nothing left to do today. */
export function noteShown(userId: string, t: AttendanceToday, now: Date): void {
  if (t.state === "not_clocked_in" && promptDue(t, now) === "start") write(START_KEY, markOf(userId, t.date));
}

/** Whether the closing prompt may open now: not while a reminder it set is still running. */
export function closeDue(userId: string, date: string, now: Date): boolean {
  const raw = read(CLOSE_KEY);
  if (!raw) return true;
  const [user, day, until] = raw.split("|");
  if (`${user}|${day}` !== markOf(userId, date)) return true;
  return now.getTime() >= Number(until);
}

/** Bring the closing prompt back in `minutes`; opening it sets the shortest choice until answered. */
export function remindIn(userId: string, date: string, now: Date, minutes: number = REMIND_CHOICES[0]): void {
  write(CLOSE_KEY, `${markOf(userId, date)}|${now.getTime() + minutes * 60_000}`);
}
