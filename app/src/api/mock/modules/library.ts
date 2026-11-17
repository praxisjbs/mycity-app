/**
 * Document Centre · Library on the in-browser mock (docs/guides/document-centre.md §5): the list with
 * its search, filters and sort, the four figures, one document, and the filters' options, in the
 * contract's shapes. Laptops and CI only; a release build never carries it (F12).
 *
 * The mock's two full accounts see every row; everyone else sees the company-wide ones and their
 * own, standing in for the vault's rule the real API applies per document. Company documents (PR 2)
 * live in categories: one seen by everyone, one by named roles, kept by documents.manage.
 */
import type { DocumentCategory, LibraryDocument, LibraryFilters, LibrarySummary } from "@mycity/contract/contract.gen.ts";
import { created, daysAgo, fail, invalid, isoDaysAgo, isoDaysAhead, notFound, ok, paged, route, sid, type Req } from "../core";
import { grantsFor } from "../data/people";
import { UPLOADS } from "../uploads";
import { me } from "./identity";
import { exportFile } from "./shared";

const AREA_LABEL: Record<string, string> = {
  documents: "Company",
  people: "People",
  queries: "Queries & Sanctions",
  recruitment: "Recruitment",
  payroll: "Payroll",
  partnerships: "Partnerships",
  expenses: "Expenses",
  knowledge: "Knowledge Hub",
};

const TYPES: Array<{ doc_type: string; label: string; area: string }> = [
  { doc_type: "company_document", label: "Company Document", area: "documents" },
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
    company: null,
    matched_text: null,
  };
});
/* ------------------------------------------------------------------ *
 * Company documents and their categories (§6.4, §6.5)
 * ------------------------------------------------------------------ */

const role = (code: string, name: string) => ({ role_id: sid(`role:${code}`), name });
const CATEGORIES: DocumentCategory[] = [
  { name: "Registration & Statutory", description: "Incorporation, status reports and filings.", audience: "everyone" as const, roles: [] },
  { name: "Licences & Permits", description: "Operating licences and permits.", audience: "everyone" as const, roles: [] },
  { name: "Finance Records", description: "Audited accounts and tax filings.", audience: "roles" as const, roles: [role("management", "Management"), role("operations_people", "Operations & People")] },
].map((c, i) => ({
  document_category_id: sid(`document_category:${c.name}`),
  ...c,
  documents: 0,
  archived_at: null,
  created_at: daysAgo(90 - i).toISOString(),
  updated_at: daysAgo(90 - i).toISOString(),
}));

/** Who made each company document (the mock's account key), for Edit Details' rule. */
const OWNER = new Map<string, string>();
let numbered = 0;

function companyRow(input: { title: string; category: DocumentCategory; tags: string[]; expires_on: string | null; description: string | null; by: string; byName: string; added: number; mime?: string; id?: string }): LibraryDocument {
  numbered += 1;
  const id = input.id ?? sid(`library:company:${input.title}`);
  OWNER.set(id, input.by);
  const mime = input.mime ?? "application/pdf";
  const expiring = Boolean(input.expires_on && input.expires_on <= isoDaysAhead(60));
  return {
    document_id: id,
    title: input.title,
    original_name: `${input.title.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase()}.pdf`,
    doc_type: "company_document",
    type_label: "Company Document",
    area: "documents",
    area_label: "Company",
    record: { type: "document_category", id: input.category.document_category_id, label: input.category.name, ref: null, link: null },
    number: `DOC-${String(numbered).padStart(4, "0")}`,
    mime,
    bytes: 96_000,
    page_count: mime === "application/pdf" ? 1 : null,
    version: 1,
    status: expiring ? "expiring" : null,
    expires_on: input.expires_on,
    locked_at: null,
    created_at: daysAgo(input.added).toISOString(),
    added_by_name: input.byName,
    company: {
      company_document_id: sid(`company_document:${id}`),
      category: { document_category_id: input.category.document_category_id, name: input.category.name },
      tags: input.tags,
      description: input.description,
      archived_at: null,
      may_edit: false,
      may_archive: false,
    },
    matched_text: null,
  };
}

