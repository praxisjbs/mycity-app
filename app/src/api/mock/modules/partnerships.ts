import type {
  Contact,
  CustomValues,
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
import type { ProposalContent, ProposalContentEdit, ProposalDetail, ProposalQuestion, ProposalTemplate } from "@mycity/contract/contract.gen.ts";
import SAMPLE_HTML from "@mycity/ui/samples/proposal-kit.sample.html?raw";
import SAMPLE_CONTENT from "@mycity/ui/samples/proposal-kit.sample.json";
import { at, created, fail, invalid, isoDaysAgo, isoDaysAhead, notFound, ok, paged, route, sid, uuid, type Req } from "../core";
import { byId, byKey, refKey } from "../data/people";
import { PARTNERS, type MockPartner } from "../data/partners";
import { pickedPlace, placeOf } from "./maps";
import { exportFile } from "./shared";
import { mockCategories, mockFields, mockList } from "./partnerships_categories";

/**
 * Partnerships on the mock (docs/guides/partnerships.md): Pipeline, Partners, Leads and both 360s in
 * the contract's shapes (packages/contract/schemas/partner_pipeline.js, leads.js, partners.js,
 * interactions.js), by the API's own rules where a screen can see them: a lead's status read from its
 * deal's stage, reasons for a move back, On Hold and Closed Lost, the signed copy for a signed stage,
 * Stalled needing blockers, conversion making the partner. Everyone signed in sees every record, as
 * the Operations account the screen gates sign in as does (§6.1). Proposals and the studio are in the
 * contract's shapes (M7 PR 7), Contracts & MOUs in partnerships_agreements.ts (PR 6); Analytics stays on
 * its INTERIM shape below until PR 8.
 */

const k = (m: string) => Math.round(Number(m) * 100);
const m = (kobo: number) => `${Math.trunc(kobo / 100)}.${String(kobo % 100).padStart(2, "0")}`;
const now = () => new Date().toISOString();

/* ------------------------------------------------------------------ *
 * MyCity's lists and categories, as Categories enters them
 * ------------------------------------------------------------------ */

/** MyCity's stages and lists, and the categories, as Categories holds them (partnerships_categories.ts): one source. */
const stages = () => mockList("partnership_stage");
/** The tracker's stage names in the demonstration partners, as MyCity's codes. */
const FROM_TRACKER: Record<string, string> = {
  "Prospect identified": "prospect_identified",
  "Initial contact": "initial_contact",
  "Intro meeting scheduled": "introductory_meeting_scheduled",
  "Intro meeting held": "introductory_meeting_held",
  "Proposal sent": "proposal_sent",
  "Follow up": "follow_up_ongoing",
  "Ongoing negotiation": "negotiation",
  "Verbal approval": "verbal_approval",
  "Contract review": "contract_review",
  "Partnership signed": "partnership_signed",
  "Active partnership": "active_partnership",
  "On hold": "on_hold",
};
const stageOf = (code: string) => stages().find((s) => s.code === code) ?? null;
const meaningOf = (code: string) => stageOf(code)?.meaning ?? null;
const SIGNED = new Set(["signed", "active"]);
const LEAD_STATUS: Record<string, LeadRow["status"]> = { prospect: "new", contacted: "contacted", meeting: "contacted", proposal: "qualified", negotiation: "qualified", closed_lost: "lost", signed: "converted", active: "converted" };

const categoryOf = (id: string | null | undefined) => mockCategories().find((c) => c.partner_category_id === id) ?? null;
/** A category's name, for the work pickers (partnerships_work.ts). */
export const categoryNameOf = (id: string | null | undefined) => categoryOf(id)?.name ?? null;

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
  custom: CustomValues;
  impact: string[];
  impact_rating: LeadDetail["impact_rating"];
  impact_note: string | null;
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
  custom: CustomValues;
  impact: string[];
}

export const RECORDS: MockRecord[] = [];
export const DEALS: MockDeal[] = [];
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
  const category = mockCategories().find((c) => c.name === p.type) ?? mockCategories()[0];
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
    custom: {},
    impact: [],
    impact_rating: null,
    impact_note: null,
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
    custom: {},
    impact: [],
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

