"use strict";
/**
 * Employment contracts (docs/guides/offers.md §3 step 5, §6): generated when an offer is accepted,
 * from the offer, its final job description, the vacancy and the hire's details, then signed by
 * the hire on its own signing link. It belongs to the hire's onboarding case and counts towards
 * documentation.
 *
 * Statuses (the contract's spelling is the table's CHECK, migration 5030):
 *   draft      generated, not yet sent
 *   sent       sent for signature
 *   signed     signed by the hire; sealed and locked
 *   cancelled  the case was cancelled before it was signed
 */
const { z } = require("zod");
const { uuid, isoDate, isoDateTime } = require("./common");
const { DocumentRef } = require("./documents");
const { SignerView } = require("./signatures");

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
  })
  .strict();

/** Which table each schema is a row of (gate 6, check/contract-columns.js). */
const TABLES = {
  EmploymentContractView: {
    table: "employment_contract",
    virtual: {
      document: "the document behind document_id",
      signers: "its signature request's signature rows",
    },
  },
};

module.exports = {
  TABLES,
  EmploymentContractStatus,
  EmploymentContractView,
};
