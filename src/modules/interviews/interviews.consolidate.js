"use strict";
/**
 * The round after the panel (docs/guides/recruitment.md §3 steps 10 and 11, §6.6).
 *
 *   closeIn(client, row, actor)    close the round: its interview_score = the mean of the submitted
 *                                  cards' scores × 10, one decimal (a card's score is the mean of its
 *                                  ratings, or its overall rating); every submitted card becomes readable
 *                                  to those who may see the interview; drafts never are
 *   close(actor, scope, id)        Close Round, before every card is in
 *   report(actor, scope, id, body) the consolidated report and its decision, once closed, by
 *                                  `recruitment` edit in scope or the vacancy's hiring manager; each save
 *                                  makes a new Interview Assessment Form (documents.generate)
 *   details(actor, scope, id, body)  Candidate Details, filled once for the panel, not blind
 *
 * A closed round does not reopen.
 */
const { pool } = require("../../config/db");
const { atomically } = require("../../shared/db/tx");
const { AppError } = require("../../shared/errors");
const { emit } = require("../../shared/events/emit");
const { assertInScope } = require("../../shared/rbac/scope");
const { formatLongDate } = require("../../shared/time/day-first");
const documents = require("../../shared/documents/generate");
const vacancyRepo = require("../vacancies/vacancies.repo");
const repo = require("./interviews.repo");
const { EVENTS, FORM_DOC_TYPE } = require("./interviews.events");

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

const round1 = (n) => Math.round(n * 10) / 10;
const notFound = () => new AppError("NOT_FOUND", "That interview does not exist", 404);

/** The round's score from its submitted cards; null when none was submitted. */
function scoreOf(cards) {
  const scores = cards.map((c) => Number(c.score)).filter((n) => Number.isFinite(n));
  if (!scores.length) return null;
  return round1((scores.reduce((a, b) => a + b, 0) / scores.length) * 10);
}

async function closeIn(client, row, actor) {
  const score = scoreOf(await repo.cardScores(client, row.interview_id));
  await repo.closeRound(client, row.interview_round_id, { score, by: actor ? actor.user_id : null });
  await repo.updateInterview(client, row.interview_id, { status: row.status === "scheduled" ? "done" : row.status });
  await emit(client, {
    key: EVENTS.INTERVIEW_ROUND_CLOSED,
    entity: { type: "interview", id: row.interview_id },
    actor,
    payload: { interview_id: row.interview_id, application_number: row.application_number, interview_score: score },
  });
  return score;
}

/** An interview of the reader's scope, locked, or 404. */
async function scoped(client, id, actor, scope) {
  const row = await repo.get(client, id, actor.employee_id, { lock: true });
  if (!row) throw notFound();
  assertInScope(scope, row.hiring_manager_id);
  return row;
}

async function close(actor, scope, id) {
  return tx(async (client) => {
    const row = await scoped(client, id, actor, scope);
    if (row.round_status !== "open" || row.status === "cancelled")
      throw new AppError("ROUND_CLOSED", "This round is already closed", 409);
    await closeIn(client, row, actor);
    return id;
  });
}

const ACADEMICS = { outstanding: "Outstanding", very_good: "Very Good", good: "Good", average: "Average", poor: "Poor" };
const DECISIONS = { select: "Select", on_hold: "On Hold", reject: "Reject" };
const months = (n) => (n === null || n === undefined ? null : n === 1 ? "1 month" : `${n} months`);
/** The mean of the numbers given, or null when there are none. */
function mean(values) {
  const ns = values.map(Number).filter((n) => Number.isFinite(n));
  return ns.length ? ns.reduce((x, y) => x + y, 0) / ns.length : null;
}
const one = (n) => (n === null || n === undefined ? "Not rated" : String(round1(Number(n))));

