"use strict";
/**
 * Candidates: the one write path for an application once it is made (docs/guides/recruitment.md
 * §3 steps 5, 6, 11 and 12, §6.3 to §6.5, §6.8). Apply itself is candidates.apply.js, which never
 * loads staff auth.
 *
 *   list(), summary(), get()     the board, the figures above it, a candidate's sheet; each card with
 *                                its screening score (Provisional while it is the estimate) and its
 *                                weighted total over the parts on
 *   cv()                         the CV, once the virus check has cleared it
 *   move(), notProgressed(), reopen()   the pipeline (candidates.pipeline.js), each a row of
 *                                entity_state_history; Not Progressing spends the candidate's live
 *                                links and mails candidate-not-progressed
 *   advanceIn(), offerEndedIn(), hireIn()   the steps another module's transaction implies: an
 *                                assessment sent, an interview scheduled, and M5's offer and
 *                                onboarding (Offer and after are set only through these)
 *   requestScore(), scoreAll()   Score With AI and Screen With AI: queued, read in the worker
 *                                (candidates.score.js)
 *   invite()                     Invite to Apply: the person kept, the link made and mailed after commit
 *   emails(), email(), saveEmail(), restoreEmail()   Candidate Emails (candidates.emails.js)
 *
 * Scope is the vacancy's hiring manager (guide §8): an application outside it is a 404.
 */
const { pool } = require("../../config/db");
const { envelope } = require("../../shared/http/paged");
const { atomically } = require("../../shared/db/tx");
const { AppError } = require("../../shared/errors");
const { emit } = require("../../shared/events/emit");
const { transition } = require("../../shared/state/state-history");
const { assertInScope } = require("../../shared/rbac/scope");
const publicToken = require("../../shared/tokens/public-token");
const vault = require("../../shared/documents/vault");
const { scopeFor } = require("../../middleware/rbac");
const lifecycle = require("../vacancies/vacancies.lifecycle");
const vacancyRepo = require("../vacancies/vacancies.repo");
const vacancies = require("../vacancies/vacancies.service");
const repo = require("./candidates.repo");
const pipeline = require("./candidates.pipeline");
const { shown } = require("./candidates.screening");
const { scorecard } = require("./candidates.scorecard");
const { daysAtStage } = require("./candidates.sla");
const emailsOf = require("./candidates.emails");
const mail = require("./candidates.mail");
const { EVENTS } = require("./candidates.events");

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

const notFound = () => new AppError("NOT_FOUND", "That candidate does not exist", 404);

/** The CV's state from its document's scan (CvState). */
function cvState(scan) {
  if (!scan) return "none";
  if (scan === "pending") return "checking";
  if (scan === "infected") return "infected";
  return "clean";
}

/** A row as the board shows it (Candidate). */
function card(row, now = new Date()) {
  const s = shown(row);
  return {
    application_id: row.application_id,
    number: row.number,
    candidate_id: row.candidate_id,
    name: row.name,
    email: row.email,
    vacancy: { vacancy_id: row.vacancy_id, number: row.vacancy_number, title: row.vacancy_title },
    stage: row.stage,
    status: row.status,
    source: row.source,
    applied_at: row.applied_at,
    current_stage_entered_at: row.current_stage_entered_at,
    days_at_stage: daysAtStage(row.current_stage_entered_at, now),
    score: s.score === null ? null : Math.round(s.score * 10) / 10,
    score_provisional: s.provisional,
    weighted_total: row.weighted_total === null || row.weighted_total === undefined ? null : Number(row.weighted_total),
    parts_scored: Math.min(5, Number(row.parts_scored) || 0),
    parts_active: Math.min(5, Math.max(1, Number(row.parts_active) || 1)),
    cv_state: cvState(row.cv_scan),
    next_stages: nextOf(row),
  };
}

/**
 * Where a card may move now (pipeline.nextStages on its role's own board): none for one not in
 * progress, at Offer or after, or on a closed role. The sheet narrows it to readers who may edit.
 */
function nextOf(row) {
  if (row.status !== "active" || row.vacancy_status === "closed" || pipeline.isM5(row.stage)) return [];
  const board = lifecycle.boardStages((row.active_parts || []).map((code) => ({ code, active: true })));
  return pipeline.nextStages(row.stage, board);
}

const num = (v) => (v === null || v === undefined ? null : Number(v));

