"use strict";
/**
 * Documentation and onboarding (docs/guides/offers.md §3 steps 5 to 8, §6): the case that opens
 * when an offer is accepted, its document checklist, and the checklist's settings.
 *
 * Recruitment · Onboarding reads and writes cases under /recruitment/onboarding within the caller's
 * `recruitment` scope. The hire uploads on a public link (`go.mycityapp.io/onboard/<token>`) after
 * acknowledging the privacy notice; every file lands on the employee, created at acceptance, and on
 * its checklist item. Onboarding never opens before documentation completes.
 *
 * Statuses (the contract's spelling is the tables' CHECKs, migration 5030):
 *   case    documentation → pre_onboarding (every required item verified, the contract signed)
 *           → onboarding (the start date) → completed; or cancelled
 *   item    pending → uploaded → verified, or rejected (back to the hire with the reason)
 *
 * The requirements are MyCity's New Joiner list, entered on the Checklist settings, never seeded
 * (A26). A requirement of kind `number` or `both` takes a typed value on its item (the MyLagosApp
 * Wallet ID). The BVN is not a checklist item: it is asked once on the upload page and kept on
 * the employee record under employee.bank (masked).
 *
 * Two guarantors a hire, not related to them: one a previous employer, one who has known them
 * four years or more; serving police, military and other uniformed staff are not accepted.
 * Operations & People run a reference check on each (pending → passed or failed). Documentation
 * completes when every required item is verified, both guarantors passed, and the contract signed.
 */
const { z } = require("zod");
const { uuid, text, optionalText, email, phone, blank, isoDate, isoDateTime, listQuery, Paged } = require("./common");
const { DocumentRef } = require("./documents");
const { EmploymentContractView } = require("./employment_contracts");

const OnboardingStatus = z.enum(["documentation", "pre_onboarding", "onboarding", "completed", "cancelled"]);
const ChecklistItemStatus = z.enum(["pending", "uploaded", "verified", "rejected"]);
/** What a requirement asks for: a file, a typed number (BVN), or both. */
const RequirementKind = z.enum(["file", "number", "both"]);
const GuarantorKind = z.enum(["previous_employer", "personal"]);
const ReferenceCheckStatus = z.enum(["pending", "passed", "failed"]);

/** A Bank Verification Number: eleven digits. */
const bvn = z.string().trim().regex(/^\d{11}$/, "Eleven digits");

/* ------------------------------------------------------------------ *
 * The checklist's settings
 * ------------------------------------------------------------------ */

const DocumentRequirement = z
  .object({
    document_requirement_id: uuid,
    code: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    kind: RequirementKind,
    required: z.boolean(),
    expires: z.boolean(),
    active: z.boolean(),
    display_order: z.number().int().min(0),
  })
  .strict();

const DocumentRequirementCreate = z
  .object({
    code: z.string().trim().regex(/^[a-z][a-z0-9_]{1,39}$/, "Lowercase letters, digits, _"),
    name: text(120),
    description: optionalText(500),
    kind: RequirementKind.default("file"),
    required: z.boolean().default(true),
    expires: z.boolean().default(false),
  })
  .strict();

const DocumentRequirementEdit = DocumentRequirementCreate.omit({ code: true })
  .extend({ active: z.boolean(), display_order: z.number().int().min(0) })
  .partial();

const DocumentRequirementPage = Paged(DocumentRequirement);

/* ------------------------------------------------------------------ *
 * Cases
 * ------------------------------------------------------------------ */

/** One checklist item as the case shows it. */
const OnboardingItem = z
  .object({
    onboarding_checklist_item_id: uuid,
    document_requirement_id: uuid.nullable(),
    title: z.string(),
    kind: RequirementKind,
    required: z.boolean(),
    status: ChecklistItemStatus,
    document: DocumentRef.nullable(),
    entered_value: z.string().nullable(),
    uploaded_at: isoDateTime.nullable(),
    verified_at: isoDateTime.nullable(),
    rejected_reason: z.string().nullable(),
    display_order: z.number().int().min(0),
  })
  .strict();

/** A guarantor as the case shows them. */
const Guarantor = z
  .object({
    onboarding_guarantor_id: uuid,
    position: z.number().int().min(1).max(2),
    kind: GuarantorKind,
    full_name: z.string(),
    relationship: z.string(),
    organisation: z.string().nullable(),
    job_title: z.string().nullable(),
    phone: z.string(),
    email: z.string().nullable(),
    years_known: z.number().int().nullable(),
    form: DocumentRef.nullable(),
    check_status: ReferenceCheckStatus,
    check_note: z.string().nullable(),
    checked_at: isoDateTime.nullable(),
  })
  .strict();

/** A guarantor as the hire enters them on the upload page. */
const GuarantorInput = z
  .object({
    position: z.number().int().min(1).max(2),
    kind: GuarantorKind,
    full_name: text(120),
    relationship: text(80),
    organisation: optionalText(160),
    job_title: optionalText(120),
    phone,
    email: blank(email),
    years_known: blank(z.coerce.number().int().min(0).max(80)),
    form_document_id: blank(uuid),
  })
  .strict()
  .refine((v) => v.kind !== "personal" || (v.years_known ?? 0) >= 4, {
    message: "Four years or more",
    path: ["years_known"],
  });

/** Record a guarantor's reference check. */
const ReferenceCheckRecord = z
  .object({
    check_status: z.enum(["passed", "failed"]),
    check_note: optionalText(500),
  })
  .strict();

