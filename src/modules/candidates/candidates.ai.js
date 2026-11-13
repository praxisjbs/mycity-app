"use strict";
/**
 * What the assistant may read about candidates (docs/guides/recruitment.md §9): the board as the
 * asker may see it, by the same scope the screen keeps (the vacancy's hiring manager, guide §8), one
 * page of 25 at a time, with each card's weighted total and whether its screening score is the
 * estimate; and one candidate's sheet. It takes no action here: every candidate form is a person's
 * own judgement of a person, made on the screen.
 */
const c = require("@mycity/contract");
const { defineManifest } = require("../../shared/ai/manifest");
const service = require("./candidates.service");
const { probeFor, applicationFor } = require("../vacancies/vacancies.matrix");

const cite = (row) => ({ type: "candidate", id: row.application_id, label: `${row.number}, ${row.name}` });

module.exports = defineManifest({
  module: "recruitment",
  actions: [],
  // Every create and edit form of this module's contract, and why the chat does not fill it (gate 23).
  not_offered: {
    CandidateMove: "personal: moving a candidate is a person's judgement of a person, made on the board",
    CandidateNotProgressed: "personal: stopping a candidate, with the reason they are given, is made on their sheet",
    ScoreAll: "ai: Screen With AI is itself an AI read, pressed on Candidates",
    ApplyInvite: "personal: inviting a named person to apply is sent from Candidates",
    CandidateEmailSave: "design: a candidate email is worded whole on Candidate Emails, checked against its variables",
    ApplicationSubmit: "personal: only the candidate applies, on the public Apply form",
  },
  reads: [
    {
      key: "candidates.list",
      summary: "candidates.summary",
      description:
        "List candidates: the role, stage and status of each application, its screening score (and whether it is the provisional estimate), weighted total and days at stage",
      params: c.candidates.CandidateListQuery,
      permission: ["recruitment", "view"],
      run: (_client, params, actor) => service.list(params, actor.scope),
      cite,
      // An application to a role the asker manages is listed; one to the outsider's role never is.
      matrix: probeFor(async (v, ctx) => {
        const a = await applicationFor(v, ctx.role);
        return { type: "candidate", id: a.application_id, params: { vacancy_id: v.vacancy_id } };
      }),
    },
    {
      key: "candidates.get",
      summary: "none: one record",
      description: "One candidate: their answers, scores and scorecard parts, assessments, interviews and stage history",
      params: c.common.IdParams,
      permission: ["recruitment", "view"],
      run: (_client, params, actor) => service.get(params.id, actor, actor.scope),
      cite,
    },
  ],
  summaries: [
    {
      key: "candidates.summary",
      description: "Candidates in figures: in progress, hired, not progressing; the funnel by stage, each vacancy by stage as stacked bars, by source, applications by month or week",
      params: c.candidates.ApplicationSummaryQuery,
      permission: ["recruitment", "view"],
      run: (client, params, actor) => service.aiSummary(client, params, actor.scope),
      // An application to a role the asker manages is counted; one to the outsider's role never is (praxis-ai.md §6.17).
      matrix: probeFor(async (v, ctx) => {
        const a = await applicationFor(v, `${ctx.role} summary`);
        return { type: "candidate", id: a.application_id };
      }),
    },
  ],
  routes: [
    { intent: "invite someone to apply for a vacancy", screen: "recruitment.candidates", params: { invite: "1" } },
    { intent: "screen a role's applications with AI", screen: "recruitment.candidates" },
    { intent: "change the wording of a candidate email", screen: "recruitment.vacancies", params: { panel: "emails" } },
  ],
});
