/**
 * Contracts & MOUs on the mock (docs/guides/partnerships.md §6.8, §6.9, §10): agreements in the contract's
 * shapes (packages/contract/schemas/agreements.js), by the API's own rules where a screen can see them:
 * Generate Agreement filling the category's template from the deal, an empty field kept as a chip that
 * Submit names, Draft edits only, the Partner Agreement flow's two stages, Send for Signature approved
 * only, Send Again, Record Signed Copy, Renew and Close. Signing itself happens on the public page (the
 * public site's own mock); here a sent agreement stays sent. Every organisation and person is invented.
 */
import type { AgreementDetail, AgreementRow, AgreementStatus, RenewalRow, RichTextBlock, Signer, SignerInput, TemplateKind } from "@mycity/contract/contract.gen.ts";
import { created, fail, invalid, isoDaysAgo, isoDaysAhead, notFound, ok, paged, route, sid, type Req } from "../core";
import { refKey, SIGN_INS } from "../data/people";
import { DEALS, dealOf, recordOf, RECORDS } from "./partnerships";

type Body = Record<string, unknown>;
const now = () => new Date().toISOString();
const mayDecide = (user: string | null) => Boolean(user) && SIGN_INS[user!]?.view === "ceo";

interface MockAgreement {
  id: string;
  number: string;
  title: string;
  kind: TemplateKind;
  status: AgreementStatus;
  record_id: string;
  deal_id: string;
  owner: string;
  starts_on: string | null;
  ends_on: string | null;
  renewal_notice_days: number;
  value: string | null;
  fields: Record<string, string | null>;
  /** The fields still empty, by path. */
  empty: string[];
  approval: Omit<NonNullable<AgreementDetail["approval"]>, "can_decide"> | null;
  returned_reason: string | null;
  countersigned: boolean;
  signers: Signer[];
  signing: AgreementDetail["signing"];
  signed_at: string | null;
  signed_outside: boolean;
  sent: boolean;
  renews_id: string | null;
  closed_at: string | null;
  close_reason: string | null;
  created_at: string;
}

const LABEL: Record<string, string> = { "deal.event_title": "Event Title", "contact.full_name": "Contact Person", "ask.opening_hours": "Opening Hours" };
const KIND_TITLE: Record<TemplateKind, string> = { deal_merchant: "Deal Merchant Agreement", mou: "Memorandum of Understanding", service_agreement: "Service Agreement", contract: "Partnership Contract" };

const span = (text: string, bold = false) => ({ text, bold, italic: false, href: null });
const cell = (text: string) => [span(text)];

/** The wording as blocks: the record's values in, an empty field as its label. */
function blocksOf(a: MockAgreement): RichTextBlock[] {
  const v = (path: string) => a.fields[path] ?? `[${LABEL[path] ?? path}]`;
  const signer = a.signers.find((s) => s.side === "partner" && s.state === "signed");
  return [
    { kind: "heading", level: 2, spans: [span(KIND_TITLE[a.kind])] },
    { kind: "paragraph", spans: [span("Business Name: "), span(v("partner.name"), true)] },
    { kind: "paragraph", spans: [span(`Contact Person: ${v("contact.full_name")}`)] },
    { kind: "paragraph", spans: [span(`Event: ${v("deal.event_title")}`)] },
    { kind: "heading", level: 2, spans: [span("Financials")] },
    {
      kind: "table",
      head: [[], cell("Regular"), cell("VIP")],
      rows: [
        [cell("Original Price"), cell("₦12,000.00"), cell("₦30,000.00")],
        [cell("Discount"), cell("10%"), cell("10%")],
        [cell("Deal Price"), cell("₦10,800.00"), cell("₦27,000.00")],
      ],
    },
    { kind: "heading", level: 2, spans: [span("Fine Print")] },
    { kind: "numbered", items: [[span("Event registration and check-in on MyCityApp.")], [span("Amplification across MyCity's channels.")], [span(`Opening hours for customers: ${v("ask.opening_hours")}.`)]] },
    { kind: "paragraph", spans: [span("The above prices, specifications and conditions are hereby accepted.")] },
    { kind: "paragraph", spans: [span(`Name of Representative: ${signer ? signer.name : ""}`)] },
    { kind: "paragraph", spans: [span(`Signature: ${signer ? (signer.method === "paper" ? "Signed on paper" : "Signed electronically") : ""}`)] },
  ];
}

