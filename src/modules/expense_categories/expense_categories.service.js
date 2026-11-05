"use strict";
/**
 * Expense categories: the one write path for what a request's money is for
 * (docs/guides/expenses.md §6.7).
 *
 * A category has a name, a type (operating or capital) and an optional description; its code is
 * made from its name and never shown, so two categories never share a name. A category in use is
 * deactivated, never deleted, and a deactivated one is not offered on a new request (the request
 * that already names it keeps it).
 *
 * MyCity enters its own categories (A26). Add Suggested Categories puts the twelve below in at
 * one press, only while there are none at all.
 */
const { pool } = require("../../config/db");
const { atomically } = require("../../shared/db/tx");
const { AppError } = require("../../shared/errors");
const { emit } = require("../../shared/events/emit");
const { oneNamedIn } = require("../../shared/ai/named");
const lagos = require("../../shared/time/lagos");
const repo = require("./expense_categories.repo");
const { EVENTS } = require("./expense_categories.events");

/**
 * The suggested categories (guide §6.7), from MyCity's expenditure sheet and the demo. Salaries
 * are not a category: they are paid by payroll (M6).
 */
const SUGGESTED = Object.freeze([
  { name: "Advertising and Media", type: "operating" },
  { name: "Branded Items and Printing", type: "operating" },
  { name: "Content and Production", type: "operating" },
  { name: "Events and Activations", type: "operating" },
  { name: "Travel and Transport", type: "operating" },
  { name: "Influencers and PR", type: "operating" },
  { name: "Accommodation and Meals", type: "operating" },
  { name: "Prizes and Giveaways", type: "operating" },
  { name: "Data Airtime and Subscriptions", type: "operating" },
  { name: "Legal and Professional Services", type: "operating" },
  { name: "Office and Admin", type: "operating" },
  { name: "Equipment", type: "capital" },
]);

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

/** The first day of this month in Lagos, the start of This Month's spend. */
const monthStart = (now = new Date()) => `${lagos.today(now).slice(0, 7)}-01`;

const notFound = () => new AppError("NOT_FOUND", "That category does not exist", 404, { expense_category_id: ["No such category"] });

const taken = () => new AppError("CATEGORY_EXISTS", "A category already has this name", 409, { name: ["Already in use"] });

/** The code a category is stored under, from its name ("Travel and Transport" is travel_and_transport). */
function codeOf(name) {
  const slug = String(name)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
  return /^[a-z]/.test(slug) ? slug : `category_${slug}`.slice(0, 60);
}

const list = (query) => repo.list(pool, query, monthStart());

async function get(id) {
  const row = await repo.get(pool, id, monthStart());
  if (!row) throw notFound();
  return row;
}

/** New Category. */
async function create(actor, body) {
  const code = codeOf(body.name);
  const id = await tx(async (client) => {
    if (await repo.clash(client, code, body.name)) throw taken();
    const row = await repo.insert(client, { code, name: body.name, type: body.type || "operating", description: body.description });
    await emit(client, {
      key: EVENTS.EXPENSE_CATEGORY_CREATED,
      entity: { type: "expense_category", id: row.expense_category_id },
      actor,
      after: row,
    });
    return row.expense_category_id;
  });
  return get(id);
}

/** Edit Category, Deactivate and its way back: only what the body names changes. */
async function update(actor, id, body) {
  await tx(async (client) => {
    const before = await repo.getRow(client, id);
    if (!before) throw notFound();
    const patch = { ...body };
    if (body.name !== undefined && body.name !== before.name) {
      patch.code = codeOf(body.name);
      if (await repo.clash(client, patch.code, body.name, id)) throw taken();
    }
    const after = await repo.update(client, id, patch);
    await emit(client, {
      key: EVENTS.EXPENSE_CATEGORY_UPDATED,
      entity: { type: "expense_category", id },
      actor,
      before,
      after,
    });
  });
  return get(id);
}

/** Add Suggested Categories: the twelve defaults in one press, only while there are none. */
async function addSuggested(actor) {
  await tx(async (client) => {
    await repo.lockTable(client);
    if ((await repo.count(client)) > 0)
      throw new AppError("CATEGORIES_EXIST", "Categories are already set up", 409);
    const made = [];
    for (const s of SUGGESTED) made.push(await repo.insert(client, { code: codeOf(s.name), name: s.name, type: s.type }));
    await emit(client, {
      key: EVENTS.EXPENSE_CATEGORY_SUGGESTED,
      entity: { type: "expense_category", id: made[0].expense_category_id },
      actor,
      payload: { count: made.length },
      metadata: { count: made.length },
    });
  });
  return list({ page: 1 });
}

/**
 * The category a request may name now: one that exists and is offered. The one a request already
 * holds stays allowed when it is deactivated afterwards (`keep`).
 */
async function assertOffered(db, id, keep = null) {
  const active = await repo.isActive(db, id);
  if (active === null || (active === false && id !== keep))
    throw new AppError("CATEGORY_UNAVAILABLE", "Pick a category that is offered", 422, { expense_category_id: ["Not offered"] });
}

/* ------------------------------------------------------------------ *
 * Praxis AI's cards (docs/guides/praxis-ai.md §6.11): what a card names and re-checks. Nothing
 * here writes.
 * ------------------------------------------------------------------ */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A category a card names by its words (shared/ai/named.js): among the categories its words find,
 * then the first page in name order (`active` true for those offered on a request); null when none
 * or several match.
 */
async function idOf(db, words, { active } = {}) {
  const only = active !== undefined ? { active } : {};
  const pageOf = async (q) => (await repo.list(db, { page: 1, ...only, ...(q && { q }) }, monthStart())).data || [];
  const said = String(words || "").trim();
  const found = await oneNamedIn([() => pageOf(said.slice(0, 80)), () => pageOf(null)], said, (c) => [c.name], { drop: ["category", "expenses", "expense"] });
  return found ? found.expense_category_id : null;
}

/** Every category's name, offered first, to tap when a card asks which category. */
async function names(db, { active } = {}) {
  const page = await repo.list(db, { page: 1, ...(active !== undefined && { active }) }, monthStart());
  return (page.data || []).sort((a, b) => Number(b.active) - Number(a.active)).map((c) => c.name).slice(0, 6);
}

/** The category a card names, by its name. */
async function cardCategory(db, id) {
  if (!db || !UUID.test(String(id || ""))) return [];
  const row = await repo.getRow(db, id);
  return row ? [{ type: "expense_category", id, label: row.name }] : [];
}

/** Save Category's re-check: the category is there. */
async function assertCard(db, id) {
  if (!(await cardCategory(db, id)).length) throw notFound();
}

module.exports = {
  SUGGESTED,
  codeOf,
  monthStart,
  list,
  get,
  create,
  update,
  addSuggested,
  assertOffered,
  idOf,
  names,
  cardCategory,
  assertCard,
};
