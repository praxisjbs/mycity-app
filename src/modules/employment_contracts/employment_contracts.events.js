"use strict";
/**
 * What the employment contracts module records, and what follows (docs/guides/offers.md §3 step 5a,
 * §7). Loaded by the API (through the service) and the worker. Payloads carry ids, numbers and who
 * to tell; never a figure or a link.
 *
 *   contract.generated       the offer was accepted: the contract is made and waits for the company
 *   contract.company_signed  Sign for Company: the hire's link is mailed by the service after commit
 *   contract.resent          Resend Contract: a fresh link, every earlier one revoked
 *   contract.signed          the hire signed: the last signature of its request
 *   contract.cancelled       the hire declined, the request lapsed, or the case was cancelled
 *
 * The contract is a doc type of its own, signed through the signatures service
 * (defineSignable("employment_contract")): the standard wording, then Additional Terms and
 * Schedule A, and once sealed the signatures, the Signature Certificate and the QR. The company
 * signs first and the hire second, so the hire's link exists only after the company's signature.
 */
const c = require("@mycity/contract");
const { defineEvents } = require("../../shared/events/catalogue");
const { defineNotification } = require("../../shared/notifications/fanout");
const { defineVariables } = require("../../shared/templates/variables");
const { defineDocType } = require("../../shared/documents/generate");
const signatures = require("../signatures/signatures.service");
const render = require("./employment_contracts.render");

const EVENTS = defineEvents("recruitment", {
  "contract.generated": { summary: "An employment contract was generated" },
  "contract.company_signed": { summary: "An employment contract was signed for the company" },
  "contract.resent": { summary: "An employment contract's link was sent again" },
  "contract.signed": { summary: "A hire signed their employment contract" },
  "contract.cancelled": { summary: "An employment contract was cancelled" },
});

/** The employment contract (guide §3 step 5a). */
const DOC_TYPE = "employment_contract";

/** The emails this module sends: worded on Candidate Emails, their variables declared by candidates.events.js. */
const EMAILS = Object.freeze({ sent: "contract-sent" });

defineDocType(DOC_TYPE, {
  label: "Employment Contract",
  module: "recruitment",
  template: render.TEMPLATE,
  numbering: null,
  sensitivity: "personal",
  signable: true,
  title: (d) => `Contract of Employment: ${d.employee.full_name}`,
  letter: (d) => ({ date: d.date, to: [d.employee.full_name, `By email: ${d.employee.email}`] }),
  appendix: (d) => render.appendixOf(d),
  sealing: (d) => d.sealing || null,
});
defineVariables("document", render.TEMPLATE, c.employment_contracts.EmploymentContractVars);

const service = () => require("./employment_contracts.service");

signatures.defineSignable(DOC_TYPE, {
  document_type: DOC_TYPE,
  letter: (db, contractId) => service().letterOf(db, contractId),
  contentHash: (db, contractId) => service().contentHashOf(db, contractId),
  seal: (client, ctx) => service().sealIn(client, ctx),
  onCompleted: (client, ctx) => service().signedIn(client, ctx),
  onDeclined: (client, ctx) => service().declinedIn(client, ctx),
  onEnded: (client, ctx) => service().endedIn(client, ctx),
});

const owner = (e) => (e.payload.owner_user_id ? [e.payload.owner_user_id] : []);

defineNotification(EVENTS.CONTRACT_GENERATED, {
  to: [{ users: (e) => (e.payload.signatory_user_id ? [e.payload.signatory_user_id] : []) }],
  title: "Contract Waiting",
  body: (e) => `${e.payload.number} for ${e.payload.employee_name} waits for the company's signature.`,
});

defineNotification(EVENTS.CONTRACT_SIGNED, {
  to: [{ users: owner }],
  title: "Contract Signed",
  body: (e) => `${e.payload.employee_name} signed ${e.payload.number}.`,
});

defineNotification(EVENTS.CONTRACT_CANCELLED, {
  to: [{ users: owner }],
  title: "Contract Cancelled",
  body: (e) => `${e.payload.number} for ${e.payload.employee_name} was not signed.`,
});

module.exports = { EVENTS, DOC_TYPE, EMAILS };
