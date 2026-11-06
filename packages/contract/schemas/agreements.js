"use strict";
/**
 * Agreements (docs/guides/partnerships.md §3 step 5, §4.2, §5, §6.8, §6.9): a Deal Merchant Agreement,
 * MOU, service agreement or contract filled from its category's template, approved through
 * `partnership.agreement`, signed on the public signing page and sealed, then verified by QR.
 *
 * The lifecycle (MILESTONES §12): draft (Generate Agreement; a rejection) → review (Submit for
 * Approval) → approval (a later stage waits) → sent (Send for Signature; a declined or expired
 * signature) → viewed (the first signer opens it) → signed (the last signature, or Record Signed Copy;
 * sealed and locked) → active (its start) → expiring (its notice date) → renewed (the next one signed);
 * closed (Close Agreement, from any status).
 *
 * The signing and verification half is the signatures service's, shared with M5's offers: one
 * signing page, one verification page. Typed by reference, verification shows status, signers and
 * the two verdicts, never the content; opened from its QR, the document too (§6.9, A9, A12).
 */
const { z } = require("zod");
const { uuid, text, optionalText, email, isoDate, isoDateTime, money, blank, listQuery, Paged } = require("./common");
const { PersonRef } = require("./organisation");
const { DocumentRef } = require("./documents");
const { RecordRef, TemplateKind } = require("./partner_pipeline");
const { AnswerValue } = require("./proposals");

const AgreementStatus = z.enum(["draft", "review", "approval", "sent", "viewed", "signed", "active", "expiring", "renewed", "closed"]);
/** Which side a signer signs for: the partner's signatory, or MyCity's countersignatory. */
const SignerSide = z.enum(["partner", "mycity"]);
const SignerState = z.enum(["waiting", "sent", "viewed", "signed", "declined"]);

/** An ask's or a field's value by its key: what the template was filled with. */
const FieldValues = z.record(z.string().regex(/^[a-z][a-z0-9_.]{0,79}$/), AnswerValue);

/* ------------------------------------------------------------------ *
 * Writing
 * ------------------------------------------------------------------ */

/** Generate Agreement on a deal: the category's default template of the kind, filled from the record and the asks. */
const AgreementGenerate = z
  .object({
    deal_id: uuid,
    kind: TemplateKind.optional(),
    template_key: z.string().trim().regex(/^[a-z0-9][a-z0-9-]{1,79}$/).optional(),
    asks: FieldValues.optional(),
  })
  .strict();

