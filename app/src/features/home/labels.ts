import type { HomeActivityItem, HomeRosterStatus } from "@mycity/contract/contract.gen.ts";

/**
 * The words Home shows for the API's values (docs/guides/home.md §10.1). The server sends
 * keys and figures; the screen words them here, once, so the Overview and Team say the
 * same thing and the screen gates read every word.
 */
type Tone = "ok" | "warn" | "err" | "info" | "neutral";

/** A person's status today on the shared attendance roster. */
export const ROSTER_STATUS: Record<HomeRosterStatus, { tone: Tone; text: string }> = {
  on_site: { tone: "ok", text: "On Site" },
  remote: { tone: "ok", text: "Remote" },
  late: { tone: "warn", text: "Late" },
  not_in: { tone: "neutral", text: "Not In" },
  on_leave: { tone: "info", text: "On Leave" },
  absent: { tone: "err", text: "Absent" },
};

const someone = (name: string | null) => name ?? "Someone";

/**
 * Activity Today, one line per event the server's allow-list sends
 * (src/modules/dashboard/dashboard.activity.js). A key with no line here is not shown:
 * the server may list an event before the screen has words for it, and a raw key never
 * reaches a person.
 */
const ACTIVITY: Record<string, (e: HomeActivityItem) => string> = {
  "employee.created": (e) => `${someone(e.subject)} joined`,
  "leave_request.approved": (e) => `Leave approved for ${someone(e.subject)}`,
  "leave_request.recorded": (e) => `Leave recorded for ${someone(e.subject)}`,
  "attendance.review_required": (e) => `Punch needs review for ${someone(e.subject)}`,
  "recognition.posted": (e) => (e.subject ? `${someone(e.actor_name)} recognised ${e.subject}` : `${someone(e.actor_name)} posted a recognition`),
  "celebration.posted": (e) => `Celebrating ${someone(e.subject)}`,
};

/** The line Activity Today shows for an event, or null for a key it has no words for. */
export function activityLine(e: HomeActivityItem): string | null {
  const line = ACTIVITY[e.event_key];
  return line ? line(e) : null;
}
