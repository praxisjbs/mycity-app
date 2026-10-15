import type { Contract, Lead, Partner360, PartnerRow, Proposal } from "@/api/types/partnerships";
import type { Status, Trail } from "@/api/types/performance";
import { at, created, fail, invalid, isoDaysAgo, isoDaysAhead, notFound, ok, paged, route, sid } from "../core";
import { byId, refKey } from "../data/people";
import { PARTNERS, STAGES, stageTone, type MockPartner, type Stage } from "../data/partners";

const S = (tone: Status["tone"], text: string): Status => ({ tone, text });
const k = (m: string) => Math.round(Number(m) * 100);
const m = (kobo: number) => `${Math.trunc(kobo / 100)}.${String(kobo % 100).padStart(2, "0")}`;
const SHORT: Record<string, string> = { "Prospect identified": "Prospect", "Initial contact": "Contact", "Intro meeting scheduled": "Meeting", "Intro meeting held": "Meeting", "Proposal sent": "Proposal", "Follow up": "Proposal", "Ongoing negotiation": "Negotiation", "Verbal approval": "Negotiation", "Contract review": "Negotiation", "Partnership signed": "Signed", "Active partnership": "Active" };
const LADDER = ["Prospect", "Contact", "Meeting", "Proposal", "Negotiation", "Signed", "Active"];
const status = (p: MockPartner): Status => (p.quiet_days > 30 ? S("err", `Quiet ${p.quiet_days} days`) : S(stageTone(p.stage, p.quiet_days), p.stage === "Active partnership" ? "Active" : p.stage));
const pipeline = () => PARTNERS.filter((p) => p.stage !== "Active partnership" && p.stage !== "On hold");
const LOGS = new Map<string, Trail[]>();

function row(p: MockPartner): PartnerRow {
  return { partner_id: p.partner_id, name: p.name, industry: p.industry, type: p.type, stage: p.stage, stage_status: status(p), owner: refKey(p.owner), value: p.value, last_contact_days: p.quiet_days };
}
function full(p: MockPartner): Partner360 {
  const at_ = LADDER.indexOf(SHORT[p.stage] ?? "Prospect");
  const active = p.stage === "Active partnership";
  const live = active || p.stage === "Partnership signed";
  const value = k(p.value);
  const logs = LOGS.get(p.partner_id) ?? [
    ...(p.quiet_days > 30 ? [{ title: "Inactivity alert raised", when: at(p.quiet_days - 30, "06:00"), text: "30 days with no recorded contact.", tone: "hi" as const }] : []),
    { title: active ? "Quarterly review held" : "Last recorded contact", when: at(p.quiet_days, "11:00"), text: active ? "Deliverables on track. Renewal discussed." : "Email follow up on the proposal.", tone: null },
    { title: `Moved to ${p.stage}`, when: at(p.days_at_stage, "15:30"), text: `By ${refKey(p.owner).display_name}.`, tone: "ok" as const },
  ];
  LOGS.set(p.partner_id, logs);
  return {
    partner_id: p.partner_id, name: p.name, legal_name: p.legal_name, industry: p.industry, type: p.type, owner: refKey(p.owner), stage: p.stage, stage_status: status(p), value: p.value, since: p.since, last_contact_days: p.quiet_days, hq: p.hq, website: p.website,
    stats: { signed_documents: live ? 2 : 0, open_tasks: p.quiet_days > 30 ? 1 : 3, interactions_90d: Math.max(1, 14 - Math.floor(p.quiet_days / 5)), renewal: p.renewal },
    contacts: [["Contact", `Head of Partnerships, ${p.name}`], ["Email", `partnerships@${p.website}`], ["Phone", "+234 803 000 0000"], ["Introduced by", active ? "Direct approach by the CEO" : "Business development outreach"]],
    chain: LADDER.map((label, i) => ({ label, state: i < at_ ? "done" : i === at_ ? (active ? "done" : "now") : null })),
    chain_note: p.quiet_days > 30 ? `${p.quiet_days} days quiet at this stage. An inactivity alert is open on the owner.` : active ? `Live since ${p.since?.split("-").reverse().join("/")}. Renewal is tracked in Contracts & MOUs.` : "Moving normally.",
    days_at_stage: LADDER.slice(0, at_ + 1).map((label, i) => ({ label, days: i === at_ ? p.days_at_stage : [11, 24, 18, 9, 22, 6][i] ?? 7, current: i === at_ && !active })),
    interactions: logs,
    documents: live ? [{ title: "Partnership MOU", kind: "MOU", signed_on: p.since, status: S("ok", "Signed") }, { title: "Activation schedule", kind: "Schedule", signed_on: p.since, status: S("ok", "Signed") }] : p.stage === "Proposal sent" || p.stage === "Follow up" ? [{ title: "Partnership proposal", kind: "Proposal", signed_on: null, status: S("warn", "Viewed") }] : [],
    deliverables: (active ? [["Monthly attribution report", "adedotun", 6, S("ok", "On track")], ["Campaign placement refresh", "tolu", 12, S("warn", "In progress")]] : [["Decide: re-engage or close", p.owner, p.quiet_days > 30 ? -22 : 4, p.quiet_days > 30 ? S("err", "Overdue") : S("neutral", "Not started")]]).map(([title, owner, d, st]) => ({ title: title as string, owner: refKey(owner as string), due: isoDaysAhead(d as number), status: st as Status })),
    downloads: { labels: ["May", "Jun", "Jul", "Aug", "Sep", "Oct"], values: active ? [1200, 1900, 2600, 3100, 3900, Math.round(value / 100000)] : [0, 0, 0, 0, 0, 0] },
    lines: active ? [{ label: "Platform Placement", pct: 64, value: `${m(Math.round(value * 0.64))}` }, { label: "Activation Days", pct: 36, value: `${m(Math.round(value * 0.36))}` }] : [{ label: p.type, pct: 0, value: `0.00 of ${p.value}`, emphasis: "warn" }],
  };
}