/** Edit, in Draft only. An empty required field blocks Submit and is named. */
const AgreementUpdate = z
  .object({
    body: z.string().max(200000).optional(),
    fields: FieldValues.optional(),
    starts_on: isoDate.nullable().optional(),
    ends_on: isoDate.nullable().optional(),
    renewal_notice_days: z.number().int().min(0).max(730).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Change at least one field")
  .refine((v) => !v.starts_on || !v.ends_on || v.ends_on >= v.starts_on, { message: "Ends before it starts", path: ["ends_on"] });

const SignerInput = z
  .object({
    contact_id: blank(uuid),
    name: text(120),
    title: optionalText(120),
    email,
    side: SignerSide,
  })
  .strict();

/** Send for Signature, approved only: the person confirms each signer, and `confirm: true` with it. */
const AgreementSend = z
  .object({
    signers: z.array(SignerInput).min(1, "Add a signer").max(4),
    message: optionalText(2000),
    confirm: z.literal(true),
  })
  .strict();

/** Record Signed Copy: a signature made on paper, its scan through the upload engine. */
const SignedCopyRecord = z
  .object({
    document_id: uuid,
    signed_on: isoDate,
    signed_by_name: text(120),
    signed_by_title: optionalText(120),
  })
  .strict();

/** Renew: the next agreement drafted from this one, dates moved, and a new deal for the term if asked. */
const AgreementRenew = z
  .object({
    starts_on: isoDate,
    ends_on: blank(isoDate),
    new_deal: z.boolean().optional(),
  })
  .strict()
  .refine((v) => !v.ends_on || v.ends_on >= v.starts_on, { message: "Ends before it starts", path: ["ends_on"] });

const AgreementClose = z.object({ reason: z.string().trim().min(10, "At least 10 characters").max(1000) }).strict();

/* ------------------------------------------------------------------ *
 * Reading
 * ------------------------------------------------------------------ */

const Signer = z
  .object({
    name: z.string(),
    title: z.string().nullable(),
    email: z.string(),
    side: SignerSide,
    state: SignerState,
    signed_at: isoDateTime.nullable(),
  })
  .strict();

const AgreementRow = z
  .object({
    partnership_agreement_id: uuid,
    number: z.string(),
    title: z.string(),
    kind: TemplateKind.nullable(),
    status: AgreementStatus,
    record: RecordRef,
    deal_id: uuid.nullable(),
    starts_on: isoDate.nullable(),
    ends_on: isoDate.nullable(),
    /** `renewal_notice_days` before it ends. */
    renewal_on: isoDate.nullable(),
    value: money.nullable(),
    currency: z.string().nullable(),
    owner: PersonRef.nullable(),
    signed_at: isoDateTime.nullable(),
  })
  .strict();

const AgreementDetail = AgreementRow.extend({
  proposal_id: uuid.nullable(),
  template_key: z.string().nullable(),
  template_version: z.number().int().nullable(),
  fields: FieldValues,
  body: z.string().nullable(),
  /** The required fields still empty: Submit names them. */
  missing_fields: z.array(z.string()),
  workflow_instance_id: uuid.nullable(),
  approval: z
    .object({ stage: z.string(), waiting_on: z.string().nullable() })
    .strict()
    .nullable(),
  signers: z.array(Signer).max(4),
  document: DocumentRef.nullable(),
  signed_document: DocumentRef.nullable(),
  signed_outside: z.boolean(),
  renewal_notice_days: z.number().int().min(0),
  renews_agreement_id: uuid.nullable(),
  closed_at: isoDateTime.nullable(),
  close_reason: z.string().nullable(),
  /** The reference and the QR's link, once sealed. */
  verify: z.object({ reference: z.string(), qr_url: z.string() }).strict().nullable(),
}).strict();

const AgreementListQuery = listQuery(
  {
    status: AgreementStatus.optional(),
    kind: TemplateKind.optional(),
    partner_id: uuid.optional(),
    lead_id: uuid.optional(),
    deal_id: uuid.optional(),
    owner_id: uuid.optional(),
  },
  ["starts_on", "ends_on", "created_at", "number"],
);
const AgreementPage = Paged(AgreementRow);

/** Renewals due: the agreements ending within the next `within_days`, soonest first. */
const RenewalQuery = listQuery({ within_days: z.coerce.number().int().min(1).max(730).optional() }, ["ends_on"]);

const RenewalRow = z
  .object({
    partnership_agreement_id: uuid,
    number: z.string(),
    title: z.string(),
    record: RecordRef,
    ends_on: isoDate,
    renewal_on: isoDate,
    days_left: z.number().int(),
    owner: PersonRef.nullable(),
  })
  .strict();
const RenewalPage = Paged(RenewalRow);

/** The cards above Contracts & MOUs. */
const AgreementsSummary = z
  .object({
    active: z.number().int().min(0),
    in_approval: z.number().int().min(0),
    awaiting_signature: z.number().int().min(0),
    renewals_180: z.number().int().min(0),
  })
  .strict();

/* Signing and verification are the signatures service's, shared with M5: schemas/signatures.js
 * (SignTokenParams, SignCodeVerify, SignaturePng, SignSubmit, SignDecline, VerifyRefParams,
 * VerifyResult, VerifyByToken), moved there on 06/11/2026 (GE, LA; docs/guides/offers.md). */

/** Which table each schema is a row of (gate 6, check/contract-columns.js). */
const ROW = {
  record: "the lead or partner it is on",
  deal_id: "partnership_agreement.partnership_opportunity_id",
  renewal_on: "ends_on less renewal_notice_days",
  owner: "the person, from employee and department",
};
const TABLES = {
  AgreementGenerate: {
    table: "partnership_agreement",
    virtual: { deal_id: "written as partnership_opportunity_id", asks: "kept in fields with the record's values" },
  },
  AgreementUpdate: { table: "partnership_agreement" },
  SignerInput: { table: null, reason: "a signer confirmed for the signature request" },
  AgreementSend: { table: null, reason: "the signers and message the signature request is made with" },
  SignedCopyRecord: { table: null, reason: "a paper signature: signed_document_id, signed_at, signed_outside and the signer" },
  AgreementRenew: { table: null, reason: "the next agreement's dates, drafted from this one" },
  AgreementClose: { table: null, reason: "the reason, kept as close_reason" },
  Signer: { table: null, reason: "a signer of the signature request, and where they are" },
  AgreementRow: { table: "partnership_agreement", virtual: ROW },
  AgreementDetail: {
    table: "partnership_agreement",
    virtual: {
      ...ROW,
      missing_fields: "the template's required fields still empty",
      approval: "the waiting stage of its workflow_instance",
      signers: "its signature request's signers",
      document: "the document behind document_id",
      signed_document: "the document behind signed_document_id",
      verify: "the sealed copy's reference and QR link",
    },
  },
  AgreementListQuery: { table: null, reason: "list controls and filters for the agreements" },
  AgreementPage: { table: null, reason: "a page of agreements" },
  RenewalQuery: { table: null, reason: "list controls for the renewals due" },
  RenewalRow: {
    table: "partnership_agreement",
    virtual: { record: ROW.record, renewal_on: ROW.renewal_on, days_left: "Lagos days to renewal_on", owner: ROW.owner },
  },
  RenewalPage: { table: null, reason: "a page of renewals due" },
  AgreementsSummary: { table: null, reason: "figures over the agreements" },
};

module.exports = {
  TABLES,
  AgreementStatus,
  SignerSide,
  SignerState,
  FieldValues,
  AgreementGenerate,
  AgreementUpdate,
  SignerInput,
  AgreementSend,
  SignedCopyRecord,
  AgreementRenew,
  AgreementClose,
  Signer,
  AgreementRow,
  AgreementDetail,
  AgreementListQuery,
  AgreementPage,
  RenewalQuery,
  RenewalRow,
  RenewalPage,
  AgreementsSummary,
};
