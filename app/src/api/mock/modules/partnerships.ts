import type {
  CategoryRow,
  Contact,
  DealDetail,
  DealOption,
  DealReturn,
  DealRow,
  Interaction,
  Lead360,
  LeadDetail,
  LeadRow,
  ListValue,
  Partner360,
  PartnerDetail,
  PartnerDocument,
  PartnerRow,
  PipelineDeal,
  PlaceView,
  StageHistoryLine,
} from "@mycity/contract/contract.gen.ts";
import type { Contract, Proposal } from "@/api/types/partnerships";
import type { Status } from "@/api/types/performance";
import { at, created, fail, invalid, isoDaysAgo, isoDaysAhead, notFound, ok, paged, route, sid, type Req } from "../core";
import { byId, byKey, refKey } from "../data/people";
import { PARTNERS, type MockPartner } from "../data/partners";
import { pickedPlace, placeOf } from "./maps";

/**
 * Partnerships on the mock (docs/guides/partnerships.md): Pipeline, Partners, Leads and both 360s in
 * the contract's shapes (packages/contract/schemas/partner_pipeline.js, leads.js, partners.js,
 * interactions.js), by the API's own rules where a screen can see them: a lead's status read from its
 * deal's stage, reasons for a move back, On Hold and Closed Lost, the signed copy for a signed stage,
 * Stalled needing blockers, conversion making the partner. Everyone signed in sees every record, as
 * the Operations account the screen gates sign in as does (§6.1). Proposals, Contracts & MOUs and
 * Analytics stay on their INTERIM shapes below until M7 PR 6 to 8.
 */

const S = (tone: Status["tone"], text: string): Status => ({ tone, text });
const k = (m: string) => Math.round(Number(m) * 100);
const m = (kobo: number) => `${Math.trunc(kobo / 100)}.${String(kobo % 100).padStart(2, "0")}`;
const now = () => new Date().toISOString();

/* ------------------------------------------------------------------ *
 * MyCity's lists and categories, as Categories enters them
 * ------------------------------------------------------------------ */

const STAGE_ROWS: Array<[string, string, ListValue["meaning"]]> = [
  ["prospect_identified", "Prospect Identified", "prospect"],
  ["initial_contact", "Initial Contact", "contacted"],
  ["intro_meeting_scheduled", "Meeting Scheduled", "meeting"],
  ["intro_meeting_held", "Meeting Held", "meeting"],
  ["proposal_sent", "Proposal Sent", "proposal"],
  ["follow_up_ongoing", "Follow-Up Ongoing", "proposal"],
  ["negotiation", "Negotiation", "negotiation"],
  ["verbal_approval", "Verbal Approval", "negotiation"],
  ["contract_review", "Contract Review", "negotiation"],
  ["partnership_signed", "Partnership Signed", "signed"],
  ["active_partnership", "Active Partnership", "active"],
  ["closed_lost", "Closed Lost", "closed_lost"],
  ["on_hold", "On Hold", "on_hold"],
];
const STAGES: ListValue[] = STAGE_ROWS.map(([code, label, meaning], i) => ({ code, label, meaning, position: (i + 1) * 10, active: true }));
const LISTS: Record<string, ListValue[]> = {
  partnership_stage: STAGES,
  partnership_impact: ["App Downloads & Visibility", "Revenue Generation", "Brand Visibility", "User Acquisition", "Vendor Acquisition", "Community Growth"].map((label, i) => ({
    code: label.toLowerCase().replace(/[^a-z]+/g, "_").replace(/_$/, ""),
    label,
    meaning: null,
    position: (i + 1) * 10,
    active: true,
  })),
  lead_source: ["Referral", "Event", "Inbound", "Outreach"].map((label, i) => ({ code: label.toLowerCase(), label, meaning: null, position: (i + 1) * 10, active: true })),
  partner_document_kind: ["Proposal", "MOU", "Service Agreement", "Contract", "Brief", "Invoice", "Media", "Other"].map((label, i) => ({
    code: label.toLowerCase().replace(/\s+/g, "_"),
    label,
    meaning: null,
    position: (i + 1) * 10,
    active: true,
  })),
};
/** The tracker's stage names in the demonstration partners, as MyCity's codes. */
const FROM_TRACKER: Record<string, string> = {
  "Prospect identified": "prospect_identified",
  "Initial contact": "initial_contact",
  "Intro meeting scheduled": "intro_meeting_scheduled",
  "Intro meeting held": "intro_meeting_held",
  "Proposal sent": "proposal_sent",
  "Follow up": "follow_up_ongoing",
  "Ongoing negotiation": "negotiation",
  "Verbal approval": "verbal_approval",
  "Contract review": "contract_review",
  "Partnership signed": "partnership_signed",
  "Active partnership": "active_partnership",
  "On hold": "on_hold",
};
const stageOf = (code: string) => STAGES.find((s) => s.code === code) ?? null;
const meaningOf = (code: string) => stageOf(code)?.meaning ?? null;
const SIGNED = new Set(["signed", "active"]);
const LEAD_STATUS: Record<string, LeadRow["status"]> = { prospect: "new", contacted: "contacted", meeting: "contacted", proposal: "qualified", negotiation: "qualified", closed_lost: "lost", signed: "converted", active: "converted" };

interface MockCategory {
  partner_category_id: string;
  name: string;
  default_commission_pct: string | null;
  default_validity_days: number | null;
}
const CATEGORIES: MockCategory[] = [
  ["Event", "8.00", 30],
  ["Hospitality", "10.00", 60],
  ["Sponsorship", null, null],
  ["Strategic", null, null],
  ["Government", null, null],
  ["Media", null, null],
  ["Community", null, null],
  ["Vendor", "5.00", 30],
].map(([name, pct, days]) => ({ partner_category_id: sid(`category:${name}`), name: name as string, default_commission_pct: pct as string | null, default_validity_days: days as number | null }));
const categoryOf = (id: string | null | undefined) => CATEGORIES.find((c) => c.partner_category_id === id) ?? null;

/* ------------------------------------------------------------------ *
 * Leads, partners and their deals
 * ------------------------------------------------------------------ */

interface MockRecord {
  kind: "lead" | "partner";
  id: string;
  number: string;
  name: string;
  legal_name: string | null;
  category_id: string | null;
  region_scope: "cities" | "national" | "africa" | "worldwide" | null;
  cities: PlaceView[];
  industry: string | null;
  website: string | null;
  owner: string | null;
  status: string;
  created_at: string;
  identified_on: string | null;
  since: string | null;
  source: string | null;
  objective: string | null;
  comments: string | null;
  lost_reason: string | null;
  converted_partner_id: string | null;
  converted_at: string | null;
  lead_id: string | null;
  signed_outside: boolean;
  closed_at: string | null;
  close_reason: string | null;
  headquarters: PlaceView | null;
}
interface MockDeal {
  id: string;
  number: string;
  lead_id: string | null;
  partner_id: string | null;
  title: string;
  stage: string;
  status: DealRow["status"];
  health: DealRow["health"];
  blockers: string | null;
  owner: string | null;
  estimated_value: string | null;
  expected_close_on: string | null;
  event_title: string | null;
  event_starts_on: string | null;
  event_ends_on: string | null;
  venue: PlaceView | null;
  expected_attendance: number | null;
  objective: string | null;
  next_action: string | null;
  next_action_on: string | null;
  commission_pct: string | null;
  validity_days: number | null;
  valid_until: string | null;
  signed_at: string | null;
  close_reason: string | null;
  options: DealOption[];
  members: string[];
  history: StageHistoryLine[];
  stage_since: string;
  created_at: string;
  impact_rating: DealDetail["impact_rating"];
  impact_note: string | null;
  comments: string | null;
}

const RECORDS: MockRecord[] = [];
const DEALS: MockDeal[] = [];
const CONTACTS: Contact[] = [];
const INTERACTIONS: Interaction[] = [];
const DOCUMENTS: Array<PartnerDocument & { record_id: string }> = [];
const RETURNS: DealReturn[] = [];
const seq = { partner: 0, lead: 0, deal: 0 };
const year = () => isoDaysAgo(0).slice(0, 4);
const num = (kind: "partner" | "lead" | "deal") => {
  seq[kind] += 1;
  const n = String(seq[kind]).padStart(4, "0");
  return kind === "partner" ? `PAR-${n}` : kind === "lead" ? `LED-${n}` : `DEAL-${year()}-${n}`;
};
const CITY_OF: Record<string, string> = { Lagos: "Lagos, Nigeria", Abuja: "Abuja, Nigeria", Enugu: "Enugu, Nigeria", Kano: "Kano, Nigeria", Ibadan: "Ibadan, Nigeria" };
const cityOf = (hq: string) => {
  const last = hq.split(",").pop()!.trim();
  return CITY_OF[last] ? pickedPlace(CITY_OF[last]).view : null;
};
const line = (kind: StageHistoryLine["kind"], from: string | null, to: string, by: string | null, when: string, reason: string | null = null, source: StageHistoryLine["source"] = "person"): StageHistoryLine => ({
  partnership_stage_history_id: sid(`history:${to}:${when}:${Math.random()}`),
  kind,
  from_stage: from,
  to_stage: to,
  from_label: from ? (kind === "stage" ? (stageOf(from)?.label ?? from) : HEALTH_LABEL[from]) : null,
  to_label: kind === "stage" ? (stageOf(to)?.label ?? to) : HEALTH_LABEL[to],
  reason,
  source,
  by: by ? refKey(by) : null,
  changed_at: when,
});
const HEALTH_LABEL: Record<string, string> = { on_track: "On Track", follow_up_required: "Follow-Up Required", stalled: "Stalled" };

