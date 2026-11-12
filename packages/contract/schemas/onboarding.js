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
 *           → onboarding (the start date) → completed (every step done, Complete Onboarding);
 *           or cancelled (Withdraw, before completion)
 *   item    pending → uploaded → verified, or rejected (back to the hire with the reason)
 *   step    pending → done (Mark Step Done)
 *
 * The requirements are MyCity's New Joiner list, seeded once as reference data and kept on the
 * Checklist settings (5399; A26 allows it because Send Offer refuses an empty checklist, AJ
 * 11/11/2026). A requirement of kind `number` or `both` takes a typed value on its item (the
 * MyLagosApp Wallet ID). The BVN is not a checklist item: it is asked once on the upload page and kept on
 * the employee record under employee.bank (masked).
 *
 * Two guarantors a hire, not related to them: one a previous employer, one who has known them
 * four years or more; serving police, military and other uniformed staff are not accepted.
 * Operations & People run a reference check on each (pending → passed or failed). Documentation
 * completes when every required item is verified, both guarantors passed, the BVN is entered and the
 * contract signed (`waiting_on` names what is still owed).
 *
 * Plans (the Plans settings): a department's onboarding steps, each with the role that owns it, a
 * due day counted from the start date and an optional SOP. The plan with no department is the
 * company's default (MyCity's Your First 30 Days), used for a department without its own. The
 * steps are copied onto the case when it reaches onboarding, the role resolved then to a person.
 *
 * Complete Onboarding takes the hire's company email: it becomes their work email and their login's,
 * invited with the Staff role.
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
/** What documentation still waits on before the case may move to pre-onboarding. */
const GateCondition = z.enum(["documents", "guarantors", "bvn", "contract"]);
/** Who owns a plan step, named when the steps are copied onto a hire's case. */
const StepOwnerRole = z.enum(["case_owner", "line_manager", "head_of_department", "hire"]);
const CaseStepStatus = z.enum(["pending", "done"]);

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

const DocumentRequirementListQuery = listQuery({}, ["display_order", "name"]);
const DocumentRequirementPage = Paged(DocumentRequirement);
const DocumentRequirementParams = z.object({ id: uuid }).strict();

/* ------------------------------------------------------------------ *
 * The plans' settings
 * ------------------------------------------------------------------ */

/** The SOP a step points to (M10's knowledge base). */
const StepSop = z.object({ sop_id: uuid, number: z.string(), title: z.string() }).strict();

const OnboardingPlanStep = z
  .object({
    onboarding_plan_step_id: uuid,
    position: z.number().int().min(1),
    title: z.string(),
    description: z.string().nullable(),
    owner_role: StepOwnerRole,
    due_offset_days: z.number().int().min(0),
    sop: StepSop.nullable(),
  })
  .strict();

/** A plan as the Plans settings list it. `department` null is the company's default plan. */
const OnboardingPlanRow = z
  .object({
    onboarding_plan_id: uuid,
    department_id: uuid.nullable(),
    department: z.string().nullable(),
    name: z.string(),
    active: z.boolean(),
    step_count: z.number().int().min(0),
    updated_at: isoDateTime,
  })
  .strict();

const OnboardingPlan = OnboardingPlanRow.omit({ step_count: true }).extend({ steps: z.array(OnboardingPlanStep) });

/** One step as the Plans settings save it: the due day counts from the hire's start date. */
const OnboardingPlanStepInput = z
  .object({
    title: text(160),
    description: optionalText(500),
    owner_role: StepOwnerRole,
    due_offset_days: z.coerce.number().int().min(0).max(365),
    sop_id: blank(uuid),
  })
  .strict();

/** A plan saved whole: its steps replace the plan's earlier ones, in the order given. */
const OnboardingPlanSave = z
  .object({
    department_id: uuid.nullable(),
    name: text(120),
    active: z.boolean().default(true),
    steps: z.array(OnboardingPlanStepInput).min(1).max(40),
  })
  .strict();

const OnboardingPlanListQuery = listQuery({}, ["name", "updated_at"]);
const OnboardingPlanPage = Paged(OnboardingPlanRow);
const OnboardingPlanParams = z.object({ id: uuid }).strict();

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

/**
 * One step of the hire's plan, as copied onto their case on the start date: its owner named, its due
 * day counted from the start date, its SOP as it stands now (null once archived).
 */
const OnboardingStep = z
  .object({
    onboarding_case_step_id: uuid,
    position: z.number().int().min(1),
    title: z.string(),
    description: z.string().nullable(),
    owner_role: StepOwnerRole,
    owner_id: uuid.nullable(),
    owner_name: z.string().nullable(),
    due_on: isoDate.nullable(),
    overdue: z.boolean(),
    sop: StepSop.nullable(),
    status: CaseStepStatus,
    done_at: isoDateTime.nullable(),
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
  waiting_on: z.array(GateCondition),
  steps: z.array(OnboardingStep),
  can_complete: z.boolean(),
  can_withdraw: z.boolean(),
});

/** A case's checklist item or guarantor, in the path. */
const ChecklistItemParams = z.object({ id: uuid, item_id: uuid }).strict();
const GuarantorParams = z.object({ id: uuid, guarantor_id: uuid }).strict();
const CaseStepParams = z.object({ id: uuid, step_id: uuid }).strict();
const OnboardingParams = z.object({ id: uuid }).strict();

const OnboardingListQuery = listQuery(
  {
    status: OnboardingStatus.optional(),
    department_id: uuid.optional(),
  },
  ["starts_on", "created_at"],
);
const OnboardingPage = Paged(OnboardingRow);

