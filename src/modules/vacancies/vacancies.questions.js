"use strict";
/**
 * A vacancy's questions (docs/guides/recruitment.md §3 step 3, §5): the Apply questions a candidate
 * answers, and the interview traits each panelist rates from 1 to 10 (purpose interview, type
 * rating). The form sends the whole set in order; this file turns it into rows.
 *
 *   save(client, vacancyId, questions)   replace the set: an id keeps a question, a new one is added,
 *                                        one left out is deleted, or retired when it has been answered
 *                                        on an application or rated on a card (never deleted, so the
 *                                        answer or rating keeps its question). An answered question
 *                                        whose words, type or options change is retired too, and the
 *                                        new wording added as a new question: an answer always keeps
 *                                        the question it answered
 *   fromTraits(traits)                   New Vacancy's traits from Careers Settings' Default Traits
 */
const { AppError } = require("../../shared/errors");
const repo = require("./vacancies.repo");

/** A trait as the questions form sends it. */
const traitQuestion = (prompt) => ({ purpose: "interview", question_type: "rating", prompt, required: true });

/** Whether a question's meaning changed: its purpose, type, words or options. */
function reworded(old, q) {
  const options = (o) => JSON.stringify(Array.isArray(o) ? o : null);
  return (
    old.purpose !== q.purpose ||
    old.question_type !== q.question_type ||
    old.prompt.trim() !== q.prompt.trim() ||
    options(old.options) !== options(q.options)
  );
}

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
  const before = new Map((await repo.questions(client, vacancyId)).map((q) => [q.vacancy_question_id, q]));
  const keep = [];
  const order = { application: 0, interview: 0 };
  for (const q of questions) {
    const n = order[q.purpose];
    order[q.purpose] += 1;
    const row = { ...q, required: q.required !== false };
    const old = q.vacancy_question_id ? before.get(q.vacancy_question_id) : null;
    if (old && inUse.has(old.vacancy_question_id) && reworded(old, row)) {
      await repo.retireQuestion(client, old.vacancy_question_id);
      keep.push(await repo.insertQuestion(client, vacancyId, row, n));
    } else if (q.vacancy_question_id) {
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
