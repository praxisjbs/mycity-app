"use strict";
/**
 * Interviews: the SQL (docs/guides/recruitment.md §4, §6.6). Writes interview_round, interview,
 * interview_panelist, interview_feedback and interview_rating; reads the application, candidate,
 * vacancy and worksite they belong to. Never emits (BACKEND_GUIDE §2).
 *
 * Who sees an interview: its vacancy's hiring manager in the reader's scope, or a seat on its panel
 * (guide §8). Who sees a card's scoring: BLIND below, the one predicate the sheet, the AI read and the
 * form all use: the reader's own card, or a submitted card of a closed round. Private notes are read
 * only for the reader's own card (myFeedback), never in a panel read.
 */
const { personJson } = require("../../shared/db/person");
const { pageQuery, orderBy, completeQuery, TOTAL_COL } = require("../../shared/http/paged");

/**
 * A card's scoring is visible to employee `$me` when it is theirs, or submitted in a closed round.
 * @param {string} me  the SQL of the reader's employee id
 */
const BLIND = (me) => `(p.employee_id = ${me} OR (f.submitted_at IS NOT NULL AND r.status = 'closed'))`;

/** Every interview with what the list and the sheet show. `$1` is the reader's employee id. */
const ROWS = `
  SELECT i.interview_id, i.interview_round_id, r.application_id, i.interview_type, i.scheduled_start, i.scheduled_end,
         i.status, i.meeting_url, i.worksite_id, i.calendar_event_id, i.created_by,
         r.round_number, r.title, r.status AS round_status, r.closed_at, r.interview_score::float AS interview_score,
         r.report, r.decision, r.reported_at, r.current_employer, r.academics, r.total_experience_months,
         r.relevant_experience_months, r.form_document_id,
         NULLIF(btrim(COALESCE(re.first_name, '') || ' ' || COALESCE(re.last_name, '')), '') AS reported_by_name,
         a.number::text AS application_number, a.cv_document_id, a.status AS application_status, a.stage,
         btrim(k.first_name || ' ' || k.last_name) AS candidate_name, k.first_name AS candidate_first_name,
         k.last_name AS candidate_last_name, k.email::text AS candidate_email,
         v.vacancy_id, v.number::text AS vacancy_number, v.title AS vacancy_title, v.hiring_manager_id,
         d.name AS department,
         w.name AS worksite_name, NULLIF(w.address ->> 'text', '') AS worksite_address,
         (SELECT count(*)::int FROM interview_panelist p WHERE p.interview_id = i.interview_id) AS panel_size,
         (SELECT count(*)::int FROM interview_panelist p WHERE p.interview_id = i.interview_id AND p.submitted_at IS NOT NULL) AS submitted_count,
         EXISTS (SELECT 1 FROM interview_panelist p WHERE p.interview_id = i.interview_id AND p.employee_id = $1::uuid) AS on_panel,
         EXISTS (SELECT 1 FROM interview_panelist p WHERE p.interview_id = i.interview_id AND p.employee_id = $1::uuid
                   AND p.submitted_at IS NOT NULL) AS my_submitted,
         search_fold(k.first_name || ' ' || k.last_name || ' ' || v.title || ' ' || a.number) AS haystack
    FROM interview i
    JOIN interview_round r ON r.interview_round_id = i.interview_round_id
    JOIN application a ON a.application_id = r.application_id
    JOIN candidate k ON k.candidate_id = a.candidate_id
    JOIN vacancy v ON v.vacancy_id = a.vacancy_id
    LEFT JOIN department d ON d.department_id = v.department_id
    LEFT JOIN worksite w ON w.worksite_id = i.worksite_id
    LEFT JOIN app_user ru ON ru.user_id = r.reported_by
    LEFT JOIN employee re ON re.employee_id = ru.employee_id`;

