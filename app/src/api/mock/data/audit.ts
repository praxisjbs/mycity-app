import type { AuditEntry } from "@/api/types/settings";
import { at, sid } from "../core";

/** Append only: entries are added, never edited (the backend has no UPDATE path to this table). */
export const AUDIT: AuditEntry[] = [
  [0, "09:41", "System rule", "Query raised", "QRY-0014 · Bashir Lawal", null, "Awaiting response", "Repeated lateness, 3 in 30 days", "Queries & Sanctions"],
  [0, "09:12", "Ngozi Eze", "Praxis AI question", "Partnerships", null, null, "Read partnership ×5, interaction log ×15", "Praxis AI"],
  [0, "08:58", "Seyi Balogun", "Punch accepted with warning", "Attendance · Seyi Balogun", null, "Unenrolled device", "Device sent for review", "Attendance"],
  [0, "08:47", "Cynthia Osakunih", "Expense approved", "EXP-0120", "Operations", "Requisition", null, "Expenses"],
  [1, "16:40", "Ifeoma Chukwu", "Target approved", "Content · monthly target", "Awaiting CEO", "Approved", "Dispatched to 5 staff", "Performance"],
  [1, "15:30", "Bashir Lawal", "Stage changed", "Lonart-DS", "Intro meeting held", "Proposal sent", null, "Partnerships"],
  [2, "11:20", "Cynthia Osakunih", "Payroll run submitted", "Payroll run", "Computed", "Submitted", "For CEO approval", "Payroll"],
  [3, "10:05", "Cynthia Osakunih", "Bank details changed", "Employee · Hauwa Yusuf", "•••• 8812", "•••• 0425", "Requested by the employee", "People"],
  [5, "14:00", "Cynthia Osakunih", "Role changed", "User · Damilola Eke", "Staff", "Operations", "Covering payroll in November", "Settings"],
  [6, "11:20", "Cynthia Osakunih", "Policy published", "Attendance policy", "v4", "v5", "Saturday half day added", "Attendance"],
].map((r, i) => ({ audit_id: sid(`audit:${i}`), at: at(r[0] as number, r[1] as string), actor: r[2] as string, action: r[3] as string, entity: r[4] as string, before: r[5] as string | null, after: r[6] as string | null, reason: r[7] as string | null, module: r[8] as string }));

export function audit(actor: string, action: string, entity: string, before: string | null, after: string | null, reason: string | null, module: string) {
  AUDIT.unshift({ audit_id: sid(`audit:${Date.now()}:${AUDIT.length}`), at: new Date().toISOString(), actor, action, entity, before, after, reason, module });
}
