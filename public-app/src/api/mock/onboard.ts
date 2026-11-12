import type { Guarantor, OnboardingItem, UploadPack } from "@mycity/contract/contract.gen.ts";
import onboardingSchemas from "@mycity/contract/schemas/onboarding.js";
import { fail, inDays, invalid, ok, route } from "./core";

/**
 * Upload Documents (`/onboard/<token>`, M5) on the mock: three new hires' packs, in the contract's
 * shape (UploadPack): one who has not accepted the privacy notice, one part-way (an item sent back
 * with its reason, a guarantor being checked), one whose documentation is complete. Bodies are
 * checked by the contract's own schemas; a file sent is answered by the shared upload simulation.
 */

const NOTICE = [
  "MyCity App Ltd collects these documents to complete your employment record.",
  "They are stored on your staff record and seen only by Operations & People and those who check them.",
  "Your BVN is kept masked and is used only to set up your salary account.",
  "Your guarantors are contacted only to confirm the reference you gave.",
  "You may ask Operations & People for a copy of what we hold, or to correct it.",
  "We keep your record for as long as the law requires after you leave.",
];

const ITEMS: Array<[string, string, OnboardingItem["kind"], boolean]> = [
  ["proof_of_address", "Proof of Residential Address", "file", true],
  ["valid_id", "Valid ID", "file", true],
  ["certificates", "Educational and Professional Certificates", "file", true],
  ["separation", "Evidence of Separation", "file", false],
  ["birth_certificate", "Birth Certificate", "file", true],
  ["employee_data_form", "Employee Data Form", "file", true],
  ["mylagosapp_wallet", "MyLagosApp Wallet ID", "number", true],
  ["passport_photo", "Passport Photograph", "file", true],
  ["account_opening", "Account Opening Form", "file", true],
];

const id = (seed: string) => {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const x = h.toString(16).padStart(8, "0");
  return `${x}-0000-4000-8000-${x}${x.slice(0, 4)}`;
};
const day = (n: number) => inDays(n).slice(0, 10);
const at = (days: number) => `${day(-days)}T10:00:00.000Z`;

function items(key: string, state: (code: string) => OnboardingItem["status"]): OnboardingItem[] {
  return ITEMS.map(([code, title, kind, required], i) => {
    const s = state(code);
    const sent = s !== "pending";
    return {
      onboarding_checklist_item_id: id(`${key}:${code}`),
      document_requirement_id: id(`req:${code}`),
      title,
      kind,
      required,
      status: s,
      document: sent && kind !== "number" ? { document_id: id(`doc:${key}:${code}`), file_name: `${code}.pdf`, size_bytes: 310_000, mime_type: "application/pdf" } : null,
      entered_value: sent && kind !== "file" ? "MLA-4471-2208" : null,
      uploaded_at: sent ? at(2) : null,
      verified_at: s === "verified" ? at(1) : null,
      rejected_reason: s === "rejected" ? "The bill is older than three months. Send a recent one." : null,
      display_order: i + 1,
    };
  });
}

const guarantor = (key: string, position: 1 | 2, check: Guarantor["check_status"]): Guarantor => ({
  onboarding_guarantor_id: id(`${key}:g${position}`),
  position,
  kind: position === 1 ? "previous_employer" : "personal",
  full_name: position === 1 ? "Olumide Bankole" : "Ngozi Eze",
  relationship: position === 1 ? "Former line manager" : "Family friend",
  organisation: position === 1 ? "Lagos Media Group" : null,
  job_title: position === 1 ? "Head of Content" : null,
  phone: position === 1 ? "+2348031234567" : "+2348039876543",
  email: null,
  years_known: position === 1 ? 3 : 9,
  date_of_birth: position === 1 ? "1971-03-14" : "1968-09-02",
  contact_address: position === 1 ? "Allen Avenue, Ikeja, Lagos" : "Bourdillon Road, Ikoyi, Lagos",
  residential_address: position === 1 ? "Oba Akran Avenue, Ikeja, Lagos" : "Bourdillon Road, Ikoyi, Lagos",
  convicted: false,
  conviction_details: null,
  recommends: true,
  form: { document_id: id(`${key}:form${position}`), file_name: `guarantor-${position}.pdf`, size_bytes: 120_000, mime_type: "application/pdf" },
  id_document: { document_id: id(`${key}:id${position}`), file_name: `guarantor-${position}-id.jpg`, size_bytes: 300_000, mime_type: "image/jpeg" },
  check_status: check,
  check_note: null,
  checked_at: check === "pending" ? null : at(1),
});

