"use strict";
/**
 * Assessment sittings (docs/guides/recruitment.md §3 step 7, §6.7): the one write path for sending an
 * assessment to a candidate and for marking what they gave. The library itself is
 * assessments.authoring.js; the candidate's side is assessments.delivery.js.
 *
 *   sittings(), sitting()     Assessments · Sittings, each answer beside its question and points
 *   send()                    one sitting a candidate: the start-by day 1 to 14 days on (default 3),
 *                             and for an untimed brief the days after Start it is due (default 5)
 *   sendBulk()                Send to Candidates: every active candidate of a role at a stage who has
 *                             no live sitting of it; says how many were sent and skipped
 *   mark()                    Mark Answers: written and file answers; the sitting is scored once
 *                             every answer has a mark
 *   cancel()                  before it is submitted; the link stops working
 *
 * Scope is the vacancy's hiring manager (guide §8): a sitting outside it is a 404.
 */
const { pool } = require("../../config/db");
const { atomically } = require("../../shared/db/tx");
const { AppError } = require("../../shared/errors");
const { emit } = require("../../shared/events/emit");
const { assertInScope } = require("../../shared/rbac/scope");
const lagos = require("../../shared/time/lagos");
const { scopeFor } = require("../../middleware/rbac");
const vacancyRepo = require("../vacancies/vacancies.repo");
const candidates = require("../candidates/candidates.repo");
const repo = require("./assessments.repo");
const authoring = require("./assessments.authoring");
const timer = require("./assessments.timer");
const { EVENTS, SUBJECT } = require("./assessments.events");

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

const notFound = () => new AppError("NOT_FOUND", "That sitting does not exist", 404);
const field = (name, message) => new AppError("VALIDATION_FAILED", message, 422, { [name]: [message] });
const num = (v) => (v === null || v === undefined ? null : Number(v));
const iso = (v) => (v ? new Date(v).toISOString() : null);

/** Sitting (a row of Sittings). */
function listed(r) {
  return {
    due_days: r.due_days,
    application_assessment_id: r.application_assessment_id,
    application_id: r.application_id,
    candidate_name: r.candidate_name,
    vacancy_title: r.vacancy_title,
    assessment_definition_id: r.assessment_definition_id,
    assessment_name: r.assessment_name,
    assessment_type: r.assessment_type,
    status: r.status,
    start_by: r.start_by,
    started_at: iso(r.started_at),
    due_at: iso(r.due_at),
    submitted_at: iso(r.submitted_at),
    score: num(r.score),
    to_mark: r.to_mark,
  };
}

async function canEdit(user, row) {
  if (!user) return false;
  const s = await scopeFor(user, "recruitment", "edit");
  if (!s) return false;
  return s.scope === "all" || Boolean(row.hiring_manager_id && (s.scope_ids || []).includes(row.hiring_manager_id));
}

/** SittingDetail: each question with its options' points, the answer given, its mark. */
async function detailOf(db, row, user) {
  const qs = await repo.questions(db, row.assessment_definition_id);
  const keys = await repo.keysOf(db, row.assessment_definition_id);
  const answers = await repo.responses(db, row.application_assessment_id);
  const editable = await canEdit(user, row);
  return {
    ...listed(row),
    answers: qs.map((q) => {
      const staff = authoring.staffQuestion(q, keys.get(q.assessment_question_id));
      const a = answers.get(q.assessment_question_id);
      return {
        assessment_question_id: q.assessment_question_id,
        question_type: q.question_type,
        prompt: q.prompt,
        options: staff.options,
        max_score: staff.max_score,
        response: a && a.response !== null && a.response !== undefined ? String(a.response) : null,
        document: a && a.document_id ? { document_id: a.document_id, file_name: a.file_name, size_bytes: Number(a.file_bytes), mime_type: a.file_mime } : null,
        awarded_score: a ? num(a.awarded_score) : null,
        reviewer_comment: a ? a.reviewer_comment : null,
        marked_at: a ? iso(a.marked_at) : null,
      };
    }),
    can_mark: editable && ["submitted", "timed_out", "scored"].includes(row.status),
    can_cancel: editable && ["sent", "in_progress"].includes(row.status),
  };
}

async function visibleRow(db, id, scope, opts) {
  const row = await repo.sitting(db, id, opts);
  if (!row) throw notFound();
  assertInScope(scope, row.hiring_manager_id);
  return row;
}

async function sittings(query, scope) {
  const page = await repo.sittings(pool, query, scope);
  return { ...page, data: page.data.map(listed) };
}

async function sitting(id, user, scope) {
  return detailOf(pool, await visibleRow(pool, id, scope), user);
}

/* ------------------------------------------------------------------ *
 * Sending
 * ------------------------------------------------------------------ */

