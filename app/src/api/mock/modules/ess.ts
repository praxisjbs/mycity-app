import type { RawResponse } from "../../client";
import { accepted, at, invalid, isoDaysAgo, isoDaysAhead, ok, paged, route, sid, fail } from "../core";
import type { EmployeeHistoryEntry, EssProfile } from "@mycity/contract/contract.gen.ts";
import { byKey, managerOf } from "../data/people";
import { weekOf } from "./attendance";


/* My Profile, in the contract's shapes (packages/contract/schemas/ess.js EssProfile). */
const AREA = ["Lekki Phase 1", "Surulere", "Gbagada", "Yaba", "Ikeja", "Ajah", "Magodo"];
const PATCHES = new Map<string, Record<string, string>>();
const HISTORY = new Map<string, EmployeeHistoryEntry[]>();

/** A person's phone as My Profile shows it; the signature mock reads and changes the same one. */
export const phoneOf = (key: string): string | null => PATCHES.get(key)?.phone ?? byKey(key)?.phone ?? null;
export function setPhone(key: string, phone: string) {
  PATCHES.set(key, { ...(PATCHES.get(key) ?? {}), phone });
}
/** The organisation's week with where this person works each day (the attendance mock's week). */
const weekFor = (key: string): EssProfile["working_week"] =>
  weekOf(key).map(({ weekday, place }) => ({
    weekday,
    is_working_day: weekday <= 6,
    starts_at: weekday <= 6 ? "09:00" : null,
    ends_at: weekday === 6 ? "15:00" : weekday <= 5 ? "17:00" : null,
    place,
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
    photo_url: null,
    working_week: weekFor(key),
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

const ARCH = (user: string) =>
  user === "bashir" || user === "cynthia"
    ? [
        ["Repeated lateness, August", "Ifeoma Chukwu", 47, "Submitted the next day", "neutral", "Upheld, sanction"],
        ["Missing Clock-Out", "System", 122, "Submitted the same day", "ok", "Closed, no action"],
        ["Missing clock-outs, March 2025", "System", 562, "Submitted the next day", "neutral", "Upheld, sanction"],
      ]
    : [["Missing Clock-Out", "System", 122, "Submitted the same day", "ok", "Closed, no action"]];
const OPEN = new Map<string, Array<{ query_id: string; number: string; subject: string; raised_by: string; date: string; response: string | null; outcome: { tone: "warn"; text: string }; respond_by: string | null }>>([
  ["bashir", [{ query_id: sid("q:bashir:open"), number: "QRY-0014", subject: "3 late arrivals in 30 days", raised_by: "System rule", date: isoDaysAgo(7), response: null, outcome: { tone: "warn", text: "Awaiting your response" }, respond_by: at(-1, "09:41") }]],
]);
route("GET /api/v1/ess/queries/summary", (req) => {
  const arch = ARCH(req.user!);
  const sanc = SANC(req.user!);
  return ok({ open: (OPEN.get(req.user!) ?? []).filter((q) => !q.response).length, archived: arch.length, archived_note: `${arch.filter((a) => a[5] === "Closed, no action").length} closed with no action`, sanctions: sanc.length, last_sanction: sanc[0]?.date ?? null });
});
route("GET /api/v1/ess/queries", (req) => {
  const view = req.query.view;
  const q = Object.fromEntries(Object.entries(req.query).filter(([k]) => k !== "view"));
  if (view === "open") return paged(OPEN.get(req.user!) ?? [], { ...req, query: q });
  return paged(ARCH(req.user!).map((a, i) => ({ query_id: sid(`qa:${req.user}:${i}`), number: `QRY-${String(11 - i * 3).padStart(4, "0")}`, subject: a[0] as string, raised_by: a[1] as string, date: isoDaysAgo(a[2] as number), response: a[3] as string, outcome: { tone: a[4] as "ok", text: a[5] as string }, respond_by: null })), { ...req, query: q });
});
route("POST /api/v1/ess/queries/:id/response", (req) => {
  const list = OPEN.get(req.user!) ?? [];
  const qq = list.find((x) => x.query_id === req.params.id);
  if (!qq) return fail(404, "NOT_FOUND", "That query is not open.");
  const r = String(req.body.response ?? "");
  if (r.trim().length < 20) return invalid({ response: ["Write at least 20 characters"] });
  qq.response = r;
  qq.outcome = { tone: "warn", text: "Response sent, awaiting decision" };
  return ok(qq);
});
const SANC = (user: string) =>
  user === "bashir" || user === "cynthia"
    ? [
        { sanction_id: sid(`s:${user}:1`), kind: "Warning", reason: "Repeated lateness, August", date: isoDaysAgo(46), deduction: "12500.00", status: { tone: "neutral" as const, text: "Served" } },
        { sanction_id: sid(`s:${user}:2`), kind: "Caution", reason: "Missing clock-outs, March 2025", date: isoDaysAgo(560), deduction: "7500.00", status: { tone: "neutral" as const, text: "Served" } },
      ]
    : [];
route("GET /api/v1/ess/sanctions", (req) => paged(SANC(req.user!), req));

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


/*
 * Download My Data: once a day for a person, the CEO's Download Their Data counted with their own
 * (docs/guides/ess.md §6). Nothing is built in the mock; the answer says where it would go.
 */
const DATA_ASKED = new Map<string, string>();
export function askDataExport(employeeId: string, email: string, own: boolean): RawResponse {
  const today = new Date().toISOString().slice(0, 10);
  if (DATA_ASKED.get(employeeId) === today)
    return fail(429, "DATA_EXPORT_LIMIT", own ? "You already asked for your data today. Try again tomorrow." : "A copy of this person's data was already asked for today. Try again tomorrow.");
  DATA_ASKED.set(employeeId, today);
  return { ...accepted(), body: { queued: true, email } };
}

route("POST /api/v1/ess/profile/export", (req) => {
  const me = byKey(req.user!)!;
  return askDataExport(me.employee_id, me.work_email, true);
});