const base = { company: "MyCity App Ltd", privacy_notice: NOTICE };
const PACKS = new Map<string, UploadPack>([
  ["Np4xQ7cVm2Ld", { ...base, first_name: "Kunle", role: "Head, Sales & Revenue", starts_on: day(24), status: "documentation", privacy_acknowledged: false, items: items("kunle", () => "pending"), guarantors: [], bvn_entered: false, address_entered: false }],
  [
    "Fw8bK3sHr6Ty",
    {
      ...base,
      first_name: "Chiamaka",
      role: "Content Producer",
      starts_on: day(12),
      status: "documentation",
      privacy_acknowledged: true,
      items: items("chiamaka", (c) => (c === "valid_id" ? "verified" : c === "proof_of_address" ? "rejected" : ["passport_photo", "employee_data_form", "mylagosapp_wallet"].includes(c) ? "uploaded" : "pending")),
      guarantors: [guarantor("chiamaka", 1, "passed"), guarantor("chiamaka", 2, "pending")],
      bvn_entered: true,
      address_entered: false,
    },
  ],
  ["Lz2mD9qXc5Wn", { ...base, first_name: "Bola", role: "Support Officer", starts_on: day(5), status: "pre_onboarding", privacy_acknowledged: true, items: items("bola", () => "verified"), guarantors: [guarantor("bola", 1, "passed"), guarantor("bola", 2, "passed")], bvn_entered: true, address_entered: true }],
]);

interface Issue {
  path: PropertyKey[];
  message: string;
}
function parsed<T>(schema: unknown, body: unknown, then: (b: T) => ReturnType<typeof ok>) {
  const r = (schema as { safeParse(v: unknown): { success: true; data: T } | { success: false; error: { issues: Issue[] } } }).safeParse(body);
  if (r.success) return then(r.data);
  const fields: Record<string, string[]> = {};
  for (const i of r.error.issues) fields[i.path.map(String).join(".") || "body"] ??= [i.message];
  return invalid(fields);
}

const badLink = () => fail(404, "NOT_FOUND", "This link is not valid. Check you opened the whole address from the email.");
/** What every write checks first: the notice accepted, and documentation still open. */
function open(p: UploadPack) {
  if (p.status !== "documentation") return fail(409, "DOCUMENTATION_DONE", "Your documents are complete");
  if (!p.privacy_acknowledged) return fail(409, "PRIVACY_FIRST", "Accept the privacy notice first");
  return null;
}

route("GET /api/public/v1/onboard/:token", (req) => {
  const p = PACKS.get(req.params.token);
  return p ? ok(p) : badLink();
});
route("POST /api/public/v1/onboard/:token/privacy", (req) => {
  const p = PACKS.get(req.params.token);
  if (!p) return badLink();
  return parsed(onboardingSchemas.PrivacyAcknowledge, req.body, () => {
    p.privacy_acknowledged = true;
    return ok(p);
  });
});
route("POST /api/public/v1/onboard/:token/items/:item_id", (req) => {
  const p = PACKS.get(req.params.token);
  if (!p) return badLink();
  const refused = open(p);
  if (refused) return refused;
  const it = p.items.find((i) => i.onboarding_checklist_item_id === req.params.item_id);
  if (!it) return badLink();
  if (it.status === "verified") return fail(409, "ALREADY_VERIFIED", "This document is already checked");
  return parsed<{ document_id?: string; entered_value?: string }>(onboardingSchemas.UploadItem, req.body, (b) => {
    it.status = "uploaded";
    it.rejected_reason = null;
    it.uploaded_at = new Date().toISOString();
    if (b.document_id) it.document = { document_id: b.document_id, file_name: `${it.title}.pdf`, size_bytes: 200_000, mime_type: "application/pdf" };
    if (b.entered_value) it.entered_value = b.entered_value;
    return ok(p);
  });
});
route("POST /api/public/v1/onboard/:token/guarantors", (req) => {
  const p = PACKS.get(req.params.token);
  if (!p) return badLink();
  const refused = open(p);
  if (refused) return refused;
  type Input = Omit<Guarantor, "onboarding_guarantor_id" | "form" | "id_document" | "check_status" | "check_note" | "checked_at" | "contact_address" | "residential_address"> & {
    form_document_id?: string | null;
    id_document_id?: string | null;
    contact_address: { token?: string };
    residential_address: { token?: string };
  };
  return parsed<Input>(onboardingSchemas.GuarantorInput, req.body, (b) => {
    const was = p.guarantors.find((g) => g.position === b.position);
    if (was?.check_status === "passed") return fail(409, "ALREADY_CHECKED", "This guarantor has passed their check");
    const { form_document_id, id_document_id, contact_address, residential_address, ...rest } = b;
    const g: Guarantor = {
      onboarding_guarantor_id: was?.onboarding_guarantor_id ?? id(`${req.params.token}:g${b.position}`),
      ...rest,
      organisation: rest.organisation ?? null,
      job_title: rest.job_title ?? null,
      email: rest.email ?? null,
      years_known: rest.years_known ?? null,
      date_of_birth: rest.date_of_birth ?? null,
      contact_address: lineOf(contact_address),
      residential_address: lineOf(residential_address),
      convicted: rest.convicted ?? null,
      conviction_details: rest.convicted ? (rest.conviction_details ?? null) : null,
      recommends: rest.recommends ?? null,
      id_document: id_document_id ? { document_id: id_document_id, file_name: "guarantor-id.jpg", size_bytes: 300_000, mime_type: "image/jpeg" } : (was?.id_document ?? null),
      form: form_document_id ? { document_id: form_document_id, file_name: "guarantor-form.pdf", size_bytes: 120_000, mime_type: "application/pdf" } : (was?.form ?? null),
      check_status: "pending",
      check_note: null,
      checked_at: null,
    };
    p.guarantors = [...p.guarantors.filter((x) => x.position !== b.position), g].sort((x, y) => x.position - y.position);
    return ok(p);
  });
});
route("POST /api/public/v1/onboard/:token/address", (req) => {
  const p = PACKS.get(req.params.token);
  if (!p) return badLink();
  const refused = open(p);
  if (refused) return refused;
  return parsed(onboardingSchemas.HireAddressEnter, req.body, () => {
    p.address_entered = true;
    return ok(p);
  });
});

