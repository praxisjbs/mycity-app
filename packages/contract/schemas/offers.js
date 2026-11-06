"use strict";
/**
 * Offers (docs/guides/offers.md §3, §5, §6): an offer of employment made to a shortlisted
 * application, approved, signed for the company, sent for the candidate's signature and accepted
 * or declined.
 *
 * Recruitment · Offers reads and writes them under /recruitment/offers within the caller's
 * `recruitment` scope (a hiring manager sees their vacancies). An offer is approved in its
 * approval (`recruitment.offer`: the head of the hiring department, then the CEO), never by an offer
 * route of its own, so it carries the id of the approval it waits on; it keeps the flow active when
 * it was submitted. Once approved, the Offer Signatory (Offers settings) signs it for the company in
 * the hub, then Send Offer mails the candidate their signing link.
 *
 * Statuses (the contract's spelling is the table's CHECK, migration 5010):
 *   draft      being written; editable
 *   approval   with its approval
 *   approved   approved; waits for the company's signature, then Send Offer
 *   sent       with the candidate until `expires_at`
 *   accepted   signed by the candidate (signing is acceptance); locked
 *   declined, expired, withdrawn   ended; the application may take a new offer
 *
 * The letter is MyCity's offer letter (Offer Summary, Remuneration, Terms and Conditions 1 to 14,
 * Acceptance) from the standard wording edited on the Offers tab, filled with the offer's fields; the
 * offer's Additional Terms and Schedule A (the final job description) follow it. No AI drafts it.
 * Pay is monthly, line by line (Basic Salary, Internet & Recharge Allowance, Transportation
 * Allowance, ...); `annual_compensation` is twelve times the monthly total. A monthly total outside
 * the vacancy's monthly range is allowed with a reason the approvers see. Money is a two-place
 * string, NGN only.
 */
const { z } = require("zod");
const { uuid, text, optionalText, isoDate, isoDateTime, money, blank, listQuery, Paged } = require("./common");
const { DocumentRef } = require("./documents");
const { InterviewDecision } = require("./interviews");
const { EmploymentType, WorkPattern, PersonRef } = require("./organisation");
const { SignerView } = require("./signatures");

const OfferStatus = z.enum(["draft", "approval", "approved", "sent", "accepted", "declined", "expired", "withdrawn"]);

/** How long a sent offer stays open, in days: 15 unless the offer says otherwise; a link lives 90 at most. */
const OFFER_VALID_DAYS = { default: 15, min: 1, max: 90 };

/* ------------------------------------------------------------------ *
 * Reading
 * ------------------------------------------------------------------ */

/** One line of the monthly compensation. */
const OfferPayLine = z
  .object({
    offer_pay_line_id: uuid,
    position: z.number().int().min(1),
    name: z.string(),
    monthly_amount: money,
  })
  .strict();

/** A pay line as the form sends it. */
const OfferPayLineInput = z
  .object({
    name: text(80),
    monthly_amount: money,
  })
  .strict();

/** One offer as the Offers list shows it. */
const OfferRow = z
  .object({
    offer_id: uuid,
    number: z.string(),
    application_id: uuid,
    candidate_name: z.string(),
    vacancy_title: z.string(),
    job_title: z.string(),
    status: OfferStatus,
    currency: z.literal("NGN"),
    annual_compensation: money,
    outside_range: z.boolean(),
    start_date: isoDate.nullable(),
    expires_at: isoDateTime.nullable(),
    sent_at: isoDateTime.nullable(),
    created_at: isoDateTime,
  })
  .strict();

