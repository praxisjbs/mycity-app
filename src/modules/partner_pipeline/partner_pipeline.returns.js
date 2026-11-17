"use strict";
/**
 * A deal's returns (docs/guides/partnerships.md §6.14): per month, units sold, gross sales,
 * MyCity's commission, paid to the partner, downloads and a note. Every route here asks for
 * `partnerships.money`; a month saved again replaces its figures, audited. The 360's Returns tab
 * (Enter Returns) and the Partnership Returns import (partner_pipeline.returns.import.js) write here.
 */
const { pool } = require("../../config/db");
const { AppError } = require("../../shared/errors");
const { emit } = require("../../shared/events/emit");
const { compare, money, toWire } = require("../../shared/money/money");
const { EVENTS } = require("./partner_pipeline.events");
const repo = require("./partner_pipeline.repo");
const service = require("./partner_pipeline.service");

const firstOf = (month) => `${month}-01`;

/** A page of a deal's months (GET /deals/:id/returns), on a deal the reader may see. */
async function page(id, query, scope) {
  await service.assertSeen(pool, id, scope);
  return repo.returnsPage(pool, id, query);
}

/**
 * Save a month of a locked deal's returns, in the caller's transaction, replacing what it held:
 * Enter Returns (`entered`), or a row of the Partnership Returns import (`import`, with its batch,
 * M7 PR 4). The caller has checked the deal and the money capability.
 * @param {{deal_id: string, number: string}} deal  repo.lock()'s row
 * @param {string} month  `YYYY-MM`
 * @param {{source?: "entered"|"import", importBatchId?: string|null}} [opts]
 */
async function saveIn(client, actor, deal, month, body, { source = "entered", importBatchId = null } = {}) {
  const day = firstOf(month);
  const before = await repo.returnOf(client, deal.deal_id, day);
  await repo.upsertReturn(client, { deal_id: deal.deal_id, month: day, ...body, source, import_batch_id: importBatchId, entered_by: actor ? actor.user_id : null });
  const after = await repo.returnOf(client, deal.deal_id, day);
  await emit(client, {
    key: EVENTS.DEAL_RETURN_SAVED,
    entity: { type: "partner_deal", id: deal.deal_id },
    actor,
    before: before ? { units_sold: before.units_sold, downloads: before.downloads } : null,
    after: { units_sold: after.units_sold, downloads: after.downloads },
    payload: { deal_id: deal.deal_id, number: deal.number, month: day, source },
  });
  return after;
}

/**
 * Remove a month the Partnership Returns import made, reverting it, in the caller's transaction.
 * @param {{deal_id: string, number: string}} deal
 * @param {string} day  the month's 1st, `YYYY-MM-DD`
 */
async function removeIn(client, actor, deal, day) {
  const before = await repo.returnOf(client, deal.deal_id, day);
  if (!before) return;
  await repo.removeReturn(client, deal.deal_id, day);
  await emit(client, {
    key: EVENTS.DEAL_RETURN_REMOVED,
    entity: { type: "partner_deal", id: deal.deal_id },
    actor,
    before: { units_sold: before.units_sold, downloads: before.downloads },
    payload: { deal_id: deal.deal_id, number: deal.number, month: day },
  });
}

/**
 * A month a person enters must add up: MyCity's commission within gross sales, and what was paid to
 * the partner within what the commission leaves (QA F61). 422 on the field that breaks it. The
 * Partnership Returns import keeps the tracker's figures as they were written, so it is not asked.
 */
function assertFits(body) {
  if (!body.gross_sales) return;
  const commission = body.mycity_commission || "0.00";
  if (body.mycity_commission && compare(body.mycity_commission, body.gross_sales) > 0) {
    throw new AppError("VALIDATION_FAILED", "More than gross sales", 422, { mycity_commission: ["More than gross sales"] });
  }
  const left = toWire(money(body.gross_sales).minus(money(commission)));
  if (body.paid_to_partner && compare(body.paid_to_partner, left) > 0) {
    throw new AppError("VALIDATION_FAILED", "More than sales left", 422, { paid_to_partner: ["More than sales left"] });
  }
}

/** Enter Returns (PUT /deals/:id/returns/:month): a month at a time, replacing what it held. */
async function save(actor, scope, id, month, body) {
  assertFits(body);
  return service.tx(async (client) => {
    await service.assertSeen(client, id, scope);
    return saveIn(client, actor, await repo.lock(client, id), month, body);
  });
}

module.exports = { page, save, saveIn, removeIn, assertFits };
