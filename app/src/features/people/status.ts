import type { EmployeeRow, Employee360, LoginState } from "@/api/types/organisation";
import type { Tone } from "@/api/types/common";

/**
 * The pills People read on the register and on a record, from the facts the API sends
 * (docs/guides/foundation.md §10.1). Wiring, not components: the pill itself is
 * `Pill` from @mycity/ui.
 */

export type Status = { tone: Tone; text: string };

/**
 * Employment status. The record carries where someone stands (`status`) and the two
 * probation dates; On Probation is what People need to see at a glance, so it is drawn
 * from them rather than stored twice.
 */
export function employmentStatus(e: Pick<EmployeeRow, "status" | "confirmation_due_on" | "confirmed_on">): Status {
  if (e.status === "archived") return { tone: "neutral", text: "Archived" };
  if (e.status === "suspended") return { tone: "err", text: "Suspended" };
  if (e.status === "left") return { tone: "neutral", text: "Left" };
  if (e.confirmation_due_on && !e.confirmed_on) return { tone: "warn", text: "On Probation" };
  return { tone: "ok", text: "Active" };
}

/** Whether someone can sign in, as Settings · Users shows it. */
export function loginStatus(state: LoginState): Status {
  if (state === "active") return { tone: "ok", text: "Active" };
  if (state === "invited") return { tone: "info", text: "Invited" };
  if (state === "suspended") return { tone: "err", text: "Suspended" };
  if (state === "left") return { tone: "neutral", text: "Left" };
  return { tone: "neutral", text: "No Login" };
}

/** The one help term on the register (tier 2): what Invited means. */
export const INVITED_HELP = "Invited means the person has a login but has not chosen a password yet. Send Invite on their record emails them a link to choose one.";

/** Who may see a masked field, for the Restricted help term on a record. */
export const RESTRICTED_HELP =
  "Pay, bank details and personal details are open to Operations and People, Management, Implementation and the CEO. Everyone sees their own record in full.";

const WORK_PATTERNS: Record<EmployeeRow["work_pattern"], string> = {
  on_site: "On Site",
  hybrid: "Hybrid",
  remote: "Remote",
};

const EMPLOYMENT_TYPES: Record<EmployeeRow["employment_type"], string> = {
  full_time: "Full Time",
  part_time: "Part Time",
  contractor: "Contractor",
  consultant: "Consultant",
  intern: "Intern",
};

export const workPattern = (key: EmployeeRow["work_pattern"]) => WORK_PATTERNS[key];
export const employmentType = (key: EmployeeRow["employment_type"]) => EMPLOYMENT_TYPES[key];

/** The line under a name on a card or a chip: who they report to. */
export function reportsTo(e: Pick<Employee360, "line_manager">): string | null {
  return e.line_manager ? e.line_manager.display_name : null;
}