/** Whether the user may move this application: recruitment edit over its hiring manager. */
async function canEdit(user, row) {
  if (!user) return false;
  const s = await scopeFor(user, "recruitment", "edit");
  if (!s) return false;
  return s.scope === "all" || Boolean(row.hiring_manager_id && (s.scope_ids || []).includes(row.hiring_manager_id));
}

/* ------------------------------------------------------------------ *
 * Reading
 * ------------------------------------------------------------------ */

async function list(query, scope) {
  const page = await repo.list(pool, query, scope);
  const now = new Date();
  return { ...page, data: page.data.map((r) => card(r, now)) };
}

async function summary(query, scope) {
  const r = await repo.summary(pool, query, scope);
  return {
    candidates: r.candidates,
    to_screen: r.to_screen,
    in_interview: r.in_interview,
    shortlisted: r.shortlisted,
    distribution: [
      { label: "Below 40", count: r.band_0 },
      { label: "40 to 59", count: r.band_40 },
      { label: "60 to 79", count: r.band_60 },
      { label: "80 and Above", count: r.band_80 },
    ],
  };
}

/** The row behind an application the reader may see, or 404. */
async function visibleRow(db, id, scope, opts) {
  const row = await repo.get(db, id, opts);
  if (!row) throw notFound();
  assertInScope(scope, row.hiring_manager_id);
  return row;
}

/** The weighted scorecard of an application's row, with the vacancy's parts (guide §6.5). */
function scorecardOfRow(parts, row) {
  const s = shown(row);
  return scorecard(
    parts,
    {
      screening: s.score,
      psychometric: row.psychometric,
      technical: row.technical,
      case_study: row.case_study,
      interview: row.interview,
    },
    s.provisional,
  );
}

/**
 * An application's scorecard parts and total, for a screen that shows it beside its own record
 * (an interview); null when there is no such application. The caller has checked the reader's scope.
 */
async function scorecardOf(db, applicationId) {
  const row = await repo.get(db, applicationId);
  if (!row) return null;
  const sc = scorecardOfRow(await vacancyRepo.scorecard(db, row.vacancy_id), row);
  // The board's own total (SQL, exact decimals), as the candidate's sheet shows it.
  return { parts: sc.parts, weighted_total: num(row.weighted_total) };
}

/** CandidateDetail. Run one query after another: inside a write, `db` is one client. */
async function detailOf(db, row, user) {
  const parts = await vacancyRepo.scorecard(db, row.vacancy_id);
  const board = lifecycle.boardStages(parts);
  const questions = await repo.applyQuestions(db, row.vacancy_id);
  const sittings = await repo.sittings(db, row.application_id);
  const interviews = await repo.interviews(db, row.application_id);
  const history = await repo.history(db, row.application_id);
  const inScope = await canEdit(user, row);
  const editable = inScope && row.vacancy_status !== "closed";
  const sc = scorecardOfRow(parts, row);
  const answers = row.answers || {};
  return {
    ...card(row),
    // The board's own total (SQL, exact decimals), so the sheet and the ranking never disagree.
    weighted_total: num(row.weighted_total),
    parts_scored: sc.parts_scored,
    parts_active: sc.parts_active,
    first_name: row.first_name,
    last_name: row.last_name,
    phone: row.phone,
    years_experience: row.years_experience,
    cover_letter: row.cover_letter,
    cv: row.cv_document_id
      ? { document_id: row.cv_document_id, file_name: row.cv_name, size_bytes: Number(row.cv_bytes), mime_type: row.cv_mime }
      : null,
    answers: questions
      .filter((q) => answers[q.vacancy_question_id] !== undefined || q.required)
      .map((q) => ({
        vacancy_question_id: q.vacancy_question_id,
        prompt: q.prompt,
        question_type: q.question_type,
        answer: answers[q.vacancy_question_id] === undefined ? null : String(answers[q.vacancy_question_id]),
      })),
    provisional_score: num(row.provisional_score),
    screening_score: num(row.screening_score),
    screening_summary: row.screening_summary,
    screened_at: row.screened_at,
    rejection_reason: row.rejection_reason,
    scorecard: sc.parts,
    assessments: sittings.slice(0, 20).map((x) => ({
      application_assessment_id: x.application_assessment_id,
      name: x.name,
      assessment_type: x.assessment_type,
      status: x.status,
      score: num(x.score),
      submitted_at: x.submitted_at,
    })),
    interviews: interviews.slice(0, 20).map((x) => ({
      interview_id: x.interview_id,
      scheduled_start: x.scheduled_start,
      status: x.status,
      round_status: x.round_status,
      interview_score: num(x.interview_score),
    })),
    history: history.slice(-50).map((h, i, all) => ({
      from_state: h.from_state,
      to_state: h.to_state,
      changed_at: h.changed_at,
      actor_name: h.actor_name,
      reason: h.reason,
      days: daysAtStage(h.changed_at, all[i + 1] ? new Date(all[i + 1].changed_at) : new Date()),
    })),
    next_stages: row.status === "active" && editable ? pipeline.nextStages(row.stage, board) : [],
    can_edit: editable,
    // On a closed role too (GE, 05/11/2026): the people still in it can be told.
    can_not_progress: inScope && row.status === "active",
  };
}

