/**
 * Document Centre · Library on the in-browser mock (docs/guides/document-centre.md §5): the list with
 * its search, filters and sort, the four figures, one document, and the filters' options, in the
 * contract's shapes. Laptops and CI only; a release build never carries it (F12).
 *
 * The mock's two full accounts see every row; everyone else sees the company-wide ones and their
 * own, standing in for the vault's rule the real API applies per document.
 */
import type { LibraryDocument, LibraryFilters, LibrarySummary } from "@mycity/contract/contract.gen.ts";
import { daysAgo, fail, isoDaysAgo, isoDaysAhead, notFound, ok, paged, route, sid, type Req } from "../core";
import { grantsFor } from "../data/people";

const AREA_LABEL: Record<string, string> = {
  people: "People",
  queries: "Queries & Sanctions",
  recruitment: "Recruitment",
  payroll: "Payroll",
  partnerships: "Partnerships",
  expenses: "Expenses",
  knowledge: "Knowledge Hub",
};

const TYPES: Array<{ doc_type: string; label: string; area: string }> = [
  { doc_type: "employee_certificate", label: "Certificate", area: "people" },
  { doc_type: "employee_document", label: "Employee Document", area: "people" },
  { doc_type: "employee_identification", label: "Identification", area: "people" },
  { doc_type: "query_letter", label: "Query Letter", area: "queries" },
  { doc_type: "sanction_letter", label: "Sanction Letter", area: "queries" },
  { doc_type: "employment_contract", label: "Employment Contract", area: "recruitment" },
  { doc_type: "offer_letter", label: "Offer Letter", area: "recruitment" },
  { doc_type: "statutory_source", label: "Statutory Source", area: "payroll" },
  { doc_type: "partnership_agreement", label: "Agreement", area: "partnerships" },
  { doc_type: "partner_document", label: "Partner Document", area: "partnerships" },
  { doc_type: "proposal", label: "Proposal", area: "partnerships" },
  { doc_type: "disbursement_receipt", label: "Disbursement Receipt", area: "expenses" },
  { doc_type: "expense_invoice", label: "Expense Invoice", area: "expenses" },
  { doc_type: "sop_file", label: "SOP File", area: "knowledge" },
  { doc_type: "training_certificate", label: "Training Certificate", area: "knowledge" },
];

interface Seed {
  title: string;
  doc_type: string;
  /** A finer name than the type's (an agreement's kind, a partner document's). */
  kind?: string;
  record: [type: string, label: string, ref: string | null, link: string | null] | null;
  added: number;
  by: string | null;
  number?: string;
  locked?: boolean;
  /** Days until it ends; negative once passed. */
  ends?: number;
  mime?: string;
  pages?: number;
  /** Seen only by the two full accounts on the mock. */
  restricted?: boolean;
}

const partner = (name: string, ref: string): Seed["record"] => ["partner", name, ref, `/partnerships?tab=partners&id=${sid(`partner:${ref}`)}`];
const agreement = (name: string, ref: string): Seed["record"] => ["agreement", name, ref, `/partnerships?tab=contracts-and-mous&id=${sid(`agreement:${ref}`)}`];
const person = (name: string, ref: string): Seed["record"] => ["employee", name, ref, `/people?tab=employees&id=${sid(`employee:${ref}`)}`];