function seed(p: MockPartner, i: number) {
  const code = FROM_TRACKER[p.stage] ?? "prospect_identified";
  const signed = SIGNED.has(meaningOf(code) ?? "");
  const category = CATEGORIES.find((c) => c.name === p.type) ?? CATEGORIES[2];
  const city = cityOf(p.hq);
  const made = at(Math.max(p.days_at_stage, p.quiet_days) + 20, "09:00");
  const r: MockRecord = {
    kind: signed ? "partner" : "lead",
    id: sid(`${signed ? "partner" : "lead"}:${p.name}`),
    number: num(signed ? "partner" : "lead"),
    name: p.name,
    legal_name: signed ? p.legal_name : null,
    category_id: category.partner_category_id,
    region_scope: city ? "cities" : "national",
    cities: city ? [city] : [],
    industry: p.industry,
    website: p.website,
    owner: p.owner,
    status: signed ? "active" : (LEAD_STATUS[meaningOf(code) ?? ""] ?? "contacted"),
    created_at: made,
    identified_on: made.slice(0, 10),
    since: signed ? (p.since ?? made.slice(0, 10)) : null,
    source: signed ? null : (["referral", "event", "outreach"] as const)[i % 3],
    objective: `Grow ${p.name} on MyCityApp through ${category.name.toLowerCase()} activity.`,
    comments: null,
    lost_reason: null,
    converted_partner_id: null,
    converted_at: null,
    lead_id: null,
    signed_outside: signed,
    closed_at: null,
    close_reason: null,
    headquarters: null,
  };
  if (code === "on_hold") r.status = "contacted";
  RECORDS.push(r);
  const since = at(p.days_at_stage, "15:30");
  const deal: MockDeal = {
    id: sid(`deal:${p.name}`),
    number: num("deal"),
    lead_id: signed ? null : r.id,
    partner_id: signed ? r.id : null,
    title: signed ? `${p.name} ${category.name} Partnership` : `${p.name} ${category.name} Deal`,
    stage: code,
    status: signed ? "live" : "open",
    health: p.quiet_days > 30 ? "follow_up_required" : i % 7 === 3 ? "stalled" : "on_track",
    blockers: i % 7 === 3 && p.quiet_days <= 30 ? "Waiting on their legal team's review of the terms" : null,
    owner: p.owner,
    estimated_value: p.value,
    expected_close_on: signed ? null : isoDaysAhead(20 + (i % 5) * 15),
    event_title: category.name === "Event" ? `${p.name} Festival` : null,
    event_starts_on: null,
    event_ends_on: null,
    venue: null,
    expected_attendance: null,
    objective: r.objective,
    next_action: signed ? "Quarterly review" : "Send the proposal",
    next_action_on: isoDaysAhead(5 + (i % 9)),
    commission_pct: category.default_commission_pct,
    validity_days: category.default_validity_days,
    valid_until: null,
    signed_at: signed ? at(p.days_at_stage + 5, "12:00") : null,
    close_reason: null,
    options: signed
      ? [
          { deal_option_id: sid(`option:${p.name}:1`), position: 1, label: "Regular", original_price: "12000.00", discount_pct: "10.00", deal_price: "10800.00", price_note: null, commission_amount: "864.00", merchant_take: "9936.00" },
          { deal_option_id: sid(`option:${p.name}:2`), position: 2, label: "VIP", original_price: "30000.00", discount_pct: null, deal_price: "30000.00", price_note: null, commission_amount: "2400.00", merchant_take: "27600.00" },
        ]
      : [],
    members: [p.owner],
    history: [line("stage", null, "prospect_identified", p.owner, made), ...(code !== "prospect_identified" ? [line("stage", "prospect_identified", code, p.owner, since)] : [])],
    stage_since: since,
    created_at: made,
    impact_rating: (["high", "medium", "low"] as const)[i % 3],
    impact_note: null,
    comments: null,
  };
  if (deal.blockers) deal.health = "stalled";
  if (deal.health === "stalled" && !deal.blockers) deal.blockers = "No reply since the last meeting";
  DEALS.push(deal);
  CONTACTS.push({
    partner_contact_id: sid(`contact:${p.name}`),
    partner_id: signed ? r.id : null,
    lead_id: signed ? null : r.id,
    first_name: ["Ngozi", "Femi", "Amaka", "Tunde", "Halima", "Chidi"][i % 6],
    last_name: ["Adebayo", "Bello", "Okafor", "Lawal", "Musa", "Eze"][(i + 2) % 6],
    job_title: "Head of Partnerships",
    email: `partnerships@${p.website}`,
    phones: ["+2348030000000"],
    primary_contact: true,
    signatory: signed,
    created_at: made,
  });
  INTERACTIONS.push({
    partner_interaction_id: sid(`interaction:${p.name}`),
    partner_id: signed ? r.id : null,
    lead_id: signed ? null : r.id,
    deal_id: deal.id,
    contact: { partner_contact_id: sid(`contact:${p.name}`), name: CONTACTS[CONTACTS.length - 1].first_name },
    interaction_type: (["call", "meeting", "email"] as const)[i % 3],
    subject: signed ? "Quarterly review" : "Follow-up on the proposal",
    summary: signed ? "Reviewed the month's downloads and the next activation." : "They asked for the ticket tiers in writing.",
    occurred_at: at(p.quiet_days, "11:00"),
    owner: refKey(p.owner),
    from_mail: false,
    created_at: at(p.quiet_days, "11:00"),
  });
  if (signed) {
    DOCUMENTS.push({
      record_id: r.id,
      document: { document_id: sid(`doc:${p.name}`), file_name: `${p.name} Agreement.pdf`, size_bytes: 248000, mime_type: "application/pdf" },
      kind: null,
      kind_label: null,
      deal_id: deal.id,
      origin: "signed_copy",
      uploaded_by: refKey(p.owner).display_name,
      created_at: deal.signed_at!,
    });
    RETURNS.push({ deal_return_id: sid(`return:${p.name}`), deal_id: deal.id, month: `${isoDaysAgo(35).slice(0, 7)}-01`, units_sold: 40 + i, gross_sales: "432000.00", mycity_commission: "34560.00", paid_to_partner: "397440.00", downloads: 120 + i * 3, note: null, source: "entered", entered_by_name: refKey(p.owner).display_name, updated_at: at(30, "10:00") });
  }
}
PARTNERS.forEach(seed);

const recordOf = (id: string | null | undefined) => RECORDS.find((r) => r.id === id) ?? null;
const dealOf = (id: string | null | undefined) => DEALS.find((d) => d.id === id) ?? null;
const recordOfDeal = (d: MockDeal) => recordOf(d.partner_id ?? d.lead_id)!;
const regionLabel = (r: MockRecord) =>
  r.region_scope === "cities" ? r.cities.map((c) => (c.formatted ?? "").split(",")[0]).join(", ") || null : r.region_scope ? { national: "National", africa: "Africa", worldwide: "Worldwide" }[r.region_scope] : null;
const days = (iso: string) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000));
const lastContact = (r: MockRecord) => INTERACTIONS.filter((x) => (r.kind === "partner" ? x.partner_id : x.lead_id) === r.id).reduce<string | null>((a, x) => (!a || x.occurred_at > a ? x.occurred_at : a), null);
const person = (key: string | null) => (key ? refKey(key) : null);
const keyOfEmployee = (id: unknown) => byId(String(id ?? ""))?.user_key ?? null;
/** Who may give money terms: Operations, the CEO and Management hold partnerships.money (§8). */
const holdsMoney = (req: Req) => ["cynthia", "ifeoma"].includes(String(req.user ?? ""));
const recordRef = (r: MockRecord) => ({ type: r.kind, id: r.id, number: r.number, name: r.name });
const signedValue = (d: MockDeal) => (d.signed_at ? d.estimated_value : null);