/** One offer as its record shows it: the terms, the letter as the candidate reads it, its approval and signers. */
const OfferDetail = OfferRow.extend({
  vacancy_id: uuid,
  department_id: uuid.nullable(),
  department: z.string().nullable(),
  worksite_id: uuid.nullable(),
  reports_to: z.string().nullable(),
  role_function: z.string().nullable(),
  role_scope: z.string().nullable(),
  employment_type: EmploymentType.nullable(),
  work_pattern: WorkPattern.nullable(),
  office_days: z.number().int().min(0).max(7).nullable(),
  annual_leave_days: z.number().int().min(0).max(60).nullable(),
  incentives: z.string().nullable(),
  pay_lines: z.array(OfferPayLine),
  monthly_total: money,
  /** The vacancy's monthly range the total is checked against. */
  salary_min: money.nullable(),
  salary_max: money.nullable(),
  range_reason: z.string().nullable(),
  job_description: z.string().nullable(),
  additional_terms: z.string().nullable(),
  working_hours: z.string().nullable(),
  probation_months: z.number().int().min(0).max(24).nullable(),
  valid_days: z.number().int().min(OFFER_VALID_DAYS.min).max(OFFER_VALID_DAYS.max),
  benefits: z.string().nullable(),
  /** The weighted scorecard total and the interview decision when the offer was made. */
  score_snapshot: z.number().min(0).max(100).nullable(),
  decision_snapshot: InterviewDecision.nullable(),
  workflow_instance_id: uuid.nullable(),
  letter: z.array(z.string()),
  document: DocumentRef.nullable(),
  signers: z.array(SignerView),
  submitted_at: isoDateTime.nullable(),
  approved_at: isoDateTime.nullable(),
  accepted_at: isoDateTime.nullable(),
  declined_at: isoDateTime.nullable(),
  withdrawn_at: isoDateTime.nullable(),
  end_reason: z.string().nullable(),
  can_edit: z.boolean(),
  can_submit: z.boolean(),
  /** The reader is the Offer Signatory and the company has not signed yet. */
  can_sign: z.boolean(),
  can_send: z.boolean(),
  can_resend: z.boolean(),
  can_withdraw: z.boolean(),
});

const OfferListQuery = listQuery(
  {
    status: OfferStatus.optional(),
    vacancy_id: uuid.optional(),
  },
  ["created_at", "expires_at", "number", "annual_compensation"],
);
const OfferPage = Paged(OfferRow);

/** The figures above the Offers list, in the reader's scope. */
const OffersSummary = z
  .object({
    drafts: z.number().int().min(0),
    with_approval: z.number().int().min(0),
    to_send: z.number().int().min(0),
    with_candidates: z.number().int().min(0),
    accepted_this_month: z.number().int().min(0),
  })
  .strict();

/* ------------------------------------------------------------------ *
 * Writing
 * ------------------------------------------------------------------ */

/** The terms an offer is made on. The form starts from the vacancy's; the person edits them. */
const OfferFields = z
  .object({
    job_title: text(160),
    department_id: blank(uuid),
    worksite_id: blank(uuid),
    start_date: isoDate,
    reports_to: optionalText(160),
    role_function: optionalText(300),
    role_scope: optionalText(300),
    employment_type: blank(EmploymentType),
    work_pattern: blank(WorkPattern),
    office_days: blank(z.coerce.number().int().min(0).max(7)),
    annual_leave_days: blank(z.coerce.number().int().min(0).max(60)),
    incentives: optionalText(2000),
    pay_lines: z.array(OfferPayLineInput).min(1, "Add a pay line").max(12),
    /** Why the monthly total sits outside the vacancy's range; asked for only then. */
    range_reason: optionalText(500),
    working_hours: optionalText(160),
    probation_months: blank(z.coerce.number().int().min(0).max(24)),
    /** The final job description for Schedule A, Markdown, copied from the vacancy's and edited. */
    job_description: optionalText(20000),
    /** Terms for this offer alone, Markdown, printed after the standard wording. */
    additional_terms: optionalText(8000),
    benefits: optionalText(4000),
    valid_days: blank(z.coerce.number().int().min(OFFER_VALID_DAYS.min).max(OFFER_VALID_DAYS.max)),
  })
  .strict();

/** New Offer: an application at Shortlist, and its terms. */
const OfferCreate = OfferFields.extend({ application_id: uuid });

/** Edit a draft. */
const OfferEdit = OfferFields.partial();

/** Withdraw an offer that is with its approval, approved or sent: the reason the record keeps. */
const OfferWithdraw = z.object({ reason: text(500) }).strict();

/** GET /recruitment/offers/draft: the application New Offer is for. */
const OfferDraftQuery = z.object({ application_id: uuid }).strict();

