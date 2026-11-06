"use strict";
/**
 * Candidates: the SQL (docs/guides/recruitment.md §4, §6.2 to §6.5). Writes candidate and
 * application; reads the vacancy, its questions and scorecard, the application's sittings and
 * rounds, and its moves in entity_state_history. Never emits (BACKEND_GUIDE §2).
 *
 * Scope is the vacancy's hiring manager (guide §8), as on Vacancies: `team` and `own` see the
 * applications of vacancies whose hiring_manager_id is in their scope.
 *
 * The board is ranked by the weighted scorecard (guide §6.5) in SQL, so it pages in 25s on the
 * server; PART_SCORES is that one definition, and candidates.scorecard.js shapes the same scores
 * for the sheet.
 */
const { pageQuery, orderBy, completeQuery, TOTAL_COL } = require("../../shared/http/paged");
const { scopeClause } = require("../../shared/rbac/scope");

/**
 * Each part's score for application `a`, rounded as the sheet shows it, and the weighted total over
 * the vacancy's parts switched on (guide §6.5). A practical assessment counts as technical.
 */
const PART_SCORES = `
  LEFT JOIN LATERAL (
    SELECT round((array_agg(aa.score ORDER BY aa.submitted_at DESC NULLS LAST, aa.assigned_at DESC)
                    FILTER (WHERE d.assessment_type = 'psychometric'))[1], 1) AS psychometric,
           round((array_agg(aa.score ORDER BY aa.submitted_at DESC NULLS LAST, aa.assigned_at DESC)
                    FILTER (WHERE d.assessment_type IN ('technical', 'practical')))[1], 1) AS technical,
           round((array_agg(aa.score ORDER BY aa.submitted_at DESC NULLS LAST, aa.assigned_at DESC)
                    FILTER (WHERE d.assessment_type = 'case_study'))[1], 1) AS case_study
      FROM application_assessment aa
      JOIN assessment_definition d ON d.assessment_definition_id = aa.assessment_definition_id
     WHERE aa.application_id = a.application_id AND aa.status = 'scored' AND aa.score IS NOT NULL
  ) sit ON true
  LEFT JOIN LATERAL (
    SELECT round(avg(r.interview_score), 1) AS interview
      FROM interview_round r
     WHERE r.application_id = a.application_id AND r.status = 'closed' AND r.interview_score IS NOT NULL
  ) iv ON true
  LEFT JOIN LATERAL (
    SELECT round(sum(c.weight * p.score) / NULLIF(sum(c.weight), 0), 1) AS weighted_total,
           count(*)::int AS parts_scored
      FROM recruitment_scorecard_criterion c
      CROSS JOIN LATERAL (
        SELECT CASE c.code
                 WHEN 'screening' THEN round(COALESCE(a.screening_score, a.provisional_score), 1)
                 WHEN 'psychometric' THEN sit.psychometric
                 WHEN 'technical' THEN sit.technical
                 WHEN 'case_study' THEN sit.case_study
                 WHEN 'interview' THEN iv.interview
               END AS score
      ) p
     WHERE c.vacancy_id = a.vacancy_id AND c.active AND p.score IS NOT NULL
  ) wt ON true`;