/* The page's address search and pin: a few invented Lagos streets, tokens in our API's shape with
   "mock" for a signature (the browser checks the shape only; the mock never ships, F12 to F14). */
const STREETS: Array<[string, number, number]> = [
  ["Allen Avenue, Ikeja, Lagos", 6.6005, 3.3545],
  ["Oba Akran Avenue, Ikeja, Lagos", 6.6018, 3.3515],
  ["Bourdillon Road, Ikoyi, Lagos", 6.4521, 3.4339],
  ["7 Admiralty Way, Lekki Phase 1, Lagos", 6.447, 3.472],
  ["21 Herbert Macaulay Way, Yaba, Lagos", 6.5095, 3.379],
];
const b64 = (v: string) => btoa(String.fromCharCode(...new TextEncoder().encode(v))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const placeOf = ([formatted, lat, lon]: [string, number, number], i: number) => ({
  place_id: `street-${i}`,
  formatted,
  lat,
  lon,
  kind: "street" as const,
  token: `p1.${b64(JSON.stringify({ s: "search", f: formatted, la: lat, lo: lon, a: null, k: "street", v: true, p: false }))}.mock`,
});
/** The line a picked place reads as, from its token (the mock keeps no places). */
function lineOf(v: { token?: string } | undefined): string | null {
  const body = v?.token?.split(".")[1];
  if (!body) return null;
  try {
    return (JSON.parse(atob(body.replace(/-/g, "+").replace(/_/g, "/"))) as { f?: string }).f ?? null;
  } catch {
    return null;
  }
}
route("GET /api/public/v1/onboard/:token/places/search", (req) => {
  if (!PACKS.get(req.params.token)) return badLink();
  const q = String(req.query.q ?? "").trim().toLowerCase();
  if (q.length < 2) return invalid({ "query.q": ["Too short"] });
  const words = q.split(/[\s,]+/).filter(Boolean);
  return ok({ places: STREETS.map(placeOf).filter((pl) => words.every((w) => pl.formatted.toLowerCase().includes(w))) });
});
route("GET /api/public/v1/onboard/:token/places/pin", (req) => {
  if (!PACKS.get(req.params.token)) return badLink();
  const lat = Number(req.query.lat);
  const lon = Number(req.query.lon);
  const near = STREETS.map(placeOf).sort((a, b) => Math.hypot(a.lat - lat, a.lon - lon) - Math.hypot(b.lat - lat, b.lon - lon))[0]!;
  return ok({ ...near, lat, lon });
});

route("POST /api/public/v1/onboard/:token/bvn", (req) => {
  const p = PACKS.get(req.params.token);
  if (!p) return badLink();
  const refused = open(p);
  if (refused) return refused;
  return parsed(onboardingSchemas.BvnEnter, req.body, () => {
    p.bvn_entered = true;
    return ok(p);
  });
});
