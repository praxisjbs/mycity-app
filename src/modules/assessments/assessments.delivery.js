"use strict";
/**
 * An assessment on go.mycityapp.io/assess/<token> (docs/guides/recruitment.md §3 step 7, §6.7). Nobody
 * here is signed in, so this file loads no staff auth (public-surface gate); the link is the only
 * key, and every answer is an allow-list: never a score, a key or an option's points.
 *
 *   session(token)                 GET  /assess/:token                      where the sitting stands
 *   start(token)                   POST /assess/:token/start                the clock starts
 *   answer(token, qid, body)       PUT  /assess/:token/answers/:question_id an answer, as it is given
 *   answerFile(token, qid, file)   POST /assess/:token/answers/:question_id/file   a file answer
 *   submit(token)                  POST /assess/:token/submit               the end
 *
 * The clock is the server's: an answer after due_at is refused with TIME_UP, and a sitting found
 * past its time is ended there and then, as the scheduler would a minute later. Start moves the
 * link's end to a day past due_at (timer.LINK_GRACE_MS), so a test started on its last day keeps its
 * link, and a save that arrives late reaches the sitting and is told TIME_UP rather than a dead link.
 */
const { pool } = require("../../config/db");
const { atomically } = require("../../shared/db/tx");
const { AppError } = require("../../shared/errors");
const { emit } = require("../../shared/events/emit");
const lagos = require("../../shared/time/lagos");
const publicToken = require("../../shared/tokens/public-token");
const vault = require("../../shared/documents/vault");
const repo = require("./assessments.repo");
const scoring = require("./assessments.scoring");
const timer = require("./assessments.timer");
const { EVENTS, SCOPE, SUBJECT, ANSWER_DOC_TYPE } = require("./assessments.events");

const notFound = () => new AppError("NOT_FOUND", "This link is not valid or has expired", 404);
const timeUp = () => new AppError("TIME_UP", "The time for this assessment is over", 409);
const field = (name, message) => new AppError("VALIDATION_FAILED", message, 422, { [name]: [message] });

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

/** The sitting a live link opens, locked when asked; a link to anything else is the 404. */
async function sittingOf(db, raw, opts = {}) {
  const token = await publicToken.resolve(db, raw, { scope: SCOPE, forUpdate: Boolean(opts.lock) });
  if (!token || token.subject_type !== SUBJECT) throw notFound();
  const row = await repo.sitting(db, token.subject_id, opts);
  if (!row || ["expired", "cancelled"].includes(row.status) || row.application_status !== "active") throw notFound();
  return { token, row };
}

const STATE = { sent: "not_started", in_progress: "in_progress", submitted: "submitted", scored: "submitted", timed_out: "timed_out" };

/** A sitting scored at once when its time ran out still reads as time up: it ended at or after due_at. */
const stateOf = (row) =>
  row.status === "scored" && row.due_at && row.submitted_at && new Date(row.submitted_at) >= new Date(row.due_at)
    ? "timed_out"
    : STATE[row.status];

/** AssessmentSession, field by field. Questions only once started and while it runs. */
async function sessionOf(db, row) {
  const live = row.status === "in_progress";
  let questions = null;
  if (live) {
    const qs = await repo.questions(db, row.assessment_definition_id);
    const answers = await repo.responses(db, row.application_assessment_id);
    questions = qs.map((q, i) => {
      const a = answers.get(q.assessment_question_id);
      return {
        assessment_question_id: q.assessment_question_id,
        n: i + 1,
        question_type: q.question_type,
        prompt: q.prompt,
        options: Array.isArray(q.options) ? q.options.map((o) => ({ id: o.id, text: o.text })) : null,
        answer: a && a.response !== null && a.response !== undefined ? String(a.response) : null,
        file_name: a && a.file_name ? a.file_name : null,
      };
    });
  }
  return {
    candidate_first_name: row.candidate_first_name,
    vacancy_title: row.vacancy_title,
    assessment: {
      name: row.assessment_name,
      assessment_type: row.assessment_type,
      duration_minutes: row.duration_minutes,
      question_count: row.question_count,
      instructions: row.instructions,
    },
    state: stateOf(row),
    timed: Boolean(row.duration_minutes),
    start_by: row.start_by,
    ends_at: row.due_at ? new Date(row.due_at).toISOString() : null,
    server_now: new Date().toISOString(),
    current_question: row.current_question,
    questions,
    submitted_at: row.submitted_at ? new Date(row.submitted_at).toISOString() : null,
  };
}

/** A sitting read past its time is ended now, as the clock would. */
async function settled(client, row) {
  if (!timer.pastDue(row)) return row;
  await timer.finish(client, row, "timed_out");
  return repo.sitting(client, row.application_assessment_id);
}