function dealRow(d: MockDeal): DealRow {
  const r = recordOfDeal(d);
  const st = stageOf(d.stage);
  return {
    deal_id: d.id,
    number: d.number,
    title: d.title,
    record: recordRef(r),
    lead_id: d.lead_id,
    partner_id: d.partner_id,
    category: categoryOf(r.category_id)?.name ?? null,
    stage: d.stage,
    stage_label: st?.label ?? d.stage,
    meaning: st?.meaning ?? null,
    health: d.health,
    status: d.status,
    owner: person(d.owner),
    estimated_value: d.estimated_value,
    currency: "NGN",
    expected_close_on: d.expected_close_on,
    days_at_stage: days(d.stage_since),
    event_title: d.event_title,
    event_starts_on: d.event_starts_on,
    created_at: d.created_at,
  };
}
function dealDetail(d: MockDeal, money: boolean): DealDetail {
  const out: DealDetail = {
    ...dealRow(d),
    objective: d.objective,
    event_ends_on: d.event_ends_on,
    venue: d.venue,
    expected_attendance: d.expected_attendance,
    blockers: d.blockers,
    next_action: d.next_action,
    next_action_on: d.next_action_on,
    validity_days: d.validity_days,
    valid_until: d.valid_until,
    identified_on: d.created_at.slice(0, 10),
    signed_at: d.signed_at,
    completed_at: null,
    close_reason: d.close_reason,
    signed_value: signedValue(d),
    impact: [],
    impact_rating: d.impact_rating,
    impact_note: d.impact_note,
    comments: d.comments,
    custom: {},
    options: d.options.map((o) => (money ? o : { deal_option_id: o.deal_option_id, position: o.position, label: o.label, original_price: o.original_price, discount_pct: o.discount_pct, deal_price: o.deal_price, price_note: o.price_note })),
    members: d.members.map((key, i) => ({ employee: refKey(key), role: i === 0 ? "owner" : "support" })),
    deliverables: [],
    history: [...d.history].sort((a, b) => b.changed_at.localeCompare(a.changed_at)).slice(0, 25),
  };
  if (money) {
    out.commission_pct = d.commission_pct;
    out.commission_deviates = Boolean(d.commission_pct && categoryOf(recordOfDeal(d).category_id)?.default_commission_pct && d.commission_pct !== categoryOf(recordOfDeal(d).category_id)?.default_commission_pct);
  }
  return out;
}
/** A record's furthest open or live deal. */
const furthest = (r: MockRecord) =>
  DEALS.filter((d) => (d.partner_id ?? d.lead_id) === r.id && (d.status === "open" || d.status === "live")).sort((a, b) => (stageOf(b.stage)?.position ?? 0) - (stageOf(a.stage)?.position ?? 0))[0] ?? null;
const leadDeal = (r: MockRecord) => DEALS.find((d) => d.lead_id === r.id) ?? null;

function leadRow(r: MockRecord): LeadRow {
  const d = leadDeal(r);
  return {
    lead_id: r.id,
    number: r.number,
    name: r.name,
    partner_category_id: r.category_id,
    category: categoryOf(r.category_id)?.name ?? null,
    region: regionLabel(r),
    status: r.status as LeadRow["status"],
    on_hold: d ? meaningOf(d.stage) === "on_hold" : false,
    stage_label: d ? (stageOf(d.stage)?.label ?? d.stage) : null,
    health: d ? d.health : null,
    owner: person(r.owner),
    last_contact_at: lastContact(r),
    identified_on: r.identified_on,
    created_at: r.created_at,
  };
}
function partnerRow(r: MockRecord): PartnerRow {
  const d = furthest(r);
  return {
    partner_id: r.id,
    number: r.number,
    name: r.name,
    partner_category_id: r.category_id,
    category: categoryOf(r.category_id)?.name ?? null,
    region: regionLabel(r),
    status: r.status as PartnerRow["status"],
    stage_label: d ? (stageOf(d.stage)?.label ?? d.stage) : null,
    health: d ? d.health : null,
    owner: person(r.owner),
    last_contact_at: lastContact(r),
    since: r.since,
  };
}
const regionView = (r: MockRecord) => ({ scope: r.region_scope, cities: r.cities, label: regionLabel(r) });
const contactsOf = (r: MockRecord) => CONTACTS.filter((c) => (r.kind === "partner" ? c.partner_id : c.lead_id) === r.id).sort((a, b) => Number(b.primary_contact) - Number(a.primary_contact));
const interactionsOf = (r: MockRecord) => INTERACTIONS.filter((x) => (r.kind === "partner" ? x.partner_id : x.lead_id) === r.id).sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
const sinceContact = (r: MockRecord) => days(lastContact(r) ?? r.created_at);

function lead360(r: MockRecord, money: boolean): Lead360 {
  const d = leadDeal(r);
  const detail: LeadDetail = {
    ...leadRow(r),
    industry: r.industry,
    website: r.website,
    objective: r.objective,
    source: r.source,
    source_label: LISTS.lead_source.find((x) => x.code === r.source)?.label ?? null,
    region_view: regionView(r),
    impact: [],
    impact_rating: null,
    impact_note: null,
    comments: r.comments,
    custom: {},
    lost_reason: r.lost_reason,
    converted_partner_id: r.converted_partner_id,
    converted_at: r.converted_at,
  };
  return {
    lead: detail,
    kpis: { projected_value: d?.estimated_value ?? "0.00", days_at_stage: d ? days(d.stage_since) : 0, health: d ? d.health : null, days_since_contact: sinceContact(r) },
    deal: d ? dealDetail(d, money) : null,
    contacts: contactsOf(r).slice(0, 25),
    overview: { events: [], interactions: interactionsOf(r).slice(0, 5) },
    custom_fields: [],
  };
}
function partner360(r: MockRecord, money: boolean): Partner360 {
  const deals = DEALS.filter((d) => d.partner_id === r.id).sort((a, b) => Number(b.status === "open" || b.status === "live") - Number(a.status === "open" || a.status === "live") || b.created_at.localeCompare(a.created_at));
  const thisYear = RETURNS.filter((x) => deals.some((d) => d.id === x.deal_id) && x.month.startsWith(year()));
  const detail: PartnerDetail = {
    ...partnerRow(r),
    legal_name: r.legal_name,
    industry: r.industry,
    website: r.website,
    country_code: "NG",
    headquarters: r.headquarters,
    region_view: regionView(r),
    logo: null,
    lead_id: r.lead_id,
    custom: {},
    closed_at: r.closed_at,
    close_reason: r.close_reason,
    signed_outside: r.signed_outside,
    created_at: r.created_at,
  };
  const kpis: Partner360["kpis"] = {
    signed_value: m(deals.reduce((a, d) => a + (signedValue(d) ? k(signedValue(d)!) : 0), 0)),
    downloads_this_year: thisYear.reduce((a, x) => a + (x.downloads ?? 0), 0),
    active_deals: deals.filter((d) => d.status === "live").length,
    days_since_contact: sinceContact(r),
  };
  if (money) kpis.returns_this_year = m(thisYear.reduce((a, x) => a + (x.mycity_commission ? k(x.mycity_commission) : 0), 0));
  return {
    partner: detail,
    kpis,
    deals: deals.slice(0, 25).map(dealRow),
    contacts: contactsOf(r).slice(0, 25),
    overview: { events: [], interactions: interactionsOf(r).slice(0, 5) },
    deliverables: [],
    custom_fields: [],
  };
}

/* ------------------------------------------------------------------ *
 * Reads
 * ------------------------------------------------------------------ */

route("GET /api/v1/partnerships/lists/:list", (req) => (LISTS[req.params.list] ? ok({ list: req.params.list, values: LISTS[req.params.list] }) : invalid({ list: ["Choose one"] })));
route("GET /api/v1/partnerships/categories", (req) =>
  paged(
    CATEGORIES.map((c, i): CategoryRow => ({
      ...c,
      description: null,
      counts_as_vendor: c.name === "Vendor",
      display_order: i + 1,
      active: true,
      partners: RECORDS.filter((r) => r.kind === "partner" && r.category_id === c.partner_category_id).length,
      leads: RECORDS.filter((r) => r.kind === "lead" && r.category_id === c.partner_category_id && r.status !== "converted").length,
    })),
    req,
    { search: (c) => [c.name], filters: { active: (c, v) => String(c.active) === v }, sort: { display_order: (a, b) => (a.display_order ?? 0) - (b.display_order ?? 0), name: (a, b) => a.name.localeCompare(b.name) } },
  ),
);
route("GET /api/v1/partnerships/fields", () => ok({ data: [] }));

