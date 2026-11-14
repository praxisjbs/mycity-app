"use strict";
/**
 * What the assistant may read and do about proposals (docs/guides/partnerships.md §9): the proposals
 * the asker may see, a page of 25 at a time, by the rule Proposals keeps (a proposal follows its deal,
 * §6.1); and, as a card the person confirms (docs/guides/praxis-ai.md §6.11, decision 33), New
 * Proposal: the deal and the notes from the conversation, which open the Proposal Studio with that
 * brief while Claude asks its questions. "Write a proposal for X" offers the card or opens the studio.
 * Summary: the proposals in figures, by status and value, and each owner's sent proposals as stacked
 * bars of their outcome (praxis-ai.md §6.13, Partnerships).
 *
 * Nothing else about a proposal is done from the chat: its questions, pages and Send are the studio's,
 * where the person reads what Claude wrote and confirms where it goes (§6.10); proof points and saved
 * templates are MyCity's own facts and structures, kept on Categories with the whole set in view.
 */
const c = require("@mycity/contract");
const { defineManifest } = require("../../shared/ai/manifest");
const { parseBody } = require("../../shared/http/validate");
const routeMap = require("../../shared/route-map");
const pipeline = require("../partner_pipeline/partner_pipeline.service");
const service = require("./proposals.service");

const link = (id) => (routeMap.linkFor("proposal", id) || {}).path || null;
const cite = (row) => ({ type: "proposal", id: row.partnership_proposal_id, label: `${row.number} ${row.title || ""}`.trim() });

module.exports = defineManifest({
  module: "partnerships",
  actions: [
    {
      key: "proposals.start",
      label: "Start Proposal",
      description: "Start a partnership proposal on a deal with notes from the meeting; the Proposal Studio opens with that brief and Claude's questions",
      input: c.proposals.ProposalBriefAdd,
      permission: ["partnerships", "create"],
      risk: "standard",
      form: "none: New Proposal's brief also takes a transcript and images, files the chat cannot carry; the card is the deal and the notes (ProposalBriefAdd)",
      names: (values, _actor, db) => pipeline.cardNames(db, values),
      asks: [{ field: "deal_id", question: "Which deal is the proposal for?", read: "deals.list" }],
      records: (values) => (values.deal_id ? [{ type: "partner_deal", id: values.deal_id }] : []),
      check: async (client, values, actor) => {
        if (values.deal_id) await pipeline.assertSeen(client, values.deal_id, actor.scope);
      },
      run: (values, actor) => service.start(actor, parseBody(c.proposals.ProposalStart, { deal_id: values.deal_id, notes: values.notes }), actor.scope),
      readback: (p) => [{ type: "proposal", id: p.partnership_proposal_id, label: `${p.number} ${p.title || ""}`.trim(), status: "started", link: link(p.partnership_proposal_id) }],
      labels: { deal_id: "Deal", notes: "Notes" },
    },
  ],
  not_offered: {
    ProposalContentEdit: "design: a proposal's pages are edited in the studio beside the page as the partner will see it",
    ProposalTemplateSave: "design: a proposal's layouts are saved as a template from the studio, with the proposal in view",
    ProofPointCreate: "design: proof points are MyCity's own facts, entered on Categories with the whole set in view",
    ProofPointUpdate: "design: a proof point is changed and retired on Categories with the whole set in view",
  },
  reads: [
    {
      key: "proposals.list",
      summary: "proposals.summary",
      description: "List partnership proposals: number, title, the lead or partner, deal, status (brief to sent, viewed, accepted, declined), value, when sent and how often viewed",
      params: c.proposals.ProposalListQuery,
      permission: ["partnerships", "view"],
      run: (_client, params, actor) => service.list(params, actor.scope),
      cite,
    },
  ],
  summaries: [
    {
      key: "proposals.summary",
      description:
        "Proposals in figures: sent, viewed, accepted, declined, expired, acceptance rate, value sent and accepted; by status and value; by owner stacked by outcome; sent and accepted by month",
      params: c.proposals.ProposalSummaryQuery,
      permission: ["partnerships", "view"],
      run: (client, params, actor) => service.aiSummary(client, params, actor.scope),
    },
  ],
  routes: [
    { intent: "write a proposal for a partner or lead", screen: "partnerships.proposals", params: { action: "new" } },
    { intent: "see proposals sent, viewed, accepted or declined", screen: "partnerships.proposals" },
  ],
});