async function session(raw) {
  return tx(async (client) => {
    const { row } = await sittingOf(client, raw, { lock: true });
    return sessionOf(client, await settled(client, row));
  });
}

async function start(raw) {
  return tx(async (client) => {
    const { token, row } = await sittingOf(client, raw, { lock: true });
    if (row.status !== "sent") return sessionOf(client, await settled(client, row));
    if (row.start_by < lagos.today()) throw notFound();
    const due = timer.dueAt(row);
    await repo.start(client, row.application_assessment_id, due);
    await publicToken.extend(client, token.public_token_id, new Date(due.getTime() + timer.LINK_GRACE_MS));
    await emit(client, {
      key: EVENTS.ASSESSMENT_STARTED,
      entity: { type: SUBJECT, id: row.application_assessment_id },
      actor: null,
      payload: { application_assessment_id: row.application_assessment_id, application_number: row.application_number },
    });
    return sessionOf(client, await repo.sitting(client, row.application_assessment_id));
  });
}

/** The question a running sitting may answer now, or why not. */
async function running(client, raw, questionId) {
  const { row } = await sittingOf(client, raw, { lock: true });
  if (timer.pastDue(row)) {
    await timer.finish(client, row, "timed_out");
    return { ended: true };
  }
  if (row.status !== "in_progress") {
    // Ended by its clock already (the scheduler, or a read of the link): the same answer as a late save.
    if (stateOf(row) === "timed_out") throw timeUp();
    throw new AppError("NOT_RUNNING", "This assessment is not running", 409);
  }
  const q = (await repo.questions(client, row.assessment_definition_id)).find((x) => x.assessment_question_id === questionId);
  if (!q) throw notFound();
  return { row, q };
}

const HTTPS = /^https:\/\/[^\s/$.?#][^\s]*$/i;

async function answer(raw, questionId, body) {
  // A time-up ends the sitting in its own transaction, so the end stands though the answer is refused.
  const outcome = await tx(async (client) => {
    const r = await running(client, raw, questionId);
    if (r.ended) return { ended: true };
    const { row, q } = r;
    const text = body.answer.trim();
    let awarded = null;
    if (q.question_type === "choice") {
      if (text && !(q.options || []).some((o) => o.id === text)) throw field("answer", "Pick one of the options");
      const keys = await repo.keysOf(client, row.assessment_definition_id);
      awarded = scoring.award(q, text, scoring.openKey(q.assessment_question_id, keys.get(q.assessment_question_id)));
    } else if (q.question_type === "file" && text && !HTTPS.test(text)) {
      throw field("answer", "Upload a file or give an https link");
    }
    // Moving on from a file question without a new answer keeps what was given, a file or a link;
    // a new link replaces it.
    const keepGiven = q.question_type === "file" && !text;
    if (!keepGiven)
      await repo.saveResponse(client, row.application_assessment_id, q.assessment_question_id, {
        response: text || null,
        awarded: text ? awarded : null,
      });
    await repo.setPosition(client, row.application_assessment_id, body.current_question);
    return { saved_at: new Date().toISOString(), file_name: null };
  });
  if (outcome.ended) throw timeUp();
  return outcome;
}

async function answerFile(raw, questionId, file) {
  const outcome = await tx(async (client) => {
    const r = await running(client, raw, questionId);
    if (r.ended) return { ended: true };
    const { row, q } = r;
    if (q.question_type !== "file") throw field("file", "This question takes no file");
    const doc = await vault.store(client, {
      file,
      purpose: "assessment_answer",
      doc_type: ANSWER_DOC_TYPE,
      entity: { type: SUBJECT, id: row.application_assessment_id },
      stranger: true,
      actor: null,
    });
    await repo.saveResponse(client, row.application_assessment_id, q.assessment_question_id, { document_id: doc.document_id });
    // The document as the CV upload answers it (documents.DocumentRef): the page's upload engine reads it back.
    return {
      document_id: doc.document_id,
      file_name: doc.original_name,
      size_bytes: Number(doc.bytes),
      mime_type: doc.mime,
      saved_at: new Date().toISOString(),
    };
  });
  if (outcome.ended) throw timeUp();
  return outcome;
}

async function submit(raw) {
  return tx(async (client) => {
    const { row } = await sittingOf(client, raw, { lock: true });
    if (row.status === "in_progress") await timer.finish(client, row, timer.pastDue(row) ? "timed_out" : "submitted");
    else if (row.status === "sent") throw new AppError("NOT_RUNNING", "Start the assessment first", 409);
    return sessionOf(client, await repo.sitting(client, row.application_assessment_id));
  });
}

module.exports = { session, start, answer, answerFile, submit, sessionOf };
