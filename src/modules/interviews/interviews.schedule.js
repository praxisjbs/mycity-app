"use strict";
/**
 * Scheduling an interview (docs/guides/recruitment.md §3 step 8, §6.6): one round, one interview, its
 * panel, and a calendar entry through the calendar's own write path (createIn, editIn, cancelIn; the
 * panelists are its attendees and hear through calendar.invitations). The candidate is mailed
 * interview-invite with the .ics from the outbox, once the save has committed.
 *
 *   schedule(actor, scope, body)          a new round; the candidate moves to Interview
 *   reschedule(actor, scope, id, body)    a new time, place or panel; a change of panel alone is not
 *                                         sent to the candidate; a panel left with only submitted
 *                                         seats closes the round as the last card would
 *   cancel(actor, scope, id, body)        the entry and the candidate's invite cancelled; the round
 *                                         closes with no score
 *   cancelForApplication(applicationId, userId)   Not Progressing cancels what is still scheduled
 *   mailCandidate(event)                  interview-invite and its .ics (a REQUEST, or a CANCEL)
 *
 * A panelist holds `recruitment` view, is not the candidate, and is at most one of eight.
 */
const { pool } = require("../../config/db");
const { config } = require("../../config/env");
const { atomically } = require("../../shared/db/tx");
const { AppError } = require("../../shared/errors");
const { emit } = require("../../shared/events/emit");
const { assertInScope } = require("../../shared/rbac/scope");
const ics = require("../../services/calendar/ics");
const calendar = require("../calendar/calendar.service");
const candidates = require("../candidates/candidates.service");
const candidateRepo = require("../candidates/candidates.repo");
const repo = require("./interviews.repo");
const consolidate = require("./interviews.consolidate");
const { EVENTS } = require("./interviews.events");

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

const notFound = () => new AppError("NOT_FOUND", "That interview does not exist", 404);
const field = (name, message) => new AppError("VALIDATION_FAILED", message, 422, { [name]: [message] });