/** One case as the Onboarding list shows it. */
const OnboardingRow = z
  .object({
    onboarding_case_id: uuid,
    hire_name: z.string(),
    job_title: z.string(),
    department: z.string().nullable(),
    status: OnboardingStatus,
    starts_on: isoDate.nullable(),
    items_outstanding: z.number().int().min(0),
    created_at: isoDateTime,
  })
  .strict();

const OnboardingDetail = OnboardingRow.extend({
  application_id: uuid,
  offer_id: uuid,
  employee_id: uuid.nullable(),
  owner_id: uuid.nullable(),
  privacy_acknowledged_at: isoDateTime.nullable(),
  documentation_completed_at: isoDateTime.nullable(),
  completed_at: isoDateTime.nullable(),
  cancelled_at: isoDateTime.nullable(),
  end_reason: z.string().nullable(),
  items: z.array(OnboardingItem),
  guarantors: z.array(Guarantor).max(2),
  bvn_entered: z.boolean(),
  contract: EmploymentContractView.nullable(),
});

const OnboardingListQuery = listQuery(
  {
    status: OnboardingStatus.optional(),
    department_id: uuid.optional(),
  },
  ["starts_on", "created_at"],
);
const OnboardingPage = Paged(OnboardingRow);

/** Reject an uploaded document: the reason the hire reads. */
const ChecklistItemReject = z.object({ reason: text(300) }).strict();

/** Cancel a case (the hire did not join): the reason it keeps. */
const OnboardingCancel = z.object({ reason: text(500) }).strict();

/* ------------------------------------------------------------------ *
 * The hire's upload page (go.mycityapp.io/onboard/<token>)
 * ------------------------------------------------------------------ */

/** What the upload page shows: the checklist as the hire sees it. */
const UploadPack = z
  .object({
    first_name: z.string(),
    role: z.string(),
    starts_on: isoDate.nullable(),
    privacy_acknowledged: z.boolean(),
    items: z.array(OnboardingItem),
    guarantors: z.array(Guarantor).max(2),
    bvn_entered: z.boolean(),
  })
  .strict();

/** The privacy notice, accepted before anything is uploaded. */
const PrivacyAcknowledge = z.object({ consent: z.literal(true) }).strict();

/** One item: the file the upload engine stored, the typed value, or both, as the requirement asks. */
const UploadItem = z
  .object({
    document_id: uuid.optional(),
    entered_value: text(80).optional(),
  })
  .strict()
  .refine((v) => Boolean(v.document_id) || Boolean(v.entered_value), { message: "Add the file", path: ["document_id"] });

/** The hire's BVN, asked once on the upload page; kept on employee.bvn. */
const BvnEnter = z.object({ bvn }).strict();

/** Which table each schema is a row of (gate 6, check/contract-columns.js). */
const ROW = {
  hire_name: "candidate.first_name and last_name, through application",
  job_title: "offer.job_title",
  department: "department.name, through offer",
  items_outstanding: "required checklist items not yet verified",
};
const TABLES = {
  DocumentRequirement: { table: "document_requirement" },
  DocumentRequirementCreate: { table: "document_requirement" },
  DocumentRequirementEdit: { table: "document_requirement" },
  DocumentRequirementPage: { table: null, reason: "a page of document requirements" },
  OnboardingItem: {
    table: "onboarding_checklist_item",
    virtual: {
      kind: "document_requirement.kind",
      required: "document_requirement.required",
      document: "the document behind document_id",
    },
  },
  OnboardingRow: { table: "onboarding_case", virtual: ROW },
  OnboardingDetail: {
    table: "onboarding_case",
    virtual: {
      ...ROW,
      items: "onboarding_checklist_item rows",
      guarantors: "onboarding_guarantor rows",
      bvn_entered: "the hire's employee.bvn is set",
      contract: "its employment_contract",
    },
  },
  OnboardingListQuery: { table: null, reason: "list controls and filters for the cases" },
  OnboardingPage: { table: null, reason: "a page of cases" },
  ChecklistItemReject: { table: null, reason: "the reason, kept as rejected_reason" },
  OnboardingCancel: { table: null, reason: "the reason, kept as end_reason" },
  UploadPack: { table: null, reason: "the upload page's view of a case, its checklist and guarantors" },
  PrivacyAcknowledge: { table: null, reason: "kept as onboarding_case.privacy_acknowledged_at" },
  UploadItem: { table: "onboarding_checklist_item", virtual: { document_id: "the file, kept on the item and filed on the employee" } },
  BvnEnter: { table: "employee" },
  Guarantor: { table: "onboarding_guarantor", virtual: { form: "the document behind form_document_id" } },
  GuarantorInput: { table: "onboarding_guarantor" },
  ReferenceCheckRecord: { table: "onboarding_guarantor" },
};

module.exports = {
  TABLES,
  OnboardingStatus,
  ChecklistItemStatus,
  RequirementKind,
  GuarantorKind,
  ReferenceCheckStatus,
  Guarantor,
  GuarantorInput,
  ReferenceCheckRecord,
  BvnEnter,
  DocumentRequirement,
  DocumentRequirementCreate,
  DocumentRequirementEdit,
  DocumentRequirementPage,
  OnboardingItem,
  OnboardingRow,
  OnboardingDetail,
  OnboardingListQuery,
  OnboardingPage,
  ChecklistItemReject,
  OnboardingCancel,
  UploadPack,
  PrivacyAcknowledge,
  UploadItem,
};
