"use strict";
/**
 * What the assistant may read about interviews (docs/guides/recruitment.md §9): the interviews the asker
 * may see (the vacancy's hiring manager in their scope, or a seat on the panel), upcoming or past, and
 * whether each panelist has submitted. It never reads a card: the list carries no rating, decision or
 * note, so the panel stays blind in the chat as on the screen. It takes no action here. Its summary
 * counts the same interviews in figures, and who has submitted, never what (praxis-ai.md §6.13).
 */
const c = require("@mycity/contract");
const { defineManifest } = require("../../shared/ai/manifest");
const service = require("./interviews.service");

module.exports = defineManifest({
  module: "recruitment",
  actions: [],
  // Every create and edit form of this module's contract, and why the chat does not fill it (gate 23).
  not_offered: {
    FeedbackSave: "personal: a panelist's card is their own judgement, blind while the round is open",
    RoundDetailsSave: "personal: the Candidate Details are filled on the interview card",
  },
  reads: [
    {
      key: "interviews.list",
      summary: "interviews.summary",
      description:
        "List interviews: the candidate, role, type, time, status, the round's state, panel size and how many panelists have submitted (never a rating)",
      params: c.interviews.InterviewListQuery,
      permission: ["recruitment", "view"],
      run: (_client, params, actor) => service.list(params, actor, actor.scope),
      cite: (row) => ({ type: "interview", id: row.interview_id, label: `${row.candidate_name}, ${row.vacancy.title}` }),
    },
  ],
  summaries: [
    {
      key: "interviews.summary",
      description: "Interviews in figures: upcoming, awaiting feedback, held, cancelled; by status, held ones by outcome, each interviewer's cards submitted and waiting, by week",
      params: c.interviews.InterviewSummaryQuery,
      permission: ["recruitment", "view"],
      run: (client, params, actor) => service.aiSummary(client, params, actor),
    },
  ],
  routes: [
    { intent: "schedule an interview", screen: "recruitment.interviews", params: { new: "1" } },
    { intent: "fill in my interview card", screen: "recruitment.interviews", params: { mine: "true" } },
  ],
});