/** The reader may see the interview: scope over its hiring manager, or a seat on its panel. */
function visible(scope, params) {
  if (scope.scope === "all") return "";
  params.push(scope.scope_ids || []);
  return `AND (x.hiring_manager_id = ANY($${params.length}::uuid[]) OR x.on_panel)`;
}

const SORTS = { scheduled_start: "x.scheduled_start" };

/** One page of interviews the reader may see. */
function list(db, query, scope, employeeId) {
  const params = [
    employeeId,
    query.when || null,
    query.mine === "true",
    query.application_id || null,
    query.status || null,
    query.q || null,
  ];
  const s = visible(scope, params);
  return pageQuery(
    db,
    `SELECT x.*, ${TOTAL_COL}
       FROM (${ROWS}) x
      WHERE ($2::text IS NULL OR ($2 = 'upcoming' AND x.scheduled_end >= now()) OR ($2 = 'past' AND x.scheduled_end < now()))
        AND (NOT $3 OR x.on_panel)
        AND ($4::uuid IS NULL OR x.application_id = $4)
        AND ($5::text IS NULL OR x.status = $5)
        AND ($6::text IS NULL OR x.haystack LIKE '%' || search_fold($6) || '%')
        ${s}
      ORDER BY ${orderBy(query, SORTS, "x.interview_id")}`,
    params,
    query,
  );
}

/** One interview as the reader may see it, or null. `lock` holds the interview and its round for a write. */
async function get(db, id, employeeId, { lock = false } = {}) {
  if (lock)
    await db.query(
      `SELECT 1 FROM interview i JOIN interview_round r ON r.interview_round_id = i.interview_round_id
        WHERE i.interview_id = $1 FOR UPDATE OF i, r`,
      [id],
    );
  const { rows } = await db.query(`SELECT * FROM (${ROWS}) x WHERE x.interview_id = $2`, [employeeId || null, id]);
  return rows[0] || null;
}

/** The interviews of an application still to happen (Not Progressing cancels them). */
async function scheduledFor(db, applicationId) {
  // pagination:complete one application's scheduled interviews, a handful
  const { rows } = await completeQuery(
    db,
    `SELECT i.interview_id FROM interview i JOIN interview_round r ON r.interview_round_id = i.interview_round_id
      WHERE r.application_id = $1 AND i.status = 'scheduled' ORDER BY i.scheduled_start, i.interview_id`,
    [applicationId],
  );
  return rows.map((r) => r.interview_id);
}

/* ------------------------------------------------------------------ *
 * The panel
 * ------------------------------------------------------------------ */

/**
 * The seats, with each card's scoring only where BLIND allows it for `$2` (the reader). Ratings are
 * a json list, null when hidden.
 */
async function panel(db, interviewId, employeeId) {
  // pagination:complete a panel is at most 8 seats by the contract
  const { rows } = await completeQuery(
    db,
    `SELECT p.interview_panelist_id, p.employee_id, p.submitted_at, ${personJson("e", "ed")} AS panelist,
            ${BLIND("$2::uuid")} AS shown,
            CASE WHEN ${BLIND("$2::uuid")} THEN f.overall_rating END AS overall_rating,
            CASE WHEN ${BLIND("$2::uuid")} THEN f.decision END AS decision,
            CASE WHEN ${BLIND("$2::uuid")} THEN f.comments END AS comments,
            CASE WHEN ${BLIND("$2::uuid")} THEN
              (SELECT COALESCE(json_agg(json_build_object('vacancy_question_id', g.vacancy_question_id, 'rating', g.rating)
                                ORDER BY g.vacancy_question_id), '[]'::json)
                 FROM interview_rating g WHERE g.interview_feedback_id = f.interview_feedback_id)
            END AS ratings
       FROM interview_panelist p
       JOIN interview i ON i.interview_id = p.interview_id
       JOIN interview_round r ON r.interview_round_id = i.interview_round_id
       JOIN employee e ON e.employee_id = p.employee_id
       LEFT JOIN department ed ON ed.department_id = e.department_id
       LEFT JOIN interview_feedback f ON f.interview_panelist_id = p.interview_panelist_id
      WHERE p.interview_id = $1
      ORDER BY e.first_name, e.last_name, p.interview_panelist_id`,
    [interviewId, employeeId || null],
  );
  return rows;
}