async function get(id, user, scope) {
  return detailOf(pool, await visibleRow(pool, id, scope), user);
}

/** The CV document to stream: 409 while the virus check runs, never once infected. */
async function cv(id, scope) {
  const row = await visibleRow(pool, id, scope);
  if (!row.cv_document_id) throw new AppError("NOT_FOUND", "This candidate sent no CV", 404);
  const doc = await vault.get(pool, row.cv_document_id);
  if (!doc) throw new AppError("NOT_FOUND", "This candidate sent no CV", 404);
  if (doc.scan_status === "pending") throw new AppError("CV_CHECKING", "The CV is still being checked", 409);
  if (doc.scan_status === "infected") throw new AppError("CV_INFECTED", "The CV failed the virus check", 409);
  return doc;
}

/* ------------------------------------------------------------------ *
 * The pipeline
 * ------------------------------------------------------------------ */

/** The vacancy of an application must still be live for a write. */
function assertVacancyLive(row) {
  if (row.vacancy_status === "closed") throw new AppError("VACANCY_CLOSED", "This vacancy is closed", 409);
}

async function move(actor, scope, id, body) {
  return tx(async (client) => {
    const row = await visibleRow(client, id, scope, { lock: true });
    assertVacancyLive(row);
    const board = lifecycle.boardStages(await vacancyRepo.scorecard(client, row.vacancy_id));
    pipeline.assertCanMove(row, body.stage, board);
    await transition(client, pipeline.MACHINE, {
      entity_id: id,
      from: row.stage,
      to: body.stage,
      actor_id: actor.user_id,
      reason: body.reason || null,
    });
    await repo.setStage(client, id, body.stage);
    await emit(client, {
      key: EVENTS.APPLICATION_MOVED,
      entity: { type: "application", id },
      actor,
      payload: { application_id: id, number: row.number, from: row.stage, to: body.stage },
    });
    return detailOf(client, await repo.get(client, id), actor);
  });
}

/** Record a move another module's step made, in the caller's transaction: history, stage, event. */
async function stepIn(client, actor, row, to, reason = null) {
  const id = row.application_id;
  await transition(client, pipeline.MACHINE, { entity_id: id, from: row.stage, to, actor_id: actor.user_id, reason });
  await repo.setStage(client, id, to);
  await emit(client, {
    key: EVENTS.APPLICATION_MOVED,
    entity: { type: "application", id },
    actor,
    payload: { application_id: id, number: row.number, from: row.stage, to },
  });
}

/**
 * Move an application forward to `stage` inside the caller's transaction, as another module's step
 * implies it: an assessment sent or an interview scheduled (guide §3 step 8), and M5's steps past
 * Shortlist (#79, 06/11/2026): offer when an offer is sent, documentation at acceptance,
 * pre_onboarding once the checklist is done, onboarding on the start date. Only forward and only an
 * active application: among the M4 stages, only into a column of its board; from Shortlist on, only
 * the next stage (Shortlist to Offer, Offer to Documentation...). Anything else leaves it where it is,
 * so the caller checks the answer. Hired is hireIn's. True when it moved.
 */
async function advanceIn(client, actor, applicationId, stage) {
  const row = await repo.get(client, applicationId, { lock: true });
  if (!row || row.status !== "active" || row.stage === stage || stage === "hired") return false;
  if (pipeline.isM5(stage)) {
    if (!(pipeline.MACHINE.moves[row.stage] || []).includes(stage)) return false;
  } else {
    if (pipeline.isM5(row.stage)) return false;
    const board = lifecycle.boardStages(await vacancyRepo.scorecard(client, row.vacancy_id));
    if (!board.includes(stage) || board.indexOf(stage) <= board.indexOf(row.stage)) return false;
  }
  await stepIn(client, actor, row, stage);
  return true;
}

