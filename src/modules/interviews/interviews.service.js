"use strict";
/**
 * Interviews: what the screens read, and the writes put together (docs/guides/recruitment.md §3 steps
 * 8 to 11, §6.6). Each write lives in its own file and this one answers with the sheet:
 *
 *   list(), get()             Interviews, and one interview as the reader may see it: blind while open
 *   cv()                      the candidate's CV, for the panel (a seat is enough) or the reader's scope
 *   schedule(), reschedule(), cancel()       interviews.schedule.js
 *   saveFeedback(), submitFeedback()         interviews.panel.js
 *   close(), report(), details()             interviews.consolidate.js
 *   tidy()                    interviews.notes.js
 *
 * Who sees an interview: the vacancy's hiring manager in the reader's `recruitment` scope, or a seat on
 * its panel (guide §8). Who sees a card's scoring: interviews.repo.js BLIND.
 */
const { pool } = require("../../config/db");
const { AppError } = require("../../shared/errors");
const vault = require("../../shared/documents/vault");
const { scopeFor } = require("../../middleware/rbac");
const repo = require("./interviews.repo");
const panel = require("./interviews.panel");
const schedule = require("./interviews.schedule");
const consolidate = require("./interviews.consolidate");
const notes = require("./interviews.notes");

const notFound = () => new AppError("NOT_FOUND", "That interview does not exist", 404);
const iso = (v) => (v ? new Date(v).toISOString() : null);
const num = (v) => (v === null || v === undefined ? null : Number(v));
const round1 = (n) => Math.round(n * 10) / 10;

/** Interview (a row of the list). */
function listed(r) {
  return {
    interview_id: r.interview_id,
    interview_round_id: r.interview_round_id,
    application_id: r.application_id,
    candidate_name: r.candidate_name,
    vacancy: { vacancy_id: r.vacancy_id, number: r.vacancy_number, title: r.vacancy_title },
    interview_type: r.interview_type,
    scheduled_start: iso(r.scheduled_start),
    scheduled_end: iso(r.scheduled_end),
    status: r.status,
    round_status: r.round_status,
    panel_size: r.panel_size,
    submitted_count: r.submitted_count,
    on_panel: r.on_panel,
    my_submitted: r.my_submitted,
  };
}

/** Whether `user` may see a row: scope over its hiring manager, or a seat on its panel. */
function sees(scope, row) {
  return row.on_panel || scope.scope === "all" || Boolean(row.hiring_manager_id && (scope.scope_ids || []).includes(row.hiring_manager_id));
}

async function editScope(user, row) {
  const s = user ? await scopeFor(user, "recruitment", "edit") : null;
  return Boolean(s && (s.scope === "all" || (row.hiring_manager_id && (s.scope_ids || []).includes(row.hiring_manager_id))));
}

/** InterviewDetail for the reader. */
async function detailOf(db, row, user) {
  const traits = await panel.traitsOf(db, row.vacancy_id);
  const seats = await repo.panel(db, row.interview_id, user.employee_id);
  const closed = row.round_status === "closed";
  const averages = closed ? await repo.traitAverages(db, row.interview_id) : [];
  const mine = await repo.myFeedback(db, row.interview_id, user.employee_id);
  const edit = await editScope(user, row);
  const live = row.status === "scheduled" && !closed;
  return {
    ...listed(row),
    worksite: row.worksite_id ? { worksite_id: row.worksite_id, name: row.worksite_name, address: row.worksite_address } : null,
    meeting_url: row.meeting_url,
    round: {
      interview_round_id: row.interview_round_id,
      round_number: row.round_number,
      title: row.title,
      status: row.round_status,
      closed_at: iso(row.closed_at),
      interview_score: num(row.interview_score),
      report: row.report,
      decision: row.decision,
      reported_by_name: row.reported_by_name,
      reported_at: iso(row.reported_at),
      current_employer: row.current_employer,
      academics: row.academics,
      total_experience_months: row.total_experience_months,
      relevant_experience_months: row.relevant_experience_months,
      form_document_id: row.form_document_id,
    },
    panel: seats.map((s) => {
      const ratings = s.shown ? s.ratings || [] : null;
      const values = (ratings || []).map((r) => Number(r.rating));
      const score = !s.shown ? null : values.length ? round1(values.reduce((a, b) => a + b, 0) / values.length) : num(s.overall_rating);
      return {
        interview_panelist_id: s.interview_panelist_id,
        panelist: s.panelist,
        submitted_at: iso(s.submitted_at),
        score,
        overall_rating: s.shown ? s.overall_rating : null,
        decision: s.shown ? s.decision : null,
        comments: s.shown ? s.comments : null,
        ratings,
      };
    }),
    questions: traits.map((t) => ({ vacancy_question_id: t.vacancy_question_id, prompt: t.prompt })),
    trait_averages: closed
      ? traits.map((t) => ({
          vacancy_question_id: t.vacancy_question_id,
          prompt: t.prompt,
          average: num((averages.find((a) => a.vacancy_question_id === t.vacancy_question_id) || {}).average),
        }))
      : [],
    cv_document_id: row.cv_document_id,
    my_feedback: mine
      ? {
          overall_rating: mine.overall_rating ?? null,
          decision: mine.decision ?? null,
          comments: mine.comments ?? null,
          private_notes: mine.private_notes ?? null,
          ratings: mine.ratings || [],
          submitted_at: iso(mine.submitted_at),
        }
      : null,
    can_edit: edit && live,
    can_close: edit && live,
    can_report: closed && row.status !== "cancelled" && (edit || Boolean(user.employee_id && user.employee_id === row.hiring_manager_id)),
  };
}

async function visibleRow(db, id, user, scope) {
  const row = await repo.get(db, id, user.employee_id);
  if (!row || !sees(scope, row)) throw notFound();
  return row;
}

async function list(query, user, scope) {
  const page = await repo.list(pool, query, scope, user.employee_id);
  return { ...page, data: page.data.map(listed) };
}

async function get(id, user, scope) {
  return detailOf(pool, await visibleRow(pool, id, user, scope), user);
}

/** The candidate's CV for the panel: 409 while it is being checked, never once infected. */
async function cv(id, user, scope) {
  const row = await visibleRow(pool, id, user, scope);
  if (!row.cv_document_id) throw new AppError("NOT_FOUND", "This candidate sent no CV", 404);
  const doc = await vault.get(pool, row.cv_document_id);
  if (!doc) throw new AppError("NOT_FOUND", "This candidate sent no CV", 404);
  if (doc.scan_status === "pending") throw new AppError("CV_CHECKING", "The CV is still being checked", 409);
  if (doc.scan_status === "infected") throw new AppError("CV_INFECTED", "The CV failed the virus check", 409);
  return doc;
}

/** Run a write, then answer with the sheet as the writer now sees it. */
const then = (write) => async (actor, scope, ...args) => get(await write(actor, scope, ...args), actor, scope);

module.exports = {
  list,
  get,
  cv,
  schedule: then(schedule.schedule),
  reschedule: then(schedule.reschedule),
  cancel: then(schedule.cancel),
  saveFeedback: async (actor, scope, id, body) => get(await panel.save(actor, id, body), actor, scope),
  submitFeedback: async (actor, scope, id) => get(await panel.submit(actor, id), actor, scope),
  close: then(consolidate.close),
  report: then(consolidate.report),
  details: then(consolidate.details),
  tidy: (user, body) => notes.tidy(user, body),
  listed,
};
