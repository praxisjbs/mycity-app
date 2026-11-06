"use strict";
/**
 * Offers (docs/guides/offers.md §3, §5, §6): an offer of employment made to a shortlisted
 * application, approved, sent for signature and accepted or declined.
 *
 * Recruitment · Offers reads and writes them under /recruitment/offers within the caller's
 * `recruitment` scope (a hiring manager sees their vacancies). An offer is approved in its
 * approval (`recruitment.offer`, schemas/workflow.js), never by an offer route of its own, so it
 * carries the id of the approval it waits on. It keeps the flow active when it was created.
 *
 * Statuses (the contract's spelling is the table's CHECK, migration 5010):
 *   draft      being written; editable
 *   approval   with its approval
 *   sent       sent for signature; the candidate holds the link until `expires_at`
 *   accepted   signed by the candidate (signing is acceptance); locked
 *   declined, expired, withdrawn   ended; the application may take a new offer
 *
 * The letter is MyCity's offer letter (Offer Summary, Terms and Conditions 1 to 14, Acceptance,
 * Schedule A) filled with the offer's fields: no AI drafts it. Its text comes from one Markdown
 * renderer, so the page and the PDF read the same. Pay is monthly, line by line (Basic Salary,
 * Internet & Recharge Allowance, Transportation Allowance, ...); `annual_compensation` is twelve
 * times the monthly total, written by the service. Money is a two-place string, NGN only.
 *
 * The company signs first: the offer's last approver, or the signatory Operations & People name,
 * signs when it is approved; the candidate signs second, and signing is acceptance.
 */
const { z } = require("zod");
const { uuid, text, optionalText, isoDate, isoDateTime, money, blank, listQuery, Paged } = require("./common");
const { DocumentRef } = require("./documents");
const { InterviewDecision } = require("./interviews");
const { EmploymentType, WorkPattern } = require("./organisation");
const { SignerView } = require("./signatures");

const OfferStatus = z.enum(["draft", "approval", "sent", "accepted", "declined", "expired", "withdrawn"]);

/** How long a sent offer stays open, in days: 15 unless the offer says otherwise; a link lives 90 at most. */
const OFFER_VALID_DAYS = { default: 15, min: 1, max: 90 };

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

/* ------------------------------------------------------------------ *
 * Reading
 * ------------------------------------------------------------------ */

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
    start_date: isoDate.nullable(),
    expires_at: isoDateTime.nullable(),
    sent_at: isoDateTime.nullable(),
    created_at: isoDateTime,
  })
  .strict();

/** One offer as its record shows it: the terms, the letter as the candidate reads it, its approval and signers. */
const OfferDetail = OfferRow.extend({
  department_id: uuid.nullable(),
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
  job_description: z.string().nullable(),
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
  accepted_at: isoDateTime.nullable(),
  declined_at: isoDateTime.nullable(),
  withdrawn_at: isoDateTime.nullable(),
  end_reason: z.string().nullable(),
  can_edit: z.boolean(),
  can_send: z.boolean(),
});

const OfferListQuery = listQuery(
  {
    status: OfferStatus.optional(),
    vacancy_id: uuid.optional(),
  },
  ["created_at", "expires_at", "number", "annual_compensation"],
);
const OfferPage = Paged(OfferRow);

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
    working_hours: optionalText(160),
    probation_months: blank(z.coerce.number().int().min(0).max(24)),
    /** The final job description, Markdown, copied from the vacancy's and edited. */
    job_description: optionalText(20000),
    benefits: optionalText(4000),
    valid_days: blank(z.coerce.number().int().min(OFFER_VALID_DAYS.min).max(OFFER_VALID_DAYS.max)),
  })
  .strict();

/** New Offer: an application at Shortlist, and its terms. */
const OfferCreate = OfferFields.extend({ application_id: uuid });

/** Edit a draft. */
const OfferEdit = OfferFields.partial();

/** Withdraw an offer that was sent or is with its approval: the reason the candidate's record keeps. */
const OfferWithdraw = z.object({ reason: text(500) }).strict();

/* ------------------------------------------------------------------ *
 * The candidate's signing page (go.mycityapp.io/sign/<token>)
 * ------------------------------------------------------------------ */

const OfferSignState = z.enum(["awaiting", "signed", "declined", "expired", "withdrawn"]);

/** What the signing page shows: the letter as the PDF has it, and where the signing stands. */
const OfferToSign = z
  .object({
    reference: z.string(),
    candidate_name: z.string(),
    role: z.string(),
    company: z.string(),
    /** The day the letter is dated, as its letterhead prints it. */
    issued_at: isoDateTime,
    expires_at: isoDateTime,
    state: OfferSignState,
    letter: z.array(z.string()),
    /** The emailed code was entered; Accept and Sign may be pressed. */
    code_verified: z.boolean(),
    signers: z.array(SignerView),
    signed_at: isoDateTime.nullable(),
    /** go.mycityapp.io/verify/<reference>, once signed. */
    verify_number: z.string().nullable(),
  })
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
  OfferRow: { table: "offer", virtual: ROW },
  OfferDetail: {
    table: "offer",
    virtual: {
      ...ROW,
      valid_days: "kept in terms",
      benefits: "kept in terms",
      pay_lines: "offer_pay_line rows",
      monthly_total: "the sum of its pay lines",
      letter: "the rendered letter, from the template and the offer's fields",
      document: "the document behind document_id",
      signers: "its signature request's signature rows",
      can_edit: "a draft, and the reader may edit it",
      can_send: "approved and not yet sent, and the reader may send it",
    },
  },
  OfferListQuery: { table: null, reason: "list controls and filters for the offers" },
  OfferPage: { table: null, reason: "a page of offers" },
  OfferPayLine: { table: "offer_pay_line" },
  OfferPayLineInput: { table: "offer_pay_line" },
  OfferFields: { table: "offer", virtual: FIELDS },
  OfferCreate: { table: "offer", virtual: FIELDS },
  OfferEdit: { table: "offer", virtual: FIELDS },
  OfferWithdraw: { table: null, reason: "the reason, kept as end_reason" },
  OfferToSign: { table: null, reason: "the signing page's view of an offer and its signature request" },
};

module.exports = {
  TABLES,
  OFFER_VALID_DAYS,
  OfferStatus,
  OfferSignState,
  OfferPayLine,
  OfferPayLineInput,
  OfferRow,
  OfferDetail,
  OfferListQuery,
  OfferPage,
  OfferFields,
  OfferCreate,
  OfferEdit,
  OfferWithdraw,
  OfferToSign,
};