const DEAL_FILTERS = {
  stage: (d: MockDeal, v: string) => d.stage === v,
  partner_category_id: (d: MockDeal, v: string) => recordOfDeal(d).category_id === v,
  region_scope: (d: MockDeal, v: string) => recordOfDeal(d).region_scope === v,
  owner_id: (d: MockDeal, v: string) => d.owner === keyOfEmployee(v),
  health: (d: MockDeal, v: string) => d.health === v,
  status: (d: MockDeal, v: string) => d.status === v,
  lead_id: (d: MockDeal, v: string) => d.lead_id === v,
  partner_id: (d: MockDeal, v: string) => d.partner_id === v,
};
const pipelineDeal = (d: MockDeal): PipelineDeal => {
  const row = dealRow(d);
  return { deal_id: d.id, number: d.number, title: d.title, record: row.record, stage: d.stage, stage_label: row.stage_label, days_at_stage: row.days_at_stage, blockers: d.blockers, owner: row.owner };
};
route("GET /api/v1/partnerships/pipeline", (req) => {
  const keys = Object.keys(req.query).filter((q) => !["stage", "partner_category_id", "region_scope", "region_city", "owner_id", "health"].includes(q));
  if (keys.length) return invalid({ [keys[0]]: ["is not a filter on this list"] });
  const deals = DEALS.filter((d) => Object.entries(req.query).every(([q, v]) => !(q in DEAL_FILTERS) || DEAL_FILTERS[q as keyof typeof DEAL_FILTERS](d, v)));
  const unfinished = deals.filter((d) => d.status === "open" || d.status === "live");
  const signedThisYear = deals.filter((d) => d.signed_at && d.signed_at.startsWith(year()));
  return ok({
    kpis: {
      open_deals: deals.filter((d) => d.status === "open").length,
      signed_this_year: signedThisYear.length,
      signed_value: m(signedThisYear.reduce((a, d) => a + (signedValue(d) ? k(signedValue(d)!) : 0), 0)),
      stalled: unfinished.filter((d) => d.health === "stalled").length,
    },
    by_stage: STAGES.filter((s) => s.meaning !== "closed_lost").map((s) => {
      const at_ = unfinished.filter((d) => d.stage === s.code);
      return { stage: s.code, label: s.label, meaning: s.meaning, open: at_.length, value: m(at_.reduce((a, d) => a + (d.estimated_value ? k(d.estimated_value) : 0), 0)) };
    }),
    longest_at_stage: deals
      .filter((d) => d.status === "open")
      .sort((a, b) => a.stage_since.localeCompare(b.stage_since))
      .slice(0, 10)
      .map(pipelineDeal),
    stalled: unfinished.filter((d) => d.health === "stalled").sort((a, b) => a.stage_since.localeCompare(b.stage_since)).slice(0, 25).map(pipelineDeal),
  });
});
route("GET /api/v1/partnerships/deals", (req) => {
  const res = paged(DEALS, req, {
    search: (d) => [d.number, d.title, d.event_title, recordOfDeal(d).name],
    filters: DEAL_FILTERS,
    sort: { expected_close_on: (a, b) => (a.expected_close_on ?? "9").localeCompare(b.expected_close_on ?? "9"), title: (a, b) => a.title.localeCompare(b.title), estimated_value: (a, b) => k(a.estimated_value ?? "0") - k(b.estimated_value ?? "0"), created_at: (a, b) => a.created_at.localeCompare(b.created_at) },
  });
  // The page of the mock's own deals, answered in the contract's DealRow.
  if (res.status === 200) {
    const body = res.body as { data: MockDeal[] };
    return ok({ ...body, data: body.data.map(dealRow) });
  }
  return res;
});
route("GET /api/v1/partnerships/deals/:id", (req) => {
  const d = dealOf(req.params.id);
  return d ? ok(dealDetail(d, holdsMoney(req))) : notFound();
});

route("GET /api/v1/partnerships/leads/summary", () => {
  const leads = RECORDS.filter((r) => r.kind === "lead");
  const by = new Map<string | null, number>();
  for (const l of leads.filter((x) => x.status !== "lost")) by.set(l.source, (by.get(l.source) ?? 0) + 1);
  return ok({
    new: leads.filter((l) => l.status === "new").length,
    contacted: leads.filter((l) => l.status === "contacted").length,
    qualified: leads.filter((l) => l.status === "qualified").length,
    converted_this_month: leads.filter((l) => l.converted_at && l.converted_at.slice(0, 7) === isoDaysAgo(0).slice(0, 7)).length,
    by_source: [...by.entries()].sort((a, b) => b[1] - a[1]).map(([source, n]) => ({ source, label: LISTS.lead_source.find((x) => x.code === source)?.label ?? "No Source", leads: n })),
  });
});
route("GET /api/v1/partnerships/leads", (req) =>
  paged(
    RECORDS.filter((r) => r.kind === "lead" && (req.query.status ? true : r.status !== "lost")).map(leadRow),
    req,
    {
      search: (l) => [l.number, l.name],
      filters: {
        status: (l, v) => l.status === v,
        partner_category_id: (l, v) => l.partner_category_id === v,
        owner_id: (l, v) => l.owner?.employee_id === v,
        source: (l, v) => recordOf(l.lead_id)?.source === v,
        region_scope: (l, v) => recordOf(l.lead_id)?.region_scope === v,
        stage: (l, v) => leadDeal(recordOf(l.lead_id)!)?.stage === v,
        health: (l, v) => l.health === v,
      },
      sort: { name: (a, b) => a.name.localeCompare(b.name), identified_on: (a, b) => (a.identified_on ?? "").localeCompare(b.identified_on ?? ""), created_at: (a, b) => a.created_at.localeCompare(b.created_at) },
    },
  ),
);
route("GET /api/v1/partnerships/leads/:id", (req) => {
  const r = recordOf(req.params.id);
  return r && r.kind === "lead" ? ok(lead360(r, holdsMoney(req))) : notFound();
});

const quiet = (r: MockRecord) => r.status === "active" && sinceContact(r) >= 30;
route("GET /api/v1/partnerships/partners/summary", () => {
  const partners = RECORDS.filter((r) => r.kind === "partner");
  const live = DEALS.filter((d) => d.status === "live");
  return ok({
    active: partners.filter((p) => p.status === "active").length,
    dormant: partners.filter((p) => p.status === "dormant").length,
    quiet: partners.filter(quiet).length,
    live_deals: live.length,
    signed_value: m(DEALS.filter((d) => d.partner_id).reduce((a, d) => a + (signedValue(d) ? k(signedValue(d)!) : 0), 0)),
  });
});
route("GET /api/v1/partnerships/partners", (req) =>
  paged(
    RECORDS.filter((r) => r.kind === "partner").map(partnerRow),
    req,
    {
      search: (p) => [p.number, p.name, p.region],
      filters: {
        status: (p, v) => p.status === v,
        partner_category_id: (p, v) => p.partner_category_id === v,
        owner_id: (p, v) => p.owner?.employee_id === v,
        region_scope: (p, v) => recordOf(p.partner_id)?.region_scope === v,
        stage: (p, v) => DEALS.some((d) => d.partner_id === p.partner_id && d.stage === v),
        health: (p, v) => p.health === v,
        quiet: (p, v) => (v === "true" ? quiet(recordOf(p.partner_id)!) : true),
      },
      sort: { name: (a, b) => a.name.localeCompare(b.name), last_contact_at: (a, b) => (a.last_contact_at ?? "").localeCompare(b.last_contact_at ?? ""), since: (a, b) => (a.since ?? "").localeCompare(b.since ?? ""), created_at: (a, b) => (recordOf(a.partner_id)?.created_at ?? "").localeCompare(recordOf(b.partner_id)?.created_at ?? "") },
    },
  ),
);
route("GET /api/v1/partnerships/partners/:id", (req) => {
  const r = recordOf(req.params.id);
  return r && r.kind === "partner" ? ok(partner360(r, holdsMoney(req))) : notFound();
});
route("GET /api/v1/partnerships/duplicates", (req) => {
  const name = String(req.query.name ?? "").toLowerCase().trim();
  const email = String(req.query.email ?? "").toLowerCase();
  const candidates = RECORDS.filter((r) => r.status !== "converted" && r.status !== "closed")
    .map((r) => {
      const reasons: Array<"name" | "email"> = [];
      if (name.length >= 3 && r.name.toLowerCase().includes(name)) reasons.push("name");
      if (email && contactsOf(r).some((c) => c.email === email)) reasons.push("email");
      return { r, reasons };
    })
    .filter((x) => x.reasons.length)
    .slice(0, 25)
    .map(({ r, reasons }) => ({ type: r.kind, id: r.id, number: r.number, name: r.name, score: Math.min(100, reasons.length * 60), reasons }));
  return ok({ candidates });
});
route("GET /api/v1/partnerships/interactions", (req) =>
  paged(
    [...INTERACTIONS].sort((a, b) => b.occurred_at.localeCompare(a.occurred_at)),
    req,
    {
      search: (x) => [x.subject, x.summary],
      filters: { partner_id: (x, v) => x.partner_id === v, lead_id: (x, v) => x.lead_id === v, deal_id: (x, v) => x.deal_id === v, interaction_type: (x, v) => x.interaction_type === v },
      sort: { occurred_at: (a, b) => a.occurred_at.localeCompare(b.occurred_at) },
    },
  ),
);
route("GET /api/v1/partnerships/documents", (req) => {
  const id = req.query.partner_id ?? req.query.lead_id;
  if (!id) return invalid({ partner_id: ["Pick the lead or the partner"] });
  return paged(
    DOCUMENTS.filter((d) => d.record_id === id).map(({ record_id: _r, ...d }) => (void _r, d)),
    { ...req, query: Object.fromEntries(Object.entries(req.query).filter(([q]) => !["partner_id", "lead_id"].includes(q))) },
    { search: (d) => [d.document.file_name], filters: { deal_id: (d, v) => d.deal_id === v, kind: (d, v) => d.kind === v }, sort: { created_at: (a, b) => a.created_at.localeCompare(b.created_at) } },
  );
});
route("GET /api/v1/partnerships/deals/:id/returns", (req) => {
  if (!holdsMoney(req)) return fail(403, "CAPABILITY_REQUIRED", "You need See Commission and Returns for that.");
  return paged(RETURNS.filter((x) => x.deal_id === req.params.id), req, { filters: { year: (x, v) => x.month.startsWith(v) }, sort: { month: (a, b) => a.month.localeCompare(b.month) } });
});

