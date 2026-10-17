import type { AuditEntry } from "@mycity/contract/contract.gen.ts";
import { at, sid } from "../core";

/** The module key a mock module names by its label. */
const MODULE_KEY: Record<string, string> = {
  "Queries & Sanctions": "queries",
  "Praxis AI": "praxis_ai",
  Attendance: "people",
  People: "people",
  Expenses: "expenses",
  Performance: "performance",
  Partnerships: "partnerships",
  Payroll: "payroll",
  Settings: "settings",
};

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "record";

/** One entry in the contract's shape, from the words a mock module uses. */
function entry(i: number, when: string, actor: string, action: string, entity: string, before: string | null, after: string | null, reason: string | null, module: string): AuditEntry {
  const [type, ...rest] = entity.split(" · ");
  const moduleKey = MODULE_KEY[module] ?? "settings";
  return {
    audit_ledger_id: sid(`audit:${i}`),
    occurred_at: when,
    actor_user_id: actor === "System rule" ? null : sid(`user:${slug(actor)}`),
    actor_name: actor === "System rule" ? null : actor,
    actor_email: actor === "System rule" ? null : `${slug(actor).split("_")[0]}@mycityapp.io`,
    actor_ip: null,
    action: `${moduleKey}.${slug(action)}`,
    summary: action,
    module_key: moduleKey,
    entity_type: rest.length ? slug(type) : "record",
    entity_id: rest.length ? rest.join(" · ") : entity,
    link: null,
    before: before === null ? null : { value: before },
    after: after === null && reason === null ? null : { ...(after === null ? {} : { value: after }), ...(reason === null ? {} : { reason }) },
    changed_fields: before !== null && after !== null ? ["value"] : [],
    is_sensitive: /bank|role|session|security/i.test(action),
    masked: [],
  };
}

/** Append only: entries are added, never edited (the backend has no UPDATE path to this table). */
export const AUDIT: AuditEntry[] = (
  [
    [0, "09:41", "System rule", "Query raised", "Query · QRY-0014", null, "Awaiting response", "Repeated lateness, 3 in 30 days", "Queries & Sanctions"],
    [0, "09:12", "Ngozi Eze", "Praxis AI question", "Partnerships", null, null, "Read partnership ×5, interaction log ×15", "Praxis AI"],
    [0, "08:58", "Seyi Balogun", "Punch accepted with warning", "Attendance · Seyi Balogun", null, "Unenrolled device", "Device sent for review", "Attendance"],
    [0, "08:47", "Cynthia Osakunih", "Expense approved", "Expense · EXP-0120", "Operations", "Requisition", null, "Expenses"],
    [1, "16:40", "Ifeoma Chukwu", "Target approved", "Target · Content monthly", "Awaiting CEO", "Approved", "Dispatched to 5 staff", "Performance"],
    [1, "15:30", "Bashir Lawal", "Stage changed", "Partner · Lonart-DS", "Intro meeting held", "Proposal sent", null, "Partnerships"],
    [2, "11:20", "Cynthia Osakunih", "Payroll run submitted", "Payroll run · October", "Computed", "Submitted", "For CEO approval", "Payroll"],
    [3, "10:05", "Cynthia Osakunih", "Bank details changed", "Employee · Hauwa Yusuf", "•••• 8812", "•••• 0425", "Requested by the employee", "People"],
    [5, "14:00", "Cynthia Osakunih", "Role changed", "User · Damilola Eke", "Staff", "Operations", "Covering payroll in November", "Settings"],
    [6, "11:20", "Cynthia Osakunih", "Policy published", "Attendance policy · v5", "v4", "v5", "Saturday half day added", "Attendance"],
  ] as const
).map((r, i) => entry(i, at(r[0], r[1]), r[2], r[3], r[4], r[5], r[6], r[7], r[8]));

/** Record a change the way emit() does, newest first. */
export function audit(actor: string, action: string, entity: string, before: string | null, after: string | null, reason: string | null, module: string) {
  AUDIT.unshift(entry(Date.now() + AUDIT.length, new Date().toISOString(), actor, action, entity, before, after, reason, module));
}
