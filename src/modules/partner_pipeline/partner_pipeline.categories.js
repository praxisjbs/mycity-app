"use strict";
/**
 * Partnerships · Categories: the one write path for a category and its agreement templates
 * (docs/guides/partnerships.md §6.3, §6.8; the delivery checklist is partner_pipeline.checklists).
 *
 * A category is MyCity's partnership type. It carries a default commission and validity, the agreement
 * templates Generate Agreement picks from, the checklist a signed deal raises as tasks, and the custom
 * fields of its records. A category in use is retired, never deleted. A template's wording is
 * template_version's, saved through templates.agreements; the row here names it for the category, says
 * its kind, whether MyCity countersigns, and keeps its asks.
 */
const { pool } = require("../../config/db");
const { atomically } = require("../../shared/db/tx");
const { AppError } = require("../../shared/errors");
const { emit } = require("../../shared/events/emit");
const wording = require("../templates/templates.agreements");
const repo = require("./partner_pipeline.repo");
const { EVENTS } = require("./partner_pipeline.events");

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

const notFound = (what = "category") => new AppError("NOT_FOUND", `That ${what} does not exist`, 404);
const nameTaken = () => new AppError("CATEGORY_NAME_TAKEN", "That name is taken", 409, { name: ["Name in use"] });

/** Postgres' unique violation, from two people saving one name at once. */
const isUnique = (err) => err && err.code === "23505";

/* ------------------------------------------------------------------ *
 * Categories
 * ------------------------------------------------------------------ */

/** A page of categories with the partners and leads in each the reader may see (§6.1, §6.3). */
const list = (query, scope = null) => repo.listCategories(pool, query, scope);

/**
 * A category whole: its templates, checklist and fields, and what is in it that the reader may see.
 * @param {object|null} [scope]  the reader's; null counts every record
 */
async function detail(id, db = pool, scope = null) {
  const category = await repo.getCategory(db, id);
  if (!category) throw notFound();
  const [templates, checklist, fields, counts] = await Promise.all([
    repo.templatesOf(db, id),
    repo.checklistOf(db, id),
    repo.listFields(db, { partner_category_id: id }),
    repo.categoryCounts(db, id, scope),
  ]);
  return { ...category, templates, checklist, fields, counts };
}

const get = (id, scope = null) => detail(id, pool, scope);

async function create(actor, body, scope = null) {
  const id = await tx(async (client) => {
    if (await repo.categoryByName(client, body.name)) throw nameTaken();
    const row = await repo.insertCategory(client, { ...body, display_order: await repo.nextCategoryOrder(client) });
    const after = await repo.getCategory(client, row.partner_category_id);
    await emit(client, {
      key: EVENTS.CATEGORY_CREATED,
      entity: { type: "partner_category", id: row.partner_category_id },
      actor,
      after,
      payload: { partner_category_id: row.partner_category_id, name: after.name },
    });
    return row.partner_category_id;
  }).catch((err) => {
    throw isUnique(err) ? nameTaken() : err;
  });
  return detail(id, pool, scope);
}

async function update(actor, id, body, scope = null) {
  await tx(async (client) => {
    const before = await repo.getCategory(client, id);
    if (!before) throw notFound();
    if (body.name !== undefined) {
      const same = await repo.categoryByName(client, body.name);
      if (same && same.partner_category_id !== id) throw nameTaken();
    }
    await repo.updateCategory(client, id, body);
    const after = await repo.getCategory(client, id);
    await emit(client, {
      key: EVENTS.CATEGORY_UPDATED,
      entity: { type: "partner_category", id },
      actor,
      before,
      after,
      payload: { partner_category_id: id, name: after.name, active: after.active },
    });
  }).catch((err) => {
    throw isUnique(err) ? nameTaken() : err;
  });
  return detail(id, pool, scope);
}

/* ------------------------------------------------------------------ *
 * Agreement templates
 * ------------------------------------------------------------------ */

const templateNotFound = () => notFound("template");

/** The custom fields a template of this category may name: the category's and every category's, in use. */
const fieldsFor = (db, categoryId) => repo.listFields(db, { partner_category_id: categoryId, active: true });

/** GET /category-templates/:id: the template with its wording as the editor opens it. */
async function getTemplate(id, db = pool) {
  const row = await repo.getTemplate(db, id);
  if (!row) throw templateNotFound();
  const read = await wording.readWording(db, row.template_key, await fieldsFor(db, row.partner_category_id), row.asks);
  return { ...row, version: read.version || row.version || 0, title: read.title, body_html: read.body_html, record_fields: [...wording.RECORD_FIELDS] };
}