/** The reader's own seat and card, with their private notes; null when they are not on the panel. */
async function myFeedback(db, interviewId, employeeId) {
  if (!employeeId) return null;
  const { rows } = await db.query(
    `SELECT p.interview_panelist_id, p.submitted_at AS seat_submitted_at, f.interview_feedback_id, f.overall_rating,
            f.decision, f.comments, f.private_notes, f.submitted_at,
            (SELECT COALESCE(json_agg(json_build_object('vacancy_question_id', g.vacancy_question_id, 'rating', g.rating)
                              ORDER BY g.vacancy_question_id), '[]'::json)
               FROM interview_rating g WHERE g.interview_feedback_id = f.interview_feedback_id) AS ratings
       FROM interview_panelist p
       LEFT JOIN interview_feedback f ON f.interview_panelist_id = p.interview_panelist_id
      WHERE p.interview_id = $1 AND p.employee_id = $2`,
    [interviewId, employeeId],
  );
  return rows[0] || null;
}

/** Employees who may sit on a panel: active, with a login that holds `recruitment` view (or the CEO). */
async function eligible(db, employeeIds) {
  const { rows } = await db.query(
    `SELECT DISTINCT e.employee_id, e.work_email::text AS work_email
       FROM employee e
       JOIN app_user u ON u.employee_id = e.employee_id AND u.status = 'active'
      WHERE e.employee_id = ANY($1::uuid[]) AND e.status = 'active'
        AND (u.is_ceo = true OR EXISTS (
              SELECT 1 FROM user_role ur JOIN permission p ON p.role_id = ur.role_id
               WHERE ur.user_id = u.user_id AND p.module_key = 'recruitment' AND p.can_view = true
                 AND (ur.effective_to IS NULL OR ur.effective_to > CURRENT_DATE)))`,
    [employeeIds],
  );
  return rows;
}

/* ------------------------------------------------------------------ *
 * Writes
 * ------------------------------------------------------------------ */

async function insertRound(client, applicationId, title) {
  await client.query("SELECT 1 FROM application WHERE application_id = $1 FOR UPDATE", [applicationId]);
  const { rows } = await client.query(
    `INSERT INTO interview_round (application_id, round_number, title, status)
     SELECT $1, COALESCE(max(round_number), 0) + 1, COALESCE($2, 'Interview ' || (COALESCE(max(round_number), 0) + 1)), 'open'
       FROM interview_round WHERE application_id = $1
     RETURNING interview_round_id, round_number, title`,
    [applicationId, title || null],
  );
  return rows[0];
}

async function insertInterview(client, i) {
  const { rows } = await client.query(
    `INSERT INTO interview (interview_round_id, interview_type, scheduled_start, scheduled_end, worksite_id, meeting_url, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING interview_id`,
    [i.interview_round_id, i.interview_type, i.scheduled_start, i.scheduled_end, i.worksite_id || null, i.meeting_url || null, i.created_by],
  );
  return rows[0].interview_id;
}

const WRITABLE = ["interview_type", "scheduled_start", "scheduled_end", "worksite_id", "meeting_url", "status", "calendar_event_id"];

async function updateInterview(client, id, fields) {
  const keys = WRITABLE.filter((k) => fields[k] !== undefined);
  if (!keys.length) return;
  await client.query(`UPDATE interview SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(", ")} WHERE interview_id = $1`, [
    id,
    ...keys.map((k) => fields[k]),
  ]);
}

/**
 * The panel set to these employees: new seats added, and a seat taken off goes with its draft (a
 * draft is never counted). A seat whose card is submitted stays: that card is part of the round.
 * Returns the ids now on it.
 */
