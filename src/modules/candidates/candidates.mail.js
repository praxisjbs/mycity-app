"use strict";
/**
 * The candidate emails this module sends (docs/guides/recruitment.md §6.8), from the outbox after
 * the change that caused each has committed: queued on email-send, so a request never waits on
 * the mail server and paused mail waits in the queue.
 *
 *   received(event)       application-received to the candidate
 *   invite(event)         apply-invite: the Apply link is made here (7 days, single use), so its
 *                         token never sits in the outbox; the event carries only who and which role
 *   notProgressed(event)  candidate-not-progressed; the reason stays on the record and is not sent
 *
 * Each email is queued once per event (jobId), so a handler run again sends nothing twice.
 */
const { pool } = require("../../config/db");
const { config } = require("../../config/env");
const { atomically } = require("../../shared/db/tx");
const publicToken = require("../../shared/tokens/public-token");
const lifecycle = require("../vacancies/vacancies.lifecycle");
const repo = require("./candidates.repo");
const { EMAILS } = require("./candidates.events");

/** An invited Apply link lives 7 days (guide §6.2). */
const INVITE_TTL_HOURS = 7 * 24;

const origin = () => String(config.PUBLIC_ORIGIN).replace(/\/+$/, "");

function queue(template, to, data, jobId) {
  return require("../../jobs/queues").enqueue(
    "email-send",
    template,
    {
      to: { name: `${to.first_name} ${to.last_name}`.trim(), email: to.email },
      recipient: { first_name: to.first_name, last_name: to.last_name, email: to.email },
      template,
      data,
    },
    { jobId },
  );
}

async function received(event) {
  const a = await repo.get(pool, event.payload.application_id);
  if (!a) return;
  await queue(
    EMAILS.received,
    a,
    { vacancy_title: a.vacancy_title, reference: a.number },
    `application-received-${a.application_id}`,
  );
}

async function invite(event) {
  const { candidate_id: candidateId, vacancy_id: vacancyId } = event.payload;
  const v = await repo.vacancy(pool, vacancyId);
  const person = await repo.candidate(pool, candidateId);
  if (!v || !person || !lifecycle.takesApplications(v)) return;
  const client = await pool.connect();
  let link;
  try {
    link = await atomically(client, () =>
      publicToken.issue(client, {
        scope: "application.apply",
        subject_type: "vacancy",
        subject_id: vacancyId,
        ttl_hours: INVITE_TTL_HOURS,
        single_use: true,
        created_by: event.actor_user_id || event.payload.invited_by,
      }),
    );
  } finally {
    client.release();
  }
  await queue(
    EMAILS.invite,
    person,
    { vacancy_title: v.title, apply_url: `${origin()}/apply/${link.token}`, expires_at: new Date(link.expires_at).toISOString() },
    `apply-invite-${event.event_id}`,
  );
}

async function notProgressed(event) {
  const a = await repo.get(pool, event.payload.application_id);
  if (!a || a.status !== "not_progressed") return;
  await queue(
    EMAILS.notProgressed,
    a,
    { vacancy_title: a.vacancy_title, careers_url: `${origin()}/jobs` },
    `candidate-not-progressed-${event.event_id}`,
  );
}

module.exports = { received, invite, notProgressed, INVITE_TTL_HOURS };