const chip = (path: string, value: string | null) => (value ? value : `<span data-field="${path}" data-label="${LABEL[path] ?? path}">{{ ${path} }}</span>`);

/** The Draft as DocumentEditor opens it, each field still empty a chip. */
function editorHtml(a: MockAgreement): string {
  const f = (p: string) => chip(p, a.empty.includes(p) ? null : a.fields[p]);
  return [
    `<h2>${KIND_TITLE[a.kind]}</h2>`,
    `<p>Business Name: ${f("partner.name")}</p>`,
    `<p>Contact Person: ${f("contact.full_name")}</p>`,
    `<p>Event: ${f("deal.event_title")}</p>`,
    "<h2>Financials</h2>",
    "<table><tr><th></th><th>Regular</th><th>VIP</th></tr><tr><td>Original Price</td><td>₦12,000.00</td><td>₦30,000.00</td></tr><tr><td>Deal Price</td><td>₦10,800.00</td><td>₦27,000.00</td></tr></table>",
    "<h2>Fine Print</h2>",
    `<ol><li>Event registration and check-in on MyCityApp.</li><li>Opening hours for customers: ${f("ask.opening_hours")}.</li></ol>`,
    `<p>Name of Representative: <span data-field="signer.name" data-label="Signer Name">{{ signer.name }}</span></p>`,
    `<p>Signature: <span data-field="signer.signature" data-label="Signature">{{ signer.signature }}</span></p>`,
  ].join("");
}

const AGREEMENTS: MockAgreement[] = [];

const recordRef = (id: string) => {
  const r = recordOf(id);
  const shown = r && r.status === "converted" && r.converted_partner_id ? recordOf(r.converted_partner_id) : r;
  return shown ? { type: shown.kind, id: shown.id, number: shown.number, name: shown.name } : { type: "partner" as const, id, number: "", name: "" };
};

const renewalOn = (a: MockAgreement) => {
  if (!a.ends_on) return null;
  const d = new Date(`${a.ends_on}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - a.renewal_notice_days);
  return d.toISOString().slice(0, 10);
};

function rowOf(a: MockAgreement): AgreementRow {
  return {
    partnership_agreement_id: a.id,
    number: a.number,
    title: a.title,
    kind: a.kind,
    status: a.status,
    record: recordRef(a.record_id),
    deal_id: a.deal_id,
    starts_on: a.starts_on,
    ends_on: a.ends_on,
    renewal_on: renewalOn(a),
    value: a.value,
    currency: "NGN",
    owner: refKey(a.owner),
    signed_at: a.signed_at,
  };
}

const pdf = (id: string, name: string) => ({ document_id: sid(`agr-doc:${id}:${name}`), file_name: `${name}.pdf`, size_bytes: 48213, mime_type: "application/pdf" });
/** A QR the screen shows beside the reference (a placeholder square on the mock). */
const QR = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

function suggested(a: MockAgreement): SignerInput[] {
  const r = recordOf(a.record_id);
  const out: SignerInput[] = [{ name: a.fields["contact.full_name"] ?? "Ngozi Adebayo", title: "Founder", email: `partnerships@${(r?.name ?? "partner").toLowerCase().replace(/[^a-z0-9]+/g, "")}.example.test`, side: "partner" }];
  if (a.countersigned) out.push({ name: "Adaeze Okonkwo", title: "Chief Executive Officer", email: "ceo@mycityapp.example.test", side: "mycity" });
  return out;
}

/** The detail, with Approve and Reject offered to whoever may decide its approval: the CEO, who may decide any stage. */
function detailOf(a: MockAgreement, user: string | null = null): AgreementDetail {
  const signed = ["signed", "active", "expiring", "renewed"].includes(a.status) || (a.status === "closed" && Boolean(a.signed_at));
  return {
    ...rowOf(a),
    proposal_id: null,
    template_key: "events-deal-merchant-agreement",
    template_version: 3,
    fields: a.fields,
    body_html: a.status === "draft" ? editorHtml(a) : null,
    blocks: blocksOf(a),
    missing_fields: a.empty.map((p) => LABEL[p] ?? p),
    workflow_instance_id: a.approval ? sid(`agr-wf:${a.id}`) : null,
    approval: ["review", "approval"].includes(a.status) && a.approval ? { ...a.approval, can_decide: a.approval.state === "waiting" && mayDecide(user) } : null,
    returned_reason: a.status === "draft" ? a.returned_reason : null,
    countersigned: a.countersigned,
    suggested_signers: suggested(a),
    signing: a.signing,
    signers: a.signers,
    document: a.sent ? pdf(a.id, a.number) : null,
    signed_document: signed ? pdf(a.id, `${a.number} Signed`) : null,
    signed_outside: a.signed_outside,
    renewal_notice_days: a.renewal_notice_days,
    renews_agreement_id: a.renews_id,
    closed_at: a.closed_at,
    close_reason: a.close_reason,
    verify: signed ? { reference: a.number, url: `https://go.mycityapp.io/verify/${a.number}`, qr: QR } : null,
  };
}

