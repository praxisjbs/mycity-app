"use strict";
/**
 * Apply, go.mycityapp.io/apply/<token> (docs/guides/recruitment.md §3 step 4, §6.2). Nobody here is
 * signed in, so this file loads no staff auth (public-surface gate); the token is the only key, and
 * every answer is an allow-list.
 *
 *   link(token)            GET  /api/public/v1/apply/:token      the role, its questions, when the link lapses
 *   uploadCv(token, file)  POST /api/public/v1/apply/:token/cv   a PDF or Word file, quarantined until scanned
 *   submit(token, body)    POST /api/public/v1/apply/:token      the application; answers only a reference
 *
 * The link works only while its vacancy takes applications; otherwise it is the same 404 as a bad
 * token. The CV is kept against the link until the application is made, then given to it
 * (vault.adopt), so a CV sent on another link is refused. The token is spent in the transaction that
 * makes the application. A second application by the same email to the same role makes nothing and
 * answers the first one's reference, so the form cannot tell anyone who has applied.
 */
const { pool } = require("../../config/db");
const { atomically } = require("../../shared/db/tx");
const { AppError } = require("../../shared/errors");
const { emit } = require("../../shared/events/emit");
const numbering = require("../../shared/numbering/numbering");
const publicToken = require("../../shared/tokens/public-token");
const vault = require("../../shared/documents/vault");
const { transition } = require("../../shared/state/state-history");
const lifecycle = require("../vacancies/vacancies.lifecycle");
const repo = require("./candidates.repo");
const pipeline = require("./candidates.pipeline");
const screening = require("./candidates.screening");
const { EVENTS, CV_DOC_TYPE, APPLY_LINK } = require("./candidates.events");

/** The one thing an Apply link does (public_token scope). */
const SCOPE = "application.apply";

const notFound = () => new AppError("NOT_FOUND", "This link is not valid or has expired", 404);
const field = (name, message) => new AppError("VALIDATION_FAILED", message, 422, { [name]: [message] });

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

/** The vacancy the link is for, while it takes applications; else the link's 404. */
async function openVacancy(db, token, opts) {
  if (token.subject_type !== "vacancy") throw notFound();
  const v = await repo.vacancy(db, token.subject_id, opts);
  if (!v || !lifecycle.takesApplications(v)) throw notFound();
  return v;
}

/** ApplyLink. */
async function link(token) {
  const v = await openVacancy(pool, token);
  const questions = await repo.applyQuestions(pool, v.vacancy_id);
  return {
    vacancy_title: v.title,
    expires_at: token.expires_at,
    questions: questions.map((q) => ({
      vacancy_question_id: q.vacancy_question_id,
      question_type: q.question_type,
      prompt: q.prompt,
      options: Array.isArray(q.options) ? q.options : null,
      required: q.required,
    })),
  };
}

/** DocumentRef of the CV, kept against the link until the application is made. */
async function uploadCv(token, file) {
  return tx(async (client) => {
    await openVacancy(client, token);
    const doc = await vault.store(client, {
      file,
      purpose: "cv",
      doc_type: CV_DOC_TYPE,
      entity: { type: APPLY_LINK, id: token.public_token_id },
      stranger: true,
      actor: null,
    });
    return { document_id: doc.document_id, file_name: doc.original_name, size_bytes: Number(doc.bytes), mime_type: doc.mime };
  });
}

/**
 * The answers checked against the vacancy's Apply questions: none unknown, every required one
 * given, a yes or no answered yes or no, a choice one of its options. Field errors name the question.
 */
