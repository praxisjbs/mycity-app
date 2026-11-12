"use strict";
/**
 * What the assistant may read and do about offers (docs/guides/offers.md §9): the offers the asker
 * may see, by the same scope the screen keeps (the vacancy's hiring manager), a page of 25 at a time,
 * with each offer's status, role and expiry; never the letter.
 *
 *   offers.create   New Offer as a card the person confirms: a shortlisted candidate, the start date
 *                   and the monthly basic salary (with the reason, when it sits outside the vacancy's
 *                   range: refused without one, as the form is); every other term starts from the
 *                   vacancy, and the draft is finished on Offers before it goes for approval.
 *
 * Approving, signing, sending and withdrawing stay on the screen: an approval is the approver's own
 * decision, a signature is the signer's own act, and a link goes to a candidate.
 */
const c = require("@mycity/contract");
const { defineManifest } = require("../../shared/ai/manifest");
const routeMap = require("../../shared/route-map");
const service = require("./offers.service");

const offersPath = routeMap.screenPath("recruitment", "offers");
const cite = (row) => ({ type: "offer", id: row.offer_id, label: `${row.number}, ${row.candidate_name}` });

module.exports = defineManifest({
  module: "recruitment",
  // Every create and edit form of this module's contract, and why the chat does not fill it (gate 23).
  not_offered: {
    OfferCreate: "via offers.create: the card carries the candidate, start date and basic salary (OfferCard); the rest is finished on Offers",
    OfferEdit: "design: a draft's pay lines, wording and Schedule A are finished on the offer's own sheet",
    OfferSignatorySave: "design: who signs offers for the company is named on the Offers settings",
    OfferLetterTemplateSave: "design: the standard offer letter is worded whole on the Offers settings, checked against its variables",
  },
  actions: [
    {
      key: "offers.create",
      label: "Create Offer",
      description: "Draft an offer for a shortlisted candidate: the start date and the monthly basic salary; the rest starts from the vacancy",
      input: c.offers.OfferCard,
      permission: ["recruitment", "create"],
      risk: "standard",
      form: "none: New Offer takes every term at once; the card carries the first three and the draft is finished on Offers",
      asks: [
        { field: "application_id", question: "Which candidate is it for?", read: "candidates.list", params: { stage: "shortlist", status: "active" }, type: "candidate" },
        { field: "start_date", question: "When do they start?" },
        { field: "basic_salary", question: "What is the monthly basic salary?" },
      ],
      run: (values, actor) => service.createFromCard(actor, actor.scope, values),
      readback: (offer) => [{ type: "offer", id: offer.offer_id, label: `${offer.number}, ${offer.candidate_name}`, status: "draft", link: offersPath }],
      labels: {
        application_id: "Candidate",
        start_date: "Start Date",
        basic_salary: "Basic Salary (Monthly)",
        job_title: "Job Title",
        range_reason: "Reason Outside Range",
      },
    },
  ],
  reads: [
    {
      key: "offers.list",
      description: "List offers: the candidate, role, status, monthly pay outside the range or not, when sent and when it expires",
      params: c.offers.OfferListQuery,
      permission: ["recruitment", "view"],
      run: (_client, params, actor) => service.list(params, actor, actor.scope),
      cite,
    },
  ],
  routes: [
    { intent: "make an offer to a candidate", screen: "recruitment.offers", params: { new: "1" } },
    { intent: "see offers waiting to be sent", screen: "recruitment.offers", params: { status: "approved" } },
    { intent: "change who signs offers for the company", screen: "recruitment.offers", params: { panel: "settings" } },
  ],
});
