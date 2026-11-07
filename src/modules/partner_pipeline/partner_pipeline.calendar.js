"use strict";
/**
 * A signed deal's event days on its team's calendar (docs/guides/partnerships.md §6.16): one all-day
 * event, from the event's first day to its last, owned by the deal's owner, its team invited,
 * visibility `attendees`, at the deal's venue, connected to the partner and the deal. Its partner
 * keeps it (`entity_type` `partner`, with the deal's `deal_id`), so it changes only from here: Edit
 * Event and Call Off refuse it, and it opens the Partner 360.
 *
 *   on signing       made, unless the tracker import signed the deal (source `import`)
 *   on a change      a deal's dates, title, venue, owner or team changed: the event follows; dates
 *                    taken away call it off; a signed deal with dates and no event yet gets one
 *   on losing        called off (Closed Lost, a lost lead, a closed partner); a deal completed keeps
 *                    its days, which have passed (§13.2, In PR 5)
 *
 * Outbox handlers, after the deal's change commits; each reads the deal as it stands, so a retry or
 * events arriving out of order leave the calendar as the deal is.
 */
const { pool } = require("../../config/db");
const { atomically } = require("../../shared/db/tx");
const { logger } = require("../../config/logger");
const lagos = require("../../shared/time/lagos");
const places = require("../../shared/places/places");
const { ownerActor } = require("./partner_pipeline.deliverables");

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

/** The fields of a deal a change to which moves its event (Edit Deal's own names). */
const MOVES = ["title", "event_title", "event_starts_on", "event_ends_on", "venue", "owner_id", "member_ids"];

/** The deal as its event needs it, locked, or null. */
async function dealOf(client, dealId) {
  const { rows } = await client.query(
    `SELECT po.partnership_opportunity_id AS deal_id, po.title, po.event_title, po.status, po.signed_at, po.owner_id,
            po.partner_id, po.lead_id, to_char(po.event_starts_on, 'YYYY-MM-DD') AS starts_on,
            to_char(COALESCE(po.event_ends_on, po.event_starts_on), 'YYYY-MM-DD') AS ends_on
       FROM partnership_opportunity po WHERE po.partnership_opportunity_id = $1 FOR UPDATE`,
    [dealId],
  );
  return rows[0] || null;
}

/** The event as the deal says it should be. */
async function wanted(client, deal) {
  const { rows } = await client.query("SELECT employee_id FROM deal_member WHERE deal_id = $1 ORDER BY employee_id", [deal.deal_id]);
  const venue = await places.view(client, "deal.venue", deal.deal_id);
  return {
    title: String(deal.event_title || deal.title).slice(0, 200),
    event_type: "event",
    starts_at: lagos.instant(deal.starts_on).toISOString(),
    ends_at: lagos.instant(lagos.addDays(deal.ends_on, 1)).toISOString(),
    all_day: true,
    location: venue && venue.formatted ? String(venue.formatted).slice(0, 200) : null,
    visibility: "attendees",
    attendee_ids: rows.map((r) => r.employee_id).filter((id) => id !== deal.owner_id),
    partner_id: deal.partner_id || null,
    lead_id: deal.partner_id ? null : deal.lead_id,
    deal_id: deal.deal_id,
  };
}

const sameTime = (a, b) => new Date(a).getTime() === new Date(b).getTime();

/**
 * Make the deal's calendar match the deal (§6.16).
 * @param {string} dealId
 * @param {{create?: boolean, actorUserId?: string|null}} [opts]  create: may make the event when it has none
 * @returns {Promise<"made"|"moved"|"called_off"|"kept">}
 */
async function sync(dealId, { create = true, actorUserId = null } = {}) {
  return tx(async (client) => {
    const calendar = require("../calendar/calendar.service");
    const deal = await dealOf(client, dealId);
    const kept = await calendar.keptForDeal(client, dealId);
    const standing = kept && !kept.cancelled_at ? kept : null;
    const signed = Boolean(deal && deal.signed_at && deal.starts_on);
    if (!signed || deal.status === "lost") {
      if (!standing) return "kept";
      await calendar.cancelIn(client, await ownerActor(client, standing.owner_employee_id, actorUserId), standing.calendar_event_id, { asOwner: true });
      return "called_off";
    }
    // A completed deal keeps the days it had.
    if (deal.status === "completed") return "kept";
    const want = await wanted(client, deal);
    if (standing) {
      const now = await calendar.getFor(standing.calendar_event_id, standing.owner_employee_id).catch(() => null);
      if (!now) return "kept";
      const attendees = (now.attendees || []).map((a) => a.employee.employee_id).sort();
      const changes = {};
      if (now.title !== want.title) changes.title = want.title;
      if (!sameTime(now.starts_at, want.starts_at)) changes.starts_at = want.starts_at;
      if (!sameTime(now.ends_at, want.ends_at)) changes.ends_at = want.ends_at;
      if ((now.location || null) !== want.location) changes.location = want.location;
      if (attendees.join() !== [...want.attendee_ids].filter((id) => id !== standing.owner_employee_id).sort().join()) {
        changes.attendee_ids = want.attendee_ids.filter((id) => id !== standing.owner_employee_id);
      }
      const link = now.partner_link || {};
      if ((link.partner_id || null) !== want.partner_id || (link.lead_id || null) !== want.lead_id) Object.assign(changes, { partner_id: want.partner_id, lead_id: want.lead_id, deal_id: want.deal_id });
      if (!Object.keys(changes).length) return "kept";
      await calendar.editIn(client, await ownerActor(client, standing.owner_employee_id, actorUserId), standing.calendar_event_id, changes, { asOwner: true });
      return "moved";
    }
    // A signed deal always has its partner: a lead's converts in the signing's transaction.
    if (!create || deal.status !== "live" || !deal.partner_id) return "kept";
    const actor = await ownerActor(client, deal.owner_id, actorUserId);
    if (!actor) {
      logger.warn({ deal_id: dealId }, "event days not placed: the deal's owner has no login");
      return "kept";
    }
    await calendar.createIn(client, actor, { ...want, reminder_minutes: [] }, { entity: { type: "partner", id: deal.partner_id }, trusted: true });
    return "made";
  });
}

/** `deal.signed`: the days on the calendar, unless the tracker import signed it. */
const onSigned = (event) => {
  const p = event.payload || {};
  if (!p.deal_id || p.source === "import") return undefined;
  return sync(p.deal_id, { actorUserId: event.actor_user_id || null });
};

/** `deal.updated`: the event follows the deal's dates, title, venue, owner and team. */
const onUpdated = (event) => {
  const p = event.payload || {};
  if (!p.deal_id || !(p.fields || []).some((f) => MOVES.includes(f))) return undefined;
  return sync(p.deal_id, { actorUserId: event.actor_user_id || null });
};

/** `deal.lost` and `deal.stage_changed`: called off when lost; back when a lost signed deal goes live again. */
const onMoved = (event) => {
  const p = event.payload || {};
  if (!p.deal_id || p.source === "import") return undefined;
  return sync(p.deal_id, { actorUserId: event.actor_user_id || null });
};

module.exports = { sync, onSigned, onUpdated, onMoved, MOVES };
