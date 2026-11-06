"use strict";
/**
 * Partnerships · Categories: the SQL (docs/guides/partnerships.md §4.2, §6.3). Writes partner_category,
 * partner_category_template, partner_category_checklist_item, partnership_field and the four
 * reference_value lists MyCity edits on Categories. Reads partner, lead and partnership_opportunity for
 * what is in a category. Never emits; the wording of a template is template_version's, written by
 * templates.agreements.
 */
const { pageQuery, orderBy, completeQuery, TOTAL_COL } = require("../../shared/http/paged");

const one = async (db, sql, params) => (await db.query(sql, params)).rows[0] || null;
const many = async (db, sql, params) => (await db.query(sql, params)).rows;

/** Build `SET a = $2, b = $3` from the fields given; `?` in a fragment is replaced by the parameter. */
function setClause(patch, columns, params) {
  const sets = [];
  for (const [field, column] of Object.entries(columns)) {
    if (patch[field] === undefined) continue;
    params.push(patch[field]);
    sets.push(`${column} = $${params.length}`);
  }
  return sets;
}

/* ------------------------------------------------------------------ *
 * Categories
 * ------------------------------------------------------------------ */

const CATEGORY = `c.partner_category_id, c.name::text AS name, c.description,
  c.default_commission_pct::text AS default_commission_pct, c.default_validity_days,
  c.counts_as_vendor, c.display_order, c.active`;

const SORTS = { display_order: "c.display_order", name: "c.name" };

function listCategories(db, query) {
  return pageQuery(
    db,
    `SELECT ${CATEGORY},
            (SELECT count(*)::int FROM partner p WHERE p.partner_category_id = c.partner_category_id) AS partners,
            (SELECT count(*)::int FROM lead l WHERE l.partner_category_id = c.partner_category_id) AS leads,
            ${TOTAL_COL}
       FROM partner_category c
      WHERE ($1::boolean IS NULL OR c.active = $1)
        AND ($2::text IS NULL OR search_fold(c.name::text) LIKE '%' || search_fold($2) || '%')
      ORDER BY ${orderBy(query, SORTS, "c.partner_category_id")}`,
    [query.active === undefined ? null : query.active, query.q || null],
    query,
  );
}

const getCategory = (db, id) => one(db, `SELECT ${CATEGORY} FROM partner_category c WHERE c.partner_category_id = $1`, [id]);

const categoryByName = (db, name) =>
  one(db, `SELECT ${CATEGORY} FROM partner_category c WHERE c.name = $1`, [name]);

/** What is in a category: partners, leads, and deals still being pursued (their lead's or partner's category). */
const categoryCounts = (db, id) =>
  one(
    db,
    `SELECT (SELECT count(*)::int FROM partner p WHERE p.partner_category_id = $1) AS partners,
            (SELECT count(*)::int FROM lead l WHERE l.partner_category_id = $1) AS leads,
            (SELECT count(*)::int FROM partnership_opportunity d
               LEFT JOIN partner p ON p.partner_id = d.partner_id
               LEFT JOIN lead l ON l.lead_id = d.lead_id
              WHERE d.status = 'open' AND COALESCE(p.partner_category_id, l.partner_category_id) = $1) AS open_deals`,
    [id],
  );

const nextCategoryOrder = async (db) =>
  Number((await one(db, "SELECT COALESCE(max(display_order), 0) + 10 AS next FROM partner_category", [])).next);

function insertCategory(client, c) {
  return one(
    client,
    `INSERT INTO partner_category (name, description, default_commission_pct, default_validity_days, counts_as_vendor, display_order)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING partner_category_id`,
    [c.name, c.description ?? null, c.default_commission_pct ?? null, c.default_validity_days ?? null, c.counts_as_vendor ?? false, c.display_order],
  );
}

async function updateCategory(client, id, patch) {
  const params = [id];
  const sets = setClause(
    patch,
    {
      name: "name",
      description: "description",
      default_commission_pct: "default_commission_pct",
      default_validity_days: "default_validity_days",
      counts_as_vendor: "counts_as_vendor",
      display_order: "display_order",
      active: "active",
    },
    params,
  );
  if (!sets.length) return;
  await client.query(`UPDATE partner_category SET ${sets.join(", ")} WHERE partner_category_id = $1`, params);
}

/* ------------------------------------------------------------------ *
 * Agreement templates
 * ------------------------------------------------------------------ */

const TEMPLATE = `t.partner_category_template_id, t.partner_category_id, t.template_key::text AS template_key, t.kind, t.label,
  t.is_default, t.countersigned, t.active, t.asks,
  (SELECT max(v.version)::int FROM template_version v WHERE v.kind = 'document' AND v.key = t.template_key) AS version`;

const templatesOf = (db, categoryId) =>
  many(
    db,
    `SELECT ${TEMPLATE} FROM partner_category_template t
      WHERE t.partner_category_id = $1
      ORDER BY t.active DESC, t.kind, t.is_default DESC, t.label, t.partner_category_template_id`,
    [categoryId],
  );

const getTemplate = (db, id) =>
  one(db, `SELECT ${TEMPLATE} FROM partner_category_template t WHERE t.partner_category_template_id = $1`, [id]);