/** InterviewAssessmentFormVars, every value in words, from what the closed round shows everyone. */
async function formData(client, row, reporterName) {
  const traits = (await vacancyRepo.questions(client, row.vacancy_id)).filter((q) => q.active && q.purpose === "interview");
  // Read as nobody in particular: only submitted cards of the closed round are shown (BLIND).
  const seats = (await repo.panel(client, row.interview_id, null)).filter((s) => s.shown && s.submitted_at);
  const averages = new Map((await repo.traitAverages(client, row.interview_id)).map((a) => [a.vacancy_question_id, a.average]));
  const ratingOf = (seat, qid) => ((seat.ratings || []).find((r) => r.vacancy_question_id === qid) || {}).rating;
  const scoreOfSeat = (seat) => {
    const rs = (seat.ratings || []).map((r) => Number(r.rating));
    return rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : seat.overall_rating;
  };
  return {
    candidate_name: row.candidate_name,
    position: row.vacancy_title,
    department: row.department || null,
    interview_date: formatLongDate(row.scheduled_start),
    round_title: row.title,
    current_employer: row.current_employer || null,
    academics: row.academics ? ACADEMICS[row.academics] : null,
    total_experience: months(row.total_experience_months),
    relevant_experience: months(row.relevant_experience_months),
    panelists: seats.map((s) => ({ name: s.panelist.display_name })),
    traits: traits.length
      ? traits.map((t) => ({
          prompt: t.prompt,
          ratings: seats.map((s) => ({ value: one(ratingOf(s, t.vacancy_question_id)) })),
          average: one(averages.get(t.vacancy_question_id)),
        }))
      : [{ prompt: "Overall Rating", ratings: seats.map((s) => ({ value: one(s.overall_rating) })), average: one(mean(seats.map((s) => s.overall_rating))) }],
    cards: seats.map((s) => ({ name: s.panelist.display_name, score: one(scoreOfSeat(s)), decision: DECISIONS[s.decision] || "Not given", comments: s.comments || null })),
    interview_score: row.interview_score === null || row.interview_score === undefined ? "Not scored" : String(round1(row.interview_score)),
    report: row.report,
    decision: DECISIONS[row.decision],
    reported_by: reporterName,
  };
}

async function report(actor, scope, id, body) {
  return tx(async (client) => {
    const row = await repo.get(client, id, actor.employee_id, { lock: true });
    if (!row) throw notFound();
    const isHiringManager = Boolean(actor.employee_id && row.hiring_manager_id === actor.employee_id);
    if (!isHiringManager) assertInScope(scope, row.hiring_manager_id);
    if (row.round_status !== "closed" || row.status === "cancelled")
      throw new AppError("ROUND_OPEN", "Write the report once the round is closed", 409);
    await repo.saveReport(client, row.interview_round_id, { report: body.report, decision: body.decision, by: actor.user_id });
    const after = await repo.get(client, id, actor.employee_id);
    const doc = await documents.generate(client, {
      doc_type: FORM_DOC_TYPE,
      entity: { type: "interview", id },
      data: await formData(client, after, after.reported_by_name || "Recruitment"),
      actor,
    });
    await repo.setForm(client, row.interview_round_id, doc.document_id);
    await emit(client, {
      key: EVENTS.INTERVIEW_REPORTED,
      entity: { type: "interview", id },
      actor,
      payload: { interview_id: id, application_number: row.application_number, decision: body.decision, document_id: doc.document_id },
    });
    return id;
  });
}

async function details(actor, scope, id, body) {
  return tx(async (client) => {
    const row = await scoped(client, id, actor, scope);
    if (row.status === "cancelled") throw new AppError("INTERVIEW_OVER", "This interview is cancelled", 409);
    const total = body.total_experience_months !== undefined ? body.total_experience_months : row.total_experience_months;
    const relevant = body.relevant_experience_months !== undefined ? body.relevant_experience_months : row.relevant_experience_months;
    if (typeof total === "number" && typeof relevant === "number" && relevant > total)
      throw new AppError("VALIDATION_FAILED", "More than the total", 422, { relevant_experience_months: ["More than the total"] });
    await repo.saveDetails(client, row.interview_round_id, body);
    await emit(client, {
      key: EVENTS.INTERVIEW_DETAILS_SAVED,
      entity: { type: "interview", id },
      actor,
      payload: { interview_id: id, application_number: row.application_number, fields: Object.keys(body) },
    });
    return id;
  });
}

module.exports = { closeIn, close, report, details, scoreOf, formData };