ROWS.push(
  companyRow({ title: "Certificate of Incorporation", category: CATEGORIES[0]!, tags: ["cac", "incorporation"], expires_on: null, description: null, by: "cynthia", byName: "Cynthia Okafor", added: 60 }),
  companyRow({ title: "Business Premises Permit", category: CATEGORIES[1]!, tags: ["permit", "lagos"], expires_on: isoDaysAhead(45), description: "Lagos office.", by: "cynthia", byName: "Cynthia Okafor", added: 20 }),
  companyRow({ title: "Annual Status Report", category: CATEGORIES[2]!, tags: ["cac", "status report"], expires_on: null, description: null, by: "cynthia", byName: "Cynthia Okafor", added: 35 }),
);

const RESTRICTED = new Set(SEEDS.filter((s) => s.restricted).map((s) => sid(`library:${s.title}`)));

const denied = () => fail(403, "PERMISSION_DENIED", "You do not have access to this");
const may = (req: Req, action = "view") => Boolean(req.user && (grantsFor(req.user).documents ?? []).includes(action));
const full = (req: Req) => req.user === "cynthia" || req.user === "ifeoma";
/** Whether the account keeps the library (documents.manage). */
const keeps = (req: Req) => {
  if (!req.user) return false;
  const m = me(req.user);
  return m.is_ceo || m.capabilities.includes("documents.manage");
};
const refused = () => fail(403, "CAPABILITY_REQUIRED", "You need Manage Documents for this.");
const categoryOf = (id: string) => CATEGORIES.find((c) => c.document_category_id === id);
/** Whether the account sees a category: everyone's, or the full accounts standing in for its roles. */
const seesCategory = (req: Req, c: DocumentCategory) => keeps(req) || (!c.archived_at && (c.audience === "everyone" || full(req)));
/** A company row as this account reads it: what it may do with it. */
const forReader = (req: Req, d: LibraryDocument): LibraryDocument => {
  if (!d.company) return d;
  const mine = OWNER.get(d.document_id) === req.user;
  return { ...d, company: { ...d.company, may_edit: may(req, "edit") && (keeps(req) || mine), may_archive: may(req, "delete") && (keeps(req) || mine) } };
};
/** What this account sees: everything for the two full accounts, the unrestricted rows for everyone else; archived company documents for keepers alone. */
const visible = (req: Req, archived = false) =>
  ROWS.filter((d) => {
    if (d.company) {
      if (Boolean(d.company.archived_at) !== archived) return false;
      if (archived) return keeps(req);
      const c = categoryOf(d.company.category.document_category_id);
      return keeps(req) || OWNER.get(d.document_id) === req.user || Boolean(c && (c.audience === "everyone" || full(req)));
    }
    if (archived) return false;
    return full(req) || !RESTRICTED.has(d.document_id);
  }).map((d) => forReader(req, d));
const since = (added: string) => (added === "this_month" ? new Date(new Date().getFullYear(), new Date().getMonth(), 1) : added === "this_year" ? new Date(new Date().getFullYear(), 0, 1) : daysAgo(90));

route("GET /api/v1/library/documents/summary", (req) => {
  if (!may(req)) return denied();
  const rows = visible(req);
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
  const held = new Set(visible(req).map((d) => d.doc_type));
  const types = TYPES.filter((t) => held.has(t.doc_type));
  const body: LibraryFilters = {
    areas: Object.keys(AREA_LABEL).filter((a) => types.some((t) => t.area === a)).map((a) => ({ area: a, label: AREA_LABEL[a]! })),
    types,
  };
  return ok(body);
});

route("GET /api/v1/library/documents/:id", (req) => {
  if (!may(req)) return denied();
  const found = [...visible(req), ...visible(req, true)].find((d) => d.document_id === req.params.id);
  return found ? ok(found) : notFound();
});

