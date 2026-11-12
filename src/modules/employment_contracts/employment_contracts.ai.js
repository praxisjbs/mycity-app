"use strict";
/**
 * What the assistant may read and do about employment contracts (docs/guides/offers.md §9): whether
 * a hire's contract is waiting, sent or signed, by the same scope the screen keeps (the vacancy's
 * hiring manager); never the contract's text, which is personal and sits behind the record.
 *
 * Nothing here acts. A contract is made by the offer's acceptance, not by a person; signing it for
 * the company is the signer's own act, on the screen; and its link goes to the hire. M5 registers no
 * AI job: the contract is the template plus the offer's terms, never drafted by a model
 * (handoff decision 7).
 */
const { defineManifest } = require("../../shared/ai/manifest");

module.exports = defineManifest({
  module: "recruitment",
  // Every create and edit form of this module's contract, and why the chat does not fill it (gate 23).
  not_offered: {
    ContractTemplateSave:
      "design: the standard contract is worded whole on the Onboarding tab's Contract settings, checked against its variables",
  },
  actions: [],
  reads: [],
  routes: [
    { intent: "sign an employment contract for the company", screen: "recruitment.onboarding" },
    { intent: "check whether a hire has signed their contract", screen: "recruitment.onboarding" },
  ],
});
