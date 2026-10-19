import { at, invalid, isoDaysAhead, ok, paged, route, sid } from "../core";
import type { EmployeeHistoryEntry, EssProfile } from "@mycity/contract/contract.gen.ts";
import { byKey, managerOf } from "../data/people";

const fmt = (iso: string) => iso.split("-").reverse().join("/");

/* My Profile, in the contract's shapes (packages/contract/schemas/ess.js EssProfile). */
const AREA = ["Lekki Phase 1", "Surulere", "Gbagada", "Yaba", "Ikeja", "Ajah", "Magodo"];
const PATCHES = new Map<string, Record<string, string>>();
const HISTORY = new Map<string, EmployeeHistoryEntry[]>();

/** A person's phone as My Profile shows it; the signature mock reads and changes the same one. */
export const phoneOf = (key: string): string | null => PATCHES.get(key)?.phone ?? byKey(key)?.phone ?? null;
export function setPhone(key: string, phone: string) {
  PATCHES.set(key, { ...(PATCHES.get(key) ?? {}), phone });
}
const WEEK: EssProfile["working_week"] = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
  weekday,
  is_working_day: weekday <= 6,
  starts_at: weekday <= 6 ? "09:00" : null,
  ends_at: weekday === 6 ? "15:00" : weekday <= 5 ? "17:00" : null,
}));
const TYPES: EssProfile["employment_type"][] = ["full_time", "part_time", "contractor", "consultant"];

function profile(key: string): EssProfile {
  const p = byKey(key)!;
  const m = managerOf(p);
  const x = PATCHES.get(key) ?? {};
  const idx = p.employee_id.charCodeAt(0) % AREA.length;
  const [first, ...rest] = p.display_name.split(" ");
  return {
    employee_id: p.employee_id,
    staff_number: `MCA-${String(idx + 10).padStart(4, "0")}`,
    display_name: p.display_name,
    first_name: first,
    last_name: rest.join(" "),
    job_title: p.job_title,
    department: p.department,
    status: p.status === "suspended" ? "suspended" : "active",
    confirmed: p.status !== "probation",
    employment_type: TYPES.includes(p.employment_type as EssProfile["employment_type"]) ? (p.employment_type as EssProfile["employment_type"]) : "full_time",
    work_pattern: p.work_pattern,
    start_date: p.start_date,
    line_manager: m ? { employee_id: m.employee_id, org_seat_id: null, display_name: m.display_name, job_title: m.job_title, vacant: false } : null,
    work_email: p.work_email,
    phone: x.phone ?? p.phone,
    date_of_birth: p.date_of_birth,
    home_address: x.home_address ?? `${AREA[idx]}, Lagos`,
    next_of_kin_name: x.next_of_kin_name ?? p.next_of_kin,
    next_of_kin_relationship: x.next_of_kin_relationship ?? "Sibling",
    next_of_kin_phone: x.next_of_kin_phone ?? "+2348065542210",
    bank_name: x.bank_name ?? p.bank_name,
    account_last4: (x.account_number ?? p.account_last4).slice(-4),
    working_week: WEEK,
  };
}

function historyOf(key: string): EmployeeHistoryEntry[] {
  const p = byKey(key)!;
  return [
    ...(HISTORY.get(key) ?? []),
    { event_id: sid(`hist:${key}:bank`), occurred_at: at(61, "10:00"), action: "employee.updated", actor_name: p.display_name, changed_fields: ["bank_name", "account_number"], summary: "Record changed: bank_name, account_number" },
    { event_id: sid(`hist:${key}:created`), occurred_at: `${p.start_date}T09:00:00.000Z`, action: "employee.created", actor_name: "Operations & People", changed_fields: [], summary: "Record created" },
  ];
}

route("GET /api/v1/ess/profile", (req) => ok(profile(req.user!)));
route("GET /api/v1/ess/profile/history", (req) => paged(historyOf(req.user!), req));
route("PATCH /api/v1/ess/profile", (req) => {
  const b = Object.fromEntries(Object.entries(req.body as Record<string, string>).filter(([, v]) => v !== undefined && v !== ""));
  const f: Record<string, string[]> = {};
  if (b.phone !== undefined && !/^(\+?234|0)\d{10}$/.test(b.phone.replace(/[\s\-().]/g, ""))) f.phone = ["must be a Nigerian phone number"];
  if (b.next_of_kin_phone !== undefined && !/^(\+?234|0)\d{10}$/.test(b.next_of_kin_phone.replace(/[\s\-().]/g, ""))) f.next_of_kin_phone = ["must be a Nigerian phone number"];
  if (b.account_number !== undefined && !/^\d{10}$/.test(b.account_number)) f.account_number = ["must be a 10-digit NUBAN"];
  if (Object.keys(f).length) return invalid(f);
  if (!Object.keys(b).length) return invalid({ phone: ["change at least one field"] });
  PATCHES.set(req.user!, { ...(PATCHES.get(req.user!) ?? {}), ...b });
  const fields = Object.keys(b);
  HISTORY.set(req.user!, [
    { event_id: sid(`hist:${req.user}:${Date.now()}`), occurred_at: new Date().toISOString(), action: "employee.updated", actor_name: byKey(req.user)!.display_name, changed_fields: fields, summary: `Record changed: ${fields.join(", ")}` },
    ...(HISTORY.get(req.user!) ?? []),
  ]);
  return ok(profile(req.user!));
});

