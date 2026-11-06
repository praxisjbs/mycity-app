"use strict";
/**
 * The daily reminder (jobs/schedulers/interview-reminders.js): one notice a day to each panelist of
 * an interview that has ended in an open round and whose card is not submitted. A notice per seat per
 * Lagos day (dedup_key), so a tick run twice reminds nobody twice. The same tick closes a round whose
 * cards were all in before the interview started, now that it has (interviews.consolidate closeStarted).
 */
const { pool } = require("../../config/db");
const { atomically } = require("../../shared/db/tx");
const { emit } = require("../../shared/events/emit");
const lagos = require("../../shared/time/lagos");
const repo = require("./interviews.repo");
const consolidate = require("./interviews.consolidate");
const { EVENTS } = require("./interviews.events");

async function remind(now = new Date()) {
  const closed = await consolidate.closeStarted();
  const due = await repo.due(pool);
  const day = lagos.dateOf(now);
  const client = await pool.connect();
  try {
    await atomically(client, async () => {
      for (const seat of due) {
        await emit(client, {
          key: EVENTS.INTERVIEW_FEEDBACK_DUE,
          entity: { type: "interview", id: seat.interview_id },
          actor: null,
          dedup_key: `interview-feedback-due:${seat.interview_panelist_id}:${day}`,
          payload: {
            interview_id: seat.interview_id,
            application_number: seat.application_number,
            vacancy_title: seat.vacancy_title,
            subject_employee_id: seat.employee_id,
          },
        });
      }
    });
  } finally {
    client.release();
  }
  return closed ? { reminded: due.length, closed } : { reminded: due.length };
}

module.exports = { remind };
