"use strict";
/**
 * Disbursements (docs/guides/expenses.md §3 step 6, §6.5): the transfer for one authorised
 * request, to its own payee. The bank transaction reference is asked for, not required (decision 2
 * of 04/11/2026): without it or a receipt the API answers 422 REFERENCE_REQUIRED unless
 * `confirm_without_reference` is true (the screen's Save Without Reference?), and the disbursement
 * is Reference Missing until Add Reference fills it.
 */
const { z } = require("zod");
const { uuid, text, isoDate, isoDateTime, blank, money, listQuery, Paged } = require("./common");
const { PayeeType } = require("./expenses");
const { DocumentRef } = require("./documents");

/** A query-string boolean: "true" or "false". */
const flag = z.enum(["true", "false"]).transform((v) => v === "true");

/** A bank's transaction reference as the bank prints it. */
const reference = text(100);

const Disbursement = z
  .object({
    disbursement_id: uuid,
    number: z.string(),
    expense_request_id: uuid,
    request_number: z.string(),
    purpose: z.string(),
    recipient_type: PayeeType,
    recipient_name: z.string(),
    bank_name: z.string().nullable(),
    account_name: z.string().nullable(),
    account_number: z.string().nullable(),
    amount: money,
    payment_reference: z.string().nullable(),
    reference_missing: z.boolean(),
    receipt: DocumentRef.nullable(),
    paid_on: isoDate.nullable(),
    paid_at: isoDateTime.nullable(),
    processed_by: z.string().nullable(),
  })
  .strict();

const DisbursementListQuery = listQuery(
  { reference_missing: flag.optional() },
  ["paid_at", "amount", "number"],
);
const DisbursementPage = Paged(Disbursement);

/** Record Disbursement, for one authorised request. */
const DisbursementCreate = z
  .object({
    expense_request_id: uuid,
    payment_reference: blank(reference),
    receipt_document_id: blank(uuid),
    paid_on: isoDate,
    confirm_without_reference: z.boolean().default(false),
  })
  .strict();

/** Add Reference, on a disbursement saved without one. */
const DisbursementReference = z
  .object({
    payment_reference: reference,
    receipt_document_id: blank(uuid),
  })
  .strict();

/** Add Reference's card (praxis-ai.md decision 33): the disbursement, by its number, and the reference. */
const DisbursementReferenceAdd = z
  .object({
    disbursement_id: uuid,
    payment_reference: reference,
  })
  .strict();

/**
 * What the model reads off a payment receipt attached on Praxis AI (praxis-ai.md §6.18, decision
 * 46; Image Reading, `disbursement-receipt-read`): never kept. The server matches the authorised
 * request it pays in SQL and draws Record Disbursement's card from it.
 */
const DisbursementReceiptRead = z
  .object({
    payment_reference: z.string().max(100).nullable(),
    paid_on: isoDate.nullable(),
    amount: money.nullable(),
    beneficiary_name: z.string().max(150).nullable(),
    beneficiary_account_number: z.string().max(30).nullable(),
    beneficiary_bank: z.string().max(100).nullable(),
    narration: z.string().max(300).nullable(),
  })
  .strict();

const TABLES = {
  DisbursementReceiptRead: { table: null, reason: "a model's reading of a payment receipt, never kept" },
  DisbursementReferenceAdd: { table: "disbursement" },
  Disbursement: {
    table: "disbursement",
    virtual: {
      request_number: "expense_request.number",
      purpose: "expense_request.purpose",
      reference_missing: "payment_reference IS NULL",
      receipt: "the document behind receipt_document_id",
    },
  },
  DisbursementListQuery: { table: null, reason: "list controls for the disbursements" },
  DisbursementPage: { table: null, reason: "a page of disbursements" },
  DisbursementCreate: {
    table: "disbursement",
    virtual: { confirm_without_reference: "the person chose Save Without Reference" },
  },
  DisbursementReference: { table: "disbursement" },
};

module.exports = {
  TABLES,
  Disbursement,
  DisbursementListQuery,
  DisbursementPage,
  DisbursementCreate,
  DisbursementReference,
  DisbursementReferenceAdd,
  DisbursementReceiptRead,
};
