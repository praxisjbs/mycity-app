"use strict";
/**
 * Employment contracts (docs/guides/offers.md §3 steps 5 and 5a, §6): generated when an offer is
 * accepted, from the standard contract wording, the offer's terms, its final job description and the
 * hire's details, then signed by the company (the Offer Signatory, in the hub) and after it by the
 * hire on their own signing link. It belongs to the hire's onboarding case and counts towards
 * documentation.
 *
 * Statuses (the contract's spelling is the table's CHECK, migration 5030):
 *   draft      generated, not yet sent
 *   sent       sent for signature
 *   signed     signed by the hire; sealed and locked
 *   cancelled  the case was cancelled before it was signed
 */
const { z } = require("zod");
const { uuid, text, isoDate, isoDateTime, money } = require("./common");
const { DocumentRef } = require("./documents");
const { SignerView } = require("./signatures");
const { LetterPayLine, SealedSigner, CertificateLine } = require("./offers");

const EmploymentContractStatus = z.enum(["draft", "sent", "signed", "cancelled"]);

/** A contract as the onboarding case shows it. */
const EmploymentContractView = z
  .object({
    employment_contract_id: uuid,
    number: z.string(),
    status: EmploymentContractStatus,
    starts_on: isoDate,
    ends_on: isoDate.nullable(),
    document: DocumentRef,
    signers: z.array(SignerView),
    created_at: isoDateTime,
    /** The reader is the company's signer and the company has not signed yet (Sign for Company). */
    can_sign: z.boolean(),
    /** The company has signed and the hire has not: a fresh link may be sent (Resend Contract). */
    can_resend: z.boolean(),
  })
  .strict();

/** The standard contract wording as its editor shows it (the Onboarding tab's Contract settings). */
const ContractTemplate = z
  .object({
    body: z.string(),
    version: z.number().int().min(0),
    is_default: z.boolean(),
    variables: z.array(z.string()),
    updated_at: isoDateTime.nullable(),
  })
  .strict();

const ContractTemplateSave = z.object({ body: text(60000) }).strict();

/**
 * templates/documents/employment-contract.html: the standard wording's variables. The offer's terms
 * as accepted, the hire's staff number, and once sealed every signature, the certificate and the QR.
 */
const EmploymentContractVars = z
  .object({
    company: z.string(),
    date: isoDate,
    number: z.string(),
    offer_number: z.string(),
    employee: z
      .object({ full_name: z.string(), first_name: z.string(), email: z.string(), staff_number: z.string() })
      .strict(),
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

/** Which table each schema is a row of (gate 6, check/contract-columns.js). */
const TABLES = {
  EmploymentContractView: {
    table: "employment_contract",
    virtual: {
      document: "the document behind document_id",
      signers: "its signature request's signature rows",
      can_sign: "the reader against the request's company signer",
      can_resend: "the request's signers' statuses",
    },
  },
  ContractTemplate: { table: null, reason: "a template_version of templates/documents/employment-contract.html" },
  ContractTemplateSave: { table: null, reason: "saved as the next template_version" },
  EmploymentContractVars: { table: null, reason: "the variables of templates/documents/employment-contract.html" },
};

module.exports = {
  TABLES,
  EmploymentContractStatus,
  EmploymentContractView,
  ContractTemplate,
  ContractTemplateSave,
  EmploymentContractVars,
};