/* ------------------------------------------------------------------ *
 * Writes, by the API's own rules where a screen can see them
 * ------------------------------------------------------------------ */

type Body = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const moneyOf = (v: unknown) => (typeof v === "string" && /^\d+(\.\d{1,2})?$/.test(v.trim()) ? m(k(v.trim())) : null);

/** A deal's own fields from DealFields; the problems as the API words them. */
function dealFrom(b: Body, at_: string, problems: Record<string, string[]>, signedOk: boolean) {
  const stage = str(b.stage) ? stageOf(String(b.stage)) : signedOk ? stageOf("partnership_signed") : STAGES[0];
  if (!str(b.title)) problems[`${at_}title`] = ["Required"];
  if (!keyOfEmployee(b.owner_id)) problems[`${at_}owner_id`] = ["Required"];
  if (!stage) problems[`${at_}stage`] = ["Pick a stage"];
  else if (SIGNED.has(stage.meaning ?? "") !== signedOk || stage.meaning === "closed_lost") problems[`${at_}stage`] = [signedOk ? "Pick a signed stage" : "Pick an open stage"];
  return stage;
}
function newDeal(b: Body, record: MockRecord, stage: ListValue, by: string): MockDeal {
  const category = categoryOf(record.category_id);
  const signed = SIGNED.has(stage.meaning ?? "");
  const rate = str(b.commission_pct) ?? category?.default_commission_pct ?? null;
  const owner = keyOfEmployee(b.owner_id) ?? by;
  const venue = b.venue ? placeOf(b.venue)?.view ?? null : null;
  const d: MockDeal = {
    id: sid(`deal:new:${DEALS.length}:${Date.now()}`),
    number: num("deal"),
    lead_id: record.kind === "lead" ? record.id : null,
    partner_id: record.kind === "partner" ? record.id : null,
    title: String(b.title).trim(),
    stage: stage.code,
    status: signed ? "live" : "open",
    health: "on_track",
    blockers: null,
    owner,
    estimated_value: moneyOf(b.estimated_value),
    expected_close_on: str(b.expected_close_on),
    event_title: str(b.event_title),
    event_starts_on: str(b.event_starts_on),
    event_ends_on: str(b.event_ends_on),
    venue,
    expected_attendance: typeof b.expected_attendance === "number" ? b.expected_attendance : null,
    objective: str(b.objective),
    next_action: str(b.next_action),
    next_action_on: str(b.next_action_on),
    commission_pct: rate,
    validity_days: category?.default_validity_days ?? null,
    valid_until: null,
    signed_at: signed ? now() : null,
    close_reason: null,
    options: Array.isArray(b.options)
      ? (b.options as Body[]).map((o, i) => {
          const price = moneyOf(o.deal_price);
          const commission = moneyOf(o.commission_amount) ?? (price && rate ? m(Math.round((k(price) * Number(rate)) / 100)) : null);
          return { deal_option_id: sid(`option:new:${Date.now()}:${i}`), position: Number(o.position) || i + 1, label: String(o.label ?? ""), original_price: moneyOf(o.original_price), discount_pct: str(o.discount_pct), deal_price: price, price_note: str(o.price_note), commission_amount: commission, merchant_take: moneyOf(o.merchant_take) ?? (price && commission ? m(k(price) - k(commission)) : null) };
        })
      : [],
    members: [owner, ...(Array.isArray(b.member_ids) ? (b.member_ids as string[]).map(keyOfEmployee).filter((x): x is string => !!x && x !== owner) : [])],
    history: [line("stage", null, stage.code, by, now())],
    stage_since: now(),
    created_at: now(),
    impact_rating: (str(b.impact_rating) as DealDetail["impact_rating"]) ?? null,
    impact_note: str(b.impact_note),
    comments: str(b.comments),
  };
  DEALS.unshift(d);
  return d;
}
function contactFrom(b: Body, record: MockRecord, primary: boolean): Contact {
  const phones = Array.isArray(b.phones) ? (b.phones as string[]).filter(Boolean) : [];
  const c: Contact = {
    partner_contact_id: sid(`contact:new:${CONTACTS.length}:${Date.now()}`),
    partner_id: record.kind === "partner" ? record.id : null,
    lead_id: record.kind === "lead" ? record.id : null,
    first_name: String(b.first_name ?? "").trim(),
    last_name: String(b.last_name ?? "").trim(),
    job_title: str(b.job_title),
    email: str(b.email)?.toLowerCase() ?? null,
    phones,
    primary_contact: primary,
    signatory: Boolean(b.signatory),
    created_at: now(),
  };
  if (primary) for (const other of contactsOf(record)) other.primary_contact = false;
  CONTACTS.push(c);
  return c;
}
function regionFrom(b: Body, r: MockRecord) {
  const region = (b.region ?? {}) as Body;
  r.region_scope = (region.scope as MockRecord["region_scope"]) ?? r.region_scope;
  r.cities = r.region_scope === "cities" && Array.isArray(region.cities) ? (region.cities as unknown[]).map((c) => placeOf(c)?.view).filter((v): v is PlaceView => !!v) : [];
}
function recordFrom(kind: "lead" | "partner", b: Body, by: string): MockRecord {
  const r: MockRecord = {
    kind,
    id: sid(`${kind}:new:${RECORDS.length}:${Date.now()}`),
    number: num(kind),
    name: String(b.name).trim(),
    legal_name: str(b.legal_name),
    category_id: String(b.partner_category_id),
    region_scope: null,
    cities: [],
    industry: str(b.industry),
    website: str(b.website),
    owner: keyOfEmployee(b.owner_id) ?? by,
    status: kind === "partner" ? "active" : "new",
    created_at: now(),
    identified_on: str(b.identified_on) ?? isoDaysAgo(0),
    since: kind === "partner" ? (str(b.since) ?? isoDaysAgo(0)) : null,
    source: str(b.source),
    objective: str(b.objective),
    comments: str(b.comments),
    lost_reason: null,
    converted_partner_id: null,
    converted_at: null,
    lead_id: null,
    signed_outside: b.signed_before_hub === true,
    closed_at: null,
    close_reason: null,
    headquarters: b.headquarters ? placeOf(b.headquarters)?.view ?? null : null,
  };
  regionFrom(b, r);
  RECORDS.unshift(r);
  return r;
}
function recordProblems(b: Body): Record<string, string[]> {
  const problems: Record<string, string[]> = {};
  if (!str(b.name)) problems.name = ["Required"];
  if (!categoryOf(String(b.partner_category_id ?? ""))) problems.partner_category_id = ["Required"];
  if (!keyOfEmployee(b.owner_id)) problems.owner_id = ["Required"];
  const region = (b.region ?? {}) as Body;
  if (!region.scope) problems.region = ["Required"];
  else if (region.scope === "cities" && !(Array.isArray(region.cities) && region.cities.length)) problems.region = ["Pick a city"];
  const contact = (b.contact ?? {}) as Body;
  if (!str(contact.first_name)) problems["contact.first_name"] = ["Required"];
  if (!str(contact.last_name)) problems["contact.last_name"] = ["Required"];
  return problems;
}

