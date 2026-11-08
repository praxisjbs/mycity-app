"use strict";
/**
 * The follow-up when a partner goes quiet (docs/guides/partnerships.md §6.12): the
 * `partner-inactivity` scheduler, each morning after Home's alert sweep has raised Partner
 * Inactivity.
 *
 *   quiet        a partner with a live deal (status active), or a lead with an open deal, with no
 *                interaction since the start of the day N days ago (Lagos); one never contacted
 *                counts from when it was made. N is the enabled Partner Inactivity rule's threshold
 *                on Home · Alerts; with no rule enabled there is no follow-up.
 *   the follow-up, once a quiet spell (partner_follow_up.dedup_key
 *                `partner-inactivity:<record id>:<day of last contact>`), in one transaction:
 *                - its live deals (a lead's open ones) On Track become Follow-Up Required, source
 *                  `system`; a Stalled deal keeps its blockers
 *                - one Workspace task for its owner, "Follow up with <name>", due three working days
 *                  later, connected to the record, set by the owner (no task when the owner has no
 *                  login, the spell still recorded)
 *                - `follow_up.raised`
 *
 * Contact ends the spell; the next quiet spell has another day of last contact, so another key.
 * Safe to run again: a spell already followed up is skipped.
 */
const { pool } = require("../../config/db");
const { atomically } = require("../../shared/db/tx");
const { emit } = require("../../shared/events/emit");
const lagos = require("../../shared/time/lagos");
const workingWeek = require("../../shared/time/working-week");
const { EVENTS } = require("./partner_pipeline.events");
const repo = require("./partner_pipeline.repo");

/** Records one step of the sweep reads. */
const BATCH = 100;

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

/** The enabled Partner Inactivity rule's days, or null with none enabled (§6.12). */
async function ruleDays(db) {
  const { rows } = await db.query("SELECT min(threshold)::int AS n FROM home_alert_rule WHERE metric = 'partner_inactivity' AND enabled");
  return rows[0] && rows[0].n ? rows[0].n : null;
}

/** Each kind of record the sweep reads: who is quiet, and which of its deals take Follow-Up Required. */
const KINDS = {
  partner: {
    table: "partner r",
    id: "r.partner_id",
    quiet: "r.status = 'active'",
    deals: "po.partner_id = $1 AND po.status = 'live'",
  },
  lead: {
    table: "lead r",
    id: "r.lead_id",
    quiet: `r.status NOT IN ('converted', 'lost')
            AND EXISTS (SELECT 1 FROM partnership_opportunity od WHERE od.lead_id = r.lead_id AND od.partner_id IS NULL AND od.status = 'open')`,
    deals: "po.lead_id = $1 AND po.partner_id IS NULL AND po.status = 'open'",
  },
};

/** A batch of the quiet records of a kind, after `after` by id. */
async function quietBatch(db, kind, { before, after }) {
  const k = KINDS[kind];
  const { rows } = await db.query(
    `SELECT q.id, q.name, q.owner_id, q.last_contact_at
       FROM (SELECT ${k.id} AS id, r.name, r.owner_id,
                    COALESCE((SELECT max(pi.occurred_at) FROM partner_interaction pi WHERE pi.${kind}_id = ${k.id}), r.created_at) AS last_contact_at
               FROM ${k.table}
              WHERE ${k.quiet} AND ($2::uuid IS NULL OR ${k.id} > $2::uuid)) q
      WHERE q.last_contact_at < $1::timestamptz
      ORDER BY q.id
      LIMIT $3 -- pagination:batch the records one step of the morning's follow-up sweep reads`,
    [before, after, BATCH],
  );
  return rows;
}

/**
 * Follow one quiet record up, once its spell. Returns whether it was followed up now.
 * @param {"partner"|"lead"} kind
 * @param {{id: string, name: string, owner_id: string|null, last_contact_at: Date}} record
 */
async function followUp(kind, record, { today, cal }) {
  const lastDay = lagos.dateOf(new Date(record.last_contact_at));
  const key = `partner-inactivity:${record.id}:${lastDay}`;
  return tx(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO partner_follow_up (dedup_key, ${kind}_id, last_contact_on) VALUES ($1, $2, $3)
       ON CONFLICT (dedup_key) DO NOTHING RETURNING partner_follow_up_id`,
      [key, record.id, lastDay],
    );
    if (!rows.length) return false;
    const followId = rows[0].partner_follow_up_id;
    const { rows: deals } = await client.query(
      `SELECT po.partnership_opportunity_id AS id FROM partnership_opportunity po
        WHERE ${KINDS[kind].deals} AND po.health = 'on_track'
        ORDER BY po.partnership_opportunity_id`,
      [record.id],
    );
    const health = require("./partner_pipeline.health");
    for (const d of deals) await health.setIn(client, null, await repo.lock(client, d.id), { health: "follow_up_required" }, { source: "system" });
    const { ownerActor } = require("./partner_pipeline.deliverables");
    const actor = await ownerActor(client, record.owner_id);
    let taskId = null;
    if (actor) {
      const task = await require("../tasks/tasks.service").create(
        actor,
        { scope: "own", scope_ids: [record.owner_id], employee_id: record.owner_id },
        {
          title: `Follow up with ${record.name}`.slice(0, 200),
          due_on: workingWeek.addWorkingDays(today, 3, cal),
          priority: "high",
          [`${kind}_id`]: record.id,
        },
        { client, trusted: true },
      );
      taskId = task.task_id;
      await client.query("UPDATE partner_follow_up SET task_id = $2 WHERE partner_follow_up_id = $1", [followId, taskId]);
    }
    await emit(client, {
      key: EVENTS.FOLLOW_UP_RAISED,
      entity: { type: kind, id: record.id },
      actor: null,
      payload: { [`${kind}_id`]: record.id, owner_id: record.owner_id, last_contact_on: lastDay, task_id: taskId, deals: deals.length },
    });
    return true;
  });
}

/**
 * The morning's sweep (the `partner-inactivity` scheduler and queue).
 * @param {{now?: Date}} [opts]
 * @returns {Promise<{followed_up: number}|{skipped: string}>}
 */
async function sweep({ now = new Date() } = {}) {
  const days = await ruleDays(pool);
  if (!days) return { skipped: "no rule" };
  const today = lagos.dateOf(now);
  const before = lagos.startOfDay(lagos.addDays(today, -days));
  const cal = await workingWeek.loadCalendar(pool, { now: now.getTime() });
  let followed = 0;
  for (const kind of Object.keys(KINDS)) {
    let after = null;
    for (;;) {
      const batch = await quietBatch(pool, kind, { before, after });
      for (const record of batch) if (await followUp(kind, record, { today, cal })) followed += 1;
      if (batch.length < BATCH) break;
      after = batch[batch.length - 1].id;
    }
  }
  return { followed_up: followed };
}

module.exports = { sweep, followUp, ruleDays };