route("GET /api/v1/partnerships/stages", () => ok([...STAGES]));
route("GET /api/v1/partnerships/pipeline", () => {
  const total = PARTNERS.length;
  const count = (s: Stage) => PARTNERS.filter((p) => p.stage === s).length;
  const reached = (i: number) => PARTNERS.filter((p) => STAGES.indexOf(p.stage) >= i && p.stage !== "On hold").length;
  const signed = PARTNERS.filter((p) => p.since && p.since >= `${new Date().getUTCFullYear()}-01-01`);
  return ok({
    in_pipeline: pipeline().length, signed_this_year: signed.length, signed_value: m(signed.reduce((a, p) => a + k(p.value), 0)), going_quiet: PARTNERS.filter((p) => p.quiet_days > 30).length,
    stages: STAGES.map((s, i) => {
      const n = s === "Active partnership" || s === "On hold" ? count(s) : reached(i);
      return { label: s, pct: Math.round((n * 100) / total), value: String(n), ...(s === "Partnership signed" ? { emphasis: "brand" as const } : s === "On hold" ? { emphasis: "warn" as const } : {}) };
    }),
    stages_note: "Stages taken from the MyCity Partnerships Pipeline Tracker, unchanged.",
    longest: [...pipeline()].sort((a, b) => b.days_at_stage - a.days_at_stage).slice(0, 6).map((p) => ({ partner_id: p.partner_id, name: p.name, stage: p.stage, days_at_stage: p.days_at_stage, owner: refKey(p.owner), action: p.quiet_days > 30 ? S("err", p.stage === "Proposal sent" || p.stage === "Intro meeting held" ? "Chase" : "Decide or close") : p.days_at_stage > 10 ? S("warn", "Due soon") : S("ok", "Normal") })),
  });
});
route("GET /api/v1/partnerships/partners/summary", () => {
  const active = PARTNERS.filter((p) => p.stage === "Active partnership");
  const types = [...new Set(PARTNERS.map((p) => p.type))];
  const byType = types.map((t) => ({ t, v: PARTNERS.filter((p) => p.type === t).reduce((a, p) => a + k(p.value), 0) })).sort((a, b) => b.v - a.v);
  const max = byType[0]?.v || 1;
  return ok({
    active: active.length, total_value: m(PARTNERS.reduce((a, p) => a + k(p.value), 0)), renewals_180: PARTNERS.filter((p) => p.renewal && p.renewal <= isoDaysAhead(180)).length, quiet_30: PARTNERS.filter((p) => p.quiet_days > 30).length,
    by_type: byType.map((x, i) => ({ label: x.t, pct: Math.round((x.v * 100) / max), value: `₦${(x.v / 100 / 1e6).toFixed(1)}M`, ...(i === byType.length - 1 ? { emphasis: "brand" as const } : {}) })),
  });
});
route("GET /api/v1/partnerships/partners", (req) => paged(PARTNERS.map(row), req, { search: (p) => [p.name, p.industry, p.type, p.owner.display_name], filters: { stage: (p, v) => p.stage === v, type: (p, v) => p.type === v, quiet: (p, v) => (v === "true" ? p.last_contact_days > 30 : true) } }));
const find = (id: string) => PARTNERS.find((p) => p.partner_id === id);
route("GET /api/v1/partnerships/partners/:id", (req) => {
  const p = find(req.params.id);
  return p ? ok(full(p)) : notFound();
});
route("POST /api/v1/partnerships/partners", (req) => {
  const b = req.body as Record<string, string>;
  const f: Record<string, string[]> = {};
  if (!b.name?.trim()) f.name = ["Name the partner"];
  if (PARTNERS.some((p) => p.name.toLowerCase() === b.name?.trim().toLowerCase())) f.name = ["Already a partner. Open their 360 instead"];
  if (!b.industry) f.industry = ["Pick the industry"];
  if (!b.type) f.type = ["Pick the partnership type"];
  if (!byId(b.owner_id)) f.owner_id = ["Pick the owner"];
  if (Object.keys(f).length) return invalid(f);
  const p: MockPartner = { partner_id: sid(`partner:${b.name}`), name: b.name.trim(), legal_name: b.legal_name || b.name.trim(), industry: b.industry, type: b.type, owner: byId(b.owner_id)!.user_key, stage: "Prospect identified", value: b.value || "0.00", quiet_days: 0, days_at_stage: 0, since: null, renewal: null, hq: b.hq || "Lagos", website: b.website || "" };
  PARTNERS.unshift(p);
  return created(full(p));
});
route("POST /api/v1/partnerships/partners/:id/stage", (req) => {
  const p = find(req.params.id);
  if (!p) return notFound();
  const to = String(req.body.stage) as Stage;
  if (!STAGES.includes(to)) return invalid({ stage: ["Pick a stage from the tracker"] });
  if (to === "On hold" && !String(req.body.reason ?? "").trim()) return invalid({ reason: ["Say why it is on hold"] });
  if (to === "Partnership signed" && !["Contract review", "Verbal approval"].includes(p.stage)) return fail(409, "NO_CONTRACT", "A partnership is signed from Contract review, once the document is signed.");
  p.stage = to;
  p.days_at_stage = 0;
  if (to === "Active partnership" && !p.since) p.since = isoDaysAgo(0);
  LOGS.get(p.partner_id)?.unshift({ title: `Moved to ${to}`, when: new Date().toISOString(), text: req.body.reason ? String(req.body.reason) : null, tone: "ok" });
  return ok(full(p));
});
route("POST /api/v1/partnerships/partners/:id/interactions", (req) => {
  const p = find(req.params.id);
  if (!p) return notFound();
  const b = req.body as { kind?: string; happened_on?: string; summary?: string };
  const f: Record<string, string[]> = {};
  if (!b.kind) f.kind = ["Call, meeting, email or visit"];
  if (!b.happened_on) f.happened_on = ["When did it happen"];
  else if (b.happened_on > isoDaysAgo(0)) f.happened_on = ["An interaction is logged after it happens"];
  if (!b.summary || b.summary.trim().length < 10) f.summary = ["What was said or agreed (10 characters or more)"];
  if (Object.keys(f).length) return invalid(f);
  full(p);
  const days = Math.round((Date.now() - new Date(`${b.happened_on}T12:00:00+01:00`).getTime()) / 86400000);
  p.quiet_days = Math.min(p.quiet_days, Math.max(0, days));
  LOGS.get(p.partner_id)!.unshift({ title: `${b.kind![0].toUpperCase()}${b.kind!.slice(1)} logged`, when: `${b.happened_on}T12:00:00+01:00`, text: b.summary!.trim(), tone: null });
  return created(full(p));
});