/** Every application with what the board and the sheet show. */
const ROWS = `
  SELECT a.application_id, a.number::text AS number, a.candidate_id, a.vacancy_id, a.stage, a.status,
         a.source, a.applied_at, a.current_stage_entered_at, a.cover_letter, a.answers, a.years_experience,
         a.provisional_score, a.screening_score, a.screening_summary, a.screened_at, a.rejection_reason,
         a.cv_document_id, a.consented_at,
         btrim(k.first_name || ' ' || k.last_name) AS name, k.first_name, k.last_name, k.email::text AS email, k.phone,
         v.number::text AS vacancy_number, v.title AS vacancy_title, v.hiring_manager_id, v.status AS vacancy_status,
         COALESCE(a.screening_score, a.provisional_score) AS score,
         doc.scan_status AS cv_scan, doc.original_name AS cv_name, doc.bytes AS cv_bytes, doc.mime AS cv_mime,
         sit.psychometric, sit.technical, sit.case_study, iv.interview,
         wt.weighted_total, COALESCE(wt.parts_scored, 0) AS parts_scored,
         (SELECT count(*)::int FROM recruitment_scorecard_criterion c WHERE c.vacancy_id = a.vacancy_id AND c.active) AS parts_active,
         ARRAY(SELECT c.code::text FROM recruitment_scorecard_criterion c WHERE c.vacancy_id = a.vacancy_id AND c.active) AS active_parts,
         search_fold(a.number || ' ' || k.first_name || ' ' || k.last_name || ' ' || k.email || ' ' || v.title) AS haystack
    FROM application a
    JOIN candidate k ON k.candidate_id = a.candidate_id
    JOIN vacancy v ON v.vacancy_id = a.vacancy_id
    LEFT JOIN document doc ON doc.document_id = a.cv_document_id
    ${PART_SCORES}`;

/** The keys of Candidate (the board); the service adds days_at_stage and shapes the rest. */
const LIST_OUT = `x.application_id, x.number, x.candidate_id, x.vacancy_id, x.vacancy_number, x.vacancy_title,
  x.name, x.email, x.stage, x.status, x.source, x.applied_at, x.current_stage_entered_at, x.score,
  x.screening_score, x.provisional_score, x.weighted_total, x.parts_scored, x.parts_active, x.cv_scan,
  x.vacancy_status, x.active_parts`;

/** Oldest first unless asked; the board ranks with `sort=-weighted_total`. */
const SORTS = {
  applied_at: "x.applied_at",
  weighted_total: "x.weighted_total",
  score: "x.score",
  current_stage_entered_at: "x.current_stage_entered_at",
};

/**
 * One page of the board in scope.
 * @param {{stage?: string, vacancy_id?: string, status?: string, q?: string, page?: number, sort?: object}} query
 */
function list(db, query, scope) {
  const params = [query.stage || null, query.vacancy_id || null, query.status || null, query.q || null];
  const s = scopeClause(scope, { column: "x.hiring_manager_id" }, params);
  return pageQuery(
    db,
    `SELECT ${LIST_OUT}, ${TOTAL_COL}
       FROM (${ROWS}) x
      WHERE ($1::text IS NULL OR x.stage = $1)
        AND ($2::uuid IS NULL OR x.vacancy_id = $2)
        AND ($3::text IS NULL OR x.status = $3)
        AND ($4::text IS NULL OR x.haystack LIKE '%' || search_fold($4) || '%')
        ${s.and}
      ORDER BY ${orderBy(query, SORTS, "x.application_id")}`,
    params,
    query,
  );
}

/** One application with every column the service needs, or null. `lock` holds it for a write. */
async function get(db, id, { lock = false } = {}) {
  if (lock) await db.query("SELECT 1 FROM application WHERE application_id = $1 FOR UPDATE", [id]);
  const { rows } = await db.query(`SELECT * FROM (${ROWS}) x WHERE x.application_id = $1`, [id]);
  return rows[0] || null;
}

/** The four figures above the board and the spread of shown scores, in scope. */
async function summary(db, query, scope) {
  const params = [query.vacancy_id || null];
  const s = scopeClause(scope, { column: "v.hiring_manager_id" }, params);
  const { rows } = await db.query(
    `SELECT count(*)::int AS candidates,
            count(*) FILTER (WHERE a.stage = 'application' AND a.screening_score IS NULL)::int AS to_screen,
            count(*) FILTER (WHERE a.stage = 'interview')::int AS in_interview,
            count(*) FILTER (WHERE a.stage = 'shortlist')::int AS shortlisted,
            count(*) FILTER (WHERE COALESCE(a.screening_score, a.provisional_score) < 40)::int AS band_0,
            count(*) FILTER (WHERE COALESCE(a.screening_score, a.provisional_score) >= 40
                               AND COALESCE(a.screening_score, a.provisional_score) < 60)::int AS band_40,
            count(*) FILTER (WHERE COALESCE(a.screening_score, a.provisional_score) >= 60
                               AND COALESCE(a.screening_score, a.provisional_score) < 80)::int AS band_60,
            count(*) FILTER (WHERE COALESCE(a.screening_score, a.provisional_score) >= 80)::int AS band_80
       FROM application a
       JOIN vacancy v ON v.vacancy_id = a.vacancy_id
      WHERE a.status = 'active' AND ($1::uuid IS NULL OR a.vacancy_id = $1) ${s.and}`,
    params,
  );
  return rows[0];
}