const defaultOf = (db, categoryId, kind) =>
  one(
    db,
    `SELECT ${TEMPLATE} FROM partner_category_template t
      WHERE t.partner_category_id = $1 AND t.kind = $2 AND t.is_default AND t.active`,
    [categoryId, kind],
  );

function insertTemplate(client, t) {
  return one(
    client,
    `INSERT INTO partner_category_template (partner_category_id, template_key, kind, label, is_default, countersigned, asks)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb) RETURNING partner_category_template_id`,
    [t.partner_category_id, t.template_key, t.kind, t.label, t.is_default, t.countersigned ?? false, JSON.stringify(t.asks || [])],
  );
}

async function updateTemplate(client, id, patch) {
  const params = [id];
  const sets = setClause(patch, { label: "label", is_default: "is_default", countersigned: "countersigned", active: "active" }, params);
  if (patch.asks !== undefined) {
    params.push(JSON.stringify(patch.asks));
    sets.push(`asks = $${params.length}::jsonb`);
  }
  if (!sets.length) return;
  await client.query(`UPDATE partner_category_template SET ${sets.join(", ")} WHERE partner_category_template_id = $1`, params);
}

/** One default a category and kind: take it from every other template of that kind. */
const clearDefault = (client, categoryId, kind, exceptId) =>
  client.query(
    `UPDATE partner_category_template SET is_default = false
      WHERE partner_category_id = $1 AND kind = $2 AND is_default AND partner_category_template_id <> $3`,
    [categoryId, kind, exceptId],
  );

/** The first active template of a kind that is not the default, to promote when the default is retired. */
const nextTemplateOf = (db, categoryId, kind, exceptId) =>
  one(
    db,
    `SELECT partner_category_template_id FROM partner_category_template
      WHERE partner_category_id = $1 AND kind = $2 AND active AND partner_category_template_id <> $3
      ORDER BY label, partner_category_template_id LIMIT 1`,
    [categoryId, kind, exceptId],
  );

/* ------------------------------------------------------------------ *
 * Delivery checklist
 * ------------------------------------------------------------------ */

const ITEM = `i.partner_category_checklist_item_id, i.partner_category_id, i.title, i.description, i.due_from, i.due_days, i.position, i.active`;

const checklistOf = (db, categoryId) =>
  many(
    db,
    `SELECT ${ITEM} FROM partner_category_checklist_item i
      WHERE i.partner_category_id = $1
      ORDER BY i.active DESC, i.position, i.partner_category_checklist_item_id`,
    [categoryId],
  );

const getItem = (db, id) =>
  one(db, `SELECT ${ITEM} FROM partner_category_checklist_item i WHERE i.partner_category_checklist_item_id = $1`, [id]);

function insertItem(client, i) {
  return one(
    client,
    `INSERT INTO partner_category_checklist_item (partner_category_id, title, description, due_from, due_days, position)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING partner_category_checklist_item_id`,
    [i.partner_category_id, i.title, i.description ?? null, i.due_from, i.due_days, i.position],
  );
}

async function updateItem(client, id, patch) {
  const params = [id];
  const sets = setClause(
    patch,
    { title: "title", description: "description", due_from: "due_from", due_days: "due_days", position: "position", active: "active" },
    params,
  );
  if (!sets.length) return;
  await client.query(`UPDATE partner_category_checklist_item SET ${sets.join(", ")} WHERE partner_category_checklist_item_id = $1`, params);
}

/** The active items of a category in order, to renumber after one moves. */
const activeItemIds = async (db, categoryId) =>
  (
    await many(
      db,
      `SELECT partner_category_checklist_item_id AS id FROM partner_category_checklist_item
        WHERE partner_category_id = $1 AND active ORDER BY position, partner_category_checklist_item_id`,
      [categoryId],
    )
  ).map((r) => r.id);

const setItemPosition = (client, id, position) =>
  client.query("UPDATE partner_category_checklist_item SET position = $2 WHERE partner_category_checklist_item_id = $1", [id, position]);

/* ------------------------------------------------------------------ *
 * Custom fields
 * ------------------------------------------------------------------ */

const FIELD = `f.partnership_field_id, f.key, f.label, f.field_type, f.options, f.applies_to, f.partner_category_id,
  f.filterable, f.position, f.active`;

/** The definitions asked for: one category's and every category's, or one list's. Whole: a form needs them at once. */
async function listFields(db, q) {
  // pagination:complete the custom field definitions, whole: every form needs them at once, 200 at most
  const { rows } = await completeQuery(
    db,
    `SELECT ${FIELD} FROM partnership_field f
      WHERE ($1::text IS NULL OR f.applies_to = $1)
        AND ($2::uuid IS NULL OR f.partner_category_id IS NULL OR f.partner_category_id = $2)
        AND ($3::boolean IS NULL OR f.active = $3)
      ORDER BY f.active DESC, f.position, f.label, f.partnership_field_id`,
    [q.applies_to || null, q.partner_category_id || null, q.active === undefined ? null : q.active],
    { label: "The custom fields", ceiling: 200 },
  );
  return rows;
}