async function setPanel(client, interviewId, employeeIds) {
  await client.query(
    `DELETE FROM interview_panelist p
      WHERE p.interview_id = $1 AND NOT (p.employee_id = ANY($2::uuid[])) AND p.submitted_at IS NULL`,
    [interviewId, employeeIds],
  );
  for (const e of employeeIds)
    await client.query(
      "INSERT INTO interview_panelist (interview_id, employee_id) VALUES ($1, $2) ON CONFLICT (interview_id, employee_id) DO NOTHING",
      [interviewId, e],
    );
  const { rows } = await client.query("SELECT employee_id FROM interview_panelist WHERE interview_id = $1", [interviewId]);
  return rows.map((r) => r.employee_id);
}

/** A card: made on first save, a draft until submitted. */
async function saveFeedback(client, panelistId, f) {
  const { rows } = await client.query(
    `INSERT INTO interview_feedback (interview_panelist_id, overall_rating, decision, comments, private_notes)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (interview_panelist_id) DO UPDATE SET
       overall_rating = CASE WHEN $6 THEN EXCLUDED.overall_rating ELSE interview_feedback.overall_rating END,
       decision = CASE WHEN $7 THEN EXCLUDED.decision ELSE interview_feedback.decision END,
       comments = CASE WHEN $8 THEN EXCLUDED.comments ELSE interview_feedback.comments END,
       private_notes = CASE WHEN $9 THEN EXCLUDED.private_notes ELSE interview_feedback.private_notes END
     RETURNING interview_feedback_id`,
    [
      panelistId,
      f.overall_rating ?? null,
      f.decision ?? null,
      f.comments ?? null,
      f.private_notes ?? null,
      f.overall_rating !== undefined,
      f.decision !== undefined,
      f.comments !== undefined,
      f.private_notes !== undefined,
    ],
  );
  return rows[0].interview_feedback_id;
}

async function saveRating(client, feedbackId, questionId, rating) {
  await client.query(
    `INSERT INTO interview_rating (interview_feedback_id, vacancy_question_id, rating) VALUES ($1, $2, $3)
     ON CONFLICT (interview_feedback_id, vacancy_question_id) DO UPDATE SET rating = EXCLUDED.rating`,
    [feedbackId, questionId, rating],
  );
}

async function submitFeedback(client, panelistId) {
  await client.query("UPDATE interview_feedback SET submitted_at = now() WHERE interview_panelist_id = $1", [panelistId]);
  await client.query("UPDATE interview_panelist SET submitted_at = now() WHERE interview_panelist_id = $1", [panelistId]);
}

/** Each submitted card's score: the mean of its ratings, or its overall rating (1 to 10). */
async function cardScores(db, interviewId) {
  // pagination:complete a panel is at most 8 seats
  const { rows } = await completeQuery(
    db,
    `SELECT p.interview_panelist_id,
            COALESCE((SELECT avg(g.rating) FROM interview_rating g
                        JOIN vacancy_question q ON q.vacancy_question_id = g.vacancy_question_id AND q.active AND q.purpose = 'interview'
                       WHERE g.interview_feedback_id = f.interview_feedback_id), f.overall_rating)::float AS score
       FROM interview_panelist p JOIN interview_feedback f ON f.interview_panelist_id = p.interview_panelist_id
      WHERE p.interview_id = $1 AND f.submitted_at IS NOT NULL
      ORDER BY p.interview_panelist_id`,
    [interviewId],
  );
  return rows;
}

/** Each trait's mean over the submitted cards. */
async function traitAverages(db, interviewId) {
  // pagination:complete one row a trait, at most 20
  const { rows } = await completeQuery(
    db,
    `SELECT g.vacancy_question_id, round(avg(g.rating), 1)::float AS average
       FROM interview_panelist p
       JOIN interview_feedback f ON f.interview_panelist_id = p.interview_panelist_id AND f.submitted_at IS NOT NULL
       JOIN interview_rating g ON g.interview_feedback_id = f.interview_feedback_id
      WHERE p.interview_id = $1
      GROUP BY g.vacancy_question_id
      ORDER BY g.vacancy_question_id`,
    [interviewId],
  );
  return rows;
}

