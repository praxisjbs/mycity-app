"use strict";
/**
 * The assessment library (docs/guides/recruitment.md §6.7): the one write path for an assessment and
 * its questions.
 *
 *   list(), summary(), get()       Assessments, with each question's options and their points (staff)
 *   create(), update()             an assessment starts switched off (ASM-0001); Edit clearing the
 *                                  minutes makes it an untimed brief
 *   saveQuestions()                the whole set, in order; refused once it has been sent to anyone
 *                                  (409 ASSESSMENT_IN_USE): switch it off and make another
 *   activate(), deactivate()       on needs at least one question
 *   exportOf(), importFrom()       one assessment as a file (AssessmentExport): approved on staging,
 *                                  imported on production, never seeded there (A26)
 *   importFile()                   the same from that file uploaded first (purpose assessment_import),
 *                                  read back from the vault and checked against the contract
 *   assist()                       Suggest With AI (assessment-questions, job Default): nothing kept
 *
 * Each choice option's points are kept only in answer_key_enc, encrypted and bound to the question's
 * id (assessments.scoring.js sealKey), so no read the public site makes can carry them.
 */
const crypto = require("node:crypto");
const c = require("@mycity/contract");
const { pool } = require("../../config/db");
const { atomically } = require("../../shared/db/tx");
const { AppError } = require("../../shared/errors");
const { emit } = require("../../shared/events/emit");
const { assertInScope } = require("../../shared/rbac/scope");
const ai = require("../../services/ai/llm.service");
const drafts = require("../../services/ai/drafts");
const redact = require("../../services/ai/redact");
const vacancyRepo = require("../vacancies/vacancies.repo");
const repo = require("./assessments.repo");
const scoring = require("./assessments.scoring");
const { EVENTS } = require("./assessments.events");
const vault = require("../../shared/documents/vault");
const storage = require("../../services/storage/storage.service");

const MODULE = "recruitment";

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

const notFound = () => new AppError("NOT_FOUND", "That assessment does not exist", 404);
const num = (v) => (v === null || v === undefined ? null : Number(v));

/** Assessment (a row of the list). */
function listed(r) {
  return {
    assessment_definition_id: r.assessment_definition_id,
    code: r.code,
    name: r.name,
    assessment_type: r.assessment_type,
    duration_minutes: r.duration_minutes,
    pass_score: num(r.pass_score),
    scoring_method: r.scoring_method,
    active: r.active,
    question_count: r.question_count,
    sent: r.sent,
    average_score: num(r.average_score),
    created_at: r.created_at,
  };
}

/** A question as staff read it: each option with its points from the key. */
function staffQuestion(q, enc) {
  const key = q.question_type === "choice" ? scoring.openKey(q.assessment_question_id, enc) : {};
  return {
    assessment_question_id: q.assessment_question_id,
    question_type: q.question_type,
    prompt: q.prompt,
    options: Array.isArray(q.options) ? q.options.map((o) => ({ id: o.id, text: o.text, points: Number(key[o.id] ?? 0) })) : null,
    max_score: Number(q.max_score),
    display_order: q.display_order,
  };
}

async function detailOf(db, row) {
  const qs = await repo.questions(db, row.assessment_definition_id);
  const keys = await repo.keysOf(db, row.assessment_definition_id);
  return {
    ...listed(row),
    instructions: row.instructions,
    questions: qs.map((q) => staffQuestion(q, keys.get(q.assessment_question_id))),
    in_use: row.sent > 0,
  };
}

async function list(query) {
  const page = await repo.list(pool, query);
  return { ...page, data: page.data.map(listed) };
}

async function summary(scope) {
  const r = await repo.summary(pool, scope);
  return {
    active: r.active,
    sent: r.sent,
    awaiting_marking: r.awaiting_marking,
    average_score: num(r.average_score),
    by_assessment: r.by_assessment.map((b) => ({ label: b.label, value: Number(b.value) })),
  };
}

async function rowOf(db, id, opts) {
  const row = await repo.get(db, id, opts);
  if (!row) throw notFound();
  return row;
}

async function get(id) {
  return detailOf(pool, await rowOf(pool, id));
}

