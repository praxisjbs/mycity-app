"use strict";
/**
 * The blind card (docs/guides/recruitment.md §3 step 9, §6.6): each panelist's own card, saved as they
 * go and submitted once. While the round is open nobody else reads it, the hiring manager and the CEO
 * included (interviews.repo.js BLIND); private notes stay the author's always.
 *
 *   save(actor, id, body)    the reader's own draft: ratings for the vacancy's traits (1 to 10), or one
 *                            overall rating when it has none, a decision, comments (Others), notes
 *   submit(actor, id)        needs every trait rated (or the overall rating) and a decision; locks the
 *                            card; the last card to arrive closes the round (interviews.consolidate)
 *
 * Only a panelist of the interview writes here, whatever their grant (`recruitment` view is enough:
 * a seat on the panel is the permission).
 */
const { pool } = require("../../config/db");
const { atomically } = require("../../shared/db/tx");
const { AppError } = require("../../shared/errors");
const { emit } = require("../../shared/events/emit");
const vacancyRepo = require("../vacancies/vacancies.repo");
const repo = require("./interviews.repo");
const consolidate = require("./interviews.consolidate");
const { EVENTS } = require("./interviews.events");

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

const field = (name, message) => new AppError("VALIDATION_FAILED", message, 422, { [name]: [message] });

/** The vacancy's traits in use: what a card rates. */
async function traitsOf(db, vacancyId) {
  return (await vacancyRepo.questions(db, vacancyId)).filter((q) => q.active && q.purpose === "interview");
}

/** The reader's seat on a live interview, its round open and their card not yet submitted. */
async function mySeat(client, id, actor) {
  const row = await repo.get(client, id, actor.employee_id, { lock: true });
  if (!row || !row.on_panel) throw new AppError("NOT_FOUND", "That interview does not exist", 404);
  if (row.status === "cancelled" || row.round_status !== "open")
    throw new AppError("ROUND_CLOSED", "This round is closed, so its cards are final", 409);
  const seat = await repo.myFeedback(client, id, actor.employee_id);
  if (seat.submitted_at || seat.seat_submitted_at) throw new AppError("CARD_SUBMITTED", "Your card is submitted and cannot change", 409);
  return { row, seat };
}

async function save(actor, id, body) {
  return tx(async (client) => {
    const { row, seat } = await mySeat(client, id, actor);
    const traits = await traitsOf(client, row.vacancy_id);
    const known = new Set(traits.map((t) => t.vacancy_question_id));
    if (body.ratings) {
      const fields = {};
      body.ratings.forEach((r, i) => {
        if (!known.has(r.vacancy_question_id)) fields[`ratings.${i}.vacancy_question_id`] = ["Not a trait of this role"];
      });
      if (Object.keys(fields).length) throw new AppError("VALIDATION_FAILED", "Check the ratings", 422, fields);
    }
    if (body.overall_rating !== undefined && body.overall_rating !== null && traits.length)
      throw field("overall_rating", "Rate each trait instead");
    const feedbackId = await repo.saveFeedback(client, seat.interview_panelist_id, body);
    for (const r of body.ratings || []) {
      if (r.rating === null) await repo.clearRating(client, feedbackId, r.vacancy_question_id);
      else await repo.saveRating(client, feedbackId, r.vacancy_question_id, r.rating);
    }
    return id;
  });
}

async function submit(actor, id) {
  return tx(async (client) => {
    const { row, seat } = await mySeat(client, id, actor);
    const traits = await traitsOf(client, row.vacancy_id);
    const mine = await repo.myFeedback(client, id, actor.employee_id);
    const fields = {};
    if (!mine.interview_feedback_id || !mine.decision) fields.decision = ["Give your decision"];
    if (traits.length) {
      const rated = new Set((mine.ratings || []).map((r) => r.vacancy_question_id));
      const missing = traits.filter((t) => !rated.has(t.vacancy_question_id));
      if (missing.length) fields.ratings = [`Rate ${missing.length === 1 ? "the last trait" : `${missing.length} more traits`}`];
    } else if (!mine.overall_rating) {
      fields.overall_rating = ["Give a rating"];
    }
    if (Object.keys(fields).length) throw new AppError("VALIDATION_FAILED", "Finish your card first", 422, fields);
    await repo.submitFeedback(client, seat.interview_panelist_id);
    await emit(client, {
      key: EVENTS.INTERVIEW_FEEDBACK_SUBMITTED,
      entity: { type: "interview", id },
      actor,
      payload: { interview_id: id, application_number: row.application_number },
    });
    // The last card closes the round.
    const fresh = await repo.get(client, id, actor.employee_id);
    if (fresh.submitted_count === fresh.panel_size) await consolidate.closeIn(client, fresh, actor);
    return id;
  });
}

module.exports = { save, submit, traitsOf };