/**
 * New Offer from the assistant (docs/guides/offers.md §9): the application, the start date and the
 * monthly basic salary; every other term starts from the vacancy, as the form does, and the draft
 * is finished on Offers before it is submitted.
 */
const OfferCard = z
  .object({
    application_id: uuid,
    start_date: isoDate,
    basic_salary: money,
    job_title: optionalText(160),
  })
  .strict();

/** What New Offer starts from: the application's candidate and the vacancy's terms. */
const OfferDraft = z
  .object({
    application_id: uuid,
    candidate_name: z.string(),
    vacancy_title: z.string(),
    job_title: z.string(),
    department_id: uuid.nullable(),
    reports_to: z.string().nullable(),
    employment_type: EmploymentType.nullable(),
    work_pattern: WorkPattern.nullable(),
    probation_months: z.number().int().min(0).max(24).nullable(),
    start_date: isoDate.nullable(),
    salary_min: money.nullable(),
    salary_max: money.nullable(),
    job_description: z.string().nullable(),
    pay_lines: z.array(OfferPayLineInput),
    score: z.number().min(0).max(100).nullable(),
  })
  .strict();

/* ------------------------------------------------------------------ *
 * Settings on the Offers tab
 * ------------------------------------------------------------------ */

/** Who signs offers for the company, and the standard wording's state. */
const OfferSettings = z
  .object({
    signatory: PersonRef.nullable(),
    letter_version: z.number().int().min(0),
    letter_is_default: z.boolean(),
  })
  .strict();

const OfferSignatorySave = z.object({ signatory_employee_id: uuid }).strict();

/** The standard offer letter as its editor shows it. */
const OfferLetterTemplate = z
  .object({
    body: z.string(),
    version: z.number().int().min(0),
    is_default: z.boolean(),
    variables: z.array(z.string()),
    updated_at: isoDateTime.nullable(),
  })
  .strict();

const OfferLetterTemplateSave = z.object({ body: text(60000) }).strict();

/* ------------------------------------------------------------------ *
 * Templates
 * ------------------------------------------------------------------ */

/** A pay line as the letter prints it. */
const LetterPayLine = z.object({ name: z.string(), monthly_amount: money }).strict();

/** One signature on the sealed copy (docs/guides/offers.md §3 step 5; the letterhead prints it). */
const SealedSigner = z
  .object({
    name: z.string(),
    title: z.string().nullable(),
    label: z.string(),
    signed_at: isoDateTime.nullable(),
    signature: z.string().nullable(),
    typed: z.string().nullable(),
  })
  .strict();

/** One signer's evidence on the Signature Certificate. */
const CertificateLine = z
  .object({
    name: z.string(),
    title: z.string().nullable(),
    email: z.string(),
    method: z.string(),
    signed_at: z.string(),
    code_verified_at: z.string().nullable(),
    ip: z.string().nullable(),
    device: z.string().nullable(),
    content_hash: z.string(),
    signature: z.string().nullable(),
    typed: z.string().nullable(),
  })
  .strict();

/** templates/documents/offer-letter.html: the standard wording's variables. */
const OfferLetterVars = z
  .object({
    company: z.string(),
    date: isoDate,
    candidate: z.object({ full_name: z.string(), first_name: z.string(), email: z.string() }).strict(),
    job_title: z.string(),
    department: z.string().nullable(),
    role_function: z.string().nullable(),
    role_scope: z.string().nullable(),
    reports_to: z.string().nullable(),
    location: z.string().nullable(),
    start_date: isoDate,
    employment_type: z.string().nullable(),
    work_pattern: z.string().nullable(),
    office_days: z.number().int().nullable(),
    probation_months: z.number().int().nullable(),
    annual_leave_days: z.number().int().nullable(),
    working_hours: z.string().nullable(),
    incentives: z.string().nullable(),
    pay_lines: z.array(LetterPayLine),
    monthly_total: money,
    expires_at: isoDateTime.nullable(),
    signatory: z.object({ name: z.string(), title: z.string().nullable() }).strict().nullable(),
    additional_terms: z.string().nullable(),
    job_description: z.string().nullable(),
    sealing: z
      .object({
        signers: z.array(SealedSigner),
        certificate: z.array(CertificateLine),
        qr: z.string(),
        verify_url: z.string(),
        reference: z.string(),
      })
      .strict()
      .nullable(),
  })
  .strict();