async function addTemplate(actor, categoryId, body, scope = null) {
  await tx(async (client) => {
    const category = await repo.getCategory(client, categoryId);
    if (!category) throw notFound();
    if (!category.active) throw new AppError("CATEGORY_RETIRED", "Restore the category first", 409);
    const key = body.template_key || (await wording.freeKey(client, category.name, body.label));
    if (body.template_key && (await wording.keyTaken(client, key)))
      throw new AppError("TEMPLATE_KEY_TAKEN", "That key is taken", 409, { template_key: ["Key in use"] });
    const asks = body.asks || [];
    await wording.saveWording(
      client,
      { key, title: body.title, body_html: body.body_html, customFields: await fieldsFor(client, categoryId), asks },
      { created_by: actor.user_id },
    );
    const hasDefault = Boolean(await repo.defaultOf(client, categoryId, body.kind));
    const makeDefault = body.is_default === true || !hasDefault;
    const row = await repo.insertTemplate(client, {
      partner_category_id: categoryId,
      template_key: key,
      kind: body.kind,
      label: body.label,
      is_default: false,
      countersigned: body.countersigned,
      asks,
    });
    const id = row.partner_category_template_id;
    if (makeDefault) {
      await repo.clearDefault(client, categoryId, body.kind, id);
      await repo.updateTemplate(client, id, { is_default: true });
    }
    await emit(client, {
      key: EVENTS.CATEGORY_TEMPLATE_ADDED,
      entity: { type: "partner_category", id: categoryId },
      actor,
      after: await repo.getTemplate(client, id),
      payload: { partner_category_id: categoryId, partner_category_template_id: id, template_key: key, kind: body.kind },
    });
  });
  return detail(categoryId, pool, scope);
}

async function updateTemplate(actor, id, body, scope = null) {
  const categoryId = await tx(async (client) => {
    const before = await repo.getTemplate(client, id);
    if (!before) throw templateNotFound();
    const patch = { ...body };
    if (body.active === false) patch.is_default = false;
    if (body.is_default === true && !(body.active ?? before.active))
      throw new AppError("TEMPLATE_RETIRED", "Restore the template before making it the default", 409);
    if (body.is_default === true || (body.active === true && !before.is_default && !(await repo.defaultOf(client, before.partner_category_id, before.kind)))) {
      await repo.clearDefault(client, before.partner_category_id, before.kind, id);
      patch.is_default = true;
    }
    await repo.updateTemplate(client, id, patch);
    // A retired default hands the kind to the next template, so Generate Agreement always has one to pick.
    if (before.is_default && body.active === false) {
      const next = await repo.nextTemplateOf(client, before.partner_category_id, before.kind, id);
      if (next) await repo.updateTemplate(client, next.partner_category_template_id, { is_default: true });
    }
    await emit(client, {
      key: EVENTS.CATEGORY_TEMPLATE_UPDATED,
      entity: { type: "partner_category", id: before.partner_category_id },
      actor,
      before,
      after: await repo.getTemplate(client, id),
      payload: { partner_category_id: before.partner_category_id, partner_category_template_id: id, template_key: before.template_key },
    });
    return before.partner_category_id;
  });
  return detail(categoryId, pool, scope);
}

/** PUT /category-templates/:id/wording: the next version of the wording; asks replaced when given. */
async function saveTemplateWording(actor, id, body) {
  await tx(async (client) => {
    const row = await repo.getTemplate(client, id);
    if (!row) throw templateNotFound();
    if (!row.active) throw new AppError("TEMPLATE_RETIRED", "A retired template is not edited", 409);
    const asks = body.asks ?? row.asks;
    const saved = await wording.saveWording(
      client,
      { key: row.template_key, title: body.title, body_html: body.body_html, customFields: await fieldsFor(client, row.partner_category_id), asks },
      { created_by: actor.user_id },
    );
    if (body.asks !== undefined) await repo.updateTemplate(client, id, { asks });
    await emit(client, {
      key: EVENTS.CATEGORY_TEMPLATE_SAVED,
      entity: { type: "partner_category", id: row.partner_category_id },
      actor,
      before: { version: row.version },
      after: { version: saved.version },
      payload: { partner_category_id: row.partner_category_id, partner_category_template_id: id, template_key: row.template_key, version: saved.version },
    });
  });
  return getTemplate(id);
}

module.exports = { list, get, detail, create, update, getTemplate, addTemplate, updateTemplate, saveTemplateWording };