/* ------------------------------------------------------------------ *
 * The demonstration agreements: one at each step, on the mock's partners and leads
 * ------------------------------------------------------------------ */

let counter = 0;
const nextNumber = () => `AGR-${new Date().getUTCFullYear()}-${String(++counter).padStart(4, "0")}`;

function seed() {
  const partners = RECORDS.filter((r) => r.kind === "partner");
  const leads = RECORDS.filter((r) => r.kind === "lead" && r.status !== "converted" && r.status !== "lost");
  const dealOfRecord = (id: string) => DEALS.find((d) => d.partner_id === id || d.lead_id === id);
  const make = (recordId: string, status: AgreementStatus, extra: Partial<MockAgreement> = {}) => {
    const r = recordOf(recordId)!;
    const deal = dealOfRecord(recordId);
    if (!deal) return;
    const id = sid(`agr:${recordId}:${status}`);
    const a: MockAgreement = {
      id,
      number: nextNumber(),
      title: `${KIND_TITLE[extra.kind ?? "deal_merchant"]}: ${deal.event_title ?? deal.title}`,
      kind: "deal_merchant",
      status,
      record_id: recordId,
      deal_id: deal.id,
      owner: deal.owner ?? r.owner ?? "ngozi",
      starts_on: null,
      ends_on: null,
      renewal_notice_days: 90,
      value: deal.estimated_value,
      fields: { "partner.name": r.name, "contact.full_name": "Ngozi Adebayo", "deal.event_title": deal.event_title ?? deal.title, "ask.opening_hours": "24hrs" },
      empty: [],
      approval: null,
      returned_reason: null,
      countersigned: false,
      signers: [],
      signing: null,
      signed_at: null,
      signed_outside: false,
      sent: false,
      renews_id: null,
      closed_at: null,
      close_reason: null,
      created_at: now(),
      ...extra,
    };
    AGREEMENTS.push(a);
  };
  const signedBy = (name: string, at: string, method: Signer["method"] = "draw"): Signer => ({ name, title: "Founder", email: "partnerships@example.test", side: "partner", state: "signed", signed_at: at, method });
  if (partners[0]) make(partners[0].id, "active", { starts_on: isoDaysAgo(240), ends_on: isoDaysAhead(300), signed_at: `${isoDaysAgo(245)}T10:15:00.000Z`, sent: true, signing: { status: "completed", end_reason: null }, signers: [signedBy("Ngozi Adebayo", `${isoDaysAgo(245)}T10:15:00.000Z`)] });
  if (partners[1]) make(partners[1].id, "expiring", { kind: "mou", starts_on: isoDaysAgo(330), ends_on: isoDaysAhead(40), signed_at: `${isoDaysAgo(335)}T09:00:00.000Z`, sent: true, signed_outside: true, signing: { status: "completed", end_reason: null }, signers: [signedBy("Tolu Bankole", `${isoDaysAgo(335)}T11:00:00.000Z`, "paper")] });
  if (partners[2])
    make(partners[2].id, "sent", {
      starts_on: isoDaysAhead(20), ends_on: isoDaysAhead(385), sent: true, countersigned: true, signing: { status: "pending", end_reason: null },
      signers: [
        { name: "Chidi Okeke", title: "Managing Director", email: "chidi@example.test", side: "partner", state: "viewed", signed_at: null, method: null },
        { name: "Adaeze Okonkwo", title: "Chief Executive Officer", email: "ceo@mycityapp.example.test", side: "mycity", state: "waiting", signed_at: null, method: null },
      ],
    });
  if (partners[3]) make(partners[3].id, "approval", { starts_on: isoDaysAhead(30), ends_on: isoDaysAhead(395), approval: { state: "waiting", stage: "CEO", waiting_on: "Adaeze Okonkwo" } });
  if (leads[0]) make(leads[0].id, "draft", { empty: ["deal.event_title"], fields: { "partner.name": leads[0].name, "contact.full_name": "Ngozi Adebayo", "deal.event_title": null, "ask.opening_hours": "24hrs" } });
}
seed();

