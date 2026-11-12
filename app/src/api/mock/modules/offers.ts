import offerSchemas from "@mycity/contract/schemas/offers.js";
import signatureSchemas from "@mycity/contract/schemas/signatures.js";
import type {
  ApprovalInstance,
  ApprovalWaiting,
  OfferDetail,
  OfferDraft,
  OfferLetterTemplate,
  OfferRow,
  OfferSettings,
  OfferStatus,
  SignerView,
} from "@mycity/contract/contract.gen.ts";
import type { RawResponse } from "../../client";
import { at, created, fail, invalid, isoDaysAhead, notFound, ok, paged, route, sid, type Req } from "../core";
import { byId, byKey, grantsFor, refKey } from "../data/people";
import * as D from "../data/recruitment";

/**
 * Recruitment · Offers on the in-browser mock (laptops and CI only, F12), in the contract's shapes
 * (docs/guides/offers.md §5): the list and its figures, New Offer from a shortlisted application,
 * a draft's edits, Submit for Approval on the `recruitment.offer` flow (Head of Department, then the
 * CEO, decided on the offer or on My Approvals through the workflow routes, organisation.ts passes
 * them here), Sign for the company by the Offer Signatory, Send, Resend, Withdraw, and the Offers
 * settings. Bodies are checked by the contract's own schemas. The letter is a short rendering of
 * the standard wording with the offer's values; the real one is offers.render on the server.
 */

type Act = "view" | "create" | "edit";
const can = (req: Req, act: Act) => Boolean(req.user && (grantsFor(req.user).recruitment ?? []).includes(act));
function R(key: string, act: Act, handler: (req: Req) => RawResponse) {
  route(key, (req) => (can(req, act) ? handler(req) : fail(403, "PERMISSION_DENIED", "You do not have access to this")));
}

interface Issue {
  path: PropertyKey[];
  message: string;
}
interface Checker<T> {
  safeParse(v: unknown): { success: true; data: T } | { success: false; error: { issues: Issue[] } };
}
function parse<T>(schema: unknown, body: unknown, then: (data: T) => RawResponse): RawResponse {
  const r = (schema as Checker<T>).safeParse(body);
  if (r.success) return then(r.data);
  const fields: Record<string, string[]> = {};
  for (const i of r.error.issues) fields[i.path.map(String).join(".") || "body"] ??= [i.message];
  return invalid(fields);
}