/* ------------------------------------------------------------------ *
 * Writing
 * ------------------------------------------------------------------ */

/** Questions as the form sends them → rows, each choice's points sealed in its key. */
function rowsOf(questions) {
  return questions.map((q, i) => {
    const id = crypto.randomUUID();
    if (q.question_type !== "choice")
      return { assessment_question_id: id, question_type: q.question_type, prompt: q.prompt, options: null, answer_key_enc: null, max_score: q.max_score, display_order: i };
    const { options, key } = scoring.keyOf(q.options);
    return {
      assessment_question_id: id,
      question_type: "choice",
      prompt: q.prompt,
      options,
      answer_key_enc: scoring.sealKey(id, key),
      max_score: scoring.maxOf(q),
      display_order: i,
    };
  });
}

async function create(actor, body) {
  return tx(async (client) => {
    const code = await repo.nextCode(client);
    const id = await repo.insert(client, { ...body, code, created_by: actor.user_id });
    await emit(client, { key: EVENTS.ASSESSMENT_CREATED, entity: { type: "assessment", id }, actor, payload: { code, name: body.name } });
    return detailOf(client, await rowOf(client, id));
  });
}

async function update(actor, id, body) {
  return tx(async (client) => {
    const before = await rowOf(client, id, { lock: true });
    // A sitting sent reads its clock from the assessment: once sent, timed or untimed is fixed.
    if (before.sent > 0 && body.duration_minutes !== undefined && (body.duration_minutes ?? null) !== (before.duration_minutes ?? null))
      throw new AppError("ASSESSMENT_IN_USE", "It has been sent, so its time is fixed. Switch it off and make another", 409);
    await repo.update(client, id, body);
    await emit(client, {
      key: EVENTS.ASSESSMENT_UPDATED,
      entity: { type: "assessment", id },
      actor,
      payload: { code: before.code, fields: Object.keys(body) },
    });
    return detailOf(client, await rowOf(client, id));
  });
}

/** Questions inside the caller's transaction: refused once sent; the scoring method follows them. */
async function putQuestions(client, row, questions) {
  if (row.sent > 0)
    throw new AppError("ASSESSMENT_IN_USE", "It has been sent, so its questions are fixed. Switch it off and make another", 409);
  await repo.replaceQuestions(client, row.assessment_definition_id, rowsOf(questions));
  await repo.update(client, row.assessment_definition_id, { scoring_method: scoring.scoringMethod(questions) });
}

async function saveQuestions(actor, id, body) {
  return tx(async (client) => {
    const row = await rowOf(client, id, { lock: true });
    await putQuestions(client, row, body.questions);
    await emit(client, {
      key: EVENTS.ASSESSMENT_QUESTIONS_SAVED,
      entity: { type: "assessment", id },
      actor,
      payload: { code: row.code, questions: body.questions.length },
    });
    return detailOf(client, await rowOf(client, id));
  });
}

function toggle(on) {
  return async (actor, id) =>
    tx(async (client) => {
      const row = await rowOf(client, id, { lock: true });
      if (on && row.question_count === 0)
        throw new AppError("VALIDATION_FAILED", "Add a question first", 422, { questions: ["Add a question first"] });
      if (row.active !== on) {
        await repo.update(client, id, { active: on });
        await emit(client, {
          key: on ? EVENTS.ASSESSMENT_ACTIVATED : EVENTS.ASSESSMENT_DEACTIVATED,
          entity: { type: "assessment", id },
          actor,
          payload: { code: row.code },
        });
      }
      return detailOf(client, await rowOf(client, id));
    });
}

const activate = toggle(true);
const deactivate = toggle(false);

/** AssessmentExport: the assessment and its questions with their points, as Import takes them back. */
async function exportOf(id) {
  const d = await get(id);
  if (!d.questions.length) throw new AppError("VALIDATION_FAILED", "Add a question first", 422, { questions: ["Add a question first"] });
  return {
    format: "mycity-assessment-1",
    name: d.name,
    assessment_type: d.assessment_type,
    duration_minutes: d.duration_minutes,
    instructions: d.instructions,
    pass_score: d.pass_score,
    questions: d.questions.map((q) =>
      q.question_type === "choice"
        ? { question_type: "choice", prompt: q.prompt, options: q.options.map((o) => ({ text: o.text, points: o.points })) }
        : { question_type: q.question_type, prompt: q.prompt, max_score: q.max_score },
    ),
  };
}

