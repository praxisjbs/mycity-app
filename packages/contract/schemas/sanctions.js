"use strict";
/**
 * Sanctions and the consequence chain (docs/guides/queries.md §6.5, §6.6).
 *
 * The chain is MyCity's ladder, one rung a `consequence_step` row in `position`
 * order: Caution, Warning, Second Warning, Suspension, Suspension Without Pay,
 * Dismissal or Termination (Cynthia, 10 October). Adding a rung is inserting a row
 * at a position on Sanctions · Chain Settings; no code changes. Who approves a
 * proposed sanction is the `queries.consequence` approval (schemas/workflow.js).
 *
 * A sanction always follows a query: it is proposed from the query's decision
 * (POST /queries/:id/decision, schemas/queries.js) and issued when its approval is.
 *   pending_approval  proposed, its approval open
 *   issued            approved: numbered, its letter filed and sent
 *   rejected          the approval refused it
 *   withdrawn         taken back by People, with a reason
 *
 * A fine is never a rung. It attaches to any sanction and waits, pending, until
 * payroll (M6) accepts it into a run or it is waived.
 */
const { z } = require("zod");
const {
  uuid,
  text,
  isoDate,
  isoDateTime,
  money,
  listQuery,
  Paged,
} = require("./common");
const { PersonRef } = require("./organisation");
const { EvidenceItem } = require("./queries");
const { SignaturePng } = require("./policies");

const SanctionStatus = z.enum(["pending_approval", "issued", "rejected", "withdrawn"]);
const FinancialEffect = z.enum(["none", "unpaid_days", "ends_employment"]);
const FineStatus = z.enum(["pending", "accepted", "rejected", "settled", "waived"]);

/** A query-string boolean: "true" or "false". */
const flag = z.enum(["true", "false"]).transform((v) => v === "true");

/* ------------------------------------------------------------------ *
 * The chain
 * ------------------------------------------------------------------ */

/** One rung. `letter_ready`: its letter template is active, so it can be proposed. */
const ConsequenceStep = z
  .object({
    consequence_step_id: uuid,
    code: z.string(),
    name: z.string(),
    position: z.number().int().min(1),
    letter_template: z.string().nullable(),
    letter_ready: z.boolean(),
    financial_effect: FinancialEffect,
    default_days: z.number().int().min(1).nullable(),
    valid_days: z.number().int().min(1).nullable(),
    evidence_required: z.boolean(),
    active: z.boolean(),
    created_at: isoDateTime,
    updated_at: isoDateTime,
  })
  .strict();

const ConsequenceStepPage = Paged(ConsequenceStep);

/** GET /sanctions/chain, in ladder order. */
const ConsequenceStepListQuery = listQuery({ active: flag.optional() }, ["position"]);

const days = (max) => z.number().int().min(1).max(max).nullable();

/**
 * POST /sanctions/chain. `position` puts the rung there and moves the ones below
 * down; without it the rung goes to the bottom. The code is made from the name.
 */
const ConsequenceStepCreate = z
  .object({
    name: text(80),
    position: z.number().int().min(1).max(100).optional(),
    letter_template: z.string().trim().min(2).max(64).nullable().default(null),
    financial_effect: FinancialEffect.default("none"),
    default_days: days(365).default(null),
    valid_days: days(3660).default(null),
    evidence_required: z.boolean().default(false),
  })
  .strict();

