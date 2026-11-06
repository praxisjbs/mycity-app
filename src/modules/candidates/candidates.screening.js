"use strict";
/**
 * Screening, the free tier (docs/guides/recruitment.md §6.4): the estimate, arithmetic, made at
 * submit and kept as provisional_score. It is the mean of the parts that have something to say;
 * a part with nothing to say is left out, never scored as zero.
 *
 *   experience     the years given against the vacancy's minimum, capped at 100, in proportion
 *                  below it; a role with no minimum gives 100 for any experience
 *   completeness   a third each: a CV, a link among the answers (a portfolio), a cover letter of
 *                  more than 40 characters
 *   required       the share of the vacancy's required yes or no questions answered yes
 *
 * The AI read (cv-screen) is candidates.score.js. Neither score moves anyone.
 */
const LINK = /\bhttps?:\/\/\S+/i;

/** One decimal. */
const round1 = (n) => Math.round(n * 10) / 10;

/**
 * @param {{years_experience: number|null, cv: boolean, cover_letter: string|null, answers: Record<string, string>}} app
 * @param {{min_experience_years: number|null}} vacancy
 * @param {Array<{vacancy_question_id: string, question_type: string, required: boolean}>} questions  the Apply questions
 * @returns {number|null} 0 to 100, or null when no part had anything to say
 */
function estimate(app, vacancy, questions) {
  const parts = [];
  if (app.years_experience !== null && app.years_experience !== undefined) {
    const min = vacancy.min_experience_years;
    parts.push(!min ? 100 : Math.min(100, (app.years_experience / min) * 100));
  }
  const answers = app.answers || {};
  const linked = Object.values(answers).some((a) => LINK.test(String(a)));
  const letter = (app.cover_letter || "").trim().length > 40;
  parts.push(((app.cv ? 1 : 0) + (linked ? 1 : 0) + (letter ? 1 : 0)) * (100 / 3));
  const yesNo = questions.filter((q) => q.required && q.question_type === "yes_no");
  if (yesNo.length) {
    const yes = yesNo.filter((q) => String(answers[q.vacancy_question_id] || "").toLowerCase() === "yes").length;
    parts.push((yes / yesNo.length) * 100);
  }
  return parts.length ? round1(parts.reduce((a, b) => a + b, 0) / parts.length) : null;
}

/** The score a surface shows, and whether it is the estimate (§6.4: Provisional beside it). */
function shown(row) {
  if (row.screening_score !== null && row.screening_score !== undefined)
    return { score: Number(row.screening_score), provisional: false };
  if (row.provisional_score !== null && row.provisional_score !== undefined)
    return { score: Number(row.provisional_score), provisional: true };
  return { score: null, provisional: false };
}

module.exports = { estimate, shown, round1 };