/**
 * An offer ended unsigned (declined, lapsed or withdrawn; M5's offers.service), in the caller's
 * transaction: the card goes back from Offer to Shortlist with the reason, so another offer can be
 * made or the candidate told. True when it moved; false for one not active at Offer.
 */
async function offerEndedIn(client, actor, applicationId, reason) {
  const row = await repo.get(client, applicationId, { lock: true });
  if (!row || row.status !== "active" || row.stage !== "offer") return false;
  await stepIn(client, actor, row, "shortlist", reason || null);
  return true;
}

/**
 * The hire, in the caller's transaction (M5, when onboarding completes; #79, 06/11/2026): the
 * application moves from Onboarding to Hired with status hired, so it leaves the board and every
 * count of people in progress, and `application.hired` is recorded. Then the vacancy hears of it
 * (vacancies.hiredIn): its Organogram seat is filled by the new employee, and it closes as filled
 * once its openings are. 409 for an application not active at Onboarding.
 * @param {{employee_id: string}} hire  the employee M5 created at acceptance
 * @returns {Promise<{application_id: string, seat_filled: boolean, vacancy_closed: boolean}>}
 */
async function hireIn(client, actor, applicationId, { employee_id: employeeId }) {
  const row = await repo.get(client, applicationId, { lock: true });
  if (!row) throw notFound();
  if (row.status !== "active" || row.stage !== "onboarding")
    throw new AppError("MOVE_NOT_ALLOWED", "Only a candidate in onboarding can be hired", 409);
  if (!employeeId) throw new AppError("VALIDATION_FAILED", "Name the new employee", 422, { employee_id: ["Pick the employee"] });
  await transition(client, pipeline.MACHINE, { entity_id: applicationId, from: row.stage, to: "hired", actor_id: actor.user_id });
  await repo.setStage(client, applicationId, "hired");
  await repo.setStatus(client, applicationId, { status: "hired" });
  await emit(client, {
    key: EVENTS.APPLICATION_HIRED,
    entity: { type: "application", id: applicationId },
    actor,
    payload: { application_id: applicationId, number: row.number, vacancy_id: row.vacancy_id, employee_id: employeeId },
  });
  const v = await vacancies.hiredIn(client, actor, row.vacancy_id, { employee_id: employeeId });
  return { application_id: applicationId, seat_filled: v.seat_filled, vacancy_closed: v.closed };
}

/**
 * Not Progressing, at any stage and on a closed role too (a role closed with people still in it lets
 * them be told; GE, 05/11/2026). Reopen still needs the role live.
 */
async function notProgressed(actor, scope, id, body) {
  return tx(async (client) => {
    const row = await visibleRow(client, id, scope, { lock: true });
    if (row.status !== "active") throw new AppError("MOVE_NOT_ALLOWED", "This candidate is not in progress", 409);
    await notProgressIn(client, actor, row, body.rejection_reason);
    return detailOf(client, await repo.get(client, id), actor);
  });
}

/**
 * Mark one active application Not Progressing inside the caller's transaction: its live links stop,
 * its unfinished sittings end as cancelled, and the event sends the candidate their email.
 */
async function notProgressIn(client, actor, row, reason) {
  const id = row.application_id;
  await transition(client, pipeline.MACHINE, {
    entity_id: id,
    from: row.stage,
    to: pipeline.NOT_PROGRESSED,
    actor_id: actor.user_id,
    reason,
  });
  await repo.setStatus(client, id, { status: "not_progressed", rejection_reason: reason });
  // Their live links stop working: any link made for the application, and each sitting not yet
  // finished ends as cancelled through the assessments' own path (its link stops with it), so a
  // Reopen can send it again. An Apply link belongs to a vacancy, and to nobody until it is used.
  await publicToken.revokeFor(client, { subject_type: "application", subject_id: id });
  const timer = require("../assessments/assessments.timer");
  for (const sitting of await repo.sittings(client, id)) {
    if (!["sent", "in_progress"].includes(sitting.status)) continue;
    const live = await timer.lockSitting(client, sitting.application_assessment_id);
    if (live && ["sent", "in_progress"].includes(live.status)) await timer.finish(client, live, "cancelled", actor);
  }
  await emit(client, {
    key: EVENTS.APPLICATION_NOT_PROGRESSED,
    entity: { type: "application", id },
    actor,
    payload: { application_id: id, number: row.number, stage: row.stage },
  });
}

