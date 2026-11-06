import type { CategoryDetail, ChecklistItem, Field, ListValue, ProofPoint } from "@mycity/contract/contract.gen.ts";
import { created, fail, invalid, notFound, ok, paged, route, uuid } from "../core";
import partner_pipeline from "@mycity/contract/schemas/partner_pipeline.js";

/**
 * Partnerships · Categories on the in-browser mock (docs/guides/partnerships.md §5, §6.3, §6.8): the
 * routes of M7 PR 2 in the contract's shapes, with the records the staging seed holds (F13), so a
 * laptop and staging show the same Events category, its checklist, its Deal Merchant Agreement and
 * MyCity's stages. A refusal reads as the server's does. Laptops and CI only (F12).
 */

type Meaning = NonNullable<ListValue["meaning"]>;
type Template = CategoryDetail["templates"][number] & { title: string | null; body_html: string };
type Category = Omit<CategoryDetail, "templates" | "checklist" | "fields" | "counts"> & { partners: number; leads: number; open_deals: number };

const chip = (field: string, label: string, helper?: string) =>
  `<span data-field="${field}" data-label="${label}">{{ ${helper ? `${helper} ` : ""}${field} }}</span>`;

const WORDING = [
  "<h2>Deal Merchant Agreement</h2>",
  `<p>Date: ${chip("today", "Date", "longdate")}</p>`,
  `<p>Business Name: ${chip("partner.name", "Business Name")}</p>`,
  `<p>Address: ${chip("partner.headquarters", "Address")}</p>`,
  `<p>Contact person: ${chip("contact.full_name", "Contact Person")}</p>`,
  `<p>Deal Title: ${chip("deal.title", "Deal Title")}</p>`,
  "<h3>Financials</h3>",
  `<p>${chip("deal.options", "Deal Options")}</p>`,
  "<h3>Deal Validity</h3>",
  `<p>${chip("deal.validity_label", "Validity")}, ending ${chip("deal.valid_until", "Valid Until", "longdate")}</p>`,
  "<h3>Fine Print and Highlights</h3>",
  `<p>${chip("category.checklist", "Delivery Checklist")}</p>`,
  `<p>Opening hours: ${chip("ask.opening_hours", "Opening Hours")}</p>`,
  "<h3>Acceptance of Agreement</h3>",
  "<p>The Company shall remit payment for coupons to the Merchant based on redeemed coupons as per agreed days interval till deal expiration.</p>",
  `<p>Name of Representative: ${chip("signer.name", "Signer Name")}</p>`,
  `<p>Signature: ${chip("signer.signature", "Signature")}</p>`,
].join("");

const RECORD_FIELDS = [...partner_pipeline.AGREEMENT_RECORD_FIELDS] as Array<{ field: string; label: string; type: string; source: string }>;

let CATEGORIES: Category[] = [
  { partner_category_id: "5a1d0c10-0000-4000-8000-000000000001", name: "Event", description: "Events ticketed and checked in on MyCityApp.", default_commission_pct: null, default_validity_days: 30, counts_as_vendor: false, display_order: 10, active: true, partners: 6, leads: 14, open_deals: 9 },
  { partner_category_id: "5a1d0c10-0000-4000-8000-000000000002", name: "Hospitality", description: null, default_commission_pct: "8.00", default_validity_days: 60, counts_as_vendor: false, display_order: 20, active: true, partners: 4, leads: 11, open_deals: 7 },
  { partner_category_id: "5a1d0c10-0000-4000-8000-000000000003", name: "Vendor", description: null, default_commission_pct: null, default_validity_days: null, counts_as_vendor: true, display_order: 30, active: true, partners: 3, leads: 22, open_deals: 12 },
  { partner_category_id: "5a1d0c10-0000-4000-8000-000000000004", name: "Media", description: null, default_commission_pct: null, default_validity_days: null, counts_as_vendor: false, display_order: 40, active: true, partners: 2, leads: 5, open_deals: 3 },
  // The demonstration partners' other types (partnerships.ts files its leads and partners under these).
  { partner_category_id: "5a1d0c10-0000-4000-8000-000000000005", name: "Sponsorship", description: null, default_commission_pct: null, default_validity_days: null, counts_as_vendor: false, display_order: 50, active: true, partners: 2, leads: 3, open_deals: 3 },
  { partner_category_id: "5a1d0c10-0000-4000-8000-000000000006", name: "Strategic", description: null, default_commission_pct: null, default_validity_days: null, counts_as_vendor: false, display_order: 60, active: true, partners: 1, leads: 1, open_deals: 1 },
  { partner_category_id: "5a1d0c10-0000-4000-8000-000000000007", name: "Government", description: null, default_commission_pct: null, default_validity_days: null, counts_as_vendor: false, display_order: 70, active: true, partners: 3, leads: 6, open_deals: 5 },
  { partner_category_id: "5a1d0c10-0000-4000-8000-000000000008", name: "Community", description: null, default_commission_pct: null, default_validity_days: null, counts_as_vendor: false, display_order: 80, active: true, partners: 2, leads: 3, open_deals: 2 },
];

