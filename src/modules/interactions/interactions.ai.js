"use strict";
/**
 * What the assistant may read and do about interactions (docs/guides/partnerships.md §9, §6.12): a
 * record's calls, meetings, emails, visits and notes the asker may see, a page of 25 at a time; and,
 * as a card the person confirms (docs/guides/praxis-ai.md §6.11, decision 33), Log Interaction,
 * through its form's own request and the screen's own service function. A linked mail thread is
 * logged by the mailbox binding (M7 PR 8), never by a card. Summary: the interactions in figures by type,
 * by person as stacked bars of type, and by month or week (praxis-ai.md §6.13, Partnerships).
 */
const c = require("@mycity/contract");
const { defineManifest } = require("../../shared/ai/manifest");
const routeMap = require("../../shared/route-map");
const pipeline = require("../partner_pipeline/partner_pipeline.service");
const service = require("./interactions.service");

const link = (i) => (routeMap.linkFor(i.partner_id ? "partner" : "lead", i.partner_id || i.lead_id) || {}).path || null;

module.exports = defineManifest({
  module: "partnerships",
  actions: [
    {
      key: "interactions.log",
      label: "Log Interaction",
      description: "Log a call, meeting, email, visit or note with a partner or a lead: when it happened (never ahead), a subject and a summary of 10 characters or more",
      input: c.interactions.InteractionCreate,
      permission: ["partnerships", "create"],
      risk: "standard",
      names: (values, _actor, db) => pipeline.cardNames(db, values),
      asks: [
        { field: "partner_id", question: "Which partner was it with?", read: "partners.list" },
        { field: "interaction_type", question: "What kind was it?", choices: ["Call", "Meeting", "Email", "Visit", "Note"] },
        { field: "occurred_at", question: "When did it happen?" },
        { field: "subject", question: "What was it about?" },
        { field: "summary", question: "What was said or agreed?" },
      ],
      run: (values, actor) => service.create(actor, actor.scope, values),
      readback: (i) => [{ type: "partner_interaction", id: i.partner_interaction_id, label: i.subject, status: "logged", link: link(i) }],
      labels: { partner_id: "Partner", lead_id: "Lead", deal_id: "Deal", contact_id: "Contact", interaction_type: "Kind", occurred_at: "When", subject: "Subject", summary: "Summary" },
    },
  ],
  reads: [
    {
      key: "interactions.list",
      summary: "interactions.summary",
      description: "List a partner's or lead's calls, meetings, emails, visits and notes, newest first: kind, subject, summary, when and who logged it",
      params: c.interactions.InteractionListQuery,
      permission: ["partnerships", "view"],
      run: (_client, params, actor) => service.list(params, actor.scope),
      cite: (row) => ({ type: "partner_interaction", id: row.partner_interaction_id, label: row.subject }),
    },
  ],
  summaries: [
    {
      key: "interactions.summary",
      description:
        "Interactions in figures: calls, meetings, emails, visits, notes, who logged them, partners and leads reached; by type, by person stacked by type, most reached; by month or week",
      params: c.interactions.InteractionSummaryQuery,
      permission: ["partnerships", "view"],
      run: (client, params, actor) => service.aiSummary(client, params, actor.scope),
    },
  ],
  routes: [{ intent: "log a call or meeting with a partner", screen: "partnerships.partners" }],
});