/**
 * Close Vacancy's Not Progressing for all: every candidate of the role still at an M4 stage. One at
 * Offer or after is M5's (an offer out, or a hire on its way) and is left as it stands.
 */
async function notProgressAllIn(client, actor, vacancyId, reason) {
  let n = 0;
  for (const id of await repo.activeOf(client, vacancyId)) {
    const row = await repo.get(client, id, { lock: true });
    if (!row || row.status !== "active" || pipeline.isM5(row.stage)) continue;
    await notProgressIn(client, actor, row, reason);
    n += 1;
  }
  return n;
}

async function reopen(actor, scope, id) {
  return tx(async (client) => {
    const row = await visibleRow(client, id, scope, { lock: true });
    if (row.status !== "not_progressed") throw new AppError("MOVE_NOT_ALLOWED", "Only a candidate not progressed can be reopened", 409);
    assertVacancyLive(row);
    await transition(client, pipeline.MACHINE, {
      entity_id: id,
      from: pipeline.NOT_PROGRESSED,
      to: row.stage,
      actor_id: actor.user_id,
    });
    await repo.setStatus(client, id, { status: "active" });
    await emit(client, {
      key: EVENTS.APPLICATION_REOPENED,
      entity: { type: "application", id },
      actor,
      payload: { application_id: id, number: row.number, stage: row.stage },
    });
    return detailOf(client, await repo.get(client, id), actor);
  });
}

/* ------------------------------------------------------------------ *
 * Score With AI, Screen With AI
 * ------------------------------------------------------------------ */

/** Score With AI on one card: the read is queued; the sheet shows it once kept. */
async function requestScore(actor, scope, id) {
  return tx(async (client) => {
    const row = await visibleRow(client, id, scope);
    if (row.status !== "active") throw new AppError("MOVE_NOT_ALLOWED", "This candidate is not in progress", 409);
    assertVacancyLive(row);
    await emit(client, {
      key: EVENTS.APPLICATION_SCORE_REQUESTED,
      entity: { type: "application", id },
      actor,
      payload: { application_id: id, number: row.number, conditions: null },
    });
    return detailOf(client, row, actor);
  });
}

/**
 * Screen With AI on one role: its one to three must-meet conditions kept on the vacancy (left out,
 * the kept ones), then one read queued for every active application of it with no AI score yet.
 */
async function scoreAll(actor, scope, body) {
  return tx(async (client) => {
    const { conditions } = await vacancies.keepScreeningConditions(client, scope, body.vacancy_id, body.screening_conditions, actor);
    const ids = await repo.unscored(client, body.vacancy_id);
    for (const id of ids) {
      await emit(client, {
        key: EVENTS.APPLICATION_SCORE_REQUESTED,
        entity: { type: "application", id },
        actor,
        // bulk: a read Screen With AI asked for is skipped if one is kept by the time it runs.
        payload: { application_id: id, conditions, bulk: true },
      });
    }
    return { queued: ids.length };
  });
}

/* ------------------------------------------------------------------ *
 * Invite to Apply
 * ------------------------------------------------------------------ */

/**
 * Invite to Apply: the person is kept (or found by email), and after commit an Apply link for one
 * open vacancy is made and mailed (candidates.mail.js invite). They apply as anyone does.
 */
/**
 * Invite a known person to apply, inside the caller's transaction: the vacancy is in scope and takes
 * applications, and they have not applied for it. The link is made and mailed after commit
 * (candidates.mail.js invite). The Talent Pool invites through here too, with source `pool`.
 * @returns {Promise<{vacancy: object, expires_at: string}>}
 */