const EVENT = CATEGORIES[0].partner_category_id;
let TEMPLATES: Template[] = [
  {
    partner_category_template_id: "5a1d0c20-0000-4000-8000-000000000001",
    partner_category_id: EVENT,
    template_key: "event-deal-merchant-agreement",
    kind: "deal_merchant",
    label: "Deal Merchant Agreement",
    is_default: true,
    countersigned: true,
    active: true,
    asks: [
      { key: "opening_hours", label: "Opening Hours", type: "text", default: "24hrs" },
      { key: "service_period", label: "Service Period", type: "long_text", default: "For the period of the event, which is built up to event date, during event day and supported highlights after the event." },
    ],
    version: 1,
    title: "Deal Merchant Agreement",
    body_html: WORDING,
  },
];

const item = (n: number, title: string, description: string, due_from: "signing" | "event_start", due_days: number): ChecklistItem => ({
  partner_category_checklist_item_id: `5a1d0c30-0000-4000-8000-00000000000${n}`,
  partner_category_id: EVENT,
  title,
  description,
  due_from,
  due_days,
  position: n - 1,
  active: true,
});
let CHECKLIST: ChecklistItem[] = [
  item(1, "Platform and technical partnership", "Event registration on MyCityApp NG platform, with our team supporting the setup.", "signing", 7),
  item(2, "Amplification", "Our marketing team will push the event across our channels.", "event_start", 14),
  item(3, "Branded presence and souvenirs", "MyCityApp NG branded souvenir items distributed to attendees.", "event_start", 3),
  item(4, "Documentation", "Our on-ground team will join the media team to cover the event highlights.", "event_start", 0),
  item(5, "Ember to Remember calendar listing", "The event is featured on the national content calendar.", "signing", 14),
];

let FIELDS: Field[] = [
  { partnership_field_id: "5a1d0c40-0000-4000-8000-000000000001", key: "ticket_model", label: "Ticket Model", field_type: "pick", options: ["Free Entry", "Paid Tickets", "App Download"], applies_to: "deal", partner_category_id: EVENT, filterable: true, position: 10, active: true },
  { partnership_field_id: "5a1d0c40-0000-4000-8000-000000000002", key: "decision_maker", label: "Decision Maker", field_type: "text", options: null, applies_to: "lead", partner_category_id: null, filterable: false, position: 20, active: true },
];

const STAGES: Array<[string, Meaning]> = [
  ["Prospect Identified", "prospect"],
  ["Initial Contact", "contacted"],
  ["Introductory Meeting Scheduled", "meeting"],
  ["Introductory Meeting Held", "meeting"],
  ["Proposal Sent", "proposal"],
  ["Follow-up Ongoing", "proposal"],
  ["Negotiation", "negotiation"],
  ["Verbal Approval", "negotiation"],
  ["Contract Review", "negotiation"],
  ["Partnership Signed", "signed"],
  ["Active Partnership", "active"],
  ["Closed Lost", "closed_lost"],
  ["On Hold", "on_hold"],
];
const codeOf = (label: string) => label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
const value = (label: string, position: number, meaning: Meaning | null = null): ListValue => ({ code: codeOf(label), label, meaning, position, active: true });
const LISTS: Record<string, ListValue[]> = {
  partnership_stage: STAGES.map(([l, m], i) => value(l, (i + 1) * 10, m)),
  partnership_impact: ["App Downloads & Visibility", "Revenue Generation", "Brand Visibility", "User Acquisition", "Vendor Acquisition", "Content Collaboration", "Community Growth", "Business Listings", "Strategic Positioning"].map((l, i) => value(l, (i + 1) * 10)),
  lead_source: ["Referral", "Event", "Inbound", "Outreach"].map((l, i) => value(l, (i + 1) * 10)),
  partner_document_kind: ["Proposal", "MOU", "Service Agreement", "Contract", "Brief", "Invoice", "Media", "Other"].map((l, i) => value(l, (i + 1) * 10)),
};
const REQUIRED: Record<string, string> = { prospect: "starts", signed: "signs", closed_lost: "loses" };