const SEEDS: Seed[] = [
  { title: "Chowdeck Service Agreement", doc_type: "partnership_agreement", kind: "Service Agreement", record: agreement("Chowdeck", "AGR-2026-0004"), added: 2, by: "Ngozi Eze", locked: true, ends: 41, pages: 9 },
  { title: "Eko Hotels Deal Merchant Agreement", doc_type: "partnership_agreement", kind: "Deal Merchant Agreement", record: agreement("Eko Hotels & Suites", "AGR-2026-0003"), added: 6, by: "Ngozi Eze", locked: true, ends: 310, pages: 12 },
  { title: "Afrobeat Live MOU", doc_type: "partnership_agreement", kind: "MOU", record: agreement("Afrobeat Live", "AGR-2026-0005"), added: 1, by: "Ngozi Eze", pages: 4 },
  { title: "Lagos Food Festival Proposal", doc_type: "proposal", record: ["proposal", "Lagos Food Festival", "PRO-0012", `/partnerships?tab=proposals&id=${sid("proposal:PRO-0012")}`], added: 9, by: "Ngozi Eze", pages: 14 },
  { title: "Filmhouse Partnership Proposal", doc_type: "proposal", record: ["proposal", "Filmhouse Cinemas", "PRO-0011", `/partnerships?tab=proposals&id=${sid("proposal:PRO-0011")}`], added: 23, by: "Ngozi Eze", pages: 11 },
  { title: "Chowdeck CAC Certificate", doc_type: "partner_document", kind: "Other", record: partner("Chowdeck", "PAR-0007"), added: 30, by: "Ngozi Eze", mime: "image/jpeg" },
  { title: "Eko Hotels Signed Contract", doc_type: "partner_document", kind: "Signed Copy", record: partner("Eko Hotels & Suites", "PAR-0003"), added: 6, by: "Cynthia Okafor", locked: true, pages: 12 },
  { title: "Terra Kulture Venue Brief", doc_type: "partner_document", kind: "Brief", record: partner("Terra Kulture", "PAR-0011"), added: 14, by: "Ngozi Eze", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
  { title: "Offer of Employment: Tolu Adeyemi", doc_type: "offer_letter", record: ["offer", "Tolu Adeyemi", "OFR-0009", `/recruitment?tab=offers&id=${sid("offer:OFR-0009")}`], added: 4, by: null, locked: true, pages: 3, restricted: true },
  { title: "Contract of Employment: Tolu Adeyemi", doc_type: "employment_contract", record: person("Tolu Adeyemi", "MC-0031"), added: 3, by: null, locked: true, ends: 362, pages: 6, restricted: true },
  { title: "Contract of Employment: Halima Bello", doc_type: "employment_contract", record: person("Halima Bello", "MC-0018"), added: 190, by: null, locked: true, ends: 18, pages: 6, restricted: true },
  { title: "Query QRY-0014: Lateness", doc_type: "query_letter", record: ["query", "Emeka Obi", "QRY-0014", `/queries?tab=queries&id=${sid("query:QRY-0014")}`], added: 11, by: null, number: "LTR-0021", locked: true, pages: 1, restricted: true },
  { title: "Written Warning: QRY-0014", doc_type: "sanction_letter", record: ["sanction", "Emeka Obi", "SAN-0006", `/queries?tab=sanctions&id=${sid("sanction:SAN-0006")}`], added: 8, by: null, number: "LTR-0022", locked: true, pages: 1, restricted: true },
  { title: "International Passport", doc_type: "employee_identification", record: person("Halima Bello", "MC-0018"), added: 120, by: "Halima Bello", ends: -12, mime: "image/jpeg", restricted: true },
  { title: "National Identity Slip", doc_type: "employee_identification", record: person("Emeka Obi", "MC-0022"), added: 200, by: "Emeka Obi", mime: "image/png", restricted: true },
  { title: "NYSC Discharge Certificate", doc_type: "employee_certificate", record: person("Tolu Adeyemi", "MC-0031"), added: 3, by: "Tolu Adeyemi", restricted: true },
  { title: "BSc Certificate", doc_type: "employee_certificate", record: person("Halima Bello", "MC-0018"), added: 188, by: "Halima Bello", restricted: true },
  { title: "Guarantor Form, Tolu Adeyemi", doc_type: "employee_document", record: person("Tolu Adeyemi", "MC-0031"), added: 3, by: "Tolu Adeyemi", pages: 2, restricted: true },
  { title: "Driver's Licence", doc_type: "employee_document", record: person("Emeka Obi", "MC-0022"), added: 64, by: "Cynthia Okafor", ends: 44, mime: "image/jpeg", restricted: true },
  { title: "Venue Deposit Invoice", doc_type: "expense_invoice", record: ["expense", "Terra Kulture venue deposit", "EXP-2026-0041", `/expenses?tab=approvals&id=${sid("expense:EXP-2026-0041")}`], added: 5, by: "Ngozi Eze", pages: 1 },
  { title: "Printing Invoice, Brand Banners", doc_type: "expense_invoice", record: ["expense", "Roll-up banners for the Abuja launch", "EXP-2026-0038", `/expenses?tab=approvals&id=${sid("expense:EXP-2026-0038")}`], added: 16, by: "Emeka Obi", mime: "image/jpeg" },
  { title: "Transfer Receipt, Terra Kulture", doc_type: "disbursement_receipt", record: ["disbursement", "Terra Kulture", "DSB-0029", `/expenses?tab=disbursements&id=${sid("disbursement:DSB-0029")}`], added: 4, by: "Cynthia Okafor", mime: "image/png" },
  { title: "Transfer Receipt, Printworks", doc_type: "disbursement_receipt", record: ["disbursement", "Printworks Nigeria", "DSB-0027", `/expenses?tab=disbursements&id=${sid("disbursement:DSB-0027")}`], added: 15, by: "Cynthia Okafor", pages: 1 },
  { title: "Nigeria Tax Act 2025", doc_type: "statutory_source", record: ["statutory_return", "Nigeria Tax Act 2025", "Fourth Schedule", "/payroll?tab=configurations"], added: 40, by: "Cynthia Okafor", pages: 180, restricted: true },
  { title: "Pension Reform Act 2014", doc_type: "statutory_source", record: ["statutory_return", "Pension Reform Act 2014", "Section 4", "/payroll?tab=configurations"], added: 40, by: "Cynthia Okafor", pages: 96, restricted: true },
  { title: "Merchant Onboarding Checklist", doc_type: "sop_file", record: ["sop", "Onboard a Deal Merchant", "SOP-0004", `/knowledge?tab=sops&id=${sid("sop:SOP-0004")}`], added: 27, by: "Cynthia Okafor", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
  { title: "Event Day Run Sheet", doc_type: "sop_file", record: ["sop", "Run an Event Day", "SOP-0007", `/knowledge?tab=sops&id=${sid("sop:SOP-0007")}`], added: 12, by: "Cynthia Okafor", pages: 2 },
  { title: "TRN-2026-0019", doc_type: "training_certificate", record: ["training_enrolment", "Halima Bello", "TRN-2026-0019", null], added: 7, by: null, locked: true, pages: 1, restricted: true },
];

const typeOf = (docType: string) => TYPES.find((t) => t.doc_type === docType)!;

const ROWS: LibraryDocument[] = SEEDS.map((s) => {
  const t = typeOf(s.doc_type);
  const mime = s.mime ?? "application/pdf";
  const ext = mime === "application/pdf" ? "pdf" : mime.startsWith("image/") ? mime.slice(6).replace("jpeg", "jpg") : mime.includes("sheet") ? "xlsx" : "docx";
  const expires = s.ends === undefined ? null : s.ends >= 0 ? isoDaysAhead(s.ends) : isoDaysAgo(-s.ends);
  const expiring = s.ends !== undefined && s.ends <= 60;
  return {
    document_id: sid(`library:${s.title}`),
    title: s.title,
    original_name: `${s.title.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase()}.${ext}`,
    doc_type: s.doc_type,
    type_label: s.kind ?? t.label,
    area: t.area,
    area_label: AREA_LABEL[t.area]!,
    record: s.record ? { type: s.record[0], id: sid(`${s.record[0]}:${s.record[2] ?? s.record[1]}`), label: s.record[1], ref: s.record[2], link: s.record[3] } : null,
    number: s.number ?? null,
    mime,
    bytes: 48_000 + s.title.length * 9_700,
    page_count: mime === "application/pdf" ? (s.pages ?? 1) : null,
    version: 1,
    status: expiring ? "expiring" : s.locked ? "signed" : null,
    expires_on: expires,
    locked_at: s.locked ? daysAgo(s.added).toISOString() : null,
    created_at: daysAgo(s.added).toISOString(),
    added_by_name: s.by,
  };
});
const RESTRICTED = new Set(SEEDS.filter((s) => s.restricted).map((s) => sid(`library:${s.title}`)));

const denied = () => fail(403, "PERMISSION_DENIED", "You do not have access to this");
const may = (req: Req) => Boolean(req.user && (grantsFor(req.user).documents ?? []).includes("view"));
/** What this account sees: everything for the two full accounts, the unrestricted rows for everyone else. */
const seenBy = (req: Req) => (req.user === "cynthia" || req.user === "ifeoma" ? ROWS : ROWS.filter((d) => !RESTRICTED.has(d.document_id)));
const since = (added: string) => (added === "this_month" ? new Date(new Date().getFullYear(), new Date().getMonth(), 1) : added === "this_year" ? new Date(new Date().getFullYear(), 0, 1) : daysAgo(90));

route("GET /api/v1/library/documents/summary", (req) => {
  if (!may(req)) return denied();
  const rows = seenBy(req);
  const month = since("this_month").toISOString();
  const body: LibrarySummary = {
    documents: rows.length,
    added_this_month: rows.filter((d) => d.created_at >= month).length,
    expiring: rows.filter((d) => d.status === "expiring").length,
    signed: rows.filter((d) => d.locked_at !== null).length,
  };
  return ok(body);
});

route("GET /api/v1/library/filters", (req) => {
  if (!may(req)) return denied();
  const held = new Set(seenBy(req).map((d) => d.doc_type));
  const types = TYPES.filter((t) => held.has(t.doc_type));
  const body: LibraryFilters = {
    areas: Object.keys(AREA_LABEL).filter((a) => types.some((t) => t.area === a)).map((a) => ({ area: a, label: AREA_LABEL[a]! })),
    types,
  };
  return ok(body);
});

route("GET /api/v1/library/documents/:id", (req) => {
  if (!may(req)) return denied();
  const found = seenBy(req).find((d) => d.document_id === req.params.id);
  return found ? ok(found) : notFound();
});

route("GET /api/v1/library/documents", (req) => {
  if (!may(req)) return denied();
  // Every word of a search is held to the row, as the API holds it.
  const words = (req.query.q ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const text = (d: LibraryDocument) => [d.title, d.original_name, d.number, d.type_label, d.record?.label, d.record?.ref].join(" ").toLowerCase();
  const rows = seenBy(req).filter((d) => words.every((w) => text(d).includes(w)));
  const { q: _q, ...query } = req.query;
  return paged(
    rows,
    { ...req, query: { sort: "-created_at", ...query } },
    {
      filters: {
        area: (d, v) => d.area === v,
        doc_type: (d, v) => d.doc_type === v,
        status: (d, v) => (v === "signed" ? d.locked_at !== null : d.status === "expiring"),
        added: (d, v) => d.created_at >= since(v).toISOString(),
      },
      sort: {
        created_at: (a, b) => a.created_at.localeCompare(b.created_at),
        title: (a, b) => a.title.localeCompare(b.title),
        expires_on: (a, b) => (a.expires_on ?? "9999").localeCompare(b.expires_on ?? "9999"),
      },
    },
  );
});

export const LIBRARY_ROWS = ROWS;