/* ------------------------------------------------------------------ *
 * Routes
 * ------------------------------------------------------------------ */

const byIdOf = (req: Req) => AGREEMENTS.find((x) => x.id === req.params.id) ?? null;
const refuse = (code: string, message: string, status = 409, fields?: Record<string, string[]>) => fail(status, code, message, fields);

route("GET /api/v1/partnerships/agreements/summary", () =>
  ok({
    active: AGREEMENTS.filter((a) => a.status === "active" || a.status === "expiring").length,
    in_approval: AGREEMENTS.filter((a) => (a.status === "review" || a.status === "approval") && a.approval?.state === "waiting").length,
    awaiting_signature: AGREEMENTS.filter((a) => a.status === "sent" || a.status === "viewed").length,
    renewals_180: AGREEMENTS.filter((a) => ["signed", "active", "expiring"].includes(a.status) && (renewalOn(a) ?? "9999") <= isoDaysAhead(180)).length,
  }),
);

route("GET /api/v1/partnerships/agreements/renewals", (req) => {
  const within = Number(req.query.within_days ?? 180);
  const today = isoDaysAgo(0);
  const rows: RenewalRow[] = AGREEMENTS.filter((a) => ["signed", "active", "expiring"].includes(a.status) && a.ends_on && a.ends_on >= today && a.ends_on <= isoDaysAhead(within)).map((a) => ({
    partnership_agreement_id: a.id,
    number: a.number,
    title: a.title,
    record: recordRef(a.record_id),
    ends_on: a.ends_on!,
    renewal_on: renewalOn(a)!,
    days_left: Math.round((new Date(`${renewalOn(a)}T00:00:00Z`).getTime() - new Date(`${today}T00:00:00Z`).getTime()) / 86400000),
    owner: refKey(a.owner),
  }));
  const { within_days: _w, ...rest } = req.query;
  void _w;
  return paged(rows.sort((x, y) => x.days_left - y.days_left), { ...req, query: rest });
});

route("GET /api/v1/partnerships/agreements", (req) =>
  paged(
    [...AGREEMENTS].sort((x, y) => y.number.localeCompare(x.number)).map(rowOf),
    req,
    {
      search: (r) => [r.number, r.title, r.record.name],
      filters: {
        status: (r, v) => r.status === v,
        kind: (r, v) => r.kind === v,
        partner_id: (r, v) => r.record.type === "partner" && r.record.id === v,
        lead_id: (r, v) => r.record.type === "lead" && r.record.id === v,
        deal_id: (r, v) => r.deal_id === v,
        owner_id: (r, v) => r.owner?.employee_id === v,
      },
      sort: { number: (x, y) => x.number.localeCompare(y.number), starts_on: (x, y) => (x.starts_on ?? "").localeCompare(y.starts_on ?? ""), ends_on: (x, y) => (x.ends_on ?? "").localeCompare(y.ends_on ?? "") },
    },
  ),
);

route("GET /api/v1/partnerships/agreements/:id", (req) => {
  const a = byIdOf(req);
  return a ? ok(detailOf(a, req.user)) : notFound();
});

/**
 * POST /workflow/instances/:id/approve|reject for an agreement's approval, through organisation.ts's decide chain;
 * null for any other id. Head of Department first, then the CEO; a rejection returns it to Draft with its reason.
 */
export function decideAgreement(user: string, wid: string, approve: boolean, reason?: string | null) {
  const a = AGREEMENTS.find((x) => x.approval && sid(`agr-wf:${x.id}`) === wid);
  if (!a) return null;
  if (a.approval?.state !== "waiting") return fail(409, "APPROVAL_DECIDED", "This approval was already decided");
  if (!mayDecide(user)) return fail(403, "PERMISSION_DENIED", "You are not an approver for this stage");
  if (!approve) {
    if (!String(reason ?? "").trim()) return invalid({ reason: ["is required"] });
    Object.assign(a, { status: "draft", approval: null, returned_reason: String(reason).trim() });
    return ok({ workflow_instance_id: wid, state: "rejected", stage_name: null });
  }
  if (a.approval.stage === "Head of Department") {
    Object.assign(a, { status: "approval", approval: { state: "waiting", stage: "CEO", waiting_on: "The CEO" } });
    return ok({ workflow_instance_id: wid, state: "pending", stage_name: "CEO" });
  }
  Object.assign(a, { status: "approval", approval: { state: "approved", stage: null, waiting_on: null } });
  return ok({ workflow_instance_id: wid, state: "approved", stage_name: null });
}