let PROOF: ProofPoint[] = [
  { proof_point_id: "5a1d0c50-0000-4000-8000-000000000001", kind: "stat", label: "Network and community", value: "10,000+", detail: null, document: null, source_note: "MyCity's standard agreement wording", position: 10, active: true },
  { proof_point_id: "5a1d0c50-0000-4000-8000-000000000002", kind: "endorsement", label: "Ember to Remember calendar", value: null, detail: "Recognized and approved by the Federal Government of Nigeria.", document: null, source_note: null, position: 20, active: true },
  { proof_point_id: "5a1d0c50-0000-4000-8000-000000000003", kind: "endorsement", label: "MTN Nigeria", value: null, detail: "Supports the Ember to Remember calendar.", document: null, source_note: null, position: 30, active: true },
];

const detail = (c: Category): CategoryDetail => {
  const { partners, leads, open_deals, ...rest } = c;
  return {
    ...rest,
    templates: TEMPLATES.filter((t) => t.partner_category_id === c.partner_category_id).map(({ title: _t, body_html: _b, ...t }) => t),
    checklist: CHECKLIST.filter((i) => i.partner_category_id === c.partner_category_id).sort((a, b) => Number(b.active) - Number(a.active) || a.position - b.position),
    fields: FIELDS.filter((f) => f.partner_category_id === null || f.partner_category_id === c.partner_category_id),
    counts: { partners, leads, open_deals },
  };
};
const category = (id: string) => CATEGORIES.find((c) => c.partner_category_id === id);
const taken = (name: string, except?: string) => CATEGORIES.some((c) => c.partner_category_id !== except && c.name.toLowerCase() === name.trim().toLowerCase());
const text = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

route("GET /api/v1/partnerships/categories", (req) =>
  paged(
    CATEGORIES.map(({ open_deals: _o, ...c }) => c),
    req,
    {
      search: (c) => [c.name, c.description],
      filters: { active: (c, v) => String(c.active) === v },
      sort: { display_order: (a, b) => (a.display_order ?? 0) - (b.display_order ?? 0), name: (a, b) => a.name.localeCompare(b.name) },
    },
  ),
);
route("GET /api/v1/partnerships/categories/:id", (req) => {
  const c = category(req.params.id);
  return c ? ok(detail(c)) : notFound();
});
route("POST /api/v1/partnerships/categories", (req) => {
  const b = req.body as Partial<Category>;
  if (!b.name?.trim()) return invalid({ name: ["Add a name"] });
  if (taken(b.name)) return fail(409, "CATEGORY_NAME_TAKEN", "That name is taken", { name: ["Name in use"] });
  const c: Category = {
    partner_category_id: uuid(),
    name: b.name.trim(),
    description: b.description ?? null,
    default_commission_pct: b.default_commission_pct ? Number(b.default_commission_pct).toFixed(2) : null,
    default_validity_days: b.default_validity_days ?? null,
    counts_as_vendor: b.counts_as_vendor ?? false,
    display_order: (CATEGORIES.at(-1)?.display_order ?? 0) + 10,
    active: true,
    partners: 0,
    leads: 0,
    open_deals: 0,
  };
  CATEGORIES = [...CATEGORIES, c];
  return created(detail(c));
});
route("PATCH /api/v1/partnerships/categories/:id", (req) => {
  const c = category(req.params.id);
  if (!c) return notFound();
  const b = req.body as Partial<Category>;
  if (b.name !== undefined && taken(b.name, c.partner_category_id)) return fail(409, "CATEGORY_NAME_TAKEN", "That name is taken", { name: ["Name in use"] });
  Object.assign(c, {
    ...b,
    ...(b.name !== undefined ? { name: b.name.trim() } : {}),
    ...(b.default_commission_pct ? { default_commission_pct: Number(b.default_commission_pct).toFixed(2) } : {}),
  });
  return ok(detail(c));
});

/* Agreement templates */

