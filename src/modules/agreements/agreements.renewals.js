"use strict";
/**
 * Agreements live on (docs/guides/partnerships.md §3 step 10, §6.6, §6.8): the daily
 * `agreement-renewals` job and the `agreement_renewal` reminder.
 *
 *   sweep()            each morning, every step safe to run twice:
 *                        signed → active on its start;
 *                        active (or signed past its start) → expiring, `renewal_notice_days` before it ends;
 *                        live deals past the later of their validity and their event's end → completed,
 *                        each partner's status kept (partner_pipeline.completeLapsed)
 *                      Proposals' expiry is the proposals module's (M7 PR 7), not this job's.
 *   the reminder       an expiring agreement's owner is told at its notice date, then 30, 7 and 1 days
 *                      before it ends (each once), until it is renewed or closed or its end has passed
 *
 * An agreement past its end is read `expired` by verification (agreements.signing recordStatusOf); its
 * stored status stays expiring until it is renewed or closed, so nothing is lost by the date passing.
 */
const { pool } = require("../../config/db");
const { emit } = require("../../shared/events/emit");
const { formatDate } = require("../../shared/time/day-first");
const lagos = require("../../shared/time/lagos");
const repo = require("./agreements.repo");
const signing = require("./agreements.signing");
const { EVENTS, ENTITY } = require("./agreements.events");

const service = () => require("./agreements.service");

/** The days before its end the owner is reminded again, after the notice date. */
const NEARER = Object.freeze([30, 7, 1]);
/** The hour, Lagos, a reminder comes due. */
const AT = "09:00";

/** One agreement moved from `from` to `to`, in its own transaction, with its event. */
async function moveOne(id, from, to, key, guard) {
  return service().tx(async (client) => {
    const a = await repo.get(client, id, null, { lock: true });
    if (!a || !from.includes(a.status) || !guard(a)) return 0;
    if (!(await repo.set(client, id, from, { status: to }))) return 0;
    await emit(client, {
      key,
      entity: { type: ENTITY, id },
      actor: null,
      before: { status: a.status },
      after: { status: to },
      payload: await signing.payloadFor(client, a, { ends_on: a.ends_on || null }),
    });
    return 1;
  });
}

/** The daily job. @returns {Promise<{activated: number, expiring: number, deals_completed: number}>} */
async function sweep() {
  const today = lagos.today();
  let activated = 0;
  let expiring = 0;
  for (const id of await repo.dueToActivate(pool))
    activated += await moveOne(id, ["signed"], "active", EVENTS.AGREEMENT_ACTIVATED, (a) => a.starts_on && String(a.starts_on) <= today);
  for (const id of await repo.dueToExpire(pool))
    expiring += await moveOne(id, ["signed", "active"], "expiring", EVENTS.AGREEMENT_EXPIRING, (a) => Boolean(a.ends_on));
  const { completed } = await require("../partner_pipeline/partner_pipeline.service").completeLapsed();
  return { activated, expiring, deals_completed: completed };
}

/** A day at the reminder's hour, Lagos. */
const at = (day) => lagos.instant(day, AT);

/** The reminder's occurrences come due: each expiring agreement's notice date, then 30, 7 and 1 days before its end. */
async function remindersDue(db, { now }) {
  const today = lagos.today(now);
  const out = [];
  for (const a of (await repo.expiringOpen(db)).rows) {
    const end = String(a.ends_on);
    const steps = [{ occurrence: "notice", day: today }, ...NEARER.map((d) => ({ occurrence: `${d}`, day: lagos.addDays(end, -d) }))];
    for (const s of steps) {
      if (s.day > today) continue;
      if (s.occurrence !== "notice" && s.day < today) continue; // a step already past is not sent late
      out.push({ entity_type: ENTITY, entity_id: a.partnership_agreement_id, occurrence: s.occurrence, due_at: at(s.day), work_hours: true });
    }
  }
  return out;
}

/** The reminder's check, in its firing's transaction: still expiring and not yet ended. */
async function reminderCheck(client, row, { now }) {
  const a = await repo.get(client, row.entity_id);
  if (!a || a.status !== "expiring" || !a.ends_on || String(a.ends_on) < lagos.today(now)) return null;
  return {
    entity: { type: ENTITY, id: a.partnership_agreement_id },
    payload: await signing.payloadFor(client, a, { ends_on: a.ends_on, ends_on_day: formatDate(a.ends_on), occurrence: row.occurrence }),
  };
}

module.exports = { sweep, remindersDue, reminderCheck, NEARER };