route("POST /api/v1/partnerships/leads", (req) => {
  const b = req.body;
  const problems = recordProblems(b);
  const stage = dealFrom((b.deal ?? {}) as Body, "deal.", problems, false);
  if (Object.keys(problems).length) return invalid(problems);
  const r = recordFrom("lead", b, req.user!);
  contactFrom((b.contact ?? {}) as Body, r, true);
  const d = newDeal((b.deal ?? {}) as Body, r, stage!, req.user!);
  r.status = LEAD_STATUS[meaningOf(d.stage) ?? ""] ?? "new";
  return created(lead360(r, holdsMoney(req)));
});
route("POST /api/v1/partnerships/partners", (req) => {
  const b = req.body;
  const problems = recordProblems(b);
  const stage = dealFrom((b.deal ?? {}) as Body, "deal.", problems, true);
  if (!b.signed_copy_document_id === !(b.signed_before_hub === true)) problems.signed_copy_document_id = ["Attach the signed copy"];
  if (Object.keys(problems).length) return invalid(problems);
  const r = recordFrom("partner", b, req.user!);
  contactFrom((b.contact ?? {}) as Body, r, true);
  const d = newDeal((b.deal ?? {}) as Body, r, stage!, req.user!);
  if (b.signed_copy_document_id) DOCUMENTS.unshift({ record_id: r.id, document: { document_id: String(b.signed_copy_document_id), file_name: "Signed copy.pdf", size_bytes: 200000, mime_type: "application/pdf" }, kind: null, kind_label: null, deal_id: d.id, origin: "signed_copy", uploaded_by: refKey(req.user!).display_name, created_at: now() });
  return created(partner360(r, holdsMoney(req)));
});
route("POST /api/v1/partnerships/deals", (req) => {
  const b = req.body;
  const r = recordOf(String(b.partner_id ?? b.lead_id ?? ""));
  const problems: Record<string, string[]> = {};
  if (!r) problems.partner_id = ["Pick the lead or the partner"];
  else if (r.kind === "lead" && leadDeal(r)) problems.lead_id = ["Already has its deal"];
  else if (r.status === "closed") problems.partner_id = ["Partner is closed"];
  const stage = dealFrom(b, "", problems, false);
  if (Object.keys(problems).length) return invalid(problems);
  return created(dealDetail(newDeal(b, r!, stage!, req.user!), holdsMoney(req)));
});
route("PATCH /api/v1/partnerships/deals/:id", (req) => {
  const d = dealOf(req.params.id);
  if (!d) return notFound();
  const b = req.body;
  if (b.commission_pct !== undefined && !holdsMoney(req)) return fail(403, "CAPABILITY_REQUIRED", "Only a holder of See Commission and Returns enters commission.");
  for (const key of ["title", "event_title", "event_starts_on", "event_ends_on", "objective", "expected_close_on", "next_action", "next_action_on", "impact_note", "comments"] as const) if (b[key] !== undefined) (d as unknown as Body)[key] = b[key] === null ? null : String(b[key]);
  if (b.estimated_value !== undefined) d.estimated_value = b.estimated_value === null ? null : moneyOf(b.estimated_value);
  if (b.owner_id) d.owner = keyOfEmployee(b.owner_id) ?? d.owner;
  if (b.venue !== undefined) d.venue = b.venue ? (placeOf(b.venue)?.view ?? null) : null;
  if (b.commission_pct !== undefined) d.commission_pct = b.commission_pct === null ? null : String(b.commission_pct);
  if (Array.isArray(b.options)) {
    // The options worked out as New Deal works them out; the scratch deal it made is taken back.
    d.options = newDeal({ ...b, title: d.title, stage: d.stage }, recordOfDeal(d), stageOf(d.stage)!, req.user!).options;
    DEALS.shift();
  }
  if (Array.isArray(b.member_ids)) d.members = [d.owner!, ...(b.member_ids as string[]).map(keyOfEmployee).filter((x): x is string => !!x && x !== d.owner)];
  return ok(dealDetail(d, holdsMoney(req)));
});
route("POST /api/v1/partnerships/deals/:id/stage", (req) => {
  const d = dealOf(req.params.id);
  if (!d) return notFound();
  const to = stageOf(String(req.body.stage ?? ""));
  if (!to) return invalid({ stage: ["Pick a stage"] });
  if (to.code === d.stage) return invalid({ stage: ["Already at this stage"] });
  const from = stageOf(d.stage);
  const back = !!from && from.meaning !== "on_hold" && to.position < from.position;
  if (d.signed_at && !["signed", "active", "on_hold", "closed_lost"].includes(to.meaning ?? "")) return invalid({ stage: ["Already signed"] });
  const reason = str(req.body.reason);
  if ((back || to.meaning === "on_hold" || to.meaning === "closed_lost") && !reason) return invalid({ reason: ["Say why"] });
  const signs = SIGNED.has(to.meaning ?? "") && !d.signed_at;
  if (signs && !req.body.signed_copy_document_id) return fail(422, "SIGNED_COPY_REQUIRED", "Check the highlighted fields", { signed_copy_document_id: ["Attach the signed copy"] });
  d.history.push(line("stage", d.stage, to.code, req.user!, now(), reason));
  d.stage = to.code;
  d.stage_since = now();
  if (to.meaning === "closed_lost") Object.assign(d, { status: "lost", close_reason: reason });
  else if (signs) Object.assign(d, { status: "live", signed_at: now(), close_reason: null });
  else if (d.status === "lost") Object.assign(d, { status: d.signed_at ? "live" : "open", close_reason: null });
  const r = recordOfDeal(d);
  if (r.kind === "lead") {
    if (signs) convert(r, d, String(req.body.signed_copy_document_id), req.user!);
    else if (to.meaning !== "on_hold") {
      r.status = LEAD_STATUS[to.meaning ?? ""] ?? r.status;
      if (r.status === "lost") r.lost_reason = reason;
    }
  } else if (r.status !== "closed") r.status = DEALS.some((x) => x.partner_id === r.id && x.status === "live") ? "active" : "dormant";
  return ok(dealDetail(d, holdsMoney(req)));
});
route("POST /api/v1/partnerships/deals/:id/health", (req) => {
  const d = dealOf(req.params.id);
  if (!d) return notFound();
  const health = String(req.body.health ?? "") as MockDeal["health"];
  if (!HEALTH_LABEL[health]) return invalid({ health: ["Choose one"] });
  if (health === "stalled" && !str(req.body.blockers)) return invalid({ blockers: ["Say what is in the way"] });
  if (health !== d.health) d.history.push(line("health", d.health, health, req.user!, now(), str(req.body.blockers)));
  d.health = health;
  d.blockers = str(req.body.blockers);
  return ok(dealDetail(d, holdsMoney(req)));
});
route("PUT /api/v1/partnerships/deals/:id/returns/:month", (req) => {
  if (!holdsMoney(req)) return fail(403, "CAPABILITY_REQUIRED", "You need See Commission and Returns for that.");
  const d = dealOf(req.params.id);
  if (!d) return notFound();
  const month = `${req.params.month}-01`;
  const kept = RETURNS.findIndex((x) => x.deal_id === d.id && x.month === month);
  const b = req.body;
  const row: DealReturn = { deal_return_id: sid(`return:${d.id}:${month}`), deal_id: d.id, month, units_sold: typeof b.units_sold === "number" ? b.units_sold : null, gross_sales: moneyOf(b.gross_sales), mycity_commission: moneyOf(b.mycity_commission), paid_to_partner: moneyOf(b.paid_to_partner), downloads: typeof b.downloads === "number" ? b.downloads : null, note: str(b.note), source: "entered", entered_by_name: refKey(req.user!).display_name, updated_at: now() };
  if (kept >= 0) RETURNS[kept] = row;
  else RETURNS.push(row);
  return ok(row);
});