/* ------------------------------------------------------------------ *
 * Apply (candidates.apply.js)
 * ------------------------------------------------------------------ */

/** The vacancy an Apply link is for, with what applying needs. `lock` holds it while applying. */
async function vacancy(db, id, { lock = false } = {}) {
  const { rows } = await db.query(
    `SELECT v.vacancy_id, v.number::text AS number, v.title, v.status, v.closes_at, v.min_experience_years,
            v.hiring_manager_id, v.location,
            (SELECT d.name FROM department d WHERE d.department_id = v.department_id) AS department
       FROM vacancy v WHERE v.vacancy_id = $1${lock ? " FOR SHARE" : ""}`,
    [id],
  );
  return rows[0] || null;
}

/** The vacancy's Apply questions in use, in order (at most 10 by the contract). */
async function applyQuestions(db, vacancyId) {
  // pagination:complete a vacancy's Apply questions are its form, at most 10 by the contract
  const { rows } = await completeQuery(
    db,
    `SELECT q.vacancy_question_id, q.question_type, q.prompt, q.options, q.required
       FROM vacancy_question q
      WHERE q.vacancy_id = $1 AND q.purpose = 'application' AND q.active
      ORDER BY q.display_order, q.vacancy_question_id`,
    [vacancyId],
  );
  return rows;
}

/** The person behind an email (case-insensitive), held for the save. */
async function candidateByEmail(client, email) {
  const { rows } = await client.query(
    "SELECT candidate_id, first_name, last_name, email::text AS email FROM candidate WHERE email = $1::citext FOR UPDATE",
    [email],
  );
  return rows[0] || null;
}

async function insertCandidate(client, { first_name: first, last_name: last, email, phone = null, consented_at: consented = null }) {
  const { rows } = await client.query(
    `INSERT INTO candidate (first_name, last_name, email, phone, consented_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
     RETURNING candidate_id`,
    [first, last, email, phone, consented],
  );
  return rows[0].candidate_id;
}

/** What a later application may add to a person already known: a phone they had not given. */
async function fillCandidate(client, id, { phone, consented_at: consented }) {
  await client.query(
    "UPDATE candidate SET phone = COALESCE(phone, $2), consented_at = COALESCE(consented_at, $3) WHERE candidate_id = $1",
    [id, phone || null, consented || null],
  );
}

/** Whether a CV sent on this link is still held by it (and not found infected). */
async function cvOnLink(db, documentId, entityType, tokenId, docType) {
  const { rows } = await db.query(
    `SELECT 1 FROM document WHERE document_id = $1 AND entity_type = $2 AND entity_id = $3 AND doc_type = $4
        AND scan_status <> 'infected'`,
    [documentId, entityType, String(tokenId), docType],
  );
  return rows.length === 1;
}

/** How many CVs one link holds. */
async function cvsOnLink(db, entityType, tokenId) {
  const { rows } = await db.query("SELECT count(*)::int AS n FROM document WHERE entity_type = $1 AND entity_id = $2", [entityType, String(tokenId)]);
  return rows[0].n;
}

/** An application of this person to this vacancy, if they have one. */
async function applicationOf(db, vacancyId, candidateId) {
  const { rows } = await db.query(
    "SELECT application_id, number::text AS number, applied_at, cv_document_id FROM application WHERE vacancy_id = $1 AND candidate_id = $2",
    [vacancyId, candidateId],
  );
  return rows[0] || null;
}