/**
 * The figures above the Onboarding list, over the cases in the reader's scope: how many at each open
 * status, the files waiting for a check, the steps past their due day, and the hires completed this
 * month (Lagos time).
 */
const OnboardingSummary = z
  .object({
    documentation: z.number().int().min(0),
    to_verify: z.number().int().min(0),
    pre_onboarding: z.number().int().min(0),
    onboarding: z.number().int().min(0),
    overdue_steps: z.number().int().min(0),
    completed_this_month: z.number().int().min(0),
  })
  .strict();

/** Reject an uploaded document: the reason the hire reads. */
const ChecklistItemReject = z.object({ reason: text(300) }).strict();

/** Withdraw a case (the hire did not join): the reason it keeps. */
const OnboardingCancel = z.object({ reason: text(500) }).strict();

/** Complete Onboarding: the hire's company email, their work email and their login's from now. */
const OnboardingComplete = z.object({ work_email: email }).strict();

/* ------------------------------------------------------------------ *
 * The hire's upload page (go.mycityapp.io/onboard/<token>)
 * ------------------------------------------------------------------ */

/** What the upload page shows: the checklist as the hire sees it. */
const UploadPack = z
  .object({
    first_name: z.string(),
    role: z.string(),
    company: z.string(),
    starts_on: isoDate.nullable(),
    status: OnboardingStatus,
    privacy_notice: z.array(z.string()),
    privacy_acknowledged: z.boolean(),
    items: z.array(OnboardingItem),
    guarantors: z.array(Guarantor).max(2),
    bvn_entered: z.boolean(),
  })
  .strict();

/** The privacy notice, accepted before anything is uploaded. */
const PrivacyAcknowledge = z.object({ consent: z.literal(true) }).strict();

/** The path of one item on the upload page. */
const UploadItemParams = z.object({ token: z.string().min(1).max(100), item_id: uuid }).strict();

/**
 * A file sent on the upload page (multipart, field `file`): stored on the hire's employee record and
 * scanned, then named on its item (`UploadItem.document_id`) or as a guarantor's form.
 */
const UploadFile = z.object({ purpose: z.literal("document").optional() }).strict();

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
  DocumentRequirementListQuery: { table: null, reason: "list controls for the Checklist settings" },
  DocumentRequirementParams: { table: null, reason: "the requirement in the path" },
  StepSop: { table: "sop" },
  OnboardingPlanStep: { table: "onboarding_plan_step", virtual: { sop: "the sop behind sop_id" } },
  OnboardingPlanRow: {
    table: "onboarding_plan",
    virtual: { department: "department.name", step_count: "the plan's onboarding_plan_step rows" },
  },
  OnboardingPlan: {
    table: "onboarding_plan",
    virtual: { department: "department.name", steps: "the plan's onboarding_plan_step rows" },
  },
  OnboardingPlanStepInput: { table: "onboarding_plan_step" },
  OnboardingPlanSave: { table: "onboarding_plan", virtual: { steps: "saved as onboarding_plan_step rows" } },
  OnboardingPlanListQuery: { table: null, reason: "list controls for the Plans settings" },
  OnboardingPlanPage: { table: null, reason: "a page of plans" },
  OnboardingPlanParams: { table: null, reason: "the plan in the path" },
  ChecklistItemParams: { table: null, reason: "the case and its item in the path" },
  GuarantorParams: { table: null, reason: "the case and its guarantor in the path" },
  CaseStepParams: { table: null, reason: "the case and its step in the path" },
  OnboardingStep: {
    table: "onboarding_case_step",
    virtual: {
      owner_name: "the owner's employee name",
      overdue: "pending and due_on before today",
      sop: "the sop behind sop_id",
    },
  },
  OnboardingParams: { table: null, reason: "the case in the path" },
  UploadItemParams: { table: null, reason: "the link and the item in the path" },
  UploadFile: { table: null, reason: "a multipart upload's fields; the file is stored as a document" },
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
      waiting_on: "the documentation gate's conditions still unmet",
      steps: "onboarding_case_step rows",
      can_complete: "at onboarding with every step done",
      can_withdraw: "not yet completed or cancelled",
    },
  },
  OnboardingListQuery: { table: null, reason: "list controls and filters for the cases" },
  OnboardingPage: { table: null, reason: "a page of cases" },
  OnboardingSummary: { table: null, reason: "counts over the cases, their items and steps" },
  ChecklistItemReject: { table: null, reason: "the reason, kept as rejected_reason" },
  OnboardingCancel: { table: null, reason: "the reason, kept as end_reason" },
  OnboardingComplete: { table: "employee" },
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
  GateCondition,
  StepOwnerRole,
  StepSop,
  OnboardingPlanStep,
  OnboardingPlanRow,
  OnboardingPlan,
  OnboardingPlanStepInput,
  OnboardingPlanSave,
  OnboardingPlanListQuery,
  OnboardingPlanPage,
  OnboardingPlanParams,
  DocumentRequirementListQuery,
  DocumentRequirementParams,
  ChecklistItemParams,
  GuarantorParams,
  CaseStepParams,
  OnboardingParams,
  UploadItemParams,
  UploadFile,
  OnboardingStatus,
  ChecklistItemStatus,
  RequirementKind,
  GuarantorKind,
  ReferenceCheckStatus,
  CaseStepStatus,
  OnboardingStep,
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
  OnboardingSummary,
  ChecklistItemReject,
  OnboardingCancel,
  OnboardingComplete,
  UploadPack,
  PrivacyAcknowledge,
  UploadItem,
};
