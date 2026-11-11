"use strict";
/**
 * Set Health (docs/guides/partnerships.md §6.5): how a deal is going beside its stage, On Track,
 * Follow-up Required or Stalled, on open and live deals. Stalled needs its blockers (10 characters
 * or more), which Pipeline's Stalled list and the 360 show. A change of health writes a health line
 * to the deal's history; blockers alone, on a deal already Stalled, only change the deal.
 */
const { emit } = require("../../shared/events/emit");
const { AppError } = require("../../shared/errors");
const { EVENTS } = require("./partner_pipeline.events");
const repo = require("./partner_pipeline.repo");
const service = require("./partner_pipeline.service");

/**
 * Set a locked deal's health, in the caller's transaction.
 * @param {{health: string, blockers?: string}} body
 * @param {{source?: string}} [opts]  `system` for the inactivity follow-up (§6.12)
 */
async function setIn(client, actor, deal, body, { source = "person" } = {}) {
  if (!["open", "live"].includes(deal.status)) {
    throw new AppError("DEAL_FINISHED", "A finished deal keeps the health it had.", 422, { health: ["Deal is finished"] });
  }
  const blockers = body.health === "stalled" ? body.blockers.trim() : body.blockers ? body.blockers.trim() : null;
  await client.query("UPDATE partnership_opportunity SET health = $2, blockers = $3 WHERE partnership_opportunity_id = $1", [deal.deal_id, body.health, blockers]);
  if (body.health === deal.health) {
    await emit(client, { key: EVENTS.DEAL_UPDATED, entity: { type: "partner_deal", id: deal.deal_id }, actor, payload: { deal_id: deal.deal_id, number: deal.number, fields: ["blockers"] } });
    return;
  }
  await repo.addHistory(client, { deal_id: deal.deal_id, kind: "health", from: deal.health, to: body.health, reason: blockers, source, user_id: actor ? actor.user_id : null });
  await emit(client, {
    key: EVENTS.DEAL_HEALTH_CHANGED,
    entity: { type: "partner_deal", id: deal.deal_id },
    actor,
    before: { health: deal.health },
    after: { health: body.health },
    payload: { deal_id: deal.deal_id, number: deal.number, title: deal.title, from: deal.health, to: body.health, blockers: body.health === "stalled" ? blockers : null, owner_id: deal.owner_id, set_by: actor ? actor.user_id : null, source },
  });
}

/** Set Health (POST /deals/:id/health), on a deal the reader may see. */
async function set(actor, scope, id, body) {
  await service.tx(async (client) => {
    await service.assertSeen(client, id, scope);
    await setIn(client, actor, await repo.lock(client, id), body);
  });
  return service.get(id, scope, actor);
}

module.exports = { setIn, set };