/** A lead's deal signed: the partner made, the deal, contacts, documents and interactions moved (§6.4). */
function convert(r: MockRecord, d: MockDeal, copy: string | null, by: string) {
  if (r.status === "converted") return r.converted_partner_id!;
  const p = recordFrom("partner", { name: r.name, partner_category_id: r.category_id, owner_id: byKey(r.owner)?.employee_id, industry: r.industry, website: r.website, region: { scope: r.region_scope } }, by);
  p.cities = r.cities;
  p.lead_id = r.id;
  d.partner_id = p.id;
  for (const c of CONTACTS) if (c.lead_id === r.id) Object.assign(c, { partner_id: p.id, lead_id: null });
  for (const x of INTERACTIONS) if (x.lead_id === r.id) Object.assign(x, { partner_id: p.id, lead_id: null });
  for (const x of DOCUMENTS) if (x.record_id === r.id) x.record_id = p.id;
  if (copy) DOCUMENTS.unshift({ record_id: p.id, document: { document_id: copy, file_name: "Signed copy.pdf", size_bytes: 200000, mime_type: "application/pdf" }, kind: null, kind_label: null, deal_id: d.id, origin: "signed_copy", uploaded_by: refKey(by).display_name, created_at: now() });
  Object.assign(r, { status: "converted", converted_partner_id: p.id, converted_at: now() });
  return p.id;
}
route("PATCH /api/v1/partnerships/leads/:id", (req) => {
  const r = recordOf(req.params.id);
  if (!r || r.kind !== "lead") return notFound();
  if (r.status === "converted") return fail(409, "LEAD_CONVERTED", "This lead is now a partner; open the partner.");
  const b = req.body;
  for (const key of ["name", "industry", "website", "objective", "source", "comments", "identified_on"] as const) if (b[key] !== undefined) (r as unknown as Body)[key] = b[key] === null ? null : String(b[key]);
  if (b.partner_category_id) r.category_id = String(b.partner_category_id);
  if (b.owner_id) r.owner = keyOfEmployee(b.owner_id) ?? r.owner;
  if (b.region) regionFrom(b, r);
  return ok(lead360(r, holdsMoney(req)));
});
route("POST /api/v1/partnerships/leads/:id/lose", (req) => {
  const r = recordOf(req.params.id);
  if (!r || r.kind !== "lead") return notFound();
  if (r.status === "converted") return fail(409, "LEAD_CONVERTED", "This lead is now a partner; open the partner.");
  const reason = str(req.body.reason);
  if (!reason || reason.length < 10) return invalid({ reason: ["At least 10 characters"] });
  const d = leadDeal(r);
  if (d) {
    d.history.push(line("stage", d.stage, "closed_lost", req.user!, now(), reason));
    Object.assign(d, { stage: "closed_lost", status: "lost", close_reason: reason, stage_since: now() });
  }
  Object.assign(r, { status: "lost", lost_reason: reason });
  return ok(lead360(r, holdsMoney(req)));
});
route("POST /api/v1/partnerships/leads/:id/convert", (req) => {
  const r = recordOf(req.params.id);
  if (!r || r.kind !== "lead") return notFound();
  if (r.status === "converted") return ok({ partner_id: r.converted_partner_id });
  if (!req.body.signed_copy_document_id) return fail(422, "SIGNED_COPY_REQUIRED", "Check the highlighted fields", { signed_copy_document_id: ["Attach the signed copy"] });
  const d = leadDeal(r)!;
  d.history.push(line("stage", d.stage, "partnership_signed", req.user!, now(), null, "conversion"));
  Object.assign(d, { stage: "partnership_signed", status: "live", signed_at: now(), stage_since: now() });
  return ok({ partner_id: convert(r, d, String(req.body.signed_copy_document_id), req.user!) });
});
route("PATCH /api/v1/partnerships/partners/:id", (req) => {
  const r = recordOf(req.params.id);
  if (!r || r.kind !== "partner") return notFound();
  const b = req.body;
  for (const key of ["name", "legal_name", "industry", "website", "since"] as const) if (b[key] !== undefined) (r as unknown as Body)[key] = b[key] === null ? null : String(b[key]);
  if (b.partner_category_id) r.category_id = String(b.partner_category_id);
  if (b.owner_id) r.owner = keyOfEmployee(b.owner_id) ?? r.owner;
  if (b.region) regionFrom(b, r);
  if (b.headquarters !== undefined) r.headquarters = b.headquarters ? (placeOf(b.headquarters)?.view ?? null) : null;
  return ok(partner360(r, holdsMoney(req)));
});
route("POST /api/v1/partnerships/partners/:id/close", (req) => {
  const r = recordOf(req.params.id);
  if (!r || r.kind !== "partner") return notFound();
  const reason = str(req.body.reason);
  if (!reason || reason.length < 10) return invalid({ reason: ["At least 10 characters"] });
  if (r.status === "closed") return invalid({ reason: ["Already closed"] });
  for (const d of DEALS.filter((x) => x.partner_id === r.id && (x.status === "open" || x.status === "live"))) {
    d.history.push(line("stage", d.stage, "closed_lost", req.user!, now(), reason));
    Object.assign(d, { stage: "closed_lost", status: "lost", close_reason: reason, stage_since: now() });
  }
  Object.assign(r, { status: "closed", closed_at: now(), close_reason: reason });
  return ok(partner360(r, holdsMoney(req)));
});
route("POST /api/v1/partnerships/contacts", (req) => {
  const r = recordOf(String(req.body.partner_id ?? req.body.lead_id ?? ""));
  if (!r) return invalid({ partner_id: ["Pick the lead or the partner"] });
  if (!str(req.body.first_name) || !str(req.body.last_name)) return invalid({ ...(!str(req.body.first_name) && { first_name: ["Required"] }), ...(!str(req.body.last_name) && { last_name: ["Required"] }) });
  if (str(req.body.email) && contactsOf(r).some((c) => c.email === String(req.body.email).toLowerCase())) return invalid({ email: ["Already a contact"] });
  return created(contactFrom(req.body, r, Boolean(req.body.primary_contact) || contactsOf(r).length === 0));
});
route("PATCH /api/v1/partnerships/contacts/:id", (req) => {
  const c = CONTACTS.find((x) => x.partner_contact_id === req.params.id);
  if (!c) return notFound();
  const b = req.body;
  for (const key of ["first_name", "last_name", "job_title", "email"] as const) if (b[key] !== undefined) (c as unknown as Body)[key] = b[key] === null ? null : String(b[key]);
  if (Array.isArray(b.phones)) c.phones = b.phones as string[];
  if (typeof b.signatory === "boolean") c.signatory = b.signatory;
  if (b.primary_contact === true) {
    for (const other of CONTACTS) if ((other.partner_id ?? other.lead_id) === (c.partner_id ?? c.lead_id)) other.primary_contact = false;
    c.primary_contact = true;
  }
  return ok(c);
});
route("POST /api/v1/partnerships/documents", (req) => {
  const r = recordOf(String(req.body.partner_id ?? req.body.lead_id ?? ""));
  if (!r) return invalid({ partner_id: ["Pick the lead or the partner"] });
  const kind = LISTS.partner_document_kind.find((x) => x.code === req.body.kind);
  if (!kind) return invalid({ kind: ["Pick from the list"] });
  const doc: PartnerDocument = { document: { document_id: String(req.body.document_id), file_name: "Upload.pdf", size_bytes: 120000, mime_type: "application/pdf" }, kind: kind.code, kind_label: kind.label, deal_id: str(req.body.deal_id), origin: "upload", uploaded_by: refKey(req.user!).display_name, created_at: now() };
  DOCUMENTS.unshift({ ...doc, record_id: r.id });
  return created(doc);
});
route("POST /api/v1/partnerships/interactions", (req) => {
  const b = req.body;
  const r = recordOf(String(b.partner_id ?? b.lead_id ?? ""));
  if (!r) return invalid({ partner_id: ["Pick the lead or the partner"] });
  if (!str(b.subject)) return invalid({ subject: ["Required"] });
  if ((str(b.summary) ?? "").length < 10) return invalid({ summary: ["At least 10 characters"] });
  if (!b.occurred_at || new Date(String(b.occurred_at)).getTime() > Date.now() + 60000) return invalid({ occurred_at: ["Not in the future"] });
  const contact = CONTACTS.find((c) => c.partner_contact_id === b.contact_id);
  const x: Interaction = {
    partner_interaction_id: sid(`interaction:new:${INTERACTIONS.length}:${Date.now()}`),
    partner_id: r.kind === "partner" ? r.id : null,
    lead_id: r.kind === "lead" ? r.id : null,
    deal_id: str(b.deal_id),
    contact: contact ? { partner_contact_id: contact.partner_contact_id, name: `${contact.first_name} ${contact.last_name}` } : null,
    interaction_type: b.interaction_type as Interaction["interaction_type"],
    subject: String(b.subject).trim(),
    summary: String(b.summary).trim(),
    occurred_at: new Date(String(b.occurred_at)).toISOString(),
    owner: refKey(req.user!),
    from_mail: false,
    created_at: now(),
  };
  INTERACTIONS.unshift(x);
  return created(x);
});

/** A partner by id for the INTERIM screens below (Proposals, Contracts), by its name. */
const find = (id: string) => {
  const r = recordOf(id);
  return r ? { name: r.name, owner: r.owner ?? "ngozi" } : null;
};