/** "Ada Obi", "Ada Obi and Ife Ojo", "Ada Obi, Ife Ojo and 2 others". */
function sayNames(names) {
  if (names.length <= 1) return names[0] || "Someone";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  if (names.length === 3) return `${names[0]}, ${names[1]} and ${names[2]}`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} others`;
}

/**
 * The panel checked: everyone holds Recruitment and is on the staff, and none of them is the candidate.
 * A refusal names who cannot sit (the form's line); the field's own message stays short.
 */
async function checkPanel(client, ids, candidateEmail) {
  const ok = await repo.eligible(client, ids);
  const allowed = new Set(ok.map((e) => e.employee_id));
  const out = [...new Set(ids)].filter((id) => !allowed.has(id));
  if (out.length) {
    const names = (await repo.namesOf(client, out)).map((e) => e.display_name);
    const who = sayNames(names.length ? names : out.map(() => "Someone"));
    throw new AppError("NOT_PANELISTS", `${who} ${out.length === 1 ? "does" : "do"} not hold Recruitment`, 422, {
      panel_employee_ids: ["Not all hold Recruitment"],
    });
  }
  if (ok.some((e) => e.work_email && candidateEmail && e.work_email.toLowerCase() === candidateEmail.toLowerCase()))
    throw field("panel_employee_ids", "The candidate cannot sit on the panel");
}

/** Where the interview is, in the words the calendar entry and the email use. */
async function placeOf(client, body) {
  if (body.interview_type !== "in_person" || !body.worksite_id) return { line: body.meeting_url || null, worksite: null };
  const w = await repo.worksite(client, body.worksite_id);
  if (!w) throw field("worksite_id", "Pick the worksite");
  return { line: [w.name, w.address].filter(Boolean).join(", "), worksite: w };
}

const entryOf = (row, place, panel) => ({
  title: `Interview: ${row.candidate_name}, ${row.vacancy_title}`,
  description: `${row.title}. ${row.application_number}.`,
  event_type: "interview",
  starts_at: row.scheduled_start,
  ends_at: row.scheduled_end,
  all_day: false,
  location: (place.line || "").slice(0, 200) || null,
  visibility: "attendees",
  attendee_ids: panel,
});

async function schedule(actor, scope, body) {
  return tx(async (client) => {
    const app = await candidateRepo.get(client, body.application_id, { lock: true });
    if (!app) throw field("application_id", "Pick a candidate");
    assertInScope(scope, app.hiring_manager_id);
    if (app.status !== "active") throw field("application_id", "This candidate is not in progress");
    await checkPanel(client, body.panel_employee_ids, app.email);
    const place = await placeOf(client, body);
    const round = await repo.insertRound(client, app.application_id, body.title);
    const id = await repo.insertInterview(client, {
      interview_round_id: round.interview_round_id,
      interview_type: body.interview_type,
      scheduled_start: body.scheduled_start,
      scheduled_end: body.scheduled_end,
      worksite_id: body.interview_type === "in_person" ? body.worksite_id : null,
      meeting_url: body.interview_type === "video" ? body.meeting_url : null,
      created_by: actor.user_id,
    });
    const panel = await repo.setPanel(client, id, body.panel_employee_ids);
    const row = await repo.get(client, id, actor.employee_id);
    const entry = await calendar.createIn(client, actor, entryOf(row, place, panel), { entity: { type: "interview", id } });
    await repo.updateInterview(client, id, { calendar_event_id: entry.calendar_event_id });
    await candidates.advanceIn(client, actor, app.application_id, "interview");
    await emit(client, {
      key: EVENTS.INTERVIEW_SCHEDULED,
      entity: { type: "interview", id },
      actor,
      payload: { interview_id: id, application_id: app.application_id, application_number: app.number },
    });
    return id;
  });
}

/** A live interview of the reader's scope, locked; 404 outside it, 409 once it is over. */
async function liveRow(client, id, actor, scope) {
  const row = await repo.get(client, id, actor.employee_id, { lock: true });
  if (!row) throw notFound();
  assertInScope(scope, row.hiring_manager_id);
  if (row.status !== "scheduled" || row.round_status !== "open")
    throw new AppError("INTERVIEW_OVER", "This interview is cancelled or its round is closed", 409);
  return row;
}

async function reschedule(actor, scope, id, body) {
  return tx(async (client) => {
    const before = await liveRow(client, id, actor, scope);
    const next = {
      interview_type: body.interview_type || before.interview_type,
      scheduled_start: body.scheduled_start || new Date(before.scheduled_start).toISOString(),
      scheduled_end: body.scheduled_end || new Date(before.scheduled_end).toISOString(),
      worksite_id: body.worksite_id !== undefined ? body.worksite_id : before.worksite_id,
      meeting_url: body.meeting_url !== undefined ? body.meeting_url : before.meeting_url,
    };
    if (Date.parse(next.scheduled_end) <= Date.parse(next.scheduled_start)) throw field("scheduled_end", "Ends before it starts");
    if (next.interview_type === "in_person" && !next.worksite_id) throw field("worksite_id", "Pick the worksite");
    if (next.interview_type === "video" && !next.meeting_url) throw field("meeting_url", "Add the meeting link");
    if (next.interview_type !== "in_person") next.worksite_id = null;
    if (next.interview_type !== "video") next.meeting_url = null;
    if (body.panel_employee_ids) await checkPanel(client, body.panel_employee_ids, before.candidate_email);
    const place = await placeOf(client, next);
    await repo.updateInterview(client, id, next);
    if (body.title) await repo.setTitle(client, before.interview_round_id, body.title);
    const panel = body.panel_employee_ids ? await repo.setPanel(client, id, body.panel_employee_ids) : null;
    // A seat with a submitted card stays on, so the panel is checked once more against its eight.
    if (panel && panel.length > 8) throw field("panel_employee_ids", "At most 8 panelists");
    const row = await repo.get(client, id, actor.employee_id);
    const entry = entryOf(row, place, panel || undefined);
    if (!panel) delete entry.attendee_ids;
    if (before.calendar_event_id) await calendar.editIn(client, actor, before.calendar_event_id, entry, { asOwner: true });
    const moved =
      Date.parse(next.scheduled_start) !== new Date(before.scheduled_start).getTime() ||
      Date.parse(next.scheduled_end) !== new Date(before.scheduled_end).getTime() ||
      next.interview_type !== before.interview_type ||
      (next.worksite_id || null) !== (before.worksite_id || null) ||
      (next.meeting_url || null) !== (before.meeting_url || null);
    await emit(client, {
      key: EVENTS.INTERVIEW_RESCHEDULED,
      entity: { type: "interview", id },
      actor,
      payload: { interview_id: id, application_number: before.application_number, candidate_told: moved },
    });
    // A panel left with only submitted seats closes as the last Submit Card would (once started).
    await consolidate.closeIfDone(client, await repo.get(client, id, actor.employee_id), actor);
    return id;
  });
}

/** Cancel inside the caller's transaction: the entry called off, the round closed with no score. */
async function cancelIn(client, actor, row, reason) {
  await repo.updateInterview(client, row.interview_id, { status: "cancelled" });
  await repo.closeRound(client, row.interview_round_id, { score: null, by: actor ? actor.user_id : null });
  // The entry belongs to whoever scheduled it; the module calls it off for them, whoever cancels.
  if (row.calendar_event_id) await calendar.cancelIn(client, actor, row.calendar_event_id, { asOwner: true });
  await emit(client, {
    key: EVENTS.INTERVIEW_CANCELLED,
    entity: { type: "interview", id: row.interview_id },
    actor,
    payload: { interview_id: row.interview_id, application_number: row.application_number, reason: reason || null },
  });
}

async function cancel(actor, scope, id, body) {
  return tx(async (client) => {
    const row = await liveRow(client, id, actor, scope);
    await cancelIn(client, actor, row, body.reason);
    return id;
  });
}

/** Not Progressing: the application's scheduled interviews are cancelled and everyone told (guide §6.3). */
async function cancelForApplication(applicationId, userId) {
  const actor = await repo.actorOf(pool, userId);
  for (const id of await repo.scheduledFor(pool, applicationId)) {
    await tx(async (client) => {
      const row = await repo.get(client, id, actor ? actor.employee_id : null, { lock: true });
      if (!row || row.status !== "scheduled" || row.round_status !== "open") return;
      // The entry belongs to whoever scheduled it; act for them when the event names nobody.
      const as = actor || (await repo.actorOf(client, row.created_by));
      await cancelIn(client, as, row, "not progressed");
    });
  }
}

/* ------------------------------------------------------------------ *
 * The candidate's email
 * ------------------------------------------------------------------ */

/** The system sender's address, from MAIL_FROM ("Name <address>" or an address). */
function senderAddress() {
  const from = String(config.MAIL_FROM || "");
  const m = /<([^>\s]+)>$/.exec(from);
  return (m ? m[1] : from) || "no-reply@mycityapp.io";
}

async function mailCandidate(event) {
  if (event.payload.candidate_told === false) return;
  const row = await repo.get(pool, event.payload.interview_id, null);
  if (!row) return;
  const cancelled = row.status === "cancelled";
  const sequence = await repo.icsSequence(pool, row.calendar_event_id);
  const place = row.interview_type === "in_person" ? row.worksite_name : null;
  const start = new Date(row.scheduled_start).toISOString();
  const end = new Date(row.scheduled_end).toISOString();
  const invite = {
    uid: `interview-${row.interview_id}@mycityapp.io`,
    sequence,
    start,
    end,
    summary: `Interview: ${row.vacancy_title}`,
    description: `Your interview for ${row.vacancy_title} at MyCity App.`,
    location: row.interview_type === "in_person" ? [place, row.worksite_address].filter(Boolean).join(", ") : row.meeting_url || "",
    organizer: { name: "MyCity App Recruitment", email: senderAddress() },
    attendees: [{ name: row.candidate_name, email: row.candidate_email }],
    method: cancelled ? "CANCEL" : "REQUEST",
  };
  await require("../../jobs/queues").enqueue(
    "email-send",
    "interview-invite",
    {
      to: { name: row.candidate_name, email: row.candidate_email },
      recipient: { first_name: row.candidate_first_name, last_name: row.candidate_last_name, email: row.candidate_email },
      template: "interview-invite",
      data: {
        vacancy_title: row.vacancy_title,
        in_person: row.interview_type === "in_person",
        by_video: row.interview_type === "video",
        by_phone: row.interview_type === "phone",
        scheduled_start: start,
        scheduled_end: end,
        place,
        place_address: row.interview_type === "in_person" ? row.worksite_address : null,
        meeting_url: row.interview_type === "video" ? row.meeting_url : null,
        rescheduled: event.key === EVENTS.INTERVIEW_RESCHEDULED,
        cancelled,
      },
      attachments: [ics.attachment(invite, cancelled ? "cancel.ics" : "invite.ics")],
    },
    { jobId: `interview-invite-${event.event_id}` },
  );
}

module.exports = { schedule, reschedule, cancel, cancelIn, cancelForApplication, mailCandidate, checkPanel };