route("POST /api/v1/partnerships/agreements", (req) => {
  const b = req.body as Body;
  const deal = dealOf(String(b.deal_id ?? ""));
  if (!deal) return invalid({ deal_id: ["Pick the deal"] });
  if (deal.status === "lost") return refuse("DEAL_LOST", "This deal is lost. Reopen it before you write its agreement.");
  const recordId = (deal.partner_id ?? deal.lead_id)!;
  const r = recordOf(recordId)!;
  const kind = (b.kind as TemplateKind) ?? "deal_merchant";
  const a: MockAgreement = {
    id: sid(`agr:new:${AGREEMENTS.length}:${deal.id}`),
    number: nextNumber(),
    title: `${KIND_TITLE[kind]}: ${deal.event_title ?? deal.title}`,
    kind,
    status: "draft",
    record_id: recordId,
    deal_id: deal.id,
    owner: deal.owner ?? "ngozi",
    starts_on: null,
    ends_on: deal.valid_until,
    renewal_notice_days: 90,
    value: deal.estimated_value,
    fields: { "partner.name": r.name, "contact.full_name": "Ngozi Adebayo", "deal.event_title": deal.event_title, "ask.opening_hours": "24hrs" },
    empty: deal.event_title ? [] : ["deal.event_title"],
    approval: null,
    returned_reason: null,
    countersigned: kind === "mou",
    signers: [],
    signing: null,
    signed_at: null,
    signed_outside: false,
    sent: false,
    renews_id: null,
    closed_at: null,
    close_reason: null,
    created_at: now(),
  };
  AGREEMENTS.unshift(a);
  return created(detailOf(a));
});

route("PATCH /api/v1/partnerships/agreements/:id", (req) => {
  const a = byIdOf(req);
  if (!a) return notFound();
  if (a.status !== "draft") return refuse("NOT_DRAFT", "Only a draft agreement can be edited");
  const b = req.body as Body;
  const fields = (b.fields ?? {}) as Record<string, string | null>;
  for (const [k, v] of Object.entries(fields)) {
    a.fields[k] = v;
    a.empty = v ? a.empty.filter((p) => p !== k) : [...new Set([...a.empty, k])];
  }
  if (typeof b.body_html === "string") a.empty = a.empty.filter((p) => b.body_html !== "" && String(b.body_html).includes(`data-field="${p}"`));
  if (b.starts_on !== undefined) a.starts_on = (b.starts_on as string) || null;
  if (b.ends_on !== undefined) a.ends_on = (b.ends_on as string) || null;
  if (a.starts_on && a.ends_on && a.ends_on < a.starts_on) return invalid({ ends_on: ["Ends before it starts"] });
  if (typeof b.renewal_notice_days === "number") a.renewal_notice_days = b.renewal_notice_days;
  return ok(detailOf(a));
});

route("POST /api/v1/partnerships/agreements/:id/submit", (req) => {
  const a = byIdOf(req);
  if (!a) return notFound();
  if (a.status !== "draft") return refuse("NOT_DRAFT", "Only a draft agreement can be submitted");
  if (a.empty.length) {
    const named = a.empty.map((p) => LABEL[p] ?? p);
    return refuse("FIELDS_MISSING", `Fill ${named.join(", ")} first`, 422, { body_html: named.map((n) => `${n} is empty`) });
  }
  if (!a.starts_on) return refuse("VALIDATION_FAILED", "Set the start date", 422, { starts_on: ["Set the start date"] });
  a.status = "review";
  a.returned_reason = null;
  a.approval = { state: "waiting", stage: "Head of Department", waiting_on: "Tunde Bakare" };
  return ok(detailOf(a));
});

/** The signers in signing order, refused as the API refuses them. */
function ordered(a: MockAgreement, given: SignerInput[]) {
  const partner = given.filter((s) => s.side === "partner");
  const mycity = given.filter((s) => s.side === "mycity");
  if (!partner.length) return { error: invalid({ signers: ["Add the partner's signer"] }) };
  if (a.countersigned && !mycity.length) return { error: invalid({ signers: ["Add MyCity's signer"] }) };
  const emails = given.map((s) => s.email.toLowerCase());
  if (new Set(emails).size !== emails.length) return { error: invalid({ signers: ["Two signers share an email"] }) };
  return { list: [...partner, ...mycity] };
}