const PROPS: Array<Proposal & { _doc: ReturnType<typeof doc> }> = [];
function doc(ref: string, partner: string, what: string, lines: Array<[string, string]>, by: string) {
  const total = lines.reduce((a, [, v]) => a + k(v), 0);
  return { reference: ref, title: "Partnership Proposal", prepared_for: `Prepared for ${partner} · ${isoDaysAgo(17).split("-").reverse().join("/")}`, sections: [{ heading: "What we propose.", text: what }, { heading: "What MyCity brings.", text: "1.1 million monthly active residents, in-app placement in the right categories, and physical activation days." }, { heading: "What we ask.", text: `₦${(total / 100).toLocaleString("en-NG")}, payable half on signature and half on the first activation.` }], lines: lines.map(([label, amount]) => ({ label, amount })), total: m(total), footnote: `Drafted by the assistant from six answers, then edited by ${by}` };
}
[
  ["PRO-0027", "Ember to Remember headline sponsor", "ProvidusBank", "9200000.00", S("ok", "Accepted"), "A headline sponsorship of the Ember to Remember campaign, across all four cities.", [["Headline placement, 14 weeks", "6200000.00"], ["Ticket confirmation branding", "1500000.00"], ["Activation days", "1500000.00"]], "Ngozi Eze"],
  ["PRO-0030", "Healthcare activation, 4 cities", "Lonart-DS", "4100000.00", S("warn", "Viewed"), "A four-city health activation across Lagos, Abuja, Enugu and Port Harcourt, carried on the MyCityApp platform through the campaign window.", [["In-app category placement, 12 weeks", "2400000.00"], ["Eight activation days, four cities", "1200000.00"], ["Attribution reporting", "500000.00"]], "Bashir Lawal"],
  ["PRO-0028", "Cinema listings integration", "Filmhouse Cinemas", "3600000.00", S("warn", "Viewed"), "Showtimes and ticketing in the city guide, with revenue attributed to the listing.", [["Listings integration", "2600000.00"], ["Launch campaign", "1000000.00"]], "Ngozi Eze"],
  ["PRO-0025", "Hospitality bundle", "Eko Hotels", "2800000.00", S("err", "No response"), "A hospitality bundle for visitors arriving for city events.", [["Featured listing, 6 months", "1800000.00"], ["Event packages", "1000000.00"]], "Bashir Lawal"],
].forEach((p, i) => PROPS.push({ proposal_id: sid(`prop:${i}`), number: p[0] as string, title: p[1] as string, partner: p[2] as string, value: p[3] as string, status: p[4] as Status, _doc: doc(p[0] as string, p[2] as string, p[5] as string, p[6] as Array<[string, string]>, p[7] as string) }));
route("GET /api/v1/partnerships/proposals/summary", () => ok({ sent_this_year: 14, accepted: PROPS.filter((p) => p.status.tone === "ok").length + 4, viewed_no_reply: PROPS.filter((p) => p.status.text === "Viewed").length + 1, acceptance_rate: "36%" }));
route("GET /api/v1/partnerships/proposals", (req) => paged(PROPS.map(({ _doc, ...p }) => (void _doc, p)), req, { search: (p) => [p.title, p.partner, p.number] }));
route("GET /api/v1/partnerships/proposals/:id/document", (req) => {
  const p = PROPS.find((x) => x.proposal_id === req.params.id);
  return p ? ok(p._doc) : notFound();
});
route("POST /api/v1/partnerships/proposals", (req) => {
  const { cities, ...b } = req.body as Record<string, string | number> & { cities?: unknown };
  // Each city picked at level city (F27): never typed.
  const picked = Array.isArray(cities) ? cities.map((c) => placeOf(c)) : [];
  const partner = find(String(b.partner_id));
  const f: Record<string, string[]> = {};
  if (!partner) f.partner_id = ["Pick the partner"];
  if (String(b.what ?? "").trim().length < 20) f.what = ["What we propose, in a sentence or two"];
  if (String(b.why_now ?? "").trim().length < 10) f.why_now = ["Why now"];
  if (!picked.length || picked.some((c) => !c)) f.cities = ["Pick a city"];
  if (!(Number(b.weeks) >= 1)) f.weeks = ["How many weeks"];
  if (!(Number(b.value) > 0)) f.value = ["The value we ask"];
  if (Object.keys(f).length) return invalid(f);
  const n = 31 + PROPS.length - 4;
  const ref = `PRO-${String(n).padStart(4, "0")}`;
  const v = k(String(b.value));
  const p = { proposal_id: sid(`prop:new:${n}`), number: ref, title: String(b.what).split(/[.,]/)[0].slice(0, 60), partner: partner!.name, value: String(b.value), status: S("neutral", "Draft"), _doc: doc(ref, partner!.name, `${String(b.what).trim()} ${String(b.why_now).trim()}`, [[`Placement in ${picked.map((c) => c!.line).join(", ")}, ${b.weeks} weeks`, m(Math.round(v * 0.7))], ["Activation and reporting", m(v - Math.round(v * 0.7))]], refKey(req.user!).display_name) };
  PROPS.unshift(p);
  const { _doc, ...out } = p;
  void _doc;
  return created(out);
});

const CONTRACTS: Contract[] = [
  ["Platform partnership MOU", "MTN Nigeria", "MOU", "2025-03-13", "2027-03-13", "18400000.00", S("ok", "Active")],
  ["Sponsorship agreement", "ProvidusBank", "Contract", "2026-09-22", "2026-12-31", "9200000.00", S("ok", "Active")],
  ["Data sharing MOU", "Lagos State Government", "MOU", null, null, "7500000.00", S("warn", "In review")],
  ["Activation agreement", "Lonart-DS", "Contract", null, null, "4100000.00", S("neutral", "Draft")],
].map((c, i) => ({ contract_id: sid(`con:${i}`), title: c[0] as string, partner: c[1] as string, kind: c[2] as Contract["kind"], start_on: c[3] as string | null, renewal_on: c[4] as string | null, value: c[5] as string, status: c[6] as Status }));
route("GET /api/v1/partnerships/contracts/summary", () =>
  ok({
    active: CONTRACTS.filter((c) => c.status.text === "Active").length, in_review: CONTRACTS.filter((c) => c.status.text === "In review").length, draft: CONTRACTS.filter((c) => c.status.text === "Draft").length,
    renewals_180: CONTRACTS.filter((c) => c.renewal_on && c.renewal_on <= isoDaysAhead(180)).length,
    chain: ["Draft", "Review", "Approval", "Sent", "Viewed", "Signed", "Active", "Expiring", "Renewed"].map((label, i) => ({ label, state: i < 5 ? "done" : i === 5 ? "now" : null })),
  }),
);
route("GET /api/v1/partnerships/contracts", (req) => paged(CONTRACTS, req, { search: (c) => [c.title, c.partner] }));
route("GET /api/v1/partnerships/contracts/renewals", (req) => {
  const today = new Date(`${isoDaysAgo(0)}T00:00:00Z`).getTime();
  const rows = CONTRACTS.filter((c) => c.renewal_on).map((c) => ({ contract_id: c.contract_id, title: c.title, partner: c.partner, due: c.renewal_on!, days: Math.round((new Date(`${c.renewal_on}T00:00:00Z`).getTime() - today) / 86400000), owner: refKey(RECORDS.find((p) => p.name === c.partner)?.owner ?? "ngozi") })).sort((a, b) => a.days - b.days);
  return paged(rows, req, { search: (r) => [r.title, r.partner] });
});
route("POST /api/v1/partnerships/contracts", (req) => {
  const b = req.body as Record<string, string>;
  const p = find(b.partner_id);
  const f: Record<string, string[]> = {};
  if (!p) f.partner_id = ["Pick the partner"];
  if (!b.title?.trim()) f.title = ["Name the document"];
  if (!(Number(b.value) > 0)) f.value = ["Enter the value"];
  if (Object.keys(f).length) return invalid(f);
  const c: Contract = { contract_id: sid(`con:new:${CONTRACTS.length}`), title: b.title.trim(), partner: p!.name, kind: (b.kind as Contract["kind"]) ?? "Contract", start_on: null, renewal_on: null, value: b.value, status: S("neutral", "Draft") };
  CONTRACTS.unshift(c);
  return created(c);
});

route("GET /api/v1/partnerships/analytics", () =>
  ok({
    period: isoDaysAgo(0).slice(0, 7), prospects: 9, meetings: 14, proposals: 4, signed: 2,
    by_owner: [["ngozi", 5, 8, 2, 1, 9, 14200], ["bashir", 3, 4, 1, 0, 7, 6800], ["cynthia", 1, 2, 1, 1, 7, 21400]].map(([o, prospects, meetings, proposals, signed, active, downloads]) => ({ owner: refKey(o as string), prospects: prospects as number, meetings: meetings as number, proposals: proposals as number, signed: signed as number, active: active as number, downloads: downloads as number })),
    signed_per_month: { labels: ["May", "Jun", "Jul", "Aug", "Sep", "Oct"], values: [1, 2, 1, 3, 2, 2] },
    downloads: [{ label: "MTN Nigeria", pct: 100, value: "18,200" }, { label: "ProvidusBank", pct: 50, value: "9,100" }, { label: "Filmhouse Cinemas", pct: 0, value: "0", emphasis: "warn" }, { label: "Lagos State Government", pct: 0, value: "0", emphasis: "warn" }, { label: "Lonart-DS", pct: 0, value: "0", emphasis: "warn" }],
    months: [["October", 9, 4, 2, 22], ["September", 7, 3, 2, 29], ["August", 8, 2, 3, 38], ["July", 6, 3, 1, 17], ["June", 5, 2, 2, 40], ["May", 4, 1, 1, 25]].map(([month, prospects, proposals, signed, conversion_pct]) => ({ month: month as string, prospects: prospects as number, proposals: proposals as number, signed: signed as number, conversion_pct: conversion_pct as number })),
  }),
);