const nowIso = () => new Date().toISOString();
const kobo = (v: string) => Math.round(Number(v) * 100);
const naira = (k: number) => (k / 100).toFixed(2);
const shown = (v: string) => `₦${Number(v).toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const longDate = (iso: string) => new Date(`${iso}T12:00:00+01:00`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Lagos" });

const COMPANY = "MyCity App Ltd";
const EMPLOYMENT: Record<string, string> = { full_time: "Full-time", part_time: "Part-time", contractor: "Contractor", consultant: "Consultant", intern: "Intern" };
const PATTERN: Record<string, string> = { on_site: "On site", hybrid: "Hybrid", remote: "Remote" };
/** The vacancy's employment type as an employee's (organisation's spelling). */
const EMPLOYMENT_OF: Record<string, OfferDetail["employment_type"]> = { full_time: "full_time", part_time: "part_time", contract: "contractor", internship: "intern" };

/* ------------------------------------------------------------------ *
 * The Offers settings: who signs for the company, and the standard wording
 * ------------------------------------------------------------------ */

const STANDARD = [
  "**PRIVATE & CONFIDENTIAL**",
  "",
  "Dear {{ candidate.first_name }},",
  "",
  "## Offer of Employment: {{ job_title }}",
  "",
  'We are pleased to offer you employment with {{ company }} ("the Company") as {{ job_title }}, with effect from {{ longdate start_date }}, on the terms and conditions set out in this letter.',
  "",
  "### Offer Summary",
  "",
  "| Item | Detail |",
  "|---|---|",
  "| Position | {{ job_title }} |",
  "| Start date | {{ longdate start_date }} |",
  "| Total monthly compensation | {{ money monthly_total }} (see Section 3) |",
  "",
  "## Terms and Conditions",
  "",
  "### 1. Role and Reporting",
  "",
  "1.1 You are employed as {{ job_title }}. The Company may reasonably update these duties from time to time in line with business needs.",
  "",
  "### 3. Remuneration",
  "",
  "3.1 Your monthly compensation is set out below, paid in arrears on the last working day of each month.",
  "",
  "## Acceptance",
  "",
  "Please sign this letter to accept the offer by {{ datetime expires_at }}.",
  "",
  "Yours sincerely,",
  "",
  "{{ signatory.name }}, {{ signatory.title }}, for {{ company }}",
].join("\n");
const VARIABLES = Object.keys((offerSchemas.OfferLetterVars as unknown as { shape: Record<string, unknown> }).shape).filter((k) => k !== "sealing");

const SETTINGS = { signatory: "cynthia" as string | null, body: STANDARD, version: 0, updated_at: null as string | null };
const signatory = () => (SETTINGS.signatory ? byKey(SETTINGS.signatory) : undefined);
const settingsOut = (): OfferSettings => ({ signatory: SETTINGS.signatory ? refKey(SETTINGS.signatory) : null, letter_version: SETTINGS.version, letter_is_default: SETTINGS.version === 0 });
const letterOut = (): OfferLetterTemplate => ({ body: SETTINGS.body, version: SETTINGS.version, is_default: SETTINGS.version === 0, variables: VARIABLES, updated_at: SETTINGS.updated_at });

/* ------------------------------------------------------------------ *
 * The offers
 * ------------------------------------------------------------------ */

type Stage = "head_of_department" | "ceo";
interface Decision {
  stage: Stage;
  decision: "approve" | "reject";
  by: string;
  reason: string | null;
  at: string;
}
interface MockOffer {
  offer_id: string;
  number: string;
  application_id: string;
  status: OfferStatus;
  by: string;
  job_title: string;
  department_id: string | null;
  department: string | null;
  reports_to: string | null;
  role_function: string | null;
  role_scope: string | null;
  employment_type: OfferDetail["employment_type"];
  work_pattern: OfferDetail["work_pattern"];
  office_days: number | null;
  annual_leave_days: number | null;
  incentives: string | null;
  pay: Array<{ name: string; monthly_amount: string }>;
  range_reason: string | null;
  job_description: string | null;
  additional_terms: string | null;
  working_hours: string | null;
  probation_months: number | null;
  valid_days: number;
  benefits: string | null;
  score_snapshot: number | null;
  decision_snapshot: OfferDetail["decision_snapshot"];
  workflow_instance_id: string | null;
  stage: Stage | null;
  decisions: Decision[];
  /** When the Offer Signatory signed for the company, and the candidate. */
  company_signed_at: string | null;
  candidate_signed_at: string | null;
  start_date: string | null;
  expires_at: string | null;
  sent_at: string | null;
  created_at: string;
  submitted_at: string | null;
  approved_at: string | null;
  accepted_at: string | null;
  declined_at: string | null;
  withdrawn_at: string | null;
  end_reason: string | null;
  /** When the mail server refused the candidate's address for good after the send (Refused Addresses). */
  refused_at?: string | null;
}

const APPS = D.APPLICATIONS;
const appOf = (id: string) => APPS.find((a) => a.application_id === id);
const vacancyOf = (a: D.MockApplication) => D.VACANCIES.find((v) => v.vacancy_id === sid(`vac:${a.vacancy_key}`))!;
const nameOf = (a: D.MockApplication) => `${a.first_name} ${a.last_name}`;
const totalOf = (o: Pick<MockOffer, "pay">) => o.pay.reduce((n, l) => n + kobo(l.monthly_amount), 0);
const OPEN: OfferStatus[] = ["draft", "approval", "approved", "sent"];
/** As the API words an offer ended by Not Progressing (offers.service ENDED_REASON). */
const ENDED_REASON = "The candidate was not progressed";

/** The offer's terms as New Offer starts them, from its application's vacancy. */
function fromVacancy(a: D.MockApplication): Omit<MockOffer, "offer_id" | "number" | "status" | "by" | "created_at" | "pay" | "start_date"> {
  const v = vacancyOf(a);
  return {
    application_id: a.application_id,
    job_title: v.title,
    department_id: v.department_id,
    department: v.department,
    reports_to: v.reports_to,
    role_function: null,
    role_scope: null,
    employment_type: v.employment_type ? (EMPLOYMENT_OF[v.employment_type] ?? null) : null,
    work_pattern: v.work_pattern,
    office_days: v.work_pattern === "hybrid" ? 2 : null,
    annual_leave_days: 20,
    incentives: null,
    range_reason: null,
    job_description: v.description,
    additional_terms: null,
    working_hours: v.working_days ? `${v.working_days}, 9:00 a.m. to 5:00 p.m.` : null,
    probation_months: v.probation_months,
    valid_days: offerSchemas.OFFER_VALID_DAYS.default,
    benefits: null,
    score_snapshot: a.screening ?? a.provisional,
    decision_snapshot: "select",
    workflow_instance_id: null,
    stage: null,
    decisions: [],
    company_signed_at: null,
    candidate_signed_at: null,
    expires_at: null,
    sent_at: null,
    submitted_at: null,
    approved_at: null,
    accepted_at: null,
    declined_at: null,
    withdrawn_at: null,
    end_reason: null,
  };
}

/** A shortlisted candidate the fixtures put further on: the stage their offer left them at. */
function placed(i: number, first: string, last: string, vacancy: string, stage: "shortlist" | "offer" | "documentation", days: number) {
  const a = { ...D.APPLICATIONS[0]!, ...applicant(i, first, last, vacancy, days) };
  a.stage = stage;
  if (stage !== "shortlist") a.history = [...a.history, { to: "offer", days: Math.max(0, days - 6), by: "cynthia" }];
  if (stage === "documentation") a.history = [...a.history, { to: "documentation", days: Math.max(0, days - 9) }];
  APPS.push(a);
  return a;
}
function applicant(i: number, first: string, last: string, vacancy: string, days: number): Partial<D.MockApplication> {
  const order = ["application", "screening", "assessment", "interview", "shortlist"] as const;
  return {
    application_id: sid(`app:${i}`),
    number: `APP-${String(i + 1).padStart(4, "0")}`,
    candidate_id: sid(`cand:${i}`),
    first_name: first,
    last_name: last,
    email: `${first}.${last}`.toLowerCase() + "@example.test",
    phone: `+23480${String(31000000 + i * 4231).slice(0, 8)}`,
    vacancy_key: vacancy,
    status: "active",
    source: "careers",
    applied_days: days,
    at_stage_days: 2,
    screening: 82,
    provisional: 78,
    cover_letter: `I have produced work for Lagos audiences for years, and I want to bring it to MyCityApp.`,
    history: order.map((to, k) => ({ to, days: days - k * 3, by: k === 0 ? undefined : "cynthia" })),
    answers: {},
  };
}

const dayAhead = (n: number) => `${isoDaysAhead(n)}T22:59:59.000Z`;

const OFFERS: MockOffer[] = [];
function fixture(n: number, a: D.MockApplication, status: OfferStatus, more: Partial<MockOffer>): MockOffer {
  const o: MockOffer = {
    ...fromVacancy(a),
    offer_id: sid(`offer:${n}`),
    number: `OFF-${String(n).padStart(4, "0")}`,
    status,
    by: "cynthia",
    created_at: at(10, "10:00"),
    pay: [{ name: "Basic Salary", monthly_amount: "400000.00" }],
    start_date: isoDaysAhead(21),
    ...more,
  };
  OFFERS.push(o);
  return o;
}
const PAY = (basic: string, internet = "30000.00", transport = "50000.00") => [
  { name: "Basic Salary", monthly_amount: basic },
  { name: "Internet & Recharge Allowance", monthly_amount: internet },
  { name: "Transportation Allowance", monthly_amount: transport },
];
const approved = (n: number): Decision[] => [
  { stage: "head_of_department", decision: "approve", by: "cynthia", reason: null, at: at(n, "11:00") },
  { stage: "ceo", decision: "approve", by: "ifeoma", reason: null, at: at(n, "15:30") },
];

// Kunle Afolabi (Shortlist, the board's test moves him) has a draft offer for Head, Sales & Revenue.
fixture(21, APPS.find((a) => a.first_name === "Kunle")!, "draft", { pay: PAY("1100000.00", "50000.00", "100000.00"), created_at: at(1, "09:40"), role_function: "Commercial leadership", incentives: "Quarterly sales commission under the Incentive Policy" });
// With its approval: at the CEO, the Head of Department having approved.
const adaeze = placed(14, "Adaeze", "Nnadi", "design", "shortlist", 20);
fixture(20, adaeze, "approval", {
  pay: PAY("380000.00"),
  created_at: at(4, "10:00"),
  submitted_at: at(3, "09:15"),
  workflow_instance_id: sid("wf:offer:20"),
  stage: "ceo",
  decisions: [{ stage: "head_of_department", decision: "approve", by: "cynthia", reason: null, at: at(2, "14:20") }],
});
// Approved over the vacancy's range, waiting for the company's signature.
const tunde = placed(15, "Tunde", "Bakare", "sales", "shortlist", 26);
fixture(19, tunde, "approved", {
  pay: PAY("1350000.00", "50000.00", "100000.00"),
  range_reason: "Matched a competing offer from a Lagos fintech",
  created_at: at(6, "10:00"),
  submitted_at: at(5, "09:00"),
  approved_at: at(4, "15:30"),
  workflow_instance_id: sid("wf:offer:19"),
  decisions: approved(4),
});
// With the candidate: signed for the company and sent.
const dayo = placed(16, "Dayo", "Martins", "content", "offer", 30);
fixture(18, dayo, "sent", {
  pay: PAY("420000.00"),
  created_at: at(9, "10:00"),
  submitted_at: at(8, "09:00"),
  approved_at: at(7, "15:30"),
  company_signed_at: at(7, "16:05"),
  sent_at: at(6, "09:30"),
  expires_at: dayAhead(9),
  workflow_instance_id: sid("wf:offer:18"),
  decisions: approved(7),
  // Its email came back refused: the address has a typo (Change Email on the offer).
  refused_at: at(6, "09:31"),
});
// Accepted: both signatures in, the sealed copy kept.
const chiamaka = placed(17, "Chiamaka", "Eze", "content", "documentation", 40);
fixture(17, chiamaka, "accepted", {
  pay: PAY("400000.00"),
  created_at: at(20, "10:00"),
  submitted_at: at(19, "09:00"),
  approved_at: at(18, "15:30"),
  company_signed_at: at(18, "16:05"),
  sent_at: at(17, "09:30"),
  candidate_signed_at: at(15, "20:12"),
  accepted_at: at(15, "20:12"),
  expires_at: `${isoDaysAhead(-2)}T22:59:59.000Z`,
  workflow_instance_id: sid("wf:offer:17"),
  decisions: approved(18),
});
// Declined by the candidate; the card went back to Shortlist.
const seun = placed(18, "Seun", "Okonkwo", "design", "shortlist", 45);
fixture(16, seun, "declined", {
  pay: PAY("360000.00"),
  created_at: at(24, "10:00"),
  submitted_at: at(23, "09:00"),
  approved_at: at(22, "15:30"),
  company_signed_at: at(22, "16:05"),
  sent_at: at(21, "09:30"),
  declined_at: at(19, "12:40"),
  expires_at: `${isoDaysAhead(-6)}T22:59:59.000Z`,
  end_reason: "I have accepted another role closer to home",
  workflow_instance_id: sid("wf:offer:16"),
  decisions: approved(22),
});
// Kemi Bello was marked Not Progressing, which withdrew her offer.
fixture(15, APPS.find((a) => a.first_name === "Kemi")!, "withdrawn", {
  pay: PAY("300000.00"),
  created_at: at(40, "10:00"),
  withdrawn_at: at(32, "10:00"),
  end_reason: "The role went to another candidate",
});

const offer = (id: string | undefined) => OFFERS.find((o) => o.offer_id === id);
const offerNotFound = () => fail(404, "NOT_FOUND", "That offer does not exist");

/** The vacancy's monthly range, and whether the offer's total sits outside it. */
function range(o: MockOffer) {
  const v = vacancyOf(appOf(o.application_id)!);
  const total = totalOf(o);
  const outside = (v.salary_min !== null && total < kobo(v.salary_min)) || (v.salary_max !== null && total > kobo(v.salary_max));
  return { salary_min: v.salary_min, salary_max: v.salary_max, outside };
}

function rowOf(o: MockOffer): OfferRow {
  const a = appOf(o.application_id)!;
  return {
    offer_id: o.offer_id,
    number: o.number,
    application_id: o.application_id,
    candidate_name: nameOf(a),
    vacancy_title: vacancyOf(a).title,
    job_title: o.job_title,
    status: o.status,
    currency: "NGN",
    annual_compensation: naira(totalOf(o) * 12),
    outside_range: range(o).outside,
    start_date: o.start_date,
    expires_at: o.expires_at,
    sent_at: o.sent_at,
    created_at: o.created_at,
  };
}

/** The company's signer and the candidate, once the request is opened at approval. */
function signersOf(o: MockOffer): SignerView[] {
  if (!o.approved_at) return [];
  const s = signatory();
  const a = appOf(o.application_id)!;
  const ended = o.status === "declined" ? "declined" : o.status === "expired" || o.status === "withdrawn" ? "expired" : "pending";
  return [
    { name: s?.display_name ?? "Offer Signatory", title: s?.job_title ?? null, role: "mycity", status: o.company_signed_at ? "signed" : ended === "pending" ? "pending" : "expired", signed_at: o.company_signed_at, method: o.company_signed_at ? "type" : null },
    { name: nameOf(a), title: null, role: "candidate", status: o.candidate_signed_at ? "signed" : ended, signed_at: o.candidate_signed_at, method: o.candidate_signed_at ? "draw" : null },
  ];
}

/** The letter as its blocks of text: the standard wording's opening, the offer's values, its appendix. */
function letterOf(o: MockOffer): string[] {
  const a = appOf(o.application_id)!;
  const s = signatory();
  const total = naira(totalOf(o));
  const start = o.start_date ? longDate(o.start_date) : "a date to be agreed";
  return [
    nameOf(a),
    "PRIVATE & CONFIDENTIAL",
    `Dear ${a.first_name},`,
    `Offer of Employment: ${o.job_title}`,
    `We are pleased to offer you employment with ${COMPANY} ("the Company") as ${o.job_title}, with effect from ${start}, on the terms and conditions set out in this letter.`,
    "Offer Summary",
    "Item · Detail",
    `Position · ${o.job_title}`,
    ...(o.reports_to ? [`Reports to · ${o.reports_to}`] : []),
    ...(o.work_pattern ? [`Work pattern · ${PATTERN[o.work_pattern]}${o.office_days ? `: ${o.office_days} days in the office each week` : ""}`] : []),
    `Start date · ${start}`,
    ...(o.employment_type ? [`Employment type · ${EMPLOYMENT[o.employment_type]}`] : []),
    ...(o.probation_months ? [`Probation · ${o.probation_months} months`] : []),
    ...(o.annual_leave_days ? [`Annual leave · ${o.annual_leave_days} working days`] : []),
    `Total monthly compensation · ${shown(total)} (see Section 3)`,
    "Terms and Conditions",
    "1. Role and Reporting",
    `1.1 You are employed as ${o.job_title}. The Company may reasonably update these duties from time to time in line with business needs.`,
    "3. Remuneration",
    "3.1 Your monthly compensation is set out below, paid in arrears on the last working day of each month.",
    ...o.pay.map((l) => `${l.name} · ${shown(l.monthly_amount)}`),
    `Total · ${shown(total)}`,
    "Acceptance",
    o.expires_at ? `Please sign this letter to accept the offer by ${longDate(o.expires_at.slice(0, 10))}.` : "Please sign this letter to accept the offer within the time it gives.",
    "Yours sincerely,",
    `${s?.display_name ?? "The Offer Signatory"}, ${s?.job_title ?? "Operations and People Lead"}, for ${COMPANY}`,
    ...(o.additional_terms ? ["Additional Terms", o.additional_terms] : []),
    ...(o.job_description ? ["Schedule A: Role Description", ...o.job_description.split(/\n+/).map((l) => l.replace(/^#+\s*|^-\s*/g, "").trim()).filter(Boolean)] : []),
  ];
}

/** Who decides the stage the offer waits at: the vacancy's hiring manager, then the CEO; never its submitter. */
const decider = (o: MockOffer) => (o.stage === "ceo" ? "ifeoma" : (vacancyOf(appOf(o.application_id)!).hiring_manager?.employee_id === byKey("ifeoma")?.employee_id ? "ifeoma" : "cynthia"));
const mayDecide = (o: MockOffer, user: string | null) => o.status === "approval" && o.stage !== null && user === decider(o) && (o.stage === "ceo" || user !== o.by);

function detailOf(o: MockOffer, req: Req): OfferDetail {
  const r = range(o);
  const edit = can(req, "edit");
  const signer = signatory();
  const isSignatory = Boolean(signer && req.user === signer.user_key);
  return {
    ...rowOf(o),
    vacancy_id: vacancyOf(appOf(o.application_id)!).vacancy_id,
    department_id: o.department_id,
    department: o.department,
    worksite_id: null,
    reports_to: o.reports_to,
    role_function: o.role_function,
    role_scope: o.role_scope,
    employment_type: o.employment_type,
    work_pattern: o.work_pattern,
    office_days: o.office_days,
    annual_leave_days: o.annual_leave_days,
    incentives: o.incentives,
    pay_lines: o.pay.map((l, i) => ({ offer_pay_line_id: sid(`${o.offer_id}:pay:${i}`), position: i + 1, name: l.name, monthly_amount: l.monthly_amount })),
    monthly_total: naira(totalOf(o)),
    salary_min: r.salary_min,
    salary_max: r.salary_max,
    range_reason: o.range_reason,
    job_description: o.job_description,
    additional_terms: o.additional_terms,
    working_hours: o.working_hours,
    probation_months: o.probation_months,
    valid_days: o.valid_days,
    benefits: o.benefits,
    score_snapshot: o.score_snapshot,
    decision_snapshot: o.decision_snapshot,
    workflow_instance_id: o.workflow_instance_id,
    letter: letterOf(o),
    document: o.approved_at ? { document_id: sid(`${o.offer_id}:doc`), file_name: `${o.number}.pdf`, size_bytes: 96_256, mime_type: "application/pdf" } : null,
    signers: signersOf(o),
    submitted_at: o.submitted_at,
    approved_at: o.approved_at,
    accepted_at: o.accepted_at,
    declined_at: o.declined_at,
    withdrawn_at: o.withdrawn_at,
    end_reason: o.end_reason,
    candidate_email: appOf(o.application_id)!.email,
    send_refused_at: o.status === "sent" ? (o.refused_at ?? null) : null,
    can_edit: o.status === "draft" && edit,
    can_submit: o.status === "draft" && edit,
    can_sign: o.status === "approved" && !o.company_signed_at && isSignatory,
    can_send: o.status === "approved" && Boolean(o.company_signed_at) && edit,
    can_resend: o.status === "sent" && edit,
    can_withdraw: ["approval", "approved", "sent"].includes(o.status) && edit && (o.status !== "approval" || req.user === o.by || req.user === "ifeoma"),
    can_change_email: o.status === "sent" && edit,
  };
}

/** The application's stage once an offer it was sent ends unsigned (candidates.offerEndedIn). */
function ended(o: MockOffer) {
  const a = appOf(o.application_id);
  if (a && a.stage === "offer") {
    a.stage = "shortlist";
    a.at_stage_days = 0;
    a.history = [...a.history, { to: "shortlist", days: 0, reason: o.end_reason ?? undefined }];
  }
}

/* ------------------------------------------------------------------ *
 * Routes
 * ------------------------------------------------------------------ */

const startOfMonth = () => `${new Date().toISOString().slice(0, 7)}-01`;
R("GET /api/v1/recruitment/offers/summary", "view", (req) =>
  ok({
    can_configure: can(req, "edit"),
    drafts: OFFERS.filter((o) => o.status === "draft").length,
    with_approval: OFFERS.filter((o) => o.status === "approval").length,
    to_send: OFFERS.filter((o) => o.status === "approved").length,
    with_candidates: OFFERS.filter((o) => o.status === "sent").length,
    accepted_this_month: OFFERS.filter((o) => o.status === "accepted" && (o.accepted_at ?? "") >= startOfMonth()).length,
  }),
);

R("GET /api/v1/recruitment/offers", "view", (req) =>
  paged(
    [...OFFERS].sort((a, b) => b.created_at.localeCompare(a.created_at)).map(rowOf),
    req,
    {
      search: (o) => [o.number, o.candidate_name, o.job_title, o.vacancy_title],
      filters: { status: (o, s) => o.status === s, vacancy_id: (o, id) => vacancyOf(appOf(o.application_id)!).vacancy_id === id, application_id: (o, id) => o.application_id === id },
      sort: {
        created_at: (a, b) => a.created_at.localeCompare(b.created_at),
        expires_at: (a, b) => (a.expires_at ?? "").localeCompare(b.expires_at ?? ""),
        number: (a, b) => a.number.localeCompare(b.number),
        annual_compensation: (a, b) => kobo(a.annual_compensation) - kobo(b.annual_compensation),
      },
    },
  ),
);

/** An application that may take an offer: active, at Shortlist, with none open. */
function refusal(a: D.MockApplication | undefined): RawResponse | null {
  if (!a || a.status !== "active" || a.stage !== "shortlist") return fail(409, "NOT_SHORTLISTED", "Only a shortlisted candidate can take an offer", { application_id: ["Pick a shortlisted candidate"] });
  if (OFFERS.some((o) => o.application_id === a.application_id && OPEN.includes(o.status))) return fail(409, "OFFER_OPEN", "This candidate already has an open offer");
  return null;
}

R("GET /api/v1/recruitment/offers/draft", "create", (req) =>
  parse<{ application_id: string }>(offerSchemas.OfferDraftQuery, req.query, (q) => {
    const a = appOf(q.application_id);
    const no = refusal(a);
    if (no) return no;
    const v = vacancyOf(a!);
    const base = fromVacancy(a!);
    const draft: OfferDraft = {
      application_id: a!.application_id,
      candidate_name: nameOf(a!),
      vacancy_title: v.title,
      job_title: v.title,
      department_id: v.department_id,
      reports_to: v.reports_to,
      employment_type: base.employment_type,
      work_pattern: v.work_pattern,
      probation_months: v.probation_months,
      start_date: v.target_start_on,
      salary_min: v.salary_min,
      salary_max: v.salary_max,
      job_description: v.description,
      pay_lines: [{ name: "Basic Salary", monthly_amount: v.salary_min ?? "0.00" }],
      score: base.score_snapshot,
    };
    return ok(draft);
  }),
);

type Fields = Partial<{
  job_title: string;
  department_id: string | null;
  start_date: string;
  reports_to: string | null;
  role_function: string | null;
  role_scope: string | null;
  employment_type: OfferDetail["employment_type"];
  work_pattern: OfferDetail["work_pattern"];
  office_days: number | null;
  annual_leave_days: number | null;
  incentives: string | null;
  pay_lines: Array<{ name: string; monthly_amount: string }>;
  range_reason: string | null;
  working_hours: string | null;
  probation_months: number | null;
  job_description: string | null;
  additional_terms: string | null;
  benefits: string | null;
  valid_days: number | null;
}>;

/** A body's terms onto the offer; the reason is asked for only when the total sits outside the range. */
function apply(o: MockOffer, b: Fields): RawResponse | null {
  const next = { ...o };
  for (const [k, v] of Object.entries(b)) {
    if (v === undefined || k === "application_id" || k === "worksite_id") continue;
    if (k === "pay_lines") next.pay = (v as Fields["pay_lines"])!;
    else if (k === "valid_days") next.valid_days = (v as number | null) ?? offerSchemas.OFFER_VALID_DAYS.default;
    else (next as Record<string, unknown>)[k] = v;
  }
  if (next.department_id) next.department = D.VACANCIES.find((v) => v.department_id === next.department_id)?.department ?? next.department;
  if (next.start_date && next.start_date < isoDaysAhead(0)) return invalid({ start_date: ["Pick a later date"] });
  if (!next.pay.length) return invalid({ pay_lines: ["Add a pay line"] });
  if (range(next).outside && !next.range_reason) return invalid({ range_reason: ["Say why"] });
  if (!range(next).outside) next.range_reason = null;
  Object.assign(o, next);
  return null;
}

R("POST /api/v1/recruitment/offers", "create", (req) =>
  parse<Fields & { application_id: string }>(offerSchemas.OfferCreate, req.body, (b) => {
    const a = appOf(b.application_id);
    const no = refusal(a);
    if (no) return no;
    const n = Math.max(...OFFERS.map((o) => Number(o.number.slice(4)))) + 1;
    const o: MockOffer = { ...fromVacancy(a!), offer_id: sid(`offer:new:${n}`), number: `OFF-${String(n).padStart(4, "0")}`, status: "draft", by: req.user!, created_at: nowIso(), pay: [], start_date: null };
    const bad = apply(o, b);
    if (bad) return bad;
    OFFERS.unshift(o);
    return created(detailOf(o, req));
  }),
);

R("GET /api/v1/recruitment/offers/settings", "edit", () => ok(settingsOut()));
R("PUT /api/v1/recruitment/offers/settings/signatory", "edit", (req) =>
  parse<{ signatory_employee_id: string }>(offerSchemas.OfferSignatorySave, req.body, (b) => {
    const p = byId(b.signatory_employee_id);
    if (!p) return invalid({ signatory_employee_id: ["Pick an employee"] });
    SETTINGS.signatory = p.user_key;
    return ok(settingsOut());
  }),
);
R("GET /api/v1/recruitment/offers/settings/letter", "edit", () => ok(letterOut()));
R("PUT /api/v1/recruitment/offers/settings/letter", "edit", (req) =>
  parse<{ body: string }>(offerSchemas.OfferLetterTemplateSave, req.body, (b) => {
    Object.assign(SETTINGS, { body: b.body, version: SETTINGS.version + 1, updated_at: nowIso() });
    return ok(letterOut());
  }),
);
R("POST /api/v1/recruitment/offers/settings/letter/restore", "edit", () => {
  Object.assign(SETTINGS, { body: STANDARD, version: SETTINGS.version + 1, updated_at: nowIso() });
  return ok({ ...letterOut(), is_default: true });
});

R("GET /api/v1/recruitment/offers/:id", "view", (req) => {
  const o = offer(req.params.id);
  return o ? ok(detailOf(o, req)) : offerNotFound();
});

R("PATCH /api/v1/recruitment/offers/:id", "edit", (req) => {
  const o = offer(req.params.id);
  if (!o) return offerNotFound();
  if (o.status !== "draft") return fail(409, "NOT_DRAFT", "Only a draft offer can be changed");
  return parse<Fields>(offerSchemas.OfferEdit, req.body, (b) => apply(o, b) ?? ok(detailOf(o, req)));
});

R("POST /api/v1/recruitment/offers/:id/submit", "edit", (req) => {
  const o = offer(req.params.id);
  if (!o) return offerNotFound();
  if (o.status !== "draft") return fail(409, "NOT_DRAFT", "Only a draft offer can be submitted");
  if (!o.start_date) return invalid({ start_date: ["Set the start date"] });
  if (!o.department_id) return invalid({ department_id: ["Set the department"] });
  if (!signatory()) return fail(409, "NO_SIGNATORY", "Name the Offer Signatory in Offers settings first");
  Object.assign(o, { status: "approval", submitted_at: nowIso(), workflow_instance_id: o.workflow_instance_id ?? sid(`wf:${o.offer_id}:${Date.now()}`), stage: "head_of_department", decisions: [], by: req.user! });
  return ok(detailOf(o, req));
});

R("POST /api/v1/recruitment/offers/:id/sign", "view", (req) => {
  const o = offer(req.params.id);
  if (!o) return offerNotFound();
  if (o.status !== "approved") return fail(409, "NOT_APPROVED", "Only an approved offer is signed for the company");
  const s = signatory();
  if (!s || s.user_key !== req.user) return fail(403, "NOT_SIGNER", "Only the Offer Signatory signs for the company");
  return parse(signatureSchemas.SignSubmit, req.body, () => {
    o.company_signed_at ??= nowIso();
    return ok(detailOf(o, req));
  });
});

R("POST /api/v1/recruitment/offers/:id/send", "edit", (req) => {
  const o = offer(req.params.id);
  if (!o) return offerNotFound();
  if (o.status !== "approved") return fail(409, "NOT_APPROVED", "Only an approved offer can be sent");
  if (!o.company_signed_at) return fail(409, "NOT_SIGNED", "The offer is not signed for the company yet");
  Object.assign(o, { status: "sent", sent_at: nowIso(), expires_at: dayAhead(o.valid_days) });
  const a = appOf(o.application_id);
  if (a && a.stage === "shortlist") {
    a.stage = "offer";
    a.at_stage_days = 0;
    a.history = [...a.history, { to: "offer", days: 0, by: req.user! }];
  }
  return ok(detailOf(o, req));
});

R("POST /api/v1/recruitment/offers/:id/resend", "edit", (req) => {
  const o = offer(req.params.id);
  if (!o) return offerNotFound();
  if (o.status !== "sent") return fail(409, "NOT_SENT", "Only a sent offer can be resent");
  return ok(detailOf(o, req));
});

R("POST /api/v1/recruitment/offers/:id/recipient", "edit", (req) => {
  const o = offer(req.params.id);
  if (!o) return offerNotFound();
  if (o.status !== "sent") return fail(409, "NOT_SENT", "Only a sent offer can be resent");
  return parse<{ email: string }>(offerSchemas.OfferRecipient, req.body, (b) => {
    const a = appOf(o.application_id)!;
    const other = APPS.find((x) => x.email.toLowerCase() === b.email && x.candidate_id !== a.candidate_id);
    if (other) return fail(409, "EMAIL_TAKEN", "Another candidate has this email", { email: ["Another candidate has it"] });
    // The candidate is one person: every application of theirs takes the new address.
    for (const x of APPS) if (x.candidate_id === a.candidate_id) x.email = b.email;
    o.refused_at = null;
    return ok(detailOf(o, req));
  });
});

R("POST /api/v1/recruitment/offers/:id/withdraw", "edit", (req) => {
  const o = offer(req.params.id);
  if (!o) return offerNotFound();
  if (!["approval", "approved", "sent"].includes(o.status)) return fail(409, "NOT_OPEN", "Only an open offer can be withdrawn");
  if (o.status === "approval" && req.user !== o.by && req.user !== "ifeoma") return fail(403, "NOT_SUBMITTER", "Only who submitted it, or the CEO, can withdraw it");
  return parse<{ reason: string }>(offerSchemas.OfferWithdraw, req.body, (b) => {
    Object.assign(o, { status: "withdrawn", withdrawn_at: nowIso(), end_reason: b.reason, stage: null });
    ended(o);
    return ok(detailOf(o, req));
  });
});

/**
 * Not Progressing (recruitment.ts) withdraws the application's open offer, as the API's outbox
 * handler on `application.not_progressed` does (offers.service withdrawForApplication).
 */
export function withdrawOffersOf(applicationId: string) {
  for (const o of OFFERS.filter((x) => x.application_id === applicationId && OPEN.includes(x.status))) {
    Object.assign(o, { status: "withdrawn", withdrawn_at: nowIso(), end_reason: ENDED_REASON, stage: null });
  }
}

/* ------------------------------------------------------------------ *
 * The approval (organisation.ts passes the workflow routes here)
 * ------------------------------------------------------------------ */

const STAGES: Array<[Stage, string]> = [
  ["head_of_department", "Head of Department"],
  ["ceo", "CEO"],
];

/** GET /workflow/instances/:id for an offer's approval; null for any other id. */
export function offerInstance(user: string, wid: string): ApprovalInstance | null {
  const o = OFFERS.find((x) => x.workflow_instance_id === wid);
  if (!o) return null;
  const a = appOf(o.application_id)!;
  const pending = o.status === "approval";
  const state = pending ? "pending" : o.approved_at ? "approved" : o.decisions.some((d) => d.decision === "reject") ? "rejected" : "cancelled";
  const opened = o.submitted_at ?? o.created_at;
  const at = (s: Stage) => STAGES.findIndex(([k]) => k === s);
  return {
    workflow_instance_id: wid,
    definition_key: "recruitment.offer",
    definition_name: "Offer of Employment",
    version: 1,
    module_key: "recruitment",
    entity_type: "offer",
    entity_id: o.offer_id,
    subject_employee_id: null,
    subject_name: nameOf(a),
    state,
    current_stage: pending ? o.stage : null,
    stage_name: pending && o.stage ? STAGES[at(o.stage)]![1] : null,
    context: { monthly_total: naira(totalOf(o)), outside_range: range(o).outside },
    stage_entered_at: o.decisions.at(-1)?.at ?? opened,
    stage_due_at: pending ? new Date(Date.parse(opened) + 48 * 3600000).toISOString() : null,
    opened_by: null,
    opened_by_name: byKey(o.by)?.display_name ?? null,
    opened_at: opened,
    completed_at: pending ? null : (o.approved_at ?? o.withdrawn_at ?? o.decisions.at(-1)?.at ?? null),
    route: STAGES.map(([key, name]) => ({
      key,
      name,
      state: !pending ? (state === "approved" ? "done" : "stopped") : key === o.stage ? "now" : at(key) < at(o.stage!) ? "done" : "todo",
      approvers: [key === "ceo" ? { type: "ceo", value: null, label: "CEO" } : { type: "role", value: "head_of_department", label: "Head of Department" }],
    })),
    decisions: o.decisions.map((d, i) => ({
      workflow_decision_id: sid(`${wid}:d:${i}`),
      stage_key: d.stage,
      stage_name: STAGES[at(d.stage)]![1],
      actor_id: byKey(d.by)?.employee_id ?? null,
      decision: d.decision,
      actor_name: byKey(d.by)?.display_name ?? null,
      reason: d.reason,
      decided_at: d.at,
    })),
    can_decide: mayDecide(o, user),
    can_withdraw: false,
    can_reassign: false,
    link: `/recruitment?tab=offers&id=${o.offer_id}`,
  };
}

/** POST /workflow/instances/:id/approve|reject for an offer: the next stage, approved, or back to draft. */
export function decideOffer(user: string, wid: string, approve: boolean, reason?: string): RawResponse | null {
  const o = OFFERS.find((x) => x.workflow_instance_id === wid);
  if (!o) return null;
  if (o.status !== "approval" || !o.stage) return notFound();
  if (!mayDecide(o, user)) return fail(403, "PERMISSION_DENIED", "You are not an approver for this stage");
  if (!approve && !reason?.trim()) return invalid({ reason: ["Say why"] });
  o.decisions.push({ stage: o.stage, decision: approve ? "approve" : "reject", by: user, reason: reason?.trim() || null, at: nowIso() });
  if (!approve) Object.assign(o, { status: "draft", stage: null, submitted_at: null });
  else if (o.stage === "head_of_department") o.stage = "ceo";
  else Object.assign(o, { status: "approved", stage: null, approved_at: nowIso() });
  return ok({ workflow_instance_id: wid, state: o.status === "approval" ? "pending" : approve ? "approved" : "rejected", stage_name: o.stage ? STAGES.find(([k]) => k === o.stage)![1] : null });
}

/** The offers waiting on the caller, for My Approvals and Home's Need You. */
export function offersWaitingOn(user: string): ApprovalWaiting[] {
  return OFFERS.filter((o) => mayDecide(o, user)).map((o) => {
    const i = offerInstance(user, o.workflow_instance_id!)!;
    return {
      workflow_instance_id: i.workflow_instance_id,
      definition_key: i.definition_key,
      definition_name: i.definition_name,
      module_key: i.module_key,
      entity_type: i.entity_type,
      entity_id: i.entity_id,
      subject_employee_id: null,
      subject_name: i.subject_name,
      current_stage: i.current_stage!,
      stage_name: i.stage_name!,
      context: i.context,
      stage_entered_at: i.stage_entered_at,
      stage_due_at: i.stage_due_at,
      overdue: Boolean(i.stage_due_at && Date.parse(i.stage_due_at) < Date.now()),
      opened_by: null,
      opened_by_name: i.opened_by_name,
      opened_at: i.opened_at,
      link: i.link,
    };
  });
}
