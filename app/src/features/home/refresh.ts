import type { HomeOverview } from "@mycity/contract/contract.gen.ts";

/** The cards that count other people's attendance today. */
const ATTENDANCE_CARDS = new Set(["attendance_today", "team_present", "team_on_site", "team_remote", "team_flags"]);

/** Does this Overview show anyone's attendance but the reader's? */
export function showsOthers(o: HomeOverview | undefined): boolean {
  if (!o) return false;
  return (
    o.clocked_in !== null ||
    o.chart?.kind === "attendance_days" ||
    o.donut?.kind === "on_time" ||
    o.cards.some((c) => ATTENDANCE_CARDS.has(c.key))
  );
}

/**
 * Does an `attendance.updated` push call for reading the Overview again? Only someone else's
 * punch, and only on an Overview that shows other people's attendance: the reader's own punch is
 * seen through their clock state.
 */
export function reloadsFor(payload: unknown, overview: HomeOverview | undefined, employeeId: string | null): boolean {
  const who = (payload as { employee_id?: string } | null)?.employee_id ?? null;
  return showsOthers(overview) && !(who !== null && who === employeeId);
}