route("GET /api/v1/ess/performance", (req) => {
  const p = byKey(req.user)!;
  const m = managerOf(p);
  return ok({
    period: new Date().toLocaleDateString("en-GB", { month: "long", year: "numeric" }),
    set_by: m?.display_name ?? "The board",
    stats: [{ label: "KPI Score", value: "71%" }, { label: "On Track", value: "2 of 4" }, { label: "Weight Assigned", value: "100%" }, { label: "Last Review", value: "4.0 · Q3" }, { label: "Next Cycle", value: `Opens ${fmt(isoDaysAhead(6)).slice(0, 5)}` }],
    kpis: [{ label: "Partnership MOUs", pct: 75, value: "3 of 4" }, { label: "Staff Onboarded", pct: 100, value: "2 of 2", emphasis: "brand" as const }, { label: "Expense Turnaround", pct: 60, value: "3.1 days" }, { label: "Policy Refresh", pct: 40, value: "2 of 5" }],
    chain: [
      { title: "ORG-2026-03 · Scale to 12 cities", level: "Organisational · set by the CEO", top: true },
      { title: "Operational readiness for 4 new cities", level: "Annual · set by management" },
      { title: "Reduce approval turnaround to 2 days", level: "Monthly · set by management" },
      { title: `${p.department} efficiency, Q4`, level: `Departmental · set by ${m?.display_name ?? "management"}` },
      { title: "Expense turnaround, 3.1 days", level: "Your KPI · 60% complete", mine: true },
    ],
    reviews: [["Q3 2026", "4.2", "4.0", "Approved", "ok", "Closed"], ["Q2 2026", "3.9", "4.1", "Approved", "ok", "Closed"], ["Q1 2026", "4.0", "3.9", "Approved", "ok", "Closed"], ["Q4 2026", null, null, null, "warn", `Opens ${fmt(isoDaysAhead(6)).slice(0, 5)}`]].map((r, i) => ({
      review_id: sid(`rev:${req.user}:${i}`), cycle: r[0] as string, self: r[1], manager: r[2], second: r[3], status: { tone: r[4] as "ok", text: r[5] as string },
      manager_comment: r[1] ? "Strong quarter on partnerships. Turnaround still above the 2 day target." : null,
    })),
  });
});

/* My Queries is answered by the queries mock (modules/queries.ts), from the same queries People see. */

/**
 * My Documents on the mock: the Vault list the contract describes, a document
 * that is held and one People have asked for and is still Missing. Uploading
 * is multipart, which the mock cannot carry, so it says so instead.
 */
const DOCS = new Map<string, Array<{
  row_key: string;
  document_id: string | null;
  document_request_id: string | null;
  name: string;
  status: "signed" | "verified" | "expiring" | "awaiting_verification" | "missing";
  uploaded_at: string | null;
  expires_on: string | null;
  number: string | null;
  mime: string | null;
  bytes: number | null;
  version: number | null;
}>>();

const docsOf = (user: string) => {
  if (!DOCS.has(user)) {
    const p = byKey(user)!;
    const doc = (n: number, name: string, status: "signed" | "verified" | "expiring" | "awaiting_verification", when: string | null, expires: string | null, ref: string | null) => ({
      row_key: `doc:${sid(`d:${user}:${n}`)}`,
      document_id: sid(`d:${user}:${n}`),
      document_request_id: null,
      name,
      status,
      uploaded_at: when,
      expires_on: expires,
      number: ref,
      mime: "application/pdf",
      bytes: 184320,
      version: 1,
    });
    DOCS.set(user, [
      doc(1, "Employment contract", "signed", at(400, "09:00"), null, "CON-0004"),
      doc(2, "Data privacy acknowledgement", "signed", at(400, "09:05"), null, null),
      doc(3, "NDPA training certificate", "expiring", at(276, "14:20"), isoDaysAhead(47), null),
      {
        row_key: `req:${sid(`r:${user}:1`)}`,
        document_id: null,
        document_request_id: sid(`r:${user}:1`),
        name: "Passport photograph",
        status: "missing",
        uploaded_at: null,
        expires_on: null,
        number: null,
        mime: null,
        bytes: null,
        version: null,
      },
      doc(5, "Bank verification number", "verified", p.start_date ? at(300, "11:00") : null, null, null),
    ]);
  }
  return DOCS.get(user)!;
};

route("GET /api/v1/ess/documents", (req) =>
  paged(docsOf(req.user!), req, {
    search: (r) => [r.name],
    filters: { status: (r, v) => r.status === v },
  }),
);

route("GET /api/v1/ess/documents/summary", (req) => {
  const rows = docsOf(req.user!);
  const n = (s: string) => rows.filter((r) => r.status === s).length;
  return ok({
    documents: rows.filter((r) => r.document_id).length,
    signed: n("signed"),
    verified: n("verified"),
    expiring: n("expiring"),
    missing: n("missing"),
  });
});

