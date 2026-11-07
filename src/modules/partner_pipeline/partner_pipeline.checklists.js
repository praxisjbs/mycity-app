"use strict";
/**
 * A category's delivery checklist (docs/guides/partnerships.md §6.7): what MyCity delivers once a deal of the
 * category is signed, and when each item falls due, in days after signing or before the event starts. Each
 * active item becomes a Workspace task for the deal's owner on signing (M7 PR 5). Items are ordered (a
 * position 0, 1, 2 among the active ones), moved, retired and restored; changing the list later never changes
 * deals already signed.
 */
const { pool } = require("../../config/db");
const { atomically } = require("../../shared/db/tx");
const { AppError } = require("../../shared/errors");
const { emit } = require("../../shared/events/emit");
const repo = require("./partner_pipeline.repo");
const { EVENTS } = require("./partner_pipeline.events");
const { detail } = require("./partner_pipeline.categories");

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

const notFound = (what = "category") => new AppError("NOT_FOUND", `That ${what} does not exist`, 404);

/** Move an item to an index among the category's active items, and renumber them 0, 1, 2... */
async function place(client, categoryId, itemId, to) {
  const ids = (await repo.activeItemIds(client, categoryId)).filter((x) => x !== itemId);
  ids.splice(Math.max(0, Math.min(to, ids.length)), 0, itemId);
  for (const [i, x] of ids.entries()) await repo.setItemPosition(client, x, i);
}

async function addItem(actor, categoryId, body, scope = null) {
  await tx(async (client) => {
    if (!(await repo.getCategory(client, categoryId))) throw notFound();
    const end = (await repo.activeItemIds(client, categoryId)).length;
    const row = await repo.insertItem(client, { ...body, partner_category_id: categoryId, position: end });
    const id = row.partner_category_checklist_item_id;
    if (body.position !== undefined) await place(client, categoryId, id, body.position);
    await emit(client, {
      key: EVENTS.CATEGORY_CHECKLIST_ITEM_ADDED,
      entity: { type: "partner_category", id: categoryId },
      actor,
      after: await repo.getItem(client, id),
      payload: { partner_category_id: categoryId, partner_category_checklist_item_id: id },
    });
  });
  return detail(categoryId, undefined, scope);
}

async function updateItem(actor, id, body, scope = null) {
  const categoryId = await tx(async (client) => {
    const before = await repo.getItem(client, id);
    if (!before) throw notFound("checklist item");
    const { position, ...rest } = body;
    await repo.updateItem(client, id, rest);
    const active = body.active ?? before.active;
    if (active && (position !== undefined || body.active === true)) {
      await place(client, before.partner_category_id, id, position ?? Number.MAX_SAFE_INTEGER);
    }
    await emit(client, {
      key: EVENTS.CATEGORY_CHECKLIST_ITEM_UPDATED,
      entity: { type: "partner_category", id: before.partner_category_id },
      actor,
      before,
      after: await repo.getItem(client, id),
      payload: { partner_category_id: before.partner_category_id, partner_category_checklist_item_id: id },
    });
    return before.partner_category_id;
  });
  return detail(categoryId, undefined, scope);
}

module.exports = { addItem, updateItem };