function checkAnswers(questions, answers) {
  const byId = new Map(questions.map((q) => [q.vacancy_question_id, q]));
  const fields = {};
  const kept = {};
  for (const [id, raw] of Object.entries(answers || {})) {
    const q = byId.get(id);
    if (!q) {
      fields[`answers.${id}`] = ["This question is not on the form"];
      continue;
    }
    const answer = String(raw).trim();
    if (!answer) continue;
    if (q.question_type === "yes_no" && !["yes", "no"].includes(answer.toLowerCase())) fields[`answers.${id}`] = ["Answer yes or no"];
    else if (q.question_type === "choice" && !(Array.isArray(q.options) && q.options.includes(answer)))
      fields[`answers.${id}`] = ["Pick one of the options"];
    else kept[id] = q.question_type === "yes_no" ? answer.toLowerCase() : answer;
  }
  for (const q of questions) {
    if (q.required && !kept[q.vacancy_question_id] && !fields[`answers.${q.vacancy_question_id}`])
      fields[`answers.${q.vacancy_question_id}`] = ["Answer this question"];
  }
  if (Object.keys(fields).length) throw new AppError("VALIDATION_FAILED", "Check your answers", 422, fields);
  return kept;
}

/** "Ada Ngozi Obi" → first "Ada", last "Ngozi Obi". */
function splitName(full) {
  const words = String(full).trim().split(/\s+/);
  return { first_name: words[0], last_name: words.slice(1).join(" ") };
}

/**
 * ApplicationReceipt. `raw` is the token from the address: it is read again here, held, so two
 * presses of Submit cannot both use it.
 */
async function submit(raw, body) {
  return tx(async (client) => {
    const live = await publicToken.resolve(client, raw, { scope: SCOPE, forUpdate: true });
    if (!live) throw notFound();
    const v = await openVacancy(client, live, { lock: true });
    const questions = await repo.applyQuestions(client, v.vacancy_id);
    const answers = checkAnswers(questions, body.answers);
    const name = splitName(body.full_name);
    const now = new Date();

    let candidateId;
    const known = await repo.candidateByEmail(client, body.email);
    if (known) {
      const first = await repo.applicationOf(client, v.vacancy_id, known.candidate_id);
      if (first) {
        // Applied before: nothing changes, and the answer is the same as for anyone.
        await publicToken.consume(client, live.public_token_id);
        return { reference: first.number, submitted_at: first.applied_at };
      }
      candidateId = known.candidate_id;
      await repo.refreshCandidate(client, candidateId, { ...name, phone: body.phone, consented_at: now });
    } else {
      candidateId = await repo.insertCandidate(client, { ...name, email: body.email, phone: body.phone, consented_at: now });
    }

    const { number } = await numbering.allocate(client, "application");
    const source = (await repo.sentByStaff(client, live.public_token_id))
      ? (await repo.invitedFromPool(client, candidateId, v.vacancy_id))
        ? "pool"
        : "invited"
      : "careers";
    const made = await repo.insertApplication(client, {
      number,
      vacancy_id: v.vacancy_id,
      candidate_id: candidateId,
      source,
      cover_letter: body.cover_letter,
      cv_document_id: null,
      answers,
      years_experience: body.years_experience,
      consented_at: now,
      provisional_score: screening.estimate(
        { years_experience: body.years_experience, cv: true, cover_letter: body.cover_letter, answers },
        v,
        questions,
      ),
    });
    const cv = await vault.adopt(client, body.cv_document_id, {
      from: { type: APPLY_LINK, id: live.public_token_id },
      to: { type: "application", id: made.application_id },
      doc_type: CV_DOC_TYPE,
    });
    if (!cv) throw field("cv_document_id", "Attach your CV");
    await repo.setCv(client, made.application_id, cv.document_id);
    if (!(await publicToken.consume(client, live.public_token_id))) throw notFound();
    await transition(client, pipeline.MACHINE, { entity_id: made.application_id, from: null, to: "application" });
    await emit(client, {
      key: EVENTS.APPLICATION_RECEIVED,
      entity: { type: "application", id: made.application_id },
      actor: null,
      payload: {
        application_id: made.application_id,
        number,
        vacancy_id: v.vacancy_id,
        vacancy_title: v.title,
        source,
        subject_employee_id: v.hiring_manager_id,
      },
    });
    return { reference: number, submitted_at: made.applied_at };
  });
}

module.exports = { SCOPE, link, uploadCv, submit, checkAnswers, splitName };