/** offer-sent: the candidate's signing link. Queued as it is made; never in the outbox. */
const OfferSentEmailVars = z
  .object({ job_title: z.string(), company: z.string(), sign_url: z.string(), expires_at: isoDateTime })
  .strict();

/** Which table each schema is a row of (gate 6, check/contract-columns.js). */
const ROW = {
  candidate_name: "candidate.first_name and last_name, through application",
  vacancy_title: "vacancy.title, through application",
};
const FIELDS = {
  valid_days: "kept in terms",
  benefits: "kept in terms",
  pay_lines: "written to offer_pay_line; annual_compensation is twelve times their sum",
};
const TABLES = {
  OfferPayLine: { table: "offer_pay_line" },
  OfferPayLineInput: { table: "offer_pay_line" },
  OfferRow: { table: "offer", virtual: ROW },
  OfferDetail: {
    table: "offer",
    virtual: {
      ...ROW,
      vacancy_id: "application.vacancy_id",
      department: "department.name",
      valid_days: "kept in terms",
      benefits: "kept in terms",
      pay_lines: "offer_pay_line rows",
      monthly_total: "the sum of its pay lines",
      salary_min: "vacancy.salary_min",
      salary_max: "vacancy.salary_max",
      letter: "the rendered letter, from the standard wording and the offer's fields",
      document: "the document behind document_id",
      signers: "its signature request's signature rows",
      can_edit: "a draft, and the reader may edit it",
      can_submit: "a draft, and the reader may edit it",
      can_sign: "approved, the reader is the Offer Signatory, and the company has not signed",
      can_send: "approved and signed for the company, and the reader may edit",
      can_resend: "sent, and the reader may edit",
      can_withdraw: "with its approval, approved or sent, and the reader may edit",
    },
  },
  OfferListQuery: { table: null, reason: "list controls and filters for the offers" },
  OfferPage: { table: null, reason: "a page of offers" },
  OffersSummary: { table: null, reason: "counts over the offers" },
  OfferFields: { table: "offer", virtual: FIELDS },
  OfferCreate: { table: "offer", virtual: FIELDS },
  OfferEdit: { table: "offer", virtual: FIELDS },
  OfferWithdraw: { table: null, reason: "the reason, kept as end_reason" },
  OfferDraft: { table: null, reason: "New Offer's starting values, from the application and its vacancy" },
  OfferDraftQuery: { table: null, reason: "the application New Offer starts from" },
  OfferCard: { table: null, reason: "the assistant's New Offer: written to offer and offer_pay_line by the same create" },
  OfferSettings: { table: null, reason: "the Offer Signatory setting and the standard wording's version" },
  OfferSignatorySave: { table: null, reason: "kept in setting recruitment.offer_signatory" },
  OfferLetterTemplate: { table: null, reason: "a template_version of templates/documents/offer-letter.html" },
  OfferLetterTemplateSave: { table: null, reason: "saved as the next template_version" },
  LetterPayLine: { table: null, reason: "a pay line as the letter prints it" },
  SealedSigner: { table: null, reason: "a signature as the sealed copy prints it" },
  CertificateLine: { table: null, reason: "one signer's evidence on the Signature Certificate" },
  OfferLetterVars: { table: null, reason: "the variables of templates/documents/offer-letter.html" },
  OfferSentEmailVars: { table: null, reason: "the variables of templates/email/offer-sent.html" },
};

module.exports = {
  TABLES,
  OFFER_VALID_DAYS,
  OfferStatus,
  OfferPayLine,
  OfferPayLineInput,
  OfferRow,
  OfferDetail,
  OfferListQuery,
  OfferPage,
  OffersSummary,
  OfferFields,
  OfferCreate,
  OfferEdit,
  OfferWithdraw,
  OfferDraft,
  OfferDraftQuery,
  OfferCard,
  OfferSettings,
  OfferSignatorySave,
  OfferLetterTemplate,
  OfferLetterTemplateSave,
  LetterPayLine,
  SealedSigner,
  CertificateLine,
  OfferLetterVars,
  OfferSentEmailVars,
};