async function insertApplication(client, a) {
  const { rows } = await client.query(
    `INSERT INTO application (number, vacancy_id, candidate_id, source, stage, status, cover_letter, cv_document_id,
                              answers, years_experience, consented_at, provisional_score)
     VALUES ($1, $2, $3, $4, 'application', 'active', $5, $6, $7::jsonb, $8, $9, $10)
     RETURNING application_id, applied_at`,
    [
      a.number,
      a.vacancy_id,
      a.candidate_id,
      a.source,
      a.cover_letter,
      a.cv_document_id,
      JSON.stringify(a.answers || {}),
      a.years_experience,
      a.consented_at,
      a.provisional_score,
    ],
  );
  return rows[0];
}

/** The CV an application was made with (vault.adopt gave it to the application). */
async function setCv(client, id, documentId) {
  await client.query("UPDATE application SET cv_document_id = $2 WHERE application_id = $1", [id, documentId]);
}

/** Whether an Apply link was sent by staff (Invite to Apply) rather than made on the careers page. */
async function sentByStaff(db, publicTokenId) {
  const { rows } = await db.query("SELECT created_by IS NOT NULL AS staff FROM public_token WHERE public_token_id = $1", [publicTokenId]);
  return Boolean(rows[0] && rows[0].staff);
}

/** Whether the person was last invited back to this vacancy from the Talent Pool. */
async function invitedFromPool(db, candidateId, vacancyId) {
  // Every invite from the pool is kept (talent_pool_invite), so a member invited to two roles, or
  // taken off the pool while their link still works, keeps the source.
  const { rows } = await db.query(
    `SELECT 1 FROM talent_pool_invite i JOIN talent_pool_entry t ON t.talent_pool_entry_id = i.talent_pool_entry_id
      WHERE t.candidate_id = $1 AND i.vacancy_id = $2`,
    [candidateId, vacancyId],
  );
  return rows.length > 0;
}

/* ------------------------------------------------------------------ *
 * The pipeline
 * ------------------------------------------------------------------ */

/** A move: the stage, and the clock at it restarted (Home's Recruitment SLA reads it). */
async function setStage(client, id, stage) {
  await client.query(
    "UPDATE application SET stage = $2, current_stage_entered_at = now() WHERE application_id = $1",
    [id, stage],
  );
}

/** Not Progressing (with its reason) or Reopen (back to active, the reason cleared). */
async function setStatus(client, id, { status, rejection_reason: reason = null }) {
  await client.query(
    `UPDATE application
        SET status = $2, rejection_reason = $3,
            current_stage_entered_at = CASE WHEN $2 = 'active' THEN now() ELSE current_stage_entered_at END
      WHERE application_id = $1`,
    [id, status, reason],
  );
}

/** The application's moves, oldest first, with who made each. */
async function history(db, id) {
  // pagination:complete one application's moves, at most a few dozen; the contract caps the sheet at 50
  const { rows } = await completeQuery(
    db,
    `SELECT h.from_state, h.to_state, h.changed_at, h.reason,
            NULLIF(btrim(COALESCE(e.first_name, '') || ' ' || COALESCE(e.last_name, '')), '') AS actor_name
       FROM entity_state_history h
       LEFT JOIN app_user u ON u.user_id = h.actor_id
       LEFT JOIN employee e ON e.employee_id = u.employee_id
      WHERE h.entity_type = 'application' AND h.entity_id = $1
      ORDER BY h.changed_at, h.entity_state_history_id`,
    [id],
  );
  return rows;
}

/** The application's assessment sittings, newest first. */
async function sittings(db, id) {
  // pagination:complete one application's sittings, a handful; the contract caps the sheet at 20
  const { rows } = await completeQuery(
    db,
    `SELECT aa.application_assessment_id, d.name, d.assessment_type, aa.status, aa.score, aa.submitted_at
       FROM application_assessment aa
       JOIN assessment_definition d ON d.assessment_definition_id = aa.assessment_definition_id
      WHERE aa.application_id = $1
      ORDER BY aa.assigned_at DESC, aa.application_assessment_id`,
    [id],
  );
  return rows;
}