route("GET /api/v1/library/documents", (req) => {
  if (!may(req)) return denied();
  // Every word of a search is held to the row, as the API holds it.
  const words = (req.query.q ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const text = (d: LibraryDocument) => [d.title, d.original_name, d.number, d.type_label, d.record?.label, d.record?.ref, ...(d.company?.tags ?? [])].join(" ").toLowerCase();
  const rows = visible(req, req.query.archived === "true").filter((d) => words.every((w) => text(d).includes(w)));
  const { q: _q, archived: _a, ...query } = req.query;
  return paged(
    rows,
    { ...req, query: { sort: "-created_at", ...query } },
    {
      filters: {
        area: (d, v) => d.area === v,
        doc_type: (d, v) => d.doc_type === v,
        status: (d, v) => (v === "signed" ? d.locked_at !== null : d.status === "expiring"),
        added: (d, v) => d.created_at >= since(v).toISOString(),
        category_id: (d, v) => d.company?.category.document_category_id === v,
        tag: (d, v) => Boolean(d.company?.tags.includes(v.toLowerCase())),
      },
      sort: {
        created_at: (a, b) => a.created_at.localeCompare(b.created_at),
        title: (a, b) => a.title.localeCompare(b.title),
        expires_on: (a, b) => (a.expires_on ?? "9999").localeCompare(b.expires_on ?? "9999"),
      },
    },
  );
});

/* Upload Document, Edit Details, Upload New Version, Archive and Restore. */

route("POST /api/v1/library/documents", (req) => {
  if (!may(req, "create")) return denied();
  const b = req.body as { document_id?: string; title?: string; document_category_id?: string; tags?: string[]; expires_on?: string | null; description?: string | null };
  const category = b.document_category_id ? categoryOf(b.document_category_id) : undefined;
  if (!category || !seesCategory(req, category) || category.archived_at) return invalid({ document_category_id: ["Pick another category"] });
  const file = b.document_id ? UPLOADS.get(b.document_id) : undefined;
  if (!file) return invalid({ document_id: ["Upload it again"] });
  const who = me(req.user!);
  const row = companyRow({
    id: b.document_id,
    title: String(b.title ?? "").trim(),
    category,
    tags: (b.tags ?? []).map((t) => t.toLowerCase()),
    expires_on: b.expires_on || null,
    description: b.description || null,
    by: req.user!,
    byName: who.display_name,
    added: 0,
    mime: file.mime_type,
  });
  ROWS.unshift(row);
  return created(forReader(req, row));
});

/** A company document the account may change, by any id it is known by. */
function changeable(req: Req, action: "edit" | "delete") {
  const d = [...visible(req), ...visible(req, true)].find((x) => x.document_id === req.params.id);
  if (!d) return { problem: notFound() };
  if (!d.company) return { problem: fail(409, "DOCUMENT_NOT_YOURS", "This document is changed where it was made") };
  if (!may(req, action) || !(keeps(req) || OWNER.get(d.document_id) === req.user)) return { problem: fail(403, "FORBIDDEN", "Only its uploader or a document manager may change it") };
  return { row: ROWS.find((x) => x.document_id === d.document_id)! };
}

route("PATCH /api/v1/library/documents/:id", (req) => {
  const { row, problem } = changeable(req, "edit");
  if (problem) return problem;
  const b = req.body as { title?: string; document_category_id?: string; tags?: string[]; expires_on?: string | null; description?: string | null };
  if (b.document_category_id) {
    const c = categoryOf(b.document_category_id);
    if (!c || c.archived_at) return invalid({ document_category_id: ["Pick another category"] });
    row!.company!.category = { document_category_id: c.document_category_id, name: c.name };
    row!.record = { type: "document_category", id: c.document_category_id, label: c.name, ref: null, link: null };
  }
  if (b.title !== undefined) row!.title = b.title;
  if (b.tags !== undefined) row!.company!.tags = b.tags.map((t) => t.toLowerCase());
  if (b.description !== undefined) row!.company!.description = b.description || null;
  if (b.expires_on !== undefined) {
    row!.expires_on = b.expires_on || null;
    row!.status = row!.expires_on && row!.expires_on <= isoDaysAhead(60) ? "expiring" : null;
  }
  return ok(forReader(req, row!));
});

route("POST /api/v1/library/documents/:id/versions", (req) => {
  const { row, problem } = changeable(req, "edit");
  if (problem) return problem;
  const file = UPLOADS.get(String(req.body.document_id ?? ""));
  if (!file) return invalid({ document_id: ["Upload it again"] });
  const next = { ...row!, document_id: file.document_id, mime: file.mime_type, version: row!.version + 1, created_at: new Date().toISOString() };
  OWNER.set(next.document_id, OWNER.get(row!.document_id) ?? req.user!);
  ROWS.splice(ROWS.indexOf(row!), 1, next);
  return created(forReader(req, next));
});

for (const [verb, archived] of [["archive", true], ["restore", false]] as const) {
  route(`POST /api/v1/library/documents/:id/${verb}`, (req) => {
    const { row, problem } = changeable(req, "delete");
    if (problem) return problem;
    row!.company!.archived_at = archived ? new Date().toISOString() : null;
    row!.status = archived ? "archived" : row!.expires_on && row!.expires_on <= isoDaysAhead(60) ? "expiring" : null;
    return ok(forReader(req, row!));
  });
}

/* Categories and tags. */

const counted = (c: DocumentCategory): DocumentCategory => ({
  ...c,
  documents: ROWS.filter((d) => d.company && !d.company.archived_at && d.company.category.document_category_id === c.document_category_id).length,
});

route("GET /api/v1/library/categories", (req) => {
  if (!may(req)) return denied();
  const archived = req.query.archived === "true";
  const rows = archived && !keeps(req) ? [] : CATEGORIES.filter((c) => Boolean(c.archived_at) === archived && seesCategory(req, c)).map(counted);
  const { archived: _a, ...query } = req.query;
  return paged(rows, { ...req, query: { sort: "name", ...query } }, { search: (c) => [c.name], sort: { name: (a, b) => a.name.localeCompare(b.name), created_at: (a, b) => a.created_at.localeCompare(b.created_at) } });
});

route("GET /api/v1/library/categories/:id", (req) => {
  if (!may(req)) return denied();
  const c = categoryOf(req.params.id);
  return c && seesCategory(req, c) ? ok(counted(c)) : notFound();
});

const ROLE_NAMES: Record<string, string> = {
  implementation: "Implementation Team",
  operations_people: "Operations & People",
  management: "Management",
  head_of_department: "Head of Department",
  administrator: "System Administrator",
  manager: "Line Manager",
  employee: "Staff",
};
const rolesNamed = (ids: string[]) =>
  ids.map((id) => Object.entries(ROLE_NAMES).find(([code]) => sid(`role:${code}`) === id)).filter(Boolean).map((x) => role(x![0], x![1]));

function saveCategory(req: Req, c: DocumentCategory | null) {
  if (!may(req, "edit")) return denied();
  if (!keeps(req)) return refused();
  const b = req.body as { name?: string; description?: string | null; audience?: "everyone" | "roles"; role_ids?: string[] };
  const name = (b.name ?? c?.name ?? "").trim();
  if (CATEGORIES.some((x) => x !== c && x.name.toLowerCase() === name.toLowerCase())) return invalid({ name: ["Name already used"] });
  const audience = b.audience ?? c?.audience ?? "everyone";
  const roles = audience === "roles" ? rolesNamed(b.role_ids ?? c?.roles.map((r) => r.role_id) ?? []) : [];
  if (audience === "roles" && roles.length === 0) return invalid({ role_ids: ["Pick a role"] });
  const now = new Date().toISOString();
  if (c) {
    Object.assign(c, { name, description: b.description === undefined ? c.description : b.description || null, audience, roles, updated_at: now });
    return ok(counted(c));
  }
  const made: DocumentCategory = { document_category_id: sid(`document_category:${name}:${now}`), name, description: b.description || null, audience, roles, documents: 0, archived_at: null, created_at: now, updated_at: now };
  CATEGORIES.push(made);
  return created(made);
}

route("POST /api/v1/library/categories", (req) => saveCategory(req, null));
route("PATCH /api/v1/library/categories/:id", (req) => {
  const c = categoryOf(req.params.id);
  return c ? saveCategory(req, c) : notFound();
});
for (const [verb, archived] of [["archive", true], ["restore", false]] as const) {
  route(`POST /api/v1/library/categories/:id/${verb}`, (req) => {
    if (!keeps(req)) return refused();
    const c = categoryOf(req.params.id);
    if (!c) return notFound();
    c.archived_at = archived ? new Date().toISOString() : null;
    return ok(counted(c));
  });
}

route("GET /api/v1/library/tags", (req) => {
  if (!may(req)) return denied();
  const counts = new Map<string, number>();
  for (const d of visible(req)) for (const t of d.company?.tags ?? []) counts.set(t, (counts.get(t) ?? 0) + 1);
  const rows = [...counts].map(([tag, documents]) => ({ tag, documents })).sort((a, b) => b.documents - a.documents || a.tag.localeCompare(b.tag));
  return paged(rows, req, { search: (t) => [t.tag] });
});

/* Download Letterhead: an export, as every Download button's (shared.ts). */
route("POST /api/v1/library/letterhead", (req) => {
  if (!may(req)) return denied();
  const format = req.body.format === "docx" ? "docx" : "pdf";
  return exportFile(req.user!, "letterhead", format);
});

export const LIBRARY_ROWS = ROWS;