/** The assessment to send: on, with questions. */
async function sendable(client, id) {
  const d = await repo.get(client, id);
  if (!d) throw field("assessment_definition_id", "Pick an assessment");
  if (!d.active || d.question_count === 0) throw field("assessment_definition_id", "Pick an assessment that is on");
  return d;
}

/** One sitting inside the caller's transaction; null when a live one exists. */
async function sendOne(client, actor, d, applicationId, body) {
  if (await repo.liveSitting(client, applicationId, d.assessment_definition_id)) return null;
  const id = await repo.insertSitting(client, {
    application_id: applicationId,
    assessment_definition_id: d.assessment_definition_id,
    start_by: lagos.addDays(lagos.today(), body.start_within_days),
    due_days: d.duration_minutes ? null : body.due_days || 5,
    sent_by: actor.user_id,
  });
  await emit(client, {
    key: EVENTS.ASSESSMENT_SENT,
    entity: { type: SUBJECT, id },
    actor,
    payload: { application_assessment_id: id, application_id: applicationId, assessment_code: d.code },
  });
  return id;
}

async function send(actor, scope, body) {
  return tx(async (client) => {
    const app = await candidates.get(client, body.application_id, { lock: true });
    if (!app) throw field("application_id", "Pick a candidate");
    assertInScope(scope, app.hiring_manager_id);
    if (app.status !== "active") throw field("application_id", "This candidate is not in progress");
    const d = await sendable(client, body.assessment_definition_id);
    const id = await sendOne(client, actor, d, app.application_id, body);
    if (!id) throw new AppError("ALREADY_SENT", "This candidate already has this assessment", 409);
    return detailOf(client, await repo.sitting(client, id), actor);
  });
}

async function sendBulk(actor, scope, body) {
  return tx(async (client) => {
    const v = await vacancyRepo.get(client, body.vacancy_id, { lock: true });
    if (!v) throw field("vacancy_id", "Pick a vacancy");
    assertInScope(scope, v.hiring_manager_id);
    const d = await sendable(client, body.assessment_definition_id);
    let sent = 0;
    let skipped = 0;
    for (const applicationId of await repo.applicationsAt(client, v.vacancy_id, body.stage)) {
      if (await sendOne(client, actor, d, applicationId, body)) sent += 1;
      else skipped += 1;
    }
    return { sent, skipped };
  });
}

/* ------------------------------------------------------------------ *
 * Marking and cancelling
 * ------------------------------------------------------------------ */

async function mark(actor, scope, id, body) {
  return tx(async (client) => {
    const row = await visibleRow(client, id, scope, { lock: true });
    if (!["submitted", "timed_out", "scored"].includes(row.status))
      throw new AppError("NOT_FINISHED", "Mark the answers once the candidate has finished", 409);
    const qs = new Map((await repo.questions(client, row.assessment_definition_id)).map((q) => [q.assessment_question_id, q]));
    const answers = await repo.responses(client, id);
    const fields = {};
    for (const [i, m] of body.marks.entries()) {
      const q = qs.get(m.assessment_question_id);
      const a = answers.get(m.assessment_question_id);
      if (!q || q.question_type === "choice") fields[`marks.${i}.assessment_question_id`] = ["This answer scores itself"];
      else if (!a || (a.response === null && a.document_id === null)) fields[`marks.${i}.assessment_question_id`] = ["No answer was given"];
      else if (m.awarded_score > Number(q.max_score)) fields[`marks.${i}.awarded_score`] = [`At most ${Number(q.max_score)}`];
    }
    if (Object.keys(fields).length) throw new AppError("VALIDATION_FAILED", "Check the marks", 422, fields);
    for (const m of body.marks)
      await repo.mark(client, id, m.assessment_question_id, { awarded: m.awarded_score, comment: m.reviewer_comment, by: actor.user_id });
    await emit(client, {
      key: EVENTS.ASSESSMENT_MARKED,
      entity: { type: SUBJECT, id },
      actor,
      payload: { application_assessment_id: id, application_number: row.application_number, marks: body.marks.length },
    });
    await timer.score(client, row, actor);
    return detailOf(client, await repo.sitting(client, id), actor);
  });
}

async function cancel(actor, scope, id) {
  return tx(async (client) => {
    const row = await visibleRow(client, id, scope, { lock: true });
    if (!["sent", "in_progress"].includes(row.status))
      throw new AppError("MOVE_NOT_ALLOWED", "Only a sitting not yet finished can be cancelled", 409);
    await timer.finish(client, row, "cancelled", actor);
    return detailOf(client, await repo.sitting(client, id), actor);
  });
}

module.exports = { sittings, sitting, send, sendBulk, mark, cancel, listed };