/**
 * Import from an export file the person uploaded (Assessments · Import): read back from the vault,
 * only by who may read it (the uploader), and checked against AssessmentExport like the body route.
 */
async function importFile(actor, documentId) {
  const notAFile = () => new AppError("VALIDATION_FAILED", "Not an exported assessment", 422, { document_id: ["Not an exported assessment"] });
  const doc = await vault.getReadable(pool, actor, documentId);
  if (doc.mime !== "application/json") throw notAFile(); // only the assessment_import purpose takes JSON
  let parsed;
  try {
    parsed = c.assessments.AssessmentExport.safeParse(JSON.parse((await storage.get(doc.storage_key)).toString("utf8").replace(/^\uFEFF/, "")));
  } catch {
    throw notAFile();
  }
  if (!parsed.success) throw notAFile();
  return importFrom(actor, parsed.data);
}

/** A new, switched-off assessment from an exported file (checked against the contract on the way in). */
async function importFrom(actor, file) {
  return tx(async (client) => {
    const code = await repo.nextCode(client);
    const id = await repo.insert(client, {
      code,
      name: file.name,
      assessment_type: file.assessment_type,
      instructions: file.instructions,
      duration_minutes: file.duration_minutes,
      pass_score: file.pass_score,
      created_by: actor.user_id,
    });
    await putQuestions(client, await rowOf(client, id), file.questions);
    await emit(client, {
      key: EVENTS.ASSESSMENT_IMPORTED,
      entity: { type: "assessment", id },
      actor,
      payload: { code, name: file.name, questions: file.questions.length },
    });
    return detailOf(client, await rowOf(client, id));
  });
}

/* ------------------------------------------------------------------ *
 * Suggest With AI
 * ------------------------------------------------------------------ */

const off = (reason) => ({ available: false, reason, questions: [], ai_run_id: null });

/**
 * Questions to consider (prompts/assessment-questions.md). A vacancy named must be one the asker may
 * see: its scope is checked before its role is read (GE · (Ose), 04/11/2026).
 */
async function assist(user, scope, body) {
  let role = null;
  if (body.vacancy_id) {
    const v = await vacancyRepo.get(pool, body.vacancy_id);
    if (!v) throw new AppError("NOT_FOUND", "That vacancy does not exist", 404);
    assertInScope(scope, v.hiring_manager_id);
    role = { title: v.title, description: v.description, requirements: v.requirements };
  }
  const now = await drafts.availability(pool, MODULE);
  if (!now.available) return off(now.reason);
  const { about_company: company } = await vacancyRepo.settings(pool);
  const s = redact.shield({
    company,
    assessment_type: body.assessment_type,
    instruction: body.instruction,
    count: body.count,
    duration_minutes: body.duration_minutes ?? null,
    role,
  });
  let run;
  try {
    run = await ai.complete({
      purpose: "assessment-questions",
      module: MODULE,
      actor: user,
      input: s.value,
      output: drafts.readyToUse(c.assessments.AssessmentDraftOutput, s),
      egress: "external",
      temperature: 0.4,
    });
  } catch (err) {
    const reason = drafts.offReason(err);
    if (reason) return off(reason);
    throw err;
  }
  if (!run || !run.output) return off("off");
  const fit = (text, max) => (text.length > max ? text.slice(0, max).trimEnd() : text);
  return {
    available: true,
    reason: null,
    questions: run.output.questions.slice(0, 15).map((q) => ({
      question_type: q.question_type,
      prompt: fit(s.restore(q.prompt), 4000),
      options: q.options ? q.options.map((o) => ({ text: fit(s.restore(o.text), 300), points: o.points })) : null,
      max_score: q.question_type === "choice" ? null : q.max_score,
    })),
    ai_run_id: run.run_id,
  };
}

module.exports = {
  list,
  summary,
  get,
  create,
  update,
  saveQuestions,
  activate,
  deactivate,
  exportOf,
  importFrom,
  importFile,
  assist,
  rowsOf,
  staffQuestion,
};