/** The application's interviews and their rounds; a round's score only once it is closed. */
async function interviews(db, id) {
  // pagination:complete one application's interviews, a handful; the contract caps the sheet at 20
  const { rows } = await completeQuery(
    db,
    `SELECT i.interview_id, i.scheduled_start, i.status, r.status AS round_status,
            CASE WHEN r.status = 'closed' THEN r.interview_score END AS interview_score
       FROM interview i
       JOIN interview_round r ON r.interview_round_id = i.interview_round_id
      WHERE r.application_id = $1
      ORDER BY i.scheduled_start DESC, i.interview_id`,
    [id],
  );
  return rows;
}

/* ------------------------------------------------------------------ *
 * Screening (candidates.score.js)
 * ------------------------------------------------------------------ */

/** The active applications of a vacancy with no AI read yet, oldest first. */
async function unscored(db, vacancyId) {
  // pagination:complete Screen With AI queues every unscored application of one role, each its own outbox event
  const { rows } = await completeQuery(
    db,
    `SELECT a.application_id FROM application a
      WHERE a.vacancy_id = $1 AND a.status = 'active' AND a.screening_score IS NULL
      ORDER BY a.applied_at, a.application_id`,
    [vacancyId],
  );
  return rows.map((r) => r.application_id);
}

/** The active applications of a vacancy, oldest first: Close Vacancy's Not Progressing for all. */
async function activeOf(db, vacancyId) {
  // pagination:complete Close Vacancy marks every candidate still in progress, each its own row and event
  const { rows } = await completeQuery(
    db,
    `SELECT a.application_id FROM application a
      WHERE a.vacancy_id = $1 AND a.status = 'active'
      ORDER BY a.applied_at, a.application_id`,
    [vacancyId],
  );
  return rows.map((r) => r.application_id);
}

/**
 * CVs still held by an Apply link that ended a day ago or more without making an application (it
 * lapsed, was revoked, or was spent by a second application from the same email), or whose link is
 * gone: at most 200 a run (apply-cv-purge).
 */
async function leftCvs(db, entityType) {
  const { rows } = await db.query(
    `SELECT d.document_id
       FROM document d
       LEFT JOIN public_token t ON t.public_token_id::text = d.entity_id
      WHERE d.entity_type = $1
        AND (t.public_token_id IS NULL
             OR t.expires_at < now() - interval '1 day'
             OR t.used_at < now() - interval '1 day'
             OR t.revoked_at < now() - interval '1 day')
      ORDER BY d.created_at, d.document_id
      LIMIT 200 -- pagination:batch the sweep takes at most 200 a run; the rest wait for the next`,
    [entityType],
  );
  return rows.map((r) => r.document_id);
}

/** Keep an AI read. */
async function setScreening(client, id, { score, summary: text, run_id: runId }) {
  await client.query(
    `UPDATE application
        SET screening_score = $2, screening_summary = $3, screening_ai_run_id = $4, screened_at = now()
      WHERE application_id = $1`,
    [id, score, text, runId],
  );
}

/** The person behind a candidate id, for mail. */
async function candidate(db, id) {
  const { rows } = await db.query(
    "SELECT candidate_id, first_name, last_name, email::text AS email FROM candidate WHERE candidate_id = $1",
    [id],
  );
  return rows[0] || null;
}

/** When a saved wording of a candidate email was kept. */
async function emailSavedAt(db, key, version) {
  const { rows } = await db.query(
    "SELECT created_at FROM template_version WHERE kind = 'email' AND key = $1 AND version = $2",
    [key, version],
  );
  return rows[0] ? rows[0].created_at : null;
}

module.exports = {
  PART_SCORES,
  activeOf,
  leftCvs,
  candidate,
  emailSavedAt,
  list,
  get,
  summary,
  vacancy,
  applyQuestions,
  candidateByEmail,
  insertCandidate,
  fillCandidate,
  cvOnLink,
  cvsOnLink,
  applicationOf,
  insertApplication,
  setCv,
  sentByStaff,
  invitedFromPool,
  setStage,
  setStatus,
  history,
  sittings,
  interviews,
  unscored,
  setScreening,
};