const getField = (db, id) => one(db, `SELECT ${FIELD} FROM partnership_field f WHERE f.partnership_field_id = $1`, [id]);

const fieldKeyTaken = async (db, key) => Boolean(await one(db, "SELECT 1 AS x FROM partnership_field WHERE key = $1", [key]));

const nextFieldPosition = async (db) =>
  Number((await one(db, "SELECT COALESCE(max(position), 0) + 10 AS next FROM partnership_field", [])).next);

function insertField(client, f) {
  return one(
    client,
    `INSERT INTO partnership_field (key, label, field_type, options, applies_to, partner_category_id, filterable, position)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8) RETURNING partnership_field_id`,
    [f.key, f.label, f.field_type, f.options ? JSON.stringify(f.options) : null, f.applies_to, f.partner_category_id ?? null, f.filterable ?? false, f.position],
  );
}

async function updateField(client, id, patch) {
  const params = [id];
  const sets = setClause(patch, { label: "label", filterable: "filterable", position: "position", active: "active" }, params);
  if (patch.options !== undefined) {
    params.push(JSON.stringify(patch.options));
    sets.push(`options = $${params.length}::jsonb`);
  }
  if (!sets.length) return;
  await client.query(`UPDATE partnership_field SET ${sets.join(", ")} WHERE partnership_field_id = $1`, params);
}

/* ------------------------------------------------------------------ *
 * MyCity's lists (reference_value)
 * ------------------------------------------------------------------ */

const VALUE = `v.code::text AS code, v.label, v.metadata ->> 'meaning' AS meaning, v.display_order AS position, v.active`;

async function listValues(db, domain) {
  // pagination:complete one of MyCity's lists, whole: a list is a handful of values every form needs at once
  const { rows } = await completeQuery(
    db,
    `SELECT ${VALUE} FROM reference_value v
      WHERE v.domain = $1
      ORDER BY v.active DESC, v.display_order, v.label, v.code`,
    [domain],
    { label: "The list", ceiling: 200 },
  );
  return rows;
}

const getValue = (db, domain, code) =>
  one(db, `SELECT ${VALUE} FROM reference_value v WHERE v.domain = $1 AND v.code = $2`, [domain, code]);

const valueByLabel = (db, domain, label) =>
  one(db, `SELECT ${VALUE} FROM reference_value v WHERE v.domain = $1 AND lower(v.label) = lower($2) AND v.active`, [domain, label]);

const codeTaken = async (db, domain, code) =>
  Boolean(await one(db, "SELECT 1 AS x FROM reference_value WHERE domain = $1 AND code = $2", [domain, code]));

const nextValuePosition = async (db, domain) =>
  Number((await one(db, "SELECT COALESCE(max(display_order), 0) + 10 AS next FROM reference_value WHERE domain = $1", [domain])).next);

function insertValue(client, domain, v) {
  return one(
    client,
    `INSERT INTO reference_value (domain, code, label, display_order, metadata)
     VALUES ($1, $2, $3, $4, $5::jsonb) RETURNING code::text AS code`,
    [domain, v.code, v.label, v.position, JSON.stringify(v.meaning ? { meaning: v.meaning } : {})],
  );
}

async function updateValue(client, domain, code, patch) {
  const params = [domain, code];
  const sets = setClause(patch, { label: "label", position: "display_order", active: "active" }, params);
  if (patch.meaning !== undefined) {
    params.push(patch.meaning);
    sets.push(`metadata = jsonb_set(metadata, '{meaning}', to_jsonb($${params.length}::text))`);
  }
  if (!sets.length) return;
  await client.query(`UPDATE reference_value SET ${sets.join(", ")} WHERE domain = $1 AND code = $2`, params);
}

/** The active stages carrying a meaning, other than one code: what is left to count as it. */
const stagesCounting = async (db, meaning, exceptCode) =>
  Number(
    (
      await one(
        db,
        `SELECT count(*)::int AS n FROM reference_value
          WHERE domain = 'partnership_stage' AND active AND metadata ->> 'meaning' = $1 AND code <> $2`,
        [meaning, exceptCode || ""],
      )
    ).n,
  );

/** Whether a deal is at a stage (so the last stage of a meaning in use cannot change meaning or retire). */
const stageInUse = async (db, code) =>
  Boolean(await one(db, "SELECT 1 AS x FROM partnership_opportunity WHERE stage = $1 LIMIT 1", [code]));

module.exports = {
  listCategories,
  getCategory,
  categoryByName,
  categoryCounts,
  nextCategoryOrder,
  insertCategory,
  updateCategory,
  templatesOf,
  getTemplate,
  defaultOf,
  insertTemplate,
  updateTemplate,
  clearDefault,
  nextTemplateOf,
  checklistOf,
  getItem,
  insertItem,
  updateItem,
  activeItemIds,
  setItemPosition,
  listFields,
  getField,
  fieldKeyTaken,
  nextFieldPosition,
  insertField,
  updateField,
  listValues,
  getValue,
  valueByLabel,
  codeTaken,
  nextValuePosition,
  insertValue,
  updateValue,
  stagesCounting,
  stageInUse,
};
