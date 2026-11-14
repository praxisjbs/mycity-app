"use strict";
/**
 * What the assistant may read about agreements (docs/guides/partnerships.md §9): the agreements the
 * asker may see, a page of 25 at a time, and the renewals coming due, by the rule Contracts & MOUs keeps
 * (an agreement follows its deal, §6.1). Summary: the agreements in figures by status, kind and owner,
 * and the renewals due by month (praxis-ai.md §6.13, Partnerships).
 *
 * An agreement is generated, edited, submitted, sent, renewed and closed on Contracts & MOUs, where the
 * person reads the wording and confirms each step (praxis-ai.md decision 33, `design`); a signature is
 * the signer's own, behind an emailed code. "Renewals due" opens Contracts & MOUs.
 *
 * A contract or MoU attached on Praxis AI · Ask (`files`, praxis-ai.md §6.18, decision 47) is read on
 * `agreement-document-read`, summarised, its terms shown on the pane's Record tab, and filed: Record
 * Signed Copy (risk approval: it seals and locks the agreement) on the agreement waiting for its
 * signature, through the route's own service; else Partners' Add Partner Document.
 */
const c = require("@mycity/contract");
const { defineManifest } = require("../../shared/ai/manifest");
const service = require("./agreements.service");
const signing = require("./agreements.signing");
const documentAi = require("./agreements.document-ai");
const documents = require("../partners/partners.documents");

const cite = (row) => ({ type: "agreement", id: row.partnership_agreement_id, label: `${row.number} ${row.title}` });

module.exports = defineManifest({
  module: "partnerships",
  actions: [
    {
      key: "agreements.record_signed_copy",
      label: "Record Signed Copy",
      description: "File an attached contract or MoU as the signed copy of the agreement waiting for its signature: the day signed, who signed for the partner, their title",
      input: c.agreements.AgreementSignedCopyAdd,
      permission: ["partnerships", "edit"],
      risk: "approval",
      form: "none: Record Signed Copy's form sits on the agreement it records and never names it; the card names the agreement (AgreementSignedCopyAdd), drawn from an attached contract or MoU",
      from_file: { kind: "contract", fills: ["document_id"] },
      fields: ["partnership_agreement_id", "document_id", "signed_on", "signed_by_name", "signed_by_title"],
      // An agreement is named by its number or title, among those waiting for a signature the person sees.
      resolve: { partnership_agreement_id: (value, actor, db) => service.agreementIdOf(db, value, actor.scope) },
      asks: [
        { field: "partnership_agreement_id", question: "Which agreement is it?", read: "agreements.list", params: { status: "sent" } },
        { field: "signed_on", question: "When was it signed?", choices: ["Today"] },
        { field: "signed_by_name", question: "Who signed it?" },
      ],
      records: (values, actor, db) => service.cardAgreement(db, values.partnership_agreement_id, actor.scope),
      // The file reads by its name, never its id (decision 32); it is not what the press acts on.
      names: (values, actor, db) => documents.cardFile(db, values.document_id, actor),
      check: (client, values, actor) => signing.assertSignable(client, values.partnership_agreement_id, actor.scope),
      run: (values, actor) => signing.signedCopyCard(actor, values),
      readback: service.cardReadback,
      labels: { partnership_agreement_id: "Agreement", document_id: "Document", signed_on: "Signed On", signed_by_name: "Signed By", signed_by_title: "Title" },
    },
  ],
  files: [
    {
      kind: "contract",
      label: "Contract or MoU",
      permission: ["partnerships", "view"],
      question: "Summarise this contract and file it",
      read: (actor, doc, db) => documentAi.readForChat(actor, doc, db),
      actions: ["agreements.record_signed_copy", "partner_documents.attach"],
    },
  ],
  not_offered: {
    AgreementGenerate: "design: Generate Agreement fills the category's template on screen, where the person reads the wording before it is kept",
    AgreementUpdate: "design: an agreement's wording is edited in the document editor with its fields beside it",
    AgreementSend: "design: Send for Signature asks the person to confirm each signer and address on screen",
    SignerInput: "design: a signer is confirmed on Send for Signature, beside the agreement it signs",
    SignedCopyRecord: "via agreements.record_signed_copy: Record Signed Copy's own request, which never names its agreement; the card is AgreementSignedCopyAdd, drawn from a contract or MoU attached on Ask",
    AgreementRenew: "design: the next term's dates and deal are chosen on screen beside the agreement it renews",
    AgreementClose: "design: closing ends its approval and its signing links, so the person confirms it with the agreement in view",
    SignSubmit: "secret: a signature is the signer's own, made on the signing page behind the code emailed to them",
    SignCodeVerify: "secret: the signing code is emailed to the signer and entered only by them",
    SignDecline: "secret: declining is the signer's own, on the signing page their link opens",
  },
  reads: [
    {
      key: "agreements.list",
      summary: "agreements.summary",
      description: "List partnership agreements, MOUs and contracts: number, title, the lead or partner, kind, status (draft to signed, active, expiring, renewed, closed), term, renewal date and owner",
      params: c.agreements.AgreementListQuery,
      permission: ["partnerships", "view"],
      run: (_client, params, actor) => service.list(params, actor.scope),
      cite,
    },
    {
      key: "agreements.renewals",
      summary: "agreements.summary",
      description: "Signed agreements coming up for renewal: number, title, the partner, when each ends, its renewal date and the days left, soonest first",
      params: c.agreements.RenewalQuery,
      permission: ["partnerships", "view"],
      run: (_client, params, actor) => service.renewals(params, actor.scope),
      cite,
    },
  ],
  summaries: [
    {
      key: "agreements.summary",
      description:
        "Agreements, MOUs and contracts in figures: drafts, in approval, waiting for signature, signed, active, ending soon, renewed, closed; by status, kind and owner; renewals due by month",
      params: c.agreements.AgreementSummaryQuery,
      permission: ["partnerships", "view"],
      run: (client, params, actor) => service.aiSummary(client, params, actor.scope),
    },
  ],
  routes: [
    { intent: "see agreements, MOUs and contracts, or which renewals are due", screen: "partnerships.contracts-and-mous" },
    { intent: "generate, send or renew an agreement", screen: "partnerships.contracts-and-mous" },
  ],
});
