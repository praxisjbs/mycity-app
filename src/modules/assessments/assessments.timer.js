"use strict";
/**
 * The clock of a sitting, and how a sitting ends (docs/guides/recruitment.md §6.7). Loads no staff
 * auth: the public delivery and the scheduler use it as well as staff.
 *
 *   dueAt(definition, sitting, now)   when a started sitting ends: start plus the minutes, or 23:59
 *                                     Lagos on the due day of an untimed brief
 *   finish(client, row, status)       end it (submitted, timed_out, expired or cancelled): the link
 *                                     stops working, and an ended sitting is scored at once when
 *                                     every answer scores itself, else waits for Mark Answers
 *   score(client, row, actor)         the score once every answer has a mark
 *   sweep()                           assessment-expiry: past due_at → timed_out; never started by
 *                                     the start-by day → expired
 */
const { pool } = require("../../config/db");
const { logger } = require("../../config/logger");
const { atomically } = require("../../shared/db/tx");
const { emit } = require("../../shared/events/emit");
const lagos = require("../../shared/time/lagos");
const publicToken = require("../../shared/tokens/public-token");
const repo = require("./assessments.repo");
const scoring = require("./assessments.scoring");
const { EVENTS, SUBJECT } = require("./assessments.events");

/**
 * How long a started sitting's link outlives its due_at: a day, so the candidate who saves or opens the
 * link late reads Time Up from the sitting rather than a link that no longer exists.
 */
const LINK_GRACE_MS = 24 * 3_600_000;

/** The last instant of a Lagos day. */
const endOfDay = (date) => new Date(lagos.endOfDayExclusive(date).getTime() - 1000);

function dueAt(row, now = new Date()) {
  if (row.duration_minutes) return new Date(now.getTime() + Number(row.duration_minutes) * 60_000);
  return endOfDay(lagos.addDays(lagos.dateOf(now), Number(row.due_days) || 5));
}

/** Whether a started sitting has run out of time. */
const pastDue = (row, now = new Date()) => row.status === "in_progress" && row.due_at && new Date(row.due_at) <= now;

const ENDED = {
  submitted: EVENTS.ASSESSMENT_SUBMITTED,
  timed_out: EVENTS.ASSESSMENT_TIMED_OUT,
  expired: EVENTS.ASSESSMENT_EXPIRED,
  cancelled: EVENTS.ASSESSMENT_CANCELLED,
};

const payloadOf = (row) => ({
  application_assessment_id: row.application_assessment_id,
  application_id: row.application_id,
  application_number: row.application_number,
  assessment_name: row.assessment_name,
  subject_employee_id: row.hiring_manager_id,
});

/** Score a finished sitting once every answer has a mark; returns the score, or null while some wait. */
async function score(client, row, actor = null) {
  const questions = await repo.questions(client, row.assessment_definition_id);
  const answers = await repo.responses(client, row.application_assessment_id);
  const awards = new Map(
    [...answers.entries()].map(([id, r]) => [id, { answered: r.response !== null || r.document_id !== null, awarded: r.awarded_score }]),
  );
  const result = scoring.scoreOf(questions, awards);
  if (result === null) return null;
  await repo.setScore(client, row.application_assessment_id, result);
  await emit(client, {
    key: EVENTS.ASSESSMENT_SCORED,
    entity: { type: SUBJECT, id: row.application_assessment_id },
    actor,
    payload: { ...payloadOf(row), score: result },
  });
  return result;
}

/**
 * Lock a sitting for a write, its link first: the candidate's page locks the link and then the
 * sitting, so everything that ends one takes them in that order too, and the two never deadlock.
 */
async function lockSitting(client, id) {
  await repo.lockLinks(client, id);
  return repo.sitting(client, id, { lock: true });
}

/**
 * End a sitting inside the caller's transaction; `row` was locked with lockSitting. A cancelled or
 * expired sitting's link stops working; a submitted or timed-out one keeps its link until it lapses,
 * so the candidate who opens it again reads that it is over rather than a dead link (guide §11).
 */
async function finish(client, row, status, actor = null) {
  await repo.end(client, row.application_assessment_id, status);
  if (status === "cancelled" || status === "expired")
    await publicToken.revokeFor(client, { subject_type: SUBJECT, subject_id: row.application_assessment_id });
  await emit(client, {
    key: ENDED[status],
    entity: { type: SUBJECT, id: row.application_assessment_id },
    actor,
    payload: payloadOf(row),
  });
  if (status !== "submitted" && status !== "timed_out") return null;
  const result = await score(client, row, actor);
  if (result === null) {
    await emit(client, {
      key: EVENTS.ASSESSMENT_TO_MARK,
      entity: { type: SUBJECT, id: row.application_assessment_id },
      actor,
      payload: payloadOf(row),
    });
  }
  return result;
}

/** assessment-expiry: one transaction a sitting, so one bad row stops nothing else. */
async function sweep(now = new Date()) {
  const rows = await repo.due(pool, lagos.dateOf(now));
  let ended = 0;
  for (const { application_assessment_id: id } of rows) {
    const client = await pool.connect();
    try {
      await atomically(client, async () => {
        const row = await lockSitting(client, id);
        if (!row) return;
        if (pastDue(row, now)) await finish(client, row, "timed_out");
        else if (row.status === "sent" && row.start_by < lagos.dateOf(now)) await finish(client, row, "expired");
        else return;
        ended += 1;
      });
    } catch (err) {
      // One sitting that cannot be ended is logged and tried again next minute; the rest go on.
      logger.warn({ err: err.code || err.message, application_assessment_id: id }, "assessment-expiry: a sitting could not be ended");
    } finally {
      client.release();
    }
  }
  return { ended };
}

module.exports = { LINK_GRACE_MS, dueAt, pastDue, endOfDay, lockSitting, finish, score, sweep };
