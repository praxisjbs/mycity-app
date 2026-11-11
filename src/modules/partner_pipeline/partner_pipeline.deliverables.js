"use strict";
/**
 * Delivery checklists raised on signing (docs/guides/partnerships.md §6.7): once a deal is signed, each
 * active item of its category's checklist becomes a Workspace task through the tasks service, and a
 * `deal_deliverable` names it. An outbox handler on `deal.signed`, after the signing commits.
 *
 *   the task     "<item> · <deal>", for the deal's owner and set by them (so they may reassign it as
 *                A24 allows), due `due_days` after signing or before the event's start (from signing
 *                when the deal has no event date), connected to the partner and the deal, inside the
 *                deal's most recent active connected project when it has one
 *   once         a checklist item is raised once a deal (deal_deliverable_item_uq), so a repeated
 *                event or a retry raises nothing twice; a checklist changed later never changes a
 *                deal already signed
 *   skipped      a deal signed by the tracker import (source `import`) and New Partner's "signed before
 *                the hub" (`signed_before_hub`): their delivery runs outside the hub (§13.2, In PR 5)
 */
const { pool } = require("../../config/db");
const { atomically } = require("../../shared/db/tx");
const { emit } = require("../../shared/events/emit");
const { logger } = require("../../config/logger");
const lagos = require("../../shared/time/lagos");
const { EVENTS } = require("./partner_pipeline.events");

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

/**
 * The deal's owner as the one who sets work for themselves: their login when they have one, else the
 * person whose press signed the deal (a row needs someone who made it). Null when neither is known.
 */
async function ownerActor(client, ownerId, fallbackUserId = null) {
  if (!ownerId) return null;
  const { loginsOf } = require("../tasks/tasks.events");
  const [userId] = await loginsOf(client, [ownerId]);
  const user = userId || fallbackUserId;
  if (!user) return null;
  return { user_id: user, employee_id: ownerId, display_name: null };
}

/** The owner's own scope: a task they set for themselves. */
const ownScope = (ownerId) => ({ scope: "own", scope_ids: [ownerId], employee_id: ownerId });

/** When an item falls due: before the event's start, or after signing. */
function dueOf(item, deal) {
  if (item.due_days === null || item.due_days === undefined) return null;
  if (item.due_from === "event_start" && deal.event_starts_on) return lagos.addDays(deal.event_starts_on, -item.due_days);
  return lagos.addDays(lagos.dateOf(deal.signed_at), item.due_days);
}

/**
 * Raise a signed deal's deliverables (the `deal.signed` handler).
 * @param {{payload: object, actor_user_id?: string|null}} event
 * @returns {Promise<number>} how many were raised
 */
async function raise(event) {
  const p = event.payload || {};
  if (!p.deal_id || p.source === "import" || p.signed_before_hub === true) return 0;
  return tx(async (client) => {
    const { rows } = await client.query(
      `SELECT po.partnership_opportunity_id AS deal_id, po.number::text AS number, po.title, po.partner_id, po.lead_id, po.owner_id,
              po.signed_at, to_char(po.event_starts_on, 'YYYY-MM-DD') AS event_starts_on,
              COALESCE(p.partner_category_id, l.partner_category_id) AS partner_category_id
         FROM partnership_opportunity po
         LEFT JOIN partner p ON p.partner_id = po.partner_id
         LEFT JOIN lead l ON l.lead_id = po.lead_id
        WHERE po.partnership_opportunity_id = $1
        FOR UPDATE OF po`,
      [p.deal_id],
    );
    const deal = rows[0];
    if (!deal || !deal.signed_at || !deal.partner_category_id) return 0;
    const { rows: items } = await client.query(
      `SELECT i.partner_category_checklist_item_id AS id, i.title, i.description, i.due_from, i.due_days
         FROM partner_category_checklist_item i
        WHERE i.partner_category_id = $1 AND i.active
          AND NOT EXISTS (SELECT 1 FROM deal_deliverable dd WHERE dd.deal_id = $2 AND dd.checklist_item_id = i.partner_category_checklist_item_id)
        ORDER BY i.position, i.partner_category_checklist_item_id`,
      [deal.partner_category_id, deal.deal_id],
    );
    if (!items.length) return 0;
    const actor = await ownerActor(client, deal.owner_id, event.actor_user_id || null);
    if (!actor) {
      logger.warn({ deal_id: deal.deal_id }, "deliverables not raised: the deal's owner has no login");
      return 0;
    }
    const tasks = require("../tasks/tasks.service");
    const projectId = await require("../projects/projects.service").ofDeal(client, deal.deal_id);
    const link = deal.partner_id ? { partner_id: deal.partner_id } : { lead_id: deal.lead_id };
    for (const item of items) {
      const title = `${item.title} · ${deal.title}`.slice(0, 200);
      const due = dueOf(item, deal);
      const task = await tasks.create(
        actor,
        ownScope(deal.owner_id),
        {
          title,
          ...(item.description ? { description: item.description } : {}),
          ...(due ? { due_on: due } : {}),
          ...link,
          deal_id: deal.deal_id,
          ...(projectId ? { project_id: projectId } : {}),
        },
        { client, trusted: true },
      );
      await client.query(
        `INSERT INTO deal_deliverable (deal_id, checklist_item_id, title, task_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (deal_id, checklist_item_id) WHERE checklist_item_id IS NOT NULL DO NOTHING`,
        [deal.deal_id, item.id, item.title, task.task_id],
      );
    }
    await emit(client, {
      key: EVENTS.DEAL_DELIVERABLES_RAISED,
      entity: { type: "partner_deal", id: deal.deal_id },
      actor,
      payload: { deal_id: deal.deal_id, number: deal.number, owner_id: deal.owner_id, count: items.length },
    });
    return items.length;
  });
}

module.exports = { raise, ownerActor };