export const recordOf = (id: string | null | undefined) => RECORDS.find((r) => r.id === id) ?? null;
export const dealOf = (id: string | null | undefined) => DEALS.find((d) => d.id === id) ?? null;
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
    impact: d.impact,
    impact_rating: d.impact_rating,
    impact_note: d.impact_note,
    comments: d.comments,
    custom: d.custom,
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
/** The custom fields a record of a category is given (its category's and every category's), retired ones too. */
const fieldsFor = (appliesTo: "lead" | "partner" | "deal", categoryId: string | null) =>
  mockFields().filter((f) => f.applies_to === appliesTo && (f.partner_category_id === null || f.partner_category_id === categoryId));
/** Custom values written over what a record had: null or empty clears one, as the API's checkCustom does. */
function customFrom(had: CustomValues, given: unknown): CustomValues {
  const out = { ...had };
  for (const [key, value] of Object.entries((given ?? {}) as CustomValues)) {
    if (value === null || value === "" || (Array.isArray(value) && value.length === 0)) delete out[key];
    else out[key] = value;
  }
  return out;
}
/** A list's `custom` filter (`{"ticket_model":"Free Entry"}`): every value given is the record's. */
const customMatches = (custom: CustomValues, filter: string) => {
  try {
    return Object.entries(JSON.parse(filter) as Record<string, unknown>).every(([key, value]) => {
      const kept = custom[key];
      return Array.isArray(kept) ? kept.includes(value as string) : kept === value;
    });
  } catch {
    return false;
  }
};
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
    source_label: mockList("lead_source").find((x) => x.code === r.source)?.label ?? null,
    region_view: regionView(r),
    impact: r.impact,
    impact_rating: r.impact_rating,
    impact_note: r.impact_note,
    comments: r.comments,
    custom: r.custom,
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
    custom_fields: fieldsFor("lead", r.category_id),
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
    custom: r.custom,
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
    custom_fields: fieldsFor("partner", r.category_id),
    history: deals
      .flatMap((d) => d.history.map((h) => ({ ...h, deal_id: d.id, deal_number: d.number, deal_title: d.title })))
      .sort((a, b) => b.changed_at.localeCompare(a.changed_at))
      .slice(0, 25),
  };
}

/* ------------------------------------------------------------------ *
 * Reads
 * ------------------------------------------------------------------ */

