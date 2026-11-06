"use strict";
/**
 * A deal's returns (docs/guides/partnerships.md §6.14): per month, units sold, gross sales,
 * MyCity's commission, paid to the partner, downloads and a note. Every route here asks for
 * `partnerships.money`; a month saved again replaces its figures, audited. The Returns tab and the
 * Partnership Returns import arrive with M7 PR 4, on this service.
 */
const { pool } = require("../../config/db");
const { emit } = require("../../shared/events/emit");
const { EVENTS } = require("./partner_pipeline.events");
const repo = require("./partner_pipeline.repo");
const service = require("./partner_pipeline.service");

const firstOf = (month) => `${month}-01`;

/** A page of a deal's months (GET /deals/:id/returns), on a deal the reader may see. */
async function page(id, query, scope) {
  await service.assertSeen(pool, id, scope);
  return repo.returnsPage(pool, id, query);
}

/** Enter Returns (PUT /deals/:id/returns/:month): a month at a time, replacing what it held. */
async function save(actor, scope, id, month, body) {
  return service.tx(async (client) => {
    await service.assertSeen(client, id, scope);
    const deal = await repo.lock(client, id);
    const day = firstOf(month);
    const before = await repo.returnOf(client, id, day);
    await repo.upsertReturn(client, { deal_id: id, month: day, ...body, entered_by: actor.user_id });
    const after = await repo.returnOf(client, id, day);
    await emit(client, {
      key: EVENTS.DEAL_RETURN_SAVED,
      entity: { type: "partner_deal", id },
      actor,
      before: before ? { units_sold: before.units_sold, downloads: before.downloads } : null,
      after: { units_sold: after.units_sold, downloads: after.downloads },
      payload: { deal_id: id, number: deal.number, month: day },
    });
    return after;
  });
}

module.exports = { page, save };
