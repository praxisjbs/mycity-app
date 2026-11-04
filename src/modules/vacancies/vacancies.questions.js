"use strict";
/**
 * A vacancy's questions (docs/guides/recruitment.md §3 step 3, §5): the Apply questions a candidate
 * answers, and the interview traits each panelist rates from 1 to 10 (purpose interview, type
 * rating). The form sends the whole set in order; this file turns it into rows.
 *
 *   save(client, vacancyId, questions)   replace the set: an id keeps a question, a new one is added,
 *                                        one left out is deleted, or retired when it has been answered
 *                                        on an application or rated on a card (never deleted, so the
 *                                        answer or rating keeps its question)
 *   fromTraits(traits)                   New Vacancy's traits from Careers Settings' Default Traits
 */
const { AppError } = require("../../shared/errors");
const repo = require("./vacancies.repo");

/** A trait as the questions form sends it. */
const traitQuestion = (prompt) => ({ purpose: "interview", question_type: "rating", prompt, required: true });

/** New Vacancy's interview traits, in Careers Settings' order. */
const fromTraits = (traits) => (traits || []).map(traitQuestion);

/**
 * Replace a vacancy's questions with `questions`, in order; ids name existing questions.
 * @param {import("pg").PoolClient} client  inside the save's transaction
 * @param {string} vacancyId
 * @param {Array<{vacancy_question_id?: string, purpose: string, question_type: string, prompt: string,
 *   options?: string[], required?: boolean}>} questions
 */
async function save(client, vacancyId, questions) {
  const inUse = await repo.questionsInUse(client, vacancyId);
  const keep = [];
  const order = { application: 0, interview: 0 };
  for (const q of questions) {
    const n = order[q.purpose];
    order[q.purpose] += 1;
    const row = { ...q, required: q.required !== false };
    if (q.vacancy_question_id) {
      const ok = await repo.updateQuestion(client, vacancyId, q.vacancy_question_id, row, n);
      if (!ok)
        throw new AppError("VALIDATION_FAILED", "A question does not belong to this vacancy", 422, {
          questions: ["A question does not belong to this vacancy"],
        });
      keep.push(q.vacancy_question_id);
    } else {
      keep.push(await repo.insertQuestion(client, vacancyId, row, n));
    }
  }
  await repo.dropQuestions(client, vacancyId, keep, inUse);
}

module.exports = { save, fromTraits, traitQuestion };
