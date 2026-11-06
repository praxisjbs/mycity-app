"use strict";
/**
 * Scoring an assessment (docs/guides/recruitment.md §6.7), with no database:
 *
 *   keyOf(options)               a choice's options as kept: { options: [{id, text}], key: {id: points} }
 *   maxOf(question)              the most a question can score: a choice's best option, else its max_score
 *   scoringMethod(questions)     auto (all choice), manual (no choice), mixed
 *   award(question, answer, key) a choice answer's points; null for a written or file answer (marked by hand)
 *   scoreOf(questions, awards)   Σ awarded ÷ Σ max × 100, one decimal, once every answer has a mark; an
 *                                unanswered question counts zero; null while any answer waits for a mark
 *
 * The candidate never sees a score, a key or an option's points: the key lives only in
 * answer_key_enc (encrypted, bound to the question's id) and these functions.
 */
const crypto = require("node:crypto");
const encryption = require("../../services/secrets/encryption.service");

/** The record a key is bound to: a key copied onto another question fails to decrypt there. */
const aadOf = (questionId) => `assessment_question:${questionId}:answer_key`;

/** A choice's key ({option id: points}) as kept in answer_key_enc. */
const sealKey = (questionId, key) => encryption.encrypt(JSON.stringify(key), { aad: aadOf(questionId) });

/** The key back, or {} when there is none. */
const openKey = (questionId, enc) => (enc ? JSON.parse(encryption.decrypt(enc, { aad: aadOf(questionId) })) : {});

const round1 = (n) => Math.round(n * 10) / 10;

/** Options as the form sends them ({text, points}) → what is stored, and the key kept apart. */
function keyOf(options) {
  const kept = [];
  const key = {};
  for (const o of options || []) {
    const id = crypto.randomBytes(6).toString("base64url");
    kept.push({ id, text: o.text });
    key[id] = o.points;
  }
  return { options: kept, key };
}

function maxOf(q) {
  if (q.question_type === "choice") return Math.max(...(q.options || []).map((o) => Number(o.points) || 0), 0);
  return Number(q.max_score);
}

function scoringMethod(questions) {
  const choice = questions.filter((q) => q.question_type === "choice").length;
  if (choice === 0) return "manual";
  return choice === questions.length ? "auto" : "mixed";
}

/** A choice answer's points from the key; null for an answer marked by hand. */
function award(q, answer, key) {
  if (q.question_type !== "choice") return null;
  if (answer === null || answer === undefined || answer === "") return 0;
  const points = key && Object.prototype.hasOwnProperty.call(key, answer) ? Number(key[answer]) : 0;
  return Number.isFinite(points) ? points : 0;
}

/**
 * @param {Array<{assessment_question_id: string, max_score: number|string}>} questions
 * @param {Map<string, {answered: boolean, awarded: number|null}>} awards  by question id
 * @returns {number|null}
 */
function scoreOf(questions, awards) {
  let got = 0;
  let max = 0;
  for (const q of questions) {
    max += Number(q.max_score);
    const a = awards.get(q.assessment_question_id);
    if (!a || !a.answered) continue;
    if (a.awarded === null || a.awarded === undefined) return null;
    got += Number(a.awarded);
  }
  return max > 0 ? round1((got / max) * 100) : 0;
}

module.exports = { keyOf, maxOf, scoringMethod, award, scoreOf, round1, sealKey, openKey };