async function inviteIn(client, actor, scope, candidateId, vacancyId, { source = "invited" } = {}) {
  const v = await vacancyRepo.get(client, vacancyId);
  if (!v) throw new AppError("NOT_FOUND", "That vacancy does not exist", 404);
  assertInScope(scope, v.hiring_manager_id);
  if (!lifecycle.takesApplications(v))
    throw new AppError("VALIDATION_FAILED", "Pick an open vacancy", 422, { vacancy_id: ["Pick an open vacancy"] });
  if (await repo.applicationOf(client, v.vacancy_id, candidateId))
    throw new AppError("VALIDATION_FAILED", "They have applied for this role", 422, { vacancy_id: ["Applied for this role"] });
  await emit(client, {
    key: EVENTS.APPLICATION_INVITED,
    // The vacancy, whose link opens on the Audit Log; the person invited is in the payload.
    entity: { type: "vacancy", id: v.vacancy_id },
    actor,
    payload: { candidate_id: candidateId, vacancy_id: v.vacancy_id, vacancy_title: v.title, source, invited_by: actor.user_id },
  });
  return { vacancy: v, expires_at: new Date(Date.now() + mail.INVITE_TTL_HOURS * 3600 * 1000).toISOString() };
}

async function invite(actor, scope, body) {
  return tx(async (client) => {
    const known = await repo.candidateByEmail(client, body.email);
    const candidateId = known
      ? known.candidate_id
      : await repo.insertCandidate(client, { first_name: body.first_name, last_name: body.last_name, email: body.email });
    try {
      const sent = await inviteIn(client, actor, scope, candidateId, body.vacancy_id);
      return { email: known ? known.email : body.email, expires_at: sent.expires_at };
    } catch (err) {
      // On this form the person is named by their email, so that is where "already applied" belongs.
      if (err.fields && err.fields.vacancy_id && err.fields.vacancy_id[0] === "Applied for this role")
        throw new AppError("VALIDATION_FAILED", "They have applied for this role", 422, { email: ["Applied for this role"] });
      throw err;
    }
  });
}

/* ------------------------------------------------------------------ *
 * Candidate Emails
 * ------------------------------------------------------------------ */

async function emailRow(db, key) {
  const t = await emailsOf.store.current(db, "email", key);
  const updatedAt = Number(t.version) > 0 ? await repo.emailSavedAt(db, key, t.version) : null;
  return emailsOf.shape(key, t, updatedAt);
}

/** The eight, with their current wording: one page, as there are eight. */
async function emails(user) {
  const may = await require("../vacancies/vacancies.service").wordsEveryRole(user);
  const data = [];
  for (const key of emailsOf.KEYS) data.push({ ...(await emailRow(pool, key)), can_edit: may });
  return envelope(data, 1, data.length);
}

const email = async (key, user) => ({ ...(await emailRow(pool, key)), can_edit: await require("../vacancies/vacancies.service").wordsEveryRole(user) });

/** A candidate email goes to every candidate, so only a recruiter for every vacancy (scope all) words it. */
function assertAllScope(scope) {
  if (scope.scope !== "all") throw new AppError("PERMISSION_DENIED", "Only a recruiter for every vacancy can change this", 403);
}

async function saveEmail(actor, scope, key, body) {
  assertAllScope(scope);
  return tx(async (client) => {
    await emailsOf.store.saveVersion(client, { kind: "email", key, subject: body.subject, body: body.body, format: "markdown" }, { created_by: actor.user_id });
    await emit(client, {
      key: EVENTS.RECRUITMENT_CANDIDATE_EMAIL_SAVED,
      entity: { type: "template_version", id: key },
      actor,
      payload: { key, restored: false },
    });
    return { ...(await emailRow(client, key)), can_edit: true };
  });
}

/** Restore Default: the shipped wording saved as the next version. */
async function restoreEmail(actor, scope, key) {
  assertAllScope(scope);
  return tx(async (client) => {
    const def = emailsOf.store.shipped("email", key);
    await emailsOf.store.saveVersion(client, { kind: "email", key, subject: def.subject, body: def.body, format: def.format }, { created_by: actor.user_id });
    await emit(client, {
      key: EVENTS.RECRUITMENT_CANDIDATE_EMAIL_SAVED,
      entity: { type: "template_version", id: key },
      actor,
      payload: { key, restored: true },
    });
    return { ...(await emailRow(client, key)), can_edit: true };
  });
}

module.exports = {
  card,
  cvState,
  list,
  summary,
  get,
  scorecardOf,
  cv,
  move,
  advanceIn,
  offerEndedIn,
  hireIn,
  notProgressed,
  notProgressAllIn,
  reopen,
  requestScore,
  scoreAll,
  invite,
  inviteIn,
  emails,
  email,
  saveEmail,
  restoreEmail,
};