const versionOf = (t: Template) => t.version ?? 0;
const keyFrom = (c: Category, label: string) => `${c.name} ${label}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
route("POST /api/v1/partnerships/categories/:id/templates", (req) => {
  const c = category(req.params.id);
  if (!c) return notFound();
  if (!c.active) return fail(409, "CATEGORY_RETIRED", "Restore the category first");
  const b = req.body as Partial<Template>;
  if (text(b.body_html ?? "").length < 40) return invalid({ body_html: ["Write the agreement"] });
  const first = !TEMPLATES.some((t) => t.partner_category_id === c.partner_category_id && t.kind === b.kind && t.is_default && t.active);
  const makeDefault = b.is_default === true || first;
  if (makeDefault) TEMPLATES.forEach((t) => t.partner_category_id === c.partner_category_id && t.kind === b.kind && (t.is_default = false));
  TEMPLATES = [
    ...TEMPLATES,
    {
      partner_category_template_id: uuid(),
      partner_category_id: c.partner_category_id,
      template_key: b.template_key ?? keyFrom(c, b.label ?? "agreement"),
      kind: b.kind!,
      label: b.label!,
      is_default: makeDefault,
      countersigned: b.countersigned ?? false,
      active: true,
      asks: b.asks ?? [],
      version: 1,
      title: b.title ?? null,
      body_html: b.body_html!,
    },
  ];
  return created(detail(c));
});
route("GET /api/v1/partnerships/category-templates/:id", (req) => {
  const t = TEMPLATES.find((x) => x.partner_category_template_id === req.params.id);
  if (!t) return notFound();
  const { body_html, title, ...rest } = t;
  return ok({ ...rest, title, body_html, record_fields: RECORD_FIELDS });
});
route("PATCH /api/v1/partnerships/category-templates/:id", (req) => {
  const t = TEMPLATES.find((x) => x.partner_category_template_id === req.params.id);
  if (!t) return notFound();
  const b = req.body as Partial<Template>;
  if (b.is_default) TEMPLATES.forEach((o) => o.partner_category_id === t.partner_category_id && o.kind === t.kind && (o.is_default = false));
  Object.assign(t, b);
  if (b.active === false && t.is_default) {
    t.is_default = false;
    const next = TEMPLATES.find((o) => o.partner_category_id === t.partner_category_id && o.kind === t.kind && o.active && o !== t);
    if (next) next.is_default = true;
  }
  return ok(detail(category(t.partner_category_id)!));
});
route("PUT /api/v1/partnerships/category-templates/:id/wording", (req) => {
  const t = TEMPLATES.find((x) => x.partner_category_template_id === req.params.id);
  if (!t) return notFound();
  if (!t.active) return fail(409, "TEMPLATE_RETIRED", "A retired template is not edited");
  const b = req.body as { title?: string | null; body_html: string; asks?: Template["asks"] };
  if (text(b.body_html).length < 40) return invalid({ body_html: ["Write the agreement"] });
  Object.assign(t, { body_html: b.body_html, title: b.title ?? t.title, version: versionOf(t) + 1, ...(b.asks ? { asks: b.asks } : {}) });
  const { body_html, title, ...rest } = t;
  return ok({ ...rest, title, body_html, record_fields: RECORD_FIELDS });
});

/* Tidy With AI: the mock lays the pasted text out as paragraphs and marks a Business Name line. */
route("POST /api/v1/partnerships/templates/tidy", (req) => {
  const body = String((req.body as { text?: string }).text ?? "");
  if (!body.trim()) return invalid({ text: ["Paste the agreement"] });
  const paragraphs = body.split(/\n{2,}|\n/).map((p) => p.trim()).filter(Boolean);
  let found: string | null = null;
  const html = paragraphs
    .map((p) => {
      const m = /^Business Name:\s*(.+)$/i.exec(p);
      if (!m) return `<p>${p.replace(/[<>&]/g, "")}</p>`;
      found = m[1];
      return `<p>Business Name: ${chip("partner.name", "Business Name")}</p>`;
    })
    .join("");
  return ok({
    available: true,
    reason: null,
    body_html: html,
    fields: found ? [{ found, field: "partner.name", source: "record", label: "Business Name", ask_type: null }] : [],
    ai_run_id: null,
  });
});

/* Delivery checklist */

const placeItem = (categoryId: string, id: string, to: number) => {
  const ids = CHECKLIST.filter((i) => i.partner_category_id === categoryId && i.active && i.partner_category_checklist_item_id !== id).sort((a, b) => a.position - b.position).map((i) => i.partner_category_checklist_item_id);
  ids.splice(Math.max(0, Math.min(to, ids.length)), 0, id);
  ids.forEach((x, p) => (CHECKLIST.find((i) => i.partner_category_checklist_item_id === x)!.position = p));
};
route("POST /api/v1/partnerships/categories/:id/checklist", (req) => {
  const c = category(req.params.id);
  if (!c) return notFound();
  const b = req.body as Partial<ChecklistItem>;
  if (!b.title || b.title.trim().length < 3) return invalid({ title: ["At least 3 letters"] });
  const id = uuid();
  const end = CHECKLIST.filter((i) => i.partner_category_id === c.partner_category_id && i.active).length;
  CHECKLIST = [...CHECKLIST, { partner_category_checklist_item_id: id, partner_category_id: c.partner_category_id, title: b.title.trim(), description: b.description ?? null, due_from: b.due_from ?? "signing", due_days: b.due_days ?? 0, position: end, active: true }];
  if (b.position !== undefined) placeItem(c.partner_category_id, id, b.position);
  return created(detail(c));
});
route("PATCH /api/v1/partnerships/checklist-items/:id", (req) => {
  const i = CHECKLIST.find((x) => x.partner_category_checklist_item_id === req.params.id);
  if (!i) return notFound();
  const { position, ...rest } = req.body as Partial<ChecklistItem>;
  Object.assign(i, rest);
  if (i.active && (position !== undefined || rest.active === true)) placeItem(i.partner_category_id, i.partner_category_checklist_item_id, position ?? Number.MAX_SAFE_INTEGER);
  return ok(detail(category(i.partner_category_id)!));
});

/* Custom fields */

route("GET /api/v1/partnerships/fields", (req) => {
  const q = req.query;
  return ok({
    data: FIELDS.filter(
      (f) =>
        (!q.applies_to || f.applies_to === q.applies_to) &&
        (!q.partner_category_id || f.partner_category_id === null || f.partner_category_id === q.partner_category_id) &&
        (q.active === undefined || String(f.active) === q.active),
    ),
  });
});
route("POST /api/v1/partnerships/fields", (req) => {
  const b = req.body as Partial<Field>;
  if (!b.label?.trim()) return invalid({ label: ["Add a label"] });
  if (["pick", "multi_pick"].includes(b.field_type ?? "") && !b.options?.length) return invalid({ options: ["Add the choices"] });
  let key = b.label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  for (let n = 2; FIELDS.some((f) => f.key === key); n += 1) key = `${key.replace(/_\d+$/, "")}_${n}`;
  const f: Field = { partnership_field_id: uuid(), key, label: b.label.trim(), field_type: b.field_type!, options: b.options ?? null, applies_to: b.applies_to!, partner_category_id: b.partner_category_id ?? null, filterable: b.filterable ?? false, position: (FIELDS.at(-1)?.position ?? 0) + 10, active: true };
  FIELDS = [...FIELDS, f];
  return created(f);
});
route("PATCH /api/v1/partnerships/fields/:id", (req) => {
  const f = FIELDS.find((x) => x.partnership_field_id === req.params.id);
  if (!f) return notFound();
  Object.assign(f, req.body);
  return ok(f);
});

/* MyCity's lists */

const ordered = (list: string) => [...(LISTS[list] ?? [])].sort((a, b) => Number(b.active) - Number(a.active) || a.position - b.position);

/** The categories as Categories holds them now, for the deals' mock (partnerships.ts): one source, so a rename shows on Pipeline too. */
export const mockCategories = () => CATEGORIES;
/** One of MyCity's lists as Categories holds it now, in its order, for the deals' mock. */
export const mockList = (list: string): ListValue[] => ordered(list);
route("GET /api/v1/partnerships/lists/:list", (req) => (LISTS[req.params.list] ? ok({ list: req.params.list, values: ordered(req.params.list) }) : notFound()));
route("POST /api/v1/partnerships/lists/:list", (req) => {
  const list = LISTS[req.params.list];
  if (!list) return notFound();
  const b = req.body as { label?: string; meaning?: Meaning };
  if (!b.label?.trim()) return invalid({ label: ["Add a name"] });
  if (req.params.list === "partnership_stage" && !b.meaning) return invalid({ meaning: ["Pick what it counts as"] });
  if (req.params.list !== "partnership_stage" && b.meaning) return invalid({ meaning: ["Stages only"] });
  if (list.some((v) => v.active && v.label.toLowerCase() === b.label!.trim().toLowerCase())) return fail(409, "LABEL_TAKEN", "That name is taken", { label: ["Name in use"] });
  let code = codeOf(b.label);
  for (let n = 2; list.some((v) => v.code === code); n += 1) code = `${codeOf(b.label)}_${n}`;
  list.push({ code, label: b.label.trim(), meaning: b.meaning ?? null, position: (list.at(-1)?.position ?? 0) + 10, active: true });
  return created({ list: req.params.list, values: ordered(req.params.list) });
});
route("PATCH /api/v1/partnerships/lists/:list/:code", (req) => {
  const list = LISTS[req.params.list];
  const v = list?.find((x) => x.code === req.params.code);
  if (!list || !v) return notFound();
  const b = req.body as { label?: string; meaning?: Meaning; position?: number; active?: boolean };
  if (req.params.list === "partnership_stage" && v.meaning && v.active && ((b.active === false) || (b.meaning && b.meaning !== v.meaning))) {
    const left = list.filter((x) => x.active && x.meaning === v.meaning && x !== v).length;
    if (!left && REQUIRED[v.meaning]) return fail(409, "STAGE_LAST_OF_MEANING", `Keep a stage that ${REQUIRED[v.meaning]} a deal`, { meaning: ["Last of its kind"] });
  }
  Object.assign(v, b);
  // As the API does after a move: the values in use numbered 10, 20, 30 in their order, so none ever ties.
  if (b.position !== undefined)
    ordered(req.params.list)
      .filter((x) => x.active)
      .forEach((x, i) => (x.position = (i + 1) * 10));
  return ok({ list: req.params.list, values: ordered(req.params.list) });
});

/* Start From Tracker: a laptop cannot carry a workbook, so the mock reads the same dropdowns every time. */
route("POST /api/v1/partnerships/setup/from-tracker", () =>
  ok({
    stages: STAGES.map(([label, meaning]) => ({ label, meaning })),
    categories: [{ name: "Event" }, { name: "Hospitality" }, { name: "Vendor" }, { name: "Media" }, { name: "Corporate" }, { name: "Community" }],
    impact: LISTS.partnership_impact.map((v) => ({ label: v.label })),
  }),
);
route("POST /api/v1/partnerships/setup/from-tracker/apply", (req) => {
  const b = req.body as { stages: Array<{ label: string; meaning: Meaning }>; categories: Array<{ name: string }>; impact: Array<{ label: string }> };
  const made = { stages: 0, categories: 0, impact: 0 };
  for (const s of b.stages) {
    if (LISTS.partnership_stage.some((v) => v.label.toLowerCase() === s.label.toLowerCase())) continue;
    LISTS.partnership_stage.push(value(s.label, (LISTS.partnership_stage.at(-1)?.position ?? 0) + 10, s.meaning));
    made.stages += 1;
  }
  for (const i of b.impact) {
    if (LISTS.partnership_impact.some((v) => v.label.toLowerCase() === i.label.toLowerCase())) continue;
    LISTS.partnership_impact.push(value(i.label, (LISTS.partnership_impact.at(-1)?.position ?? 0) + 10));
    made.impact += 1;
  }
  for (const c of b.categories) {
    if (taken(c.name)) continue;
    CATEGORIES = [...CATEGORIES, { partner_category_id: uuid(), name: c.name, description: null, default_commission_pct: null, default_validity_days: null, counts_as_vendor: false, display_order: (CATEGORIES.at(-1)?.display_order ?? 0) + 10, active: true, partners: 0, leads: 0, open_deals: 0 }];
    made.categories += 1;
  }
  return ok(made);
});

/* Proof points */

route("GET /api/v1/partnerships/proof-points", (req) =>
  paged(PROOF, req, {
    search: (p) => [p.label, p.value, p.detail],
    filters: { kind: (p, v) => p.kind === v, active: (p, v) => String(p.active) === v },
    sort: { position: (a, b) => a.position - b.position, label: (a, b) => a.label.localeCompare(b.label) },
  }),
);
route("POST /api/v1/partnerships/proof-points", (req) => {
  const b = req.body as Partial<ProofPoint>;
  if (!b.label?.trim()) return invalid({ label: ["Add a label"] });
  const p: ProofPoint = { proof_point_id: uuid(), kind: b.kind!, label: b.label.trim(), value: b.value ?? null, detail: b.detail ?? null, document: null, source_note: b.source_note ?? null, position: (PROOF.at(-1)?.position ?? 0) + 10, active: true };
  PROOF = [...PROOF, p];
  return created(p);
});
route("PATCH /api/v1/partnerships/proof-points/:id", (req) => {
  const p = PROOF.find((x) => x.proof_point_id === req.params.id);
  if (!p) return notFound();
  const { document_id, ...rest } = req.body as Partial<ProofPoint> & { document_id?: null };
  Object.assign(p, rest);
  if (document_id === null) p.document = null;
  return ok(p);
});