function sendTo(a: MockAgreement, given: SignerInput[]) {
  const out = ordered(a, given);
  if (out.error) return out.error;
  a.signers = out.list!.map((s, i) => ({ name: s.name, title: s.title ?? null, email: s.email, side: s.side, state: i === 0 ? "sent" : "waiting", signed_at: null, method: null }));
  a.signing = { status: "pending", end_reason: null };
  a.status = "sent";
  a.sent = true;
  a.approval = null;
  return ok(detailOf(a));
}

route("POST /api/v1/partnerships/agreements/:id/send", (req) => {
  const a = byIdOf(req);
  if (!a) return notFound();
  const again = a.status === "sent" || a.status === "viewed";
  if (!again && !(a.status === "approval" && a.approval?.state === "approved")) return refuse("NOT_APPROVED", "Only an approved agreement can be sent for signature");
  return sendTo(a, ((req.body as Body).signers ?? []) as SignerInput[]);
});

route("POST /api/v1/partnerships/agreements/:id/resend", (req) => {
  const a = byIdOf(req);
  if (!a) return notFound();
  if (a.status !== "sent" && a.status !== "viewed") return refuse("NOT_SENT", "Only an agreement sent for signature can be sent again");
  return sendTo(a, a.signers.filter((s) => s.email).map((s) => ({ name: s.name, ...(s.title ? { title: s.title } : {}), email: s.email!, side: s.side })));
});

route("POST /api/v1/partnerships/agreements/:id/signed-copy", (req) => {
  const a = byIdOf(req);
  if (!a) return notFound();
  const b = req.body as Body;
  const ready = (a.status === "approval" && a.approval?.state === "approved") || a.status === "sent" || a.status === "viewed";
  if (!ready) return refuse("NOT_APPROVED", "Only an approved agreement can be recorded as signed");
  const f: Record<string, string[]> = {};
  if (!b.document_id) f.document_id = ["Upload the signed copy"];
  if (!b.signed_on) f.signed_on = ["Pick the date"];
  else if (String(b.signed_on) > isoDaysAgo(0)) f.signed_on = ["Not in the future"];
  if (!String(b.signed_by_name ?? "").trim()) f.signed_by_name = ["Who signed"];
  if (Object.keys(f).length) return invalid(f);
  a.status = "signed";
  a.signed_outside = true;
  a.signed_at = `${b.signed_on}T11:00:00.000Z`;
  a.signing = { status: "completed", end_reason: null };
  a.signers = [{ name: String(b.signed_by_name).trim(), title: (b.signed_by_title as string) || null, email: null, side: "partner", state: "signed", signed_at: a.signed_at, method: "paper" }];
  a.approval = null;
  return ok(detailOf(a));
});

route("POST /api/v1/partnerships/agreements/:id/renew", (req) => {
  const a = byIdOf(req);
  if (!a) return notFound();
  if (!["signed", "active", "expiring"].includes(a.status)) return refuse("NOT_SIGNED", "Only a signed agreement can be renewed");
  if (AGREEMENTS.some((x) => x.renews_id === a.id && x.status !== "closed")) return refuse("RENEWAL_OPEN", "Its renewal is already drafted");
  const b = req.body as Body;
  if (!b.starts_on) return invalid({ starts_on: ["Pick the date"] });
  const next: MockAgreement = { ...a, id: sid(`agr:renew:${a.id}:${AGREEMENTS.length}`), number: nextNumber(), status: "draft", starts_on: String(b.starts_on), ends_on: (b.ends_on as string) || null, empty: [], approval: null, signers: [], signing: null, signed_at: null, signed_outside: false, sent: false, renews_id: a.id, created_at: now(), fields: { ...a.fields } };
  AGREEMENTS.unshift(next);
  return created(detailOf(next));
});

route("POST /api/v1/partnerships/agreements/:id/close", (req) => {
  const a = byIdOf(req);
  if (!a) return notFound();
  if (a.status === "closed") return refuse("CLOSED", "This agreement is already closed");
  const reason = String((req.body as Body).reason ?? "").trim();
  if (reason.length < 10) return invalid({ reason: ["At least 10 characters"] });
  if (a.signing?.status === "pending") a.signing = { status: "revoked", end_reason: reason };
  a.status = "closed";
  a.closed_at = now();
  a.close_reason = reason;
  a.approval = null;
  return ok(detailOf(a));
});
