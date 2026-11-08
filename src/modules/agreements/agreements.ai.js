"use strict";
/**
 * What the assistant may read about agreements (docs/guides/partnerships.md §9): the agreements the
 * asker may see, a page of 25 at a time, and the renewals coming due, by the rule Contracts & MOUs keeps
 * (an agreement follows its deal, §6.1).
 *
 * Nothing about an agreement is done from the chat (praxis-ai.md decision 33): it is generated, edited,
 * submitted, sent, renewed and closed on Contracts & MOUs, where the person reads the wording and
 * confirms each step; a signature is the signer's own, behind an emailed code; a signed copy is a file.
 * "Renewals due" opens Contracts & MOUs.
 */
const c = require("@mycity/contract");
const { defineManifest } = require("../../shared/ai/manifest");
const service = require("./agreements.service");

const cite = (row) => ({ type: "agreement", id: row.partnership_agreement_id, label: `${row.number} ${row.title}` });

module.exports = defineManifest({
  module: "partnerships",
  actions: [],
  not_offered: {
    AgreementGenerate: "design: Generate Agreement fills the category's template on screen, where the person reads the wording before it is kept",
    AgreementUpdate: "design: an agreement's wording is edited in the document editor with its fields beside it",
    AgreementSend: "design: Send for Signature asks the person to confirm each signer and address on screen",
    SignerInput: "design: a signer is confirmed on Send for Signature, beside the agreement it signs",
    SignedCopyRecord: "file: Record Signed Copy uploads the signed scan",
    AgreementRenew: "design: the next term's dates and deal are chosen on screen beside the agreement it renews",
    AgreementClose: "design: closing ends its approval and its signing links, so the person confirms it with the agreement in view",
    SignSubmit: "secret: a signature is the signer's own, made on the signing page behind the code emailed to them",
    SignCodeVerify: "secret: the signing code is emailed to the signer and entered only by them",
    SignDecline: "secret: declining is the signer's own, on the signing page their link opens",
  },
  reads: [
    {
      key: "agreements.list",
      description: "List partnership agreements, MOUs and contracts: number, title, the lead or partner, kind, status (draft to signed, active, expiring, renewed, closed), term, renewal date and owner",
      params: c.agreements.AgreementListQuery,
      permission: ["partnerships", "view"],
      run: (_client, params, actor) => service.list(params, actor.scope),
      cite,
    },
    {
      key: "agreements.renewals",
      description: "Signed agreements coming up for renewal: number, title, the partner, when each ends, its renewal date and the days left, soonest first",
      params: c.agreements.RenewalQuery,
      permission: ["partnerships", "view"],
      run: (_client, params, actor) => service.renewals(params, actor.scope),
      cite,
    },
  ],
  routes: [
    { intent: "see agreements, MOUs and contracts, or which renewals are due", screen: "partnerships.contracts-and-mous" },
    { intent: "generate, send or renew an agreement", screen: "partnerships.contracts-and-mous" },
  ],
});