async function closeRound(client, roundId, { score, by }) {
  await client.query(
    `UPDATE interview_round SET status = 'closed', closed_at = now(), closed_by = $2, interview_score = $3
      WHERE interview_round_id = $1 AND status = 'open'`,
    [roundId, by, score],
  );
}

async function saveReport(client, roundId, { report, decision, by }) {
  await client.query(
    "UPDATE interview_round SET report = $2, decision = $3, reported_by = $4, reported_at = now() WHERE interview_round_id = $1",
    [roundId, report, decision, by],
  );
}

async function setTitle(client, roundId, title) {
  await client.query("UPDATE interview_round SET title = $2 WHERE interview_round_id = $1", [roundId, title]);
}

async function setForm(client, roundId, documentId) {
  await client.query("UPDATE interview_round SET form_document_id = $2 WHERE interview_round_id = $1", [roundId, documentId]);
}

const DETAILS = ["current_employer", "academics", "total_experience_months", "relevant_experience_months"];

async function saveDetails(client, roundId, fields) {
  const keys = DETAILS.filter((k) => fields[k] !== undefined);
  if (!keys.length) return;
  await client.query(`UPDATE interview_round SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(", ")} WHERE interview_round_id = $1`, [
    roundId,
    ...keys.map((k) => fields[k]),
  ]);
}

/** Panelists who have not submitted for interviews that ended in an open round (the daily reminder). */
async function due(db) {
  // pagination:complete one reminder a missing card a day; open rounds are few
  const { rows } = await completeQuery(
    db,
    `SELECT p.interview_panelist_id, p.employee_id, i.interview_id, a.number::text AS application_number, v.title AS vacancy_title
       FROM interview_panelist p
       JOIN interview i ON i.interview_id = p.interview_id
       JOIN interview_round r ON r.interview_round_id = i.interview_round_id
       JOIN application a ON a.application_id = r.application_id
       JOIN vacancy v ON v.vacancy_id = a.vacancy_id
      WHERE r.status = 'open' AND i.status <> 'cancelled' AND i.scheduled_end < now() AND p.submitted_at IS NULL
      ORDER BY i.interview_id, p.interview_panelist_id`,
  );
  return rows;
}

/** A worksite still in use, by id, with its readable address line. */
async function worksite(db, id) {
  const { rows } = await db.query(
    "SELECT worksite_id, name, NULLIF(address ->> 'text', '') AS address FROM worksite WHERE worksite_id = $1 AND active",
    [id],
  );
  return rows[0] || null;
}

/** The calendar entry's change count, so the candidate's .ics carries the same SEQUENCE. */
async function icsSequence(db, calendarEventId) {
  if (!calendarEventId) return 0;
  const { rows } = await db.query("SELECT ics_sequence FROM calendar_event WHERE calendar_event_id = $1", [calendarEventId]);
  return rows[0] ? Number(rows[0].ics_sequence) || 0 : 0;
}

/** The login behind a user id, as an actor a handler can act as. */
async function actorOf(db, userId) {
  if (!userId) return null;
  const { rows } = await db.query("SELECT user_id, employee_id FROM app_user WHERE user_id = $1", [userId]);
  return rows[0] || null;
}

module.exports = {
  BLIND,
  list,
  get,
  scheduledFor,
  panel,
  myFeedback,
  eligible,
  insertRound,
  insertInterview,
  updateInterview,
  setPanel,
  saveFeedback,
  saveRating,
  submitFeedback,
  cardScores,
  traitAverages,
  closeRound,
  saveReport,
  setTitle,
  setForm,
  saveDetails,
  due,
  worksite,
  icsSequence,
  actorOf,
};