// Lists, categories and fields are read from Categories' mock (partnerships_categories.ts).

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
    by_stage: stages().filter((s) => s.meaning !== "closed_lost").map((s) => {
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
    by_source: [...by.entries()].sort((a, b) => b[1] - a[1]).map(([source, n]) => ({ source, label: mockList("lead_source").find((x) => x.code === source)?.label ?? "No Source", leads: n })),
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
        custom: (l, v) => customMatches(recordOf(l.lead_id)!.custom, v),
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
    quiet_days: 30,
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
        custom: (p, v) => customMatches(recordOf(p.partner_id)!.custom, v),
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

/** A deal's validity from the contract's Validity: 30 or 60 days, a date, else the category's days. */
function validityFrom(v: unknown, categoryDays: number | null) {
  const given = (v ?? null) as { days?: number; until?: string } | null;
  if (given && given.days) return { validity_days: given.days, valid_until: null };
  if (given && given.until) return { validity_days: null, valid_until: given.until };
  return { validity_days: categoryDays, valid_until: null };
}

/** A deal's own fields from DealFields; the problems as the API words them. */
function dealFrom(b: Body, at_: string, problems: Record<string, string[]>, signedOk: boolean) {
  const stage = str(b.stage) ? stageOf(String(b.stage)) : signedOk ? stageOf("partnership_signed") : stages()[0];
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
    ...validityFrom(b.validity, category?.default_validity_days ?? null),
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
    custom: customFrom({}, b.custom),
    impact: Array.isArray(b.impact) ? (b.impact as string[]) : [],
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
    custom: customFrom({}, b.custom),
    impact: Array.isArray(b.impact) ? (b.impact as string[]) : [],
    impact_rating: (str(b.impact_rating) as LeadDetail["impact_rating"]) ?? null,
    impact_note: str(b.impact_note),
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
  if (Array.isArray(b.impact)) d.impact = b.impact as string[];
  if (b.impact_rating !== undefined) d.impact_rating = (b.impact_rating as DealDetail["impact_rating"]) ?? null;
  if (b.custom !== undefined) d.custom = customFrom(d.custom, b.custom);
  if (b.validity !== undefined) Object.assign(d, b.validity === null ? { validity_days: null, valid_until: null } : validityFrom(b.validity, null));
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
      r.lost_reason = r.status === "lost" ? reason : null;
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
  const p = recordFrom("partner", { name: r.name, partner_category_id: r.category_id, owner_id: byKey(r.owner)?.employee_id, industry: r.industry, website: r.website, region: { scope: r.region_scope }, custom: r.custom }, by);
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
  if (Array.isArray(b.impact)) r.impact = b.impact as string[];
  if (b.impact_rating !== undefined) r.impact_rating = (b.impact_rating as LeadDetail["impact_rating"]) ?? null;
  if (b.impact_note !== undefined) r.impact_note = str(b.impact_note);
  if (b.custom !== undefined) r.custom = customFrom(r.custom, b.custom);
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
  if (b.custom !== undefined) r.custom = customFrom(r.custom, b.custom);
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
  const kind = mockList("partner_document_kind").find((x) => x.code === req.body.kind);
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


/* ------------------------------------------------------------------ *
 * Proposals and the studio (M7 PR 7, packages/contract/schemas/proposals.js), by the API's rules where a
 * screen can see them: Write Draft waits on the required cards, at most three reshuffles a card, nothing
 * sent without confirm, the link only while it works. Claude's answers are the kit's sample; the cards
 * arrive with the brief, as the worker would bring them.
 * ------------------------------------------------------------------ */

type MockProposal = ProposalDetail & { _owner: string };
const PROPOSALS: MockProposal[] = [];
const TEMPLATES: ProposalTemplate[] = [];
const SAMPLE = SAMPLE_CONTENT as unknown as ProposalContent;
const LAYOUT_LABEL: Record<string, string> = { cover: "Cover", letter: "Letter", opportunity: "Opportunity", why_mycity: "Why MyCity", audience: "Audience", deliverables: "Deliverables", packages: "Packages", timeline: "Timeline", proof: "Proof", terms: "Terms", next_steps: "Next Steps", closing: "Closing", insight: "Insight" };
const FIGURE_LAYOUTS = ["why_mycity", "audience", "proof"];
const CARD_TEXT: Array<[ProposalQuestion["group_key"], string, ProposalQuestion["answer_kind"], boolean, string | null]> = [
  ["partner", "What would make this season a success for them?", "long_text", true, null],
  ["audience", "How many guests do they expect each night?", "number", true, "From the transcript, 00:21:51"],
  ["offer", "Which packages should go on sale?", "multi_pick", false, "From the deal"],
  ["money", "What is the early bird price?", "money", false, null],
  ["timing", "When do tickets go on sale?", "date", false, null],
  ["proof", "Which past results matter most to them?", "short_text", false, null],
];
const cardsOf = (seed: string): ProposalQuestion[] =>
  CARD_TEXT.map(([group_key, question, answer_kind, required, from], i) => ({
    proposal_question_id: sid(`card:${seed}:${i}`),
    position: i,
    group_key,
    question,
    why: "What the proposal says changes with the answer",
    answer_kind,
    options: answer_kind === "multi_pick" ? ["Regular", "VIP", "VVIP"] : null,
    suggested: answer_kind === "number" ? 1500 : answer_kind === "multi_pick" ? ["Regular", "VIP"] : null,
    suggested_from: from,
    required,
    answer: null,
    state: "open",
    replaces_id: null,
    reshuffles: 0,
  }));
const contentFor = (p: { number: string; title: string; partner: string }): ProposalContent => ({
  sections: SAMPLE.sections.map((s) => (s.layout === "cover" ? { ...s, title: p.title, prepared_for: p.partner, reference: p.number } : s)),
});
const canOf = (p: ProposalDetail): ProposalDetail["can"] => ({
  edit: p.status === "draft",
  send: p.status === "draft" && !!p.content,
  revise: ["sent", "viewed", "declined", "expired", "withdrawn"].includes(p.status),
  decide: ["sent", "viewed"].includes(p.status),
  withdraw: ["sent", "viewed"].includes(p.status),
  save_template: !!p.content,
});
const fresh = (p: MockProposal): ProposalDetail => {
  const { _owner, ...out } = p;
  void _owner;
  return { ...out, can: canOf(p) };
};
const rowOfProposal = (p: MockProposal) => {
  const d = fresh(p);
  return {
    partnership_proposal_id: d.partnership_proposal_id,
    number: d.number,
    version: d.version,
    title: d.title,
    status: d.status,
    value: d.value,
    currency: d.currency,
    record: d.record,
    deal_id: d.deal_id,
    deal_title: d.deal_title,
    owner: d.owner,
    sent_at: d.sent_at,
    first_viewed_at: d.first_viewed_at,
    view_count: d.view_count,
    valid_until: d.valid_until,
    created_at: d.created_at,
  };
};
function newProposal(deal: MockDeal, status: ProposalDetail["status"], n: number, extra: Partial<ProposalDetail> = {}): MockProposal {
  const r = recordOfDeal(deal);
  const number = `PRO-${String(n).padStart(4, "0")}`;
  const title = status === "questions" ? deal.title : `${deal.title}, Together`;
  const sent = ["sent", "viewed", "accepted"].includes(status);
  return {
    partnership_proposal_id: sid(`proposal:${number}:${status}`),
    number,
    version: 1,
    title,
    status,
    value: deal.estimated_value,
    currency: "NGN",
    record: recordRef(r),
    deal_id: deal.id,
    deal_title: deal.title,
    owner: person(deal.owner),
    sent_at: sent ? `${isoDaysAgo(9)}T10:00:00.000Z` : null,
    first_viewed_at: status === "viewed" || status === "accepted" ? `${isoDaysAgo(8)}T15:20:00.000Z` : null,
    view_count: status === "viewed" ? 3 : status === "accepted" ? 5 : 0,
    valid_until: sent ? isoDaysAhead(21) : null,
    created_at: `${isoDaysAgo(12)}T09:00:00.000Z`,
    brief: { notes: "They want three sold-out nights and a crowd that comes back.", transcript: null },
    questions: status === "questions" ? cardsOf(number) : cardsOf(number).map((q) => ({ ...q, state: "answered", answer: q.suggested ?? "Full lawns and a crowd that returns" })),
    content: status === "questions" ? null : contentFor({ number, title, partner: r.name }),
    assets: [],
    design_template_id: null,
    sent_to: sent ? ["events@example.test"] : [],
    sent_cc: [],
    last_viewed_at: status === "viewed" ? `${isoDaysAgo(2)}T11:00:00.000Z` : null,
    accepted_at: status === "accepted" ? `${isoDaysAgo(3)}T12:00:00.000Z` : null,
    declined_at: null,
    decline_reason: null,
    withdrawn_at: null,
    supersedes_id: null,
    link_url: sent ? `https://go.mycityapp.io/proposal/${sid(`link:${number}`).replace(/-/g, "")}` : null,
    ai: "on",
    progress: null,
    versions: [],
    can: { edit: false, send: false, revise: false, decide: false, withdraw: false, save_template: false },
    _owner: deal.owner ?? "ngozi",
    ...extra,
  };
}
DEALS.filter((d) => d.status === "open" || d.status === "live")
  .slice(0, 4)
  .forEach((d, i) => PROPOSALS.push(newProposal(d, (["viewed", "draft", "accepted", "questions"] as const)[i], 27 + i)));
PROPOSALS.forEach((p) => (p.versions = [{ partnership_proposal_id: p.partnership_proposal_id, version: 1, status: p.status, sent_at: p.sent_at }]));
TEMPLATES.push({ proposal_template_id: sid("ptemplate:festival"), name: "Festival Ticketing", partner_category_id: null, structure: { layouts: SAMPLE.sections.map((s) => s.layout), tone_notes: "Warm and direct." }, created_from_proposal_id: null, active: true });

const proposalOf = (id: string) => PROPOSALS.find((p) => p.partnership_proposal_id === id) ?? null;
const notNow = (message: string) => fail(409, "PROPOSAL_STATE", message);
const touch = (p: MockProposal) => {
  p.versions = p.versions.map((v) => (v.partnership_proposal_id === p.partnership_proposal_id ? { ...v, status: p.status, sent_at: p.sent_at } : v));
  return ok(fresh(p));
};

route("GET /api/v1/partnerships/proposals/summary", () => {
  const decided = PROPOSALS.filter((p) => ["accepted", "declined"].includes(p.status));
  const accepted = PROPOSALS.filter((p) => p.status === "accepted").length;
  return ok({ sent_this_year: PROPOSALS.filter((p) => p.sent_at).length, accepted, viewed_no_reply: PROPOSALS.filter((p) => p.status === "viewed").length, acceptance_rate: decided.length ? Math.round((accepted / decided.length) * 100) : null });
});
route("GET /api/v1/partnerships/proposals", (req) =>
  paged(
    PROPOSALS.filter((p) => !PROPOSALS.some((n) => n.supersedes_id === p.partnership_proposal_id)).map(rowOfProposal),
    req,
    { search: (p) => [p.title ?? "", p.number, p.record.name, p.deal_title], filters: { status: (p, v) => p.status === v, deal_id: (p, v) => p.deal_id === v, partner_id: (p, v) => p.record.type === "partner" && p.record.id === v, lead_id: (p, v) => p.record.type === "lead" && p.record.id === v },
      sort: {
        created_at: (a, b) => a.created_at.localeCompare(b.created_at),
        sent_at: (a, b) => (a.sent_at ?? "").localeCompare(b.sent_at ?? ""),
        value: (a, b) => Number(a.value ?? 0) - Number(b.value ?? 0),
      },
    },
  ),
);
route("GET /api/v1/partnerships/proposal-templates", (req) => paged(TEMPLATES, req, { search: (t) => [t.name], filters: { partner_category_id: () => true } }));
route("GET /api/v1/partnerships/proposals/:id", (req) => {
  const p = proposalOf(req.params.id);
  return p ? ok(fresh(p)) : notFound();
});
route("GET /api/v1/partnerships/proposals/:id/preview", (req) => {
  const p = proposalOf(req.params.id);
  if (!p) return notFound();
  if (!p.content) return notNow("This proposal has no draft yet");
  const sections = p.content.sections.map((s) => ({
    key: s.key,
    layout: s.layout,
    label: ("heading" in s && s.heading) || ("title" in s && s.title) || LAYOUT_LABEL[s.layout],
    hidden: !!s.hidden,
    pages: s.hidden ? 0 : 1,
    fits: FIGURE_LAYOUTS.includes(s.layout) ? [s.layout, ...FIGURE_LAYOUTS.filter((l) => l !== s.layout)] : [s.layout],
    images: s.layout === "cover" ? [{ field: "image_asset_id" as const, stand_in: true }, { field: "partner_logo_asset_id" as const, stand_in: false }] : s.layout === "closing" ? [{ field: "image_asset_id" as const, stand_in: true }] : [],
    unconfirmed: s.unconfirmed ?? [],
  }));
  return ok({
    html: SAMPLE_HTML,
    sections,
    checks: { stand_ins: sections.filter((s) => s.images.some((i) => i.stand_in) && !s.hidden).map((s) => ({ key: s.key, label: s.label })), unconfirmed: [{ key: "opportunity", figure: "2,100" }] },
  });
});
route("POST /api/v1/partnerships/proposals", (req) => {
  const deal = dealOf(String(req.body.deal_id ?? ""));
  if (!deal) return invalid({ deal_id: ["Pick a deal"] });
  const p = newProposal(deal, "questions", 31 + PROPOSALS.length, { brief: { notes: (req.body.notes as string) || null, transcript: null } });
  p.partnership_proposal_id = uuid();
  p.versions = [{ partnership_proposal_id: p.partnership_proposal_id, version: 1, status: p.status, sent_at: null }];
  PROPOSALS.unshift(p);
  return created(fresh(p));
});
route("POST /api/v1/partnerships/proposals/:id/retry", (req) => {
  const p = proposalOf(req.params.id);
  if (!p) return notFound();
  p.progress = null;
  return touch(p);
});
const cardRoute = (action: "answer" | "skip" | "reshuffle") =>
  route(`POST /api/v1/partnerships/proposals/:id/questions/:qid/${action}`, (req) => {
    const p = proposalOf(req.params.id);
    const q = p?.questions.find((c) => c.proposal_question_id === req.params.qid && c.state !== "replaced");
    if (!p || !q) return notFound();
    if (action === "answer") {
      const a = req.body.answer as ProposalQuestion["answer"];
      if (a === null || a === "" || (Array.isArray(a) && !a.length)) return invalid({ answer: ["Give an answer"] });
      if (q.answer_kind === "money" && !/^\d+\.\d{2}$/.test(String(a))) return invalid({ answer: ["Give an amount"] });
      Object.assign(q, { answer: a, state: "answered" });
    } else if (action === "skip") {
      if (q.required) return fail(409, "PROPOSAL_STATE", "Answer this card", { answer: ["Required card"] });
      Object.assign(q, { answer: null, state: "skipped" });
    } else {
      if (q.reshuffles >= 3) return notNow("Reshuffled three times");
      q.state = "replaced";
      p.questions.push({ ...q, proposal_question_id: uuid(), question: `${q.question.replace(/\?$/, "")}, from another angle?`, state: "open", answer: null, replaces_id: q.proposal_question_id, reshuffles: q.reshuffles + 1 });
      p.questions.sort((a, b) => a.position - b.position);
    }
    return touch(p);
  });
cardRoute("answer");
cardRoute("skip");
cardRoute("reshuffle");
route("POST /api/v1/partnerships/proposals/:id/draft", (req) => {
  const p = proposalOf(req.params.id);
  if (!p) return notFound();
  if (p.status !== "questions") return notNow("A draft is already written");
  if (p.questions.some((q) => q.required && q.state === "open")) return fail(409, "PROPOSAL_STATE", "Answer the required cards", { questions: ["Answer the required cards"] });
  // The worker writes in minutes; the mock's draft is the kit's sample, at once.
  Object.assign(p, { status: "draft", content: contentFor({ number: p.number, title: `${p.deal_title}, Together`, partner: p.record.name }), title: `${p.deal_title}, Together`, progress: null });
  return touch(p);
});
route("PATCH /api/v1/partnerships/proposals/:id/content", (req) => {
  const p = proposalOf(req.params.id);
  if (!p || !p.content) return notFound();
  if (p.status !== "draft") return notNow("Revise a sent proposal to change it");
  const op = req.body as ProposalContentEdit;
  const list = [...p.content.sections];
  const at = list.findIndex((s) => s.key === op.key);
  if (op.op === "move") {
    const to = op.direction === "up" ? at - 1 : at + 1;
    if (at < 0 || to < 0 || to >= list.length) return invalid({ direction: ["Already at the end"] });
    [list[at], list[to]] = [list[to], list[at]];
  } else if (op.op === "hide" && at >= 0) list[at] = { ...list[at], hidden: op.hidden };
  else if (op.op === "section") {
    if (at >= 0) list[at] = op.section;
    else list.splice(list.length - 1, 0, op.section);
  } else if (op.op === "layout" && at >= 0) {
    const s = list[at];
    if (!FIGURE_LAYOUTS.includes(s.layout) || !FIGURE_LAYOUTS.includes(op.layout)) return invalid({ layout: ["Does not fit"] });
    const figs = s.layout === "why_mycity" ? s.points.map(({ value, label }) => ({ value, label })) : s.layout === "audience" ? s.stats : s.layout === "proof" ? s.results : [];
    const base = { key: s.key, hidden: s.hidden, sources: s.sources, unconfirmed: s.unconfirmed, heading: "heading" in s ? s.heading : "Why MyCity" };
    list[at] =
      op.layout === "audience"
        ? { ...base, layout: "audience", intro: null, stats: figs, chart: null }
        : op.layout === "proof"
          ? { ...base, layout: "proof", logos: [], results: figs, chart: null }
          : { ...base, layout: "why_mycity", points: figs.map((f) => ({ proof_point_id: null, ...f })), chart: null };
  } else if (op.op === "image" && at < 0) return notFound();
  p.content = { sections: list };
  return touch(p);
});
route("POST /api/v1/partnerships/proposals/:id/sections/:key/rewrite", (req) => {
  const p = proposalOf(req.params.id);
  const s = p?.content?.sections.find((x) => x.key === req.params.key);
  if (!p || !s) return notFound();
  const section = "heading" in s ? { ...s, heading: `${s.heading.replace(/, Rewritten$/, "")}, Rewritten` } : s;
  return ok({ available: true, reason: null, key: s.key, section, ai_run_id: null });
});
route("POST /api/v1/partnerships/proposals/:id/message", (req) => {
  const p = proposalOf(req.params.id);
  if (!p) return notFound();
  return ok({ available: true, reason: null, subject: `${p.title ?? p.deal_title} for ${p.record.name}`, message: `Dear Ife,\n\nThank you for your time last week. The proposal is attached, and the link opens it online.\n\nI would be glad to talk it through on a call this week.\n\n${refKey(p._owner).display_name.split(" ")[0]}`, ai_run_id: null });
});
route("POST /api/v1/partnerships/proposals/:id/send", (req) => {
  const p = proposalOf(req.params.id);
  if (!p) return notFound();
  const b = req.body as { to?: string[]; cc?: string[]; subject?: string; message?: string; confirm?: boolean };
  const f: Record<string, string[]> = {};
  if (!b.to?.length) f.to = ["Add an address"];
  if (!b.subject?.trim()) f.subject = ["Give a subject"];
  if (!b.message?.trim()) f.message = ["Write a message"];
  if (b.confirm !== true) f.confirm = ["Confirm to send"];
  if (Object.keys(f).length) return invalid(f);
  if (p.status !== "draft") return notNow("Only a draft can be sent");
  Object.assign(p, { status: "sent", sent_at: now(), sent_to: b.to, sent_cc: b.cc ?? [], valid_until: isoDaysAhead(30), link_url: `https://go.mycityapp.io/proposal/${uuid().replace(/-/g, "")}` });
  return touch(p);
});
route("POST /api/v1/partnerships/proposals/:id/pdf", (req) => {
  const p = proposalOf(req.params.id);
  return p ? exportFile(req.user!, p.number, "pdf") : notFound();
});
const decideRoute = (action: "accept" | "decline" | "withdraw") =>
  route(`POST /api/v1/partnerships/proposals/:id/${action}`, (req) => {
    const p = proposalOf(req.params.id);
    if (!p) return notFound();
    if (!["sent", "viewed"].includes(p.status)) return notNow("Only a sent proposal");
    if (action === "decline" && String(req.body.reason ?? "").trim().length < 1) return invalid({ reason: ["Give a reason"] });
    if (action === "accept") Object.assign(p, { status: "accepted", accepted_at: now() });
    if (action === "decline") Object.assign(p, { status: "declined", declined_at: now(), decline_reason: String(req.body.reason), link_url: null });
    if (action === "withdraw") Object.assign(p, { status: "withdrawn", withdrawn_at: now(), link_url: null });
    return touch(p);
  });
decideRoute("accept");
decideRoute("decline");
decideRoute("withdraw");
route("POST /api/v1/partnerships/proposals/:id/revise", (req) => {
  const p = proposalOf(req.params.id);
  if (!p) return notFound();
  if (!canOf(p).revise) return notNow("Only the newest sent version");
  const next: MockProposal = { ...p, partnership_proposal_id: uuid(), version: p.version + 1, status: "draft", sent_at: null, first_viewed_at: null, last_viewed_at: null, view_count: 0, valid_until: null, link_url: null, sent_to: [], sent_cc: [], accepted_at: null, declined_at: null, decline_reason: null, withdrawn_at: null, supersedes_id: p.partnership_proposal_id, created_at: now() };
  next.versions = [{ partnership_proposal_id: next.partnership_proposal_id, version: next.version, status: "draft", sent_at: null }, ...p.versions];
  PROPOSALS.unshift(next);
  return created(fresh(next));
});
route("POST /api/v1/partnerships/proposals/:id/save-as-template", (req) => {
  const p = proposalOf(req.params.id);
  if (!p || !p.content) return notFound();
  const t: ProposalTemplate = { proposal_template_id: uuid(), name: String(req.body.name ?? "Template"), partner_category_id: null, structure: { layouts: p.content.sections.filter((s) => !s.hidden).map((s) => s.layout), tone_notes: null }, created_from_proposal_id: p.partnership_proposal_id, active: true };
  TEMPLATES.unshift(t);
  return created(t);
});

// Analytics (§6.18): a period's figures in the contract's shape, the months of the period asked for.
route("GET /api/v1/partnerships/analytics", (req) => {
  const q = req.query as { period?: string; from?: string; to?: string };
  const today = isoDaysAgo(0);
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const pad = (n: number) => String(n).padStart(2, "0");
  const lastOf = (yy: number, mm: number) => `${yy}-${pad(mm)}-${pad(new Date(Date.UTC(yy, mm, 0)).getUTCDate())}`;
  const qStart = Math.floor((m - 1) / 3) * 3 + 1;
  const period =
    q.period === "custom" && q.from && q.to
      ? { from: q.from, to: q.to }
      : q.period === "year"
        ? { from: `${y}-01-01`, to: `${y}-12-31` }
        : q.period === "quarter"
          ? { from: `${y}-${pad(qStart)}-01`, to: lastOf(y, qStart + 2) }
          : { from: `${y}-${pad(m)}-01`, to: lastOf(y, m) };
  const months: string[] = [];
  for (let yy = Number(period.from.slice(0, 4)), mm = Number(period.from.slice(5, 7)); `${yy}-${pad(mm)}` <= period.to.slice(0, 7) && months.length < 60; mm === 12 ? ((yy += 1), (mm = 1)) : (mm += 1)) months.push(`${yy}-${pad(mm)}`);
  const scale = months.length;
  const owners: Array<[string, number[], string | null]> = [
    ["ngozi", [5, 8, 2, 1, 9, 14200, 2], "Meets"],
    ["bashir", [3, 4, 1, 0, 7, 6800, 1], null],
    ["cynthia", [1, 2, 1, 1, 7, 21400, 0], "Exceeds"],
  ];
  const by_owner = owners.map(([key, [p, mt, pr, sg, act, dl, v], rating]) => ({
    owner: refKey(key),
    new_prospects: p * scale,
    meetings_held: mt * scale,
    proposals_sent: pr * scale,
    partnerships_signed: sg * scale,
    active_partnerships: act,
    downloads: dl * scale,
    vendor_leads: v * scale,
    performance_rating: rating,
  }));
  const sum = (k: "new_prospects" | "meetings_held" | "proposals_sent" | "partnerships_signed") => by_owner.reduce((n, o) => n + o[k], 0);
  return ok({
    period,
    kpis: { new_prospects: sum("new_prospects"), meetings_held: sum("meetings_held"), proposals_sent: sum("proposals_sent"), partnerships_signed: sum("partnerships_signed") },
    by_owner,
    signed_per_month: months.map((month, i) => ({ month, signed: [1, 2, 1, 3, 2, 2][i % 6], value: ["2500000.00", "4100000.00", "1200000.00", "6800000.00", "3000000.00", "2750000.00"][i % 6] })),
    returns_per_month: months.map((month, i) => ({ month, gross_sales: ["1800000.00", "2400000.00", "960000.00"][i % 3], mycity_commission: ["144000.00", "192000.00", "76800.00"][i % 3], downloads: [14200, 18900, 6800][i % 3] })),
    by_category: [
      { partner_category_id: null, name: "Event", open: 6, signed: 2 * scale, value: "6600000.00" },
      { partner_category_id: null, name: "Hospitality", open: 3, signed: scale, value: "1200000.00" },
      { partner_category_id: null, name: "Vendor", open: 4, signed: 0, value: "0.00" },
    ].map((c, i) => ({ ...c, partner_category_id: `00000000-0000-4000-8000-00000000070${i}` })),
    by_region: [
      { region: "Lagos", open: 7, signed: 2 * scale },
      { region: "Abuja", open: 3, signed: scale },
      { region: "National", open: 2, signed: 0 },
      { region: "Port Harcourt", open: 1, signed: 0 },
    ],
    stage_conversion: [
      ["prospect_identified", "Prospect Identified", "initial_contact", "Initial Contact", 14, 78],
      ["initial_contact", "Initial Contact", "introductory_meeting_held", "Introductory Meeting Held", 9, 64],
      ["introductory_meeting_held", "Introductory Meeting Held", "proposal_sent", "Proposal Sent", 6, 67],
      ["proposal_sent", "Proposal Sent", "negotiation", "Negotiation", 4, 67],
      ["negotiation", "Negotiation", "partnership_signed", "Partnership Signed", 3, 75],
    ].map(([from_stage, from_label, to_stage, to_label, moved, rate]) => ({ from_stage: String(from_stage), from_label: String(from_label), to_stage: String(to_stage), to_label: String(to_label), moved: Number(moved), rate: Number(rate) })),
  });
});

// Export on Partners and Leads, in the tracker's columns: a file made for the person who pressed it.
route("POST /api/v1/partnerships/exports", (req) => exportFile(req.user!, String(req.body.source).replace("partnerships.", "")));
