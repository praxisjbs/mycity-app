import type { RawResponse } from "../../client";
import { at, invalid, isoDaysAhead, ok, paged, route, sid, fail } from "../core";
import type { EmployeeHistoryEntry, EssProfile, ExportFile } from "@mycity/contract/contract.gen.ts";
import organisation from "@mycity/contract/schemas/organisation.js";
import { exportFile } from "./shared";
import { byKey, managerOf } from "../data/people";
import { workWeekOf } from "./attendance";
import { pickAnAddress, placeOf, typedPlace, type KeptPlace } from "./maps";

/* My Profile, in the contract's shapes (packages/contract/schemas/ess.js EssProfile). */
const AREA = ["Lekki Phase 1", "Surulere", "Gbagada", "Yaba", "Ikeja", "Ajah", "Magodo"];
const PATCHES = new Map<string, Record<string, string>>();
/** A home address each person picked on My Profile (F27); the roster's are typed before the rule. */
const HOMES = new Map<string, KeptPlace>();
const HISTORY = new Map<string, EmployeeHistoryEntry[]>();

/** A person's phone as My Profile shows it; the signature mock reads and changes the same one. */
export const phoneOf = (key: string): string | null => PATCHES.get(key)?.phone ?? byKey(key)?.phone ?? null;
export function setPhone(key: string, phone: string) {
  PATCHES.set(key, { ...(PATCHES.get(key) ?? {}), phone });
}
/** The person's week as worked today, with their hours and where (the attendance mock's week). */
const weekFor = (key: string): EssProfile["working_week"] =>
  workWeekOf(key).map((d) => ({ weekday: d.weekday, is_working_day: d.working, starts_at: d.starts_at, ends_at: d.ends_at, place: d.working ? d.place! : "off" }));
const TYPES: EssProfile["employment_type"][] = ["full_time", "part_time", "contractor", "consultant"];

function profile(key: string): EssProfile {
  const p = byKey(key)!;
  const m = managerOf(p);
  const x = PATCHES.get(key) ?? {};
  const idx = p.employee_id.charCodeAt(0) % AREA.length;
  const home = HOMES.get(key) ?? typedPlace(`${AREA[idx]}, Lagos`);
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
    home_address: home?.line ?? null,
    home_address_place: home?.view ?? null,
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
    { event_id: sid(`hist:${key}:bank`), occurred_at: at(61, "10:00"), action: "employee.updated", actor_name: p.display_name, changed_fields: ["bank_name", "account_number"], summary: "Record changed: Bank, Account Number" },
    { event_id: sid(`hist:${key}:created`), occurred_at: `${p.start_date}T09:00:00.000Z`, action: "employee.created", actor_name: "Operations & People", changed_fields: [], summary: "Record created" },
  ];
}

route("GET /api/v1/ess/profile", (req) => ok(profile(req.user!)));
route("GET /api/v1/ess/profile/history", (req) => paged(historyOf(req.user!), req));
route("PATCH /api/v1/ess/profile", (req) => {
  const { home_address, ...rest } = req.body as Record<string, unknown>;
  // The home address is picked, never typed (F27); left out, it stays as it is.
  const home = home_address === undefined ? null : placeOf(home_address);
  if (home_address !== undefined && !home) return pickAnAddress("home_address");
  const b = Object.fromEntries(Object.entries(rest as Record<string, string>).filter(([, v]) => v !== undefined && v !== ""));
  const f: Record<string, string[]> = {};
  if (b.phone !== undefined && !/^(\+?234|0)\d{10}$/.test(b.phone.replace(/[\s\-().]/g, ""))) f.phone = ["must be a Nigerian phone number"];
  if (b.next_of_kin_phone !== undefined && !/^(\+?234|0)\d{10}$/.test(b.next_of_kin_phone.replace(/[\s\-().]/g, ""))) f.next_of_kin_phone = ["must be a Nigerian phone number"];
  if (b.account_number !== undefined && !/^\d{10}$/.test(b.account_number)) f.account_number = ["must be a 10-digit NUBAN"];
  if (Object.keys(f).length) return invalid(f);
  if (!Object.keys(b).length && !home) return invalid({ phone: ["change at least one field"] });
  PATCHES.set(req.user!, { ...(PATCHES.get(req.user!) ?? {}), ...b });
  if (home) HOMES.set(req.user!, home);
  const fields = [...Object.keys(b), ...(home ? ["home_address"] : [])];
  HISTORY.set(req.user!, [
    { event_id: sid(`hist:${req.user}:${Date.now()}`), occurred_at: new Date().toISOString(), action: "employee.updated", actor_name: byKey(req.user)!.display_name, changed_fields: fields, summary: `Record changed: ${organisation.employeeFieldNames(fields).join(", ")}` },
    ...(HISTORY.get(req.user!) ?? []),
  ]);
  return ok(profile(req.user!));
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


/*
 * Download My Data: once a day for a person, the CEO's Download Their Data counted with their own
 * (docs/guides/ess.md §6). The same asker pressing again that day gets that day's file again;
 * anyone else that day is refused. The file is an export as any other (shared.ts), with no bytes.
 */
const DATA_ASKED = new Map<string, { day: string; asker: string; file: ExportFile }>();
export function askDataExport(person: { employee_id: string; staff_number: string }, asker: string, own: boolean): RawResponse {
  const today = new Date().toISOString().slice(0, 10);
  const held = DATA_ASKED.get(person.employee_id);
  if (held?.day === today && held.asker === asker) return { status: 202, body: { ...held.file, status: "done" } };
  if (held?.day === today)
    return fail(429, "DATA_EXPORT_LIMIT", own ? "A copy of your data was made for People today. Ask again tomorrow." : "Their copy was already made today. Try tomorrow.");
  const answer = exportFile(asker, `my-data-${person.staff_number}`);
  DATA_ASKED.set(person.employee_id, { day: today, asker, file: answer.body as ExportFile });
  return answer;
}

route("POST /api/v1/ess/profile/export", (req) => askDataExport(byKey(req.user!)!, req.user!, true));