const LEADS: Lead[] = [
  ["Zenith Bank · events sponsorship", "BD conversation", "ngozi", 8, "Send one pager", S("info", "Qualified")],
  ["Terra Kulture · tourism listing", "Referral", "bashir", 10, "Book intro call", S("neutral", "Contacted")],
  ["Ikeja City Mall · business listings", "Website form", "ngozi", 12, "Qualify", S("neutral", "New")],
  ["Air Peace · travel partnership", "BD conversation", "bashir", 16, null, S("err", "Lost")],
  ["Nairobi Tourism Board · city launch", "Inbound email", "cynthia", 24, "Proposal", S("ok", "Converted")],
  ["Chicken Republic · city offers", "Event", "grace", 3, "Qualify", S("neutral", "New")],
  ["Lagos Marathon · runner app tie-in", "BD conversation", "adedotun", 5, "Send one pager", S("info", "Qualified")],
].map((l, i) => ({ lead_id: sid(`lead:${i}`), title: l[0] as string, source: l[1] as string, owner: refKey(l[2] as string), added_on: isoDaysAgo(l[3] as number), next_action: l[4] as string | null, status: l[5] as Status }));
route("GET /api/v1/partnerships/leads/summary", () => {
  const n = (t: string) => LEADS.filter((l) => l.status.text === t).length;
  return ok({ new: n("New"), contacted: n("Contacted"), qualified: n("Qualified"), converted_this_month: n("Converted"), sources: [{ label: "BD Conversation", pct: 100, value: "14" }, { label: "Website Form", pct: 43, value: "6" }, { label: "Referral", pct: 36, value: "5" }, { label: "Inbound Email", pct: 29, value: "4" }, { label: "Event", pct: 21, value: "3" }] });
});
route("GET /api/v1/partnerships/leads", (req) => paged(LEADS, req, { search: (l) => [l.title, l.source, l.owner.display_name], filters: { status: (l, v) => l.status.text.toLowerCase() === v, source: (l, v) => l.source === v } }));
route("POST /api/v1/partnerships/leads", (req) => {
  const b = req.body as Record<string, string>;
  const f: Record<string, string[]> = {};
  if (!b.title || b.title.trim().length < 4) f.title = ["Who, and what about"];
  if (!b.source) f.source = ["Where it came from"];
  if (Object.keys(f).length) return invalid(f);
  const l: Lead = { lead_id: sid(`lead:new:${LEADS.length}`), title: b.title.trim(), source: b.source, owner: refKey(req.user!), added_on: isoDaysAgo(0), next_action: b.next_action || null, status: S("neutral", "New") };
  LEADS.unshift(l);
  return created(l);
});
route("POST /api/v1/partnerships/leads/:id/convert", (req) => {
  const l = LEADS.find((x) => x.lead_id === req.params.id);
  if (!l) return notFound();
  if (l.status.text === "Converted" || l.status.text === "Lost") return fail(409, "CLOSED", `This lead is already ${l.status.text.toLowerCase()}.`);
  const name = l.title.split(" · ")[0];
  const p: MockPartner = { partner_id: sid(`partner:${name}`), name, legal_name: name, industry: "Other", type: "Sponsorship", owner: byId(l.owner.employee_id)!.user_key, stage: "Prospect identified", value: "0.00", quiet_days: 0, days_at_stage: 0, since: null, renewal: null, hq: "Lagos", website: "" };
  PARTNERS.unshift(p);
  l.status = S("ok", "Converted");
  return ok({ partner_id: p.partner_id });
});
route("POST /api/v1/partnerships/leads/:id/lose", (req) => {
  const l = LEADS.find((x) => x.lead_id === req.params.id);
  if (!l) return notFound();
  if (!String(req.body.reason ?? "").trim()) return invalid({ reason: ["Say why. It stays searchable"] });
  l.status = S("err", "Lost");
  l.next_action = null;
  return ok(l);
});

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
  const b = req.body as Record<string, string | number>;
  const partner = find(String(b.partner_id));
  const f: Record<string, string[]> = {};
  if (!partner) f.partner_id = ["Pick the partner"];
  if (String(b.what ?? "").trim().length < 20) f.what = ["What we propose, in a sentence or two"];
  if (String(b.why_now ?? "").trim().length < 10) f.why_now = ["Why now"];
  if (!String(b.cities ?? "").trim()) f.cities = ["Which cities"];
  if (!(Number(b.weeks) >= 1)) f.weeks = ["How many weeks"];
  if (!(Number(b.value) > 0)) f.value = ["The value we ask"];
  if (Object.keys(f).length) return invalid(f);
  const n = 31 + PROPS.length - 4;
  const ref = `PRO-${String(n).padStart(4, "0")}`;
  const v = k(String(b.value));
  const p = { proposal_id: sid(`prop:new:${n}`), number: ref, title: String(b.what).split(/[.,]/)[0].slice(0, 60), partner: partner!.name, value: String(b.value), status: S("neutral", "Draft"), _doc: doc(ref, partner!.name, `${String(b.what).trim()} ${String(b.why_now).trim()}`, [[`Placement in ${b.cities}, ${b.weeks} weeks`, m(Math.round(v * 0.7))], ["Activation and reporting", m(v - Math.round(v * 0.7))]], refKey(req.user!).display_name) };
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
  const rows = CONTRACTS.filter((c) => c.renewal_on).map((c) => ({ contract_id: c.contract_id, title: c.title, partner: c.partner, due: c.renewal_on!, days: Math.round((new Date(`${c.renewal_on}T00:00:00Z`).getTime() - today) / 86400000), owner: refKey(PARTNERS.find((p) => p.name === c.partner)?.owner ?? "ngozi") })).sort((a, b) => a.days - b.days);
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
