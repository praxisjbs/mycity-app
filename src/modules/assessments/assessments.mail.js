"use strict";
/**
 * assessment-invite (docs/guides/recruitment.md §6.7, §6.8), from the outbox after Send commits. The
 * link is made here, so its token never sits in the outbox: single use is not set (the candidate
 * opens it again to resume), it lives until 23:59 Lagos on the start-by day, and Start moves its end
 * to the sitting's due_at. A handler run again makes a new link and stops the old one, and the email
 * is queued once per event.
 */
const { pool } = require("../../config/db");
const { config } = require("../../config/env");
const { atomically } = require("../../shared/db/tx");
const publicToken = require("../../shared/tokens/public-token");
const repo = require("./assessments.repo");
const timer = require("./assessments.timer");
const { SCOPE, SUBJECT } = require("./assessments.events");

const TEMPLATE = "assessment-invite";

async function invite(event) {
  const id = event.payload.application_assessment_id;
  const client = await pool.connect();
  let made;
  try {
    made = await atomically(client, async () => {
      const row = await repo.sitting(client, id, { lock: true });
      if (!row || row.status !== "sent" || row.application_status !== "active") return null;
      const until = timer.endOfDay(row.start_by);
      const hours = Math.max(1, Math.ceil((until.getTime() - Date.now()) / 3_600_000));
      await publicToken.revokeFor(client, { subject_type: SUBJECT, subject_id: id });
      const link = await publicToken.issue(client, {
        scope: SCOPE,
        subject_type: SUBJECT,
        subject_id: id,
        ttl_hours: Math.min(hours, publicToken.MAX_TTL_HOURS),
        created_by: event.actor_user_id || null,
      });
      await repo.setLink(client, id, link.public_token_id);
      return { row, token: link.token };
    });
  } finally {
    client.release();
  }
  if (!made) return;
  const { row, token } = made;
  const timed = Boolean(row.duration_minutes);
  await require("../../jobs/queues").enqueue(
    "email-send",
    TEMPLATE,
    {
      to: { name: row.candidate_name, email: row.candidate_email },
      recipient: { first_name: row.candidate_first_name, last_name: row.candidate_last_name, email: row.candidate_email },
      template: TEMPLATE,
      data: {
        vacancy_title: row.vacancy_title,
        assessment_name: row.assessment_name,
        duration_minutes: timed ? row.duration_minutes : null,
        due_days: timed ? null : row.due_days || 5,
        start_by: row.start_by,
        assess_url: `${String(config.PUBLIC_ORIGIN).replace(/\/+$/, "")}/assess/${token}`,
      },
    },
    { jobId: `assessment-invite-${event.event_id}` },
  );
}

module.exports = { invite };
