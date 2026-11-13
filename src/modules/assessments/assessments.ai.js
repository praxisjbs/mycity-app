"use strict";
/**
 * What the assistant may read about assessments (docs/guides/recruitment.md §9): the library, and the
 * sittings as the asker may see them (the vacancy's hiring manager, guide §8), one page of 25 at a
 * time, with those waiting to be marked found by `marking`. It never reads an answer or a key, and
 * takes no action here: questions are designed whole, a sitting is a person's decision about a
 * candidate, and a mark is a person's judgement. Its summary counts the sittings in figures (praxis-ai.md
 * §6.13), never an answer.
 */
const c = require("@mycity/contract");
const { defineManifest } = require("../../shared/ai/manifest");
const authoring = require("./assessments.authoring");
const service = require("./assessments.service");
const { probeFor, sittingFor } = require("../vacancies/vacancies.matrix");

module.exports = defineManifest({
  module: "recruitment",
  actions: [],
  // Every create and edit form of this module's contract, and why the chat does not fill it (gate 23).
  not_offered: {
    AssessmentCreate: "design: an assessment is designed with its questions, on Assessments",
    AssessmentEdit: "design: an assessment is designed with its questions, on Assessments",
    AssessmentQuestionsSave: "design: the questions and their points are designed whole, with all of them in view",
    AnswerSave: "personal: only the candidate answers, on the public assessment page",
  },
  reads: [
    {
      key: "assessments.list",
      summary: "none: configuration; charted from its table (decision 50)",
      description: "List assessments: each one's type, whether it is timed, how many questions, whether it is on, how often it was sent and its average score",
      params: c.assessments.AssessmentListQuery,
      permission: ["recruitment", "view"],
      run: (_client, params) => authoring.list(params),
      cite: (row) => ({ type: "assessment", id: row.assessment_definition_id, label: `${row.code}, ${row.name}` }),
    },
    {
      key: "assessments.sittings",
      summary: "assessments.summary",
      description: "List assessment sittings: candidate, role, assessment, status, start-by day, score, and how many answers wait to be marked (marking=true for those)",
      params: c.assessments.SittingListQuery,
      permission: ["recruitment", "view"],
      run: (_client, params, actor) => service.sittings(params, actor.scope),
      // A sitting for a role the asker manages is listed; one for the outsider's role never is.
      matrix: probeFor(async (v, ctx) => {
        const { sitting, application } = await sittingFor(v, ctx);
        return { type: "application_assessment", id: sitting.application_assessment_id, params: { application_id: application.application_id } };
      }),
      // The sitting itself: it opens on Assessments · Sittings (route map application_assessment).
      cite: (row) => ({ type: "application_assessment", id: row.application_assessment_id, label: `${row.assessment_name}, ${row.candidate_name}` }),
    },
  ],
  summaries: [
    {
      key: "assessments.summary",
      description: "Assessment sittings in figures: not started, in progress, waiting to be marked, scored; the average score by assessment, by status, sent by month",
      params: c.assessments.SittingSummaryQuery,
      permission: ["recruitment", "view"],
      run: (client, params, actor) => service.aiSummary(client, params, actor.scope),
      // A sitting for a role the asker manages is counted; one for the outsider's role never is (praxis-ai.md §6.17).
      matrix: probeFor(async (v, ctx) => {
        const { sitting } = await sittingFor(v, ctx);
        return { type: "application_assessment", id: sitting.application_assessment_id };
      }),
    },
  ],
  routes: [
    { intent: "write a new assessment", screen: "recruitment.assessments", params: { new: "1" } },
    { intent: "mark the answers of finished assessments", screen: "recruitment.assessments", params: { marking: "true" } },
    { intent: "send an assessment to the candidates of a role", screen: "recruitment.assessments" },
  ],
});