/** PATCH /sanctions/chain/:id: move, rename, change, retire (`active: false`). */
const ConsequenceStepUpdate = z
  .object({
    name: text(80).optional(),
    position: z.number().int().min(1).max(100).optional(),
    letter_template: z.string().trim().min(2).max(64).nullable().optional(),
    financial_effect: FinancialEffect.optional(),
    default_days: days(365).optional(),
    valid_days: days(3660).optional(),
    evidence_required: z.boolean().optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Change at least one field");

/* ------------------------------------------------------------------ *
 * Sanctions
 * ------------------------------------------------------------------ */

const SanctionFine = z
  .object({
    amount_ngn: money,
    settlement_status: FineStatus,
    settled_at: isoDateTime.nullable(),
  })
  .strict();

/** One row of Sanction History. */
const Sanction = z
  .object({
    sanction_id: uuid,
    number: z.string().nullable(),
    employee: PersonRef,
    employee_query_id: uuid,
    query_number: z.string(),
    consequence_step_id: uuid.nullable(),
    sanction_type: z.string(),
    step_name: z.string(),
    reason: z.string(),
    decided_by: uuid,
    decided_by_name: z.string().nullable(),
    effective_on: isoDate,
    ends_on: isoDate.nullable(),
    status: SanctionStatus,
    fine: SanctionFine.nullable(),
    created_at: isoDateTime,
  })
  .strict();

const SanctionPage = Paged(Sanction);

/** One sanction, with its evidence, letter and approval. */
const SanctionDetail = Sanction.extend({
  evidence: z.array(EvidenceItem).max(50),
  letter_document_id: uuid.nullable(),
  fine_letter_document_id: uuid.nullable(),
  workflow_instance_id: uuid.nullable(),
  waiting_on: z.string().nullable(),
}).strict();

/**
 * POST /sanctions/:id/approve: the approver the stage waits on lets it stand. At the Operations &
 * People stage they sign it (guide §6.4): the drawn PNG, kept in the vault, printed on its letters.
 */
const SanctionApprove = z.object({ signature: SignaturePng.optional() }).strict();

/** POST /sanctions/:id/reject: refused with a reason; the query goes back under review. */
const SanctionReject = z
  .object({ reason: z.string().trim().min(10, "Give the reason").max(2000) })
  .strict();

/** GET /sanctions */
const SanctionListQuery = listQuery(
  {
    status: SanctionStatus.optional(),
    employee_id: uuid.optional(),
    consequence_step_id: uuid.optional(),
  },
  ["effective_on", "created_at"],
);

/** GET /sanctions/summary, within the reader's visibility. Money in Naira. */
const SanctionsSummary = z
  .object({
    active: z.number().int().min(0),
    pending_approval: z.number().int().min(0),
    fines_this_year: money,
    fines_recovered: money,
  })
  .strict();

/** GET /sanctions/standing: one person's place on the ladder. */
const SanctionStandingQuery = z.object({ employee_id: uuid }).strict();

/**
 * The rungs still in force for the person (issued, inside the rung's valid_days)
 * and the rung a new offence is offered first (guide §6.5); null when the chain is
 * empty or the person is already on its last rung.
 */
const SanctionStanding = z
  .object({
    employee_id: uuid,
    in_force: z
      .array(
        z
          .object({
            sanction_id: uuid,
            number: z.string(),
            step_name: z.string(),
            position: z.number().int().min(1),
            effective_on: isoDate,
            in_force_until: isoDate.nullable(),
          })
          .strict(),
      )
      .max(25),
    next_step: z
      .object({ consequence_step_id: uuid, name: z.string(), position: z.number().int().min(1) })
      .strict()
      .nullable(),
  })
  .strict();

/* ------------------------------------------------------------------ *
 * ESS · My Queries · Sanctions (the ess module, through the sanctions service)
 * ------------------------------------------------------------------ */

/** One of the caller's own issued sanctions. Pending, rejected and withdrawn are not shown. */
const MySanction = z
  .object({
    sanction_id: uuid,
    number: z.string(),
    step_name: z.string(),
    reason: z.string(),
    query_number: z.string(),
    effective_on: isoDate,
    ends_on: isoDate.nullable(),
    fine: SanctionFine.nullable(),
    letter_document_id: uuid.nullable(),
    fine_letter_document_id: uuid.nullable(),
  })
  .strict();

const MySanctionPage = Paged(MySanction);

/** The variables of templates/email/sanction-issued.html: the letter rides as the attachment. */
const SanctionIssuedEmailVars = z
  .object({
    sanction_number: z.string(),
    step_name: z.string(),
    query_number: z.string(),
    fine_amount: money.nullable().default(null),
  })
  .strict();

/** Which table each schema is a row of (gate 6, check/contract-columns.js). */
const TABLES = {
  ConsequenceStep: {
    table: "consequence_step",
    virtual: { letter_ready: "its letter_template row is active and has wording" },
  },
  ConsequenceStepPage: { table: null, reason: "a page of the chain's rungs" },
  ConsequenceStepListQuery: { table: null, reason: "list controls for the chain" },
  ConsequenceStepCreate: { table: "consequence_step" },
  ConsequenceStepUpdate: { table: "consequence_step" },
  SanctionFine: { table: "sanction_fine" },
  Sanction: {
    table: "sanction",
    virtual: {
      employee: "the person, from employee and department",
      query_number: "employee_query.number",
      step_name: "consequence_step.name, or sanction_type for a rung since removed",
      decided_by_name: "the proposer's display name",
      fine: "the sanction_fine row",
    },
  },
  SanctionPage: { table: null, reason: "a page of sanctions" },
  SanctionDetail: {
    table: "sanction",
    virtual: {
      employee: "the person, from employee and department",
      query_number: "employee_query.number",
      step_name: "consequence_step.name, or sanction_type for a rung since removed",
      decided_by_name: "the proposer's display name",
      fine: "the sanction_fine row",
      letter_document_id: "sanction_letter.document_id",
      fine_letter_document_id: "sanction_letter.document_id of the Salary Deduction letter",
      waiting_on: "the approval stage it waits at, from workflow_instance",
    },
  },
  SanctionListQuery: { table: null, reason: "list controls and filters for Sanction History" },
  SanctionApprove: {
    table: "sanction",
    virtual: { signature: "the drawn PNG, stored through the vault as signature_document_id, signed_by the approver" },
  },
  SanctionReject: { table: null, reason: "the approval's decision reason, kept on workflow_decision" },
  SanctionsSummary: { table: null, reason: "counts and sums over sanction and sanction_fine" },
  SanctionStandingQuery: { table: null, reason: "whose standing to read" },
  SanctionStanding: { table: null, reason: "worked out from sanction and consequence_step" },
  MySanction: {
    table: "sanction",
    virtual: {
      step_name: "consequence_step.name, or sanction_type",
      query_number: "employee_query.number",
      fine: "the sanction_fine row",
      letter_document_id: "sanction_letter.document_id",
      fine_letter_document_id: "sanction_letter.document_id of the Salary Deduction letter",
    },
  },
  MySanctionPage: { table: null, reason: "a page of the caller's own sanctions" },
  SanctionIssuedEmailVars: { table: null, reason: "the variables of templates/email/sanction-issued.html, not a row" },
};

module.exports = {
  TABLES,
  SanctionStatus,
  FinancialEffect,
  FineStatus,
  ConsequenceStep,
  ConsequenceStepPage,
  ConsequenceStepListQuery,
  ConsequenceStepCreate,
  ConsequenceStepUpdate,
  SanctionFine,
  Sanction,
  SanctionPage,
  SanctionDetail,
  SanctionApprove,
  SanctionReject,
  SanctionListQuery,
  SanctionsSummary,
  SanctionStandingQuery,
  SanctionStanding,
  MySanction,
  MySanctionPage,
  SanctionIssuedEmailVars,
};
