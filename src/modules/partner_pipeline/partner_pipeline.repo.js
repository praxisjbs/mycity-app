"use strict";
/**
 * Partnerships · the pipeline's SQL (docs/guides/partnerships.md §4.2, §6.1, §6.3, §6.5, §6.6).
 *
 * Categories (M7 PR 2): writes partner_category, partner_category_template,
 * partner_category_checklist_item, partnership_field and the four reference_value lists MyCity edits
 * on Categories, and reads partner, lead and partnership_opportunity for what is in a category. The
 * wording of a template is template_version's, written by templates.agreements.
 *
 * Deals (M7 PR 3): their options, team, history and returns. A deal is a row of
 * `partnership_opportunity`; on the wire its id is `deal_id`. Who sees what (§6.1), the one rule the
 * lists, the 360s, ⌘K, Home and Praxis AI share:
 *   a deal         its owner is in the reader's scope (shared/rbac/scope), or one of its team is, or
 *                  the owner of the lead or partner it is on (the partner's, once it has one)
 *   a lead or a    its owner is in the reader's scope, or one of its deals' owner or team is
 *   partner
 * A record with no owner and no team in scope is seen only with `all`. The ids come from
 * scopeClause, the one translation of a scope into SQL; this file only widens it to the team and the
 * record's owner.
 *
 * Money is numeric(18,2), read as its two-place string. Sums count Naira only (§6.19). Never emits.
 */
const { pageQuery, orderBy, completeQuery, TOTAL_COL } = require("../../shared/http/paged");
const { scopeClause } = require("../../shared/rbac/scope");
const { personJson } = require("../../shared/db/person");

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

const CATEGORY_SORTS = { display_order: "c.display_order", name: "c.name" };

/**
 * A page of categories, each with the partners and leads in it the reader may see (§6.1, §6.3).
 * @param {object|null} scope  null: every record (a check, never a screen)
 */
function listCategories(db, query, scope = null) {
  const params = [query.active === undefined ? null : query.active, query.q || null];
  const seenP = scope ? recordSeen(scope, { alias: "p", kind: "partner" }, params) : "";
  const seenL = scope ? recordSeen(scope, { alias: "l", kind: "lead" }, params) : "";
  return pageQuery(
    db,
    `SELECT ${CATEGORY},
            (SELECT count(*)::int FROM partner p WHERE p.partner_category_id = c.partner_category_id ${seenP}) AS partners,
            (SELECT count(*)::int FROM lead l WHERE l.partner_category_id = c.partner_category_id ${seenL}) AS leads,
            ${TOTAL_COL}
       FROM partner_category c
      WHERE ($1::boolean IS NULL OR c.active = $1)
        AND ($2::text IS NULL OR search_fold(c.name::text) LIKE '%' || search_fold($2) || '%')
      ORDER BY ${orderBy(query, CATEGORY_SORTS, "c.partner_category_id")}`,
    params,
    query,
  );
}

const getCategory = (db, id) => one(db, `SELECT ${CATEGORY} FROM partner_category c WHERE c.partner_category_id = $1`, [id]);

/** Every active category's id and name, by name: a handful MyCity keeps, offered whole on Map Values. */
async function categoryChoices(db) {
  // pagination:complete MyCity's categories, whole: a list of a dozen or so, mapped one by one on Map Values
  const { rows } = await completeQuery(
    db,
    "SELECT partner_category_id::text AS value, name::text AS label FROM partner_category WHERE active ORDER BY name, partner_category_id",
    [],
    { label: "The categories", ceiling: 200 },
  );
  return rows;
}

/** An active or retired category by its name, case aside, or null. */
const categoryNamed = (db, name) =>
  one(db, "SELECT partner_category_id::text AS id, name::text AS name, active FROM partner_category WHERE lower(name::text) = lower($1)", [name]);

const categoryByName = (db, name) =>
  one(db, `SELECT ${CATEGORY} FROM partner_category c WHERE c.name = $1`, [name]);

/**
 * What is in a category that the reader may see: partners, leads, and deals still being pursued (their
 * lead's or partner's category).
 * @param {object|null} scope  null: every record (a check, never a screen)
 */
function categoryCounts(db, id, scope = null) {
  const params = [id];
  const seenP = scope ? recordSeen(scope, { alias: "p", kind: "partner" }, params) : "";
  const seenL = scope ? recordSeen(scope, { alias: "l", kind: "lead" }, params) : "";
  const seenD = scope ? dealSeen(scope, "d", params) : "";
  return one(
    db,
    `SELECT (SELECT count(*)::int FROM partner p WHERE p.partner_category_id = $1 ${seenP}) AS partners,
            (SELECT count(*)::int FROM lead l WHERE l.partner_category_id = $1 ${seenL}) AS leads,
            (SELECT count(*)::int FROM partnership_opportunity d
               LEFT JOIN partner p ON p.partner_id = d.partner_id
               LEFT JOIN lead l ON l.lead_id = d.lead_id
              WHERE d.status = 'open' AND COALESCE(p.partner_category_id, l.partner_category_id) = $1 ${seenD}) AS open_deals`,
    params,
  );
}

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

/**
 * Number a list's values in use 10, 20, 30 in their order, after one is moved. A move places a value one
 * past its neighbour (Move Up and Move Down), so the gaps stay ten wide and no two values ever tie.
 */
async function renumberValues(client, domain) {
  await client.query(
    `UPDATE reference_value v SET display_order = r.n * 10
       FROM (SELECT code, row_number() OVER (ORDER BY display_order, label, code) AS n
               FROM reference_value WHERE domain = $1 AND active) r
      WHERE v.domain = $1 AND v.code = r.code AND v.display_order <> r.n * 10`,
    [domain],
  );
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

/* ------------------------------------------------------------------ *
 * Visibility
 * ------------------------------------------------------------------ */

/** The team clause of a deal `d`, against the ids at `$n`. */
const teamOf = (d, n) =>
  `EXISTS (SELECT 1 FROM deal_member dm WHERE dm.deal_id = ${d}.partnership_opportunity_id AND dm.employee_id = ANY($${n}::uuid[]))`;

/** The record clause of a deal `d`: the owner of its partner (once it has one), else of its lead, against `$n`. */
const recordOwnerOf = (d, n) => `(CASE WHEN ${d}.partner_id IS NOT NULL
    THEN EXISTS (SELECT 1 FROM partner rp WHERE rp.partner_id = ${d}.partner_id AND rp.owner_id = ANY($${n}::uuid[]))
    ELSE EXISTS (SELECT 1 FROM lead rl WHERE rl.lead_id = ${d}.lead_id AND rl.owner_id = ANY($${n}::uuid[])) END)`;

/**
 * The condition a deal `alias` is seen by: "" for `all`, else "AND (...)". Appends the ids to params.
 * A deal is seen through its owner, its team, or its lead's or partner's owner (§6.1).
 * @param {{scope: string, scope_ids: string[]|null}} scope
 * @param {string} alias
 * @param {Array} params
 */
function dealSeen(scope, alias, params) {
  const s = scopeClause(scope, { column: `${alias}.owner_id` }, params);
  if (!s.and) return "";
  const n = params.length;
  return `AND (${alias}.owner_id = ANY($${n}::uuid[]) OR ${teamOf(alias, n)} OR ${recordOwnerOf(alias, n)})`;
}

/**
 * The condition a lead or a partner `alias` is seen by: its owner in scope, or a deal on it seen.
 * @param {{scope: string, scope_ids: string[]|null}} scope
 * @param {{alias: string, kind: "lead"|"partner"}} on
 * @param {Array} params
 */
function recordSeen(scope, { alias, kind }, params) {
  const s = scopeClause(scope, { column: `${alias}.owner_id` }, params);
  if (!s.and) return "";
  const n = params.length;
  return `AND (${alias}.owner_id = ANY($${n}::uuid[]) OR EXISTS (
    SELECT 1 FROM partnership_opportunity sd
     WHERE sd.${kind}_id = ${alias}.${kind}_id
       AND (sd.owner_id = ANY($${n}::uuid[]) OR ${teamOf("sd", n)})))`;
}

/* ------------------------------------------------------------------ *
 * Fragments the leads and partners repos share
 * ------------------------------------------------------------------ */

/** A record's region as a list shows it: "Lagos, Ibadan", or the scope's name. */
function regionLabel(scopeExpr, owner, idExpr) {
  return `CASE ${scopeExpr}
    WHEN 'national' THEN 'National' WHEN 'africa' THEN 'Africa' WHEN 'worldwide' THEN 'Worldwide'
    WHEN 'cities' THEN (SELECT string_agg(COALESCE(pl.city, pl.formatted), ', ' ORDER BY split_part(pl.owner_key, ':', 2)::int)
                          FROM place pl WHERE pl.owner = '${owner}' AND pl.owner_key LIKE ${idExpr}::text || ':%')
    END`;
}

/** A record's region holds the city typed (as the address search names it). */
function regionHasCity(owner, idExpr, n) {
  return `EXISTS (SELECT 1 FROM place pl WHERE pl.owner = '${owner}' AND pl.owner_key LIKE ${idExpr}::text || ':%'
    AND (search_fold(COALESCE(pl.city, '')) = search_fold($${n}) OR search_fold(pl.formatted) LIKE search_fold($${n}) || '%'))`;
}

/** The record's latest interaction, or null. */
const lastContact = (kind, idExpr) => `(SELECT max(pi.occurred_at) FROM partner_interaction pi WHERE pi.${kind}_id = ${idExpr})`;

/** Lagos days from an instant to today. */
const lagosDaysSince = (at) => `GREATEST(0, ((now() AT TIME ZONE 'Africa/Lagos')::date - (${at} AT TIME ZONE 'Africa/Lagos')::date))::int`;

/** When a deal `d` entered its stage: its last stage line, else when it was made. */
const stageSince = (d) =>
  `COALESCE((SELECT max(h.changed_at) FROM partnership_stage_history h WHERE h.partnership_opportunity_id = ${d}.partnership_opportunity_id AND h.kind = 'stage'), ${d}.created_at)`;

/** A deal's signed value: its latest signed agreement's value, else its projected value; null until signed (§6.6). */
const signedValue = (d) => `CASE WHEN ${d}.signed_at IS NULL THEN NULL ELSE COALESCE(
  (SELECT (array_agg(pa.value ORDER BY pa.signed_at DESC NULLS LAST))[1] FROM partnership_agreement pa
    WHERE pa.partnership_opportunity_id = ${d}.partnership_opportunity_id AND pa.status IN ('signed', 'active', 'expiring', 'renewed') AND pa.value IS NOT NULL),
  ${d}.estimated_value) END`;

/* ------------------------------------------------------------------ *
 * Reading deals
 * ------------------------------------------------------------------ */

const FROM = `FROM partnership_opportunity po
  LEFT JOIN partner p ON p.partner_id = po.partner_id
  LEFT JOIN lead l ON l.lead_id = po.lead_id
  LEFT JOIN partner_category pc ON pc.partner_category_id = COALESCE(p.partner_category_id, l.partner_category_id)
  LEFT JOIN reference_value rv ON rv.domain = 'partnership_stage' AND rv.code = po.stage
  LEFT JOIN employee e ON e.employee_id = po.owner_id
  LEFT JOIN department d ON d.department_id = e.department_id`;

const ROW = `po.partnership_opportunity_id AS deal_id, po.number, po.title,
  CASE WHEN p.partner_id IS NOT NULL THEN json_build_object('type', 'partner', 'id', p.partner_id, 'number', p.number, 'name', p.name)
       ELSE json_build_object('type', 'lead', 'id', l.lead_id, 'number', l.number::text, 'name', l.name) END AS record,
  po.lead_id, po.partner_id, pc.name::text AS category, po.stage, COALESCE(rv.label, po.stage) AS stage_label,
  NULLIF(rv.metadata->>'meaning', '') AS meaning, po.health, po.status, ${personJson("e", "d")} AS owner,
  po.estimated_value, po.currency::text AS currency, po.expected_close_on, ${lagosDaysSince(stageSince("po"))} AS days_at_stage,
  po.event_title, po.event_starts_on, po.created_at`;

const DETAIL = `${ROW}, po.objective, po.event_ends_on, po.expected_attendance, po.blockers, po.next_action, po.next_action_on,
  po.commission_pct, po.commission_deviates, po.validity_days, po.valid_until, po.identified_on, po.signed_at,
  po.completed_at, po.close_reason, ${signedValue("po")} AS signed_value, COALESCE(po.impact, '{}') AS impact,
  po.impact_rating, po.impact_note, po.comments, po.custom, po.owner_id,
  COALESCE(p.partner_category_id, l.partner_category_id) AS partner_category_id`;

const DEAL_SORTS = {
  expected_close_on: "po.expected_close_on",
  title: "po.title",
  estimated_value: "po.estimated_value",
  created_at: "po.created_at",
};

/** The filters Pipeline and the deals list share, as SQL; appends params. */
function filters(query, params) {
  const out = [];
  const add = (v) => {
    params.push(v);
    return params.length;
  };
  if (query.stage) out.push(`po.stage = $${add(query.stage)}`);
  if (query.partner_category_id) out.push(`pc.partner_category_id = $${add(query.partner_category_id)}`);
  if (query.region_scope) out.push(`COALESCE(p.region_scope, l.region_scope) = $${add(query.region_scope)}`);
  if (query.region_city) {
    const n = add(query.region_city);
    out.push(`(CASE WHEN p.partner_id IS NOT NULL THEN ${regionHasCity("partner.cities", "p.partner_id", n)} ELSE ${regionHasCity("lead.cities", "l.lead_id", n)} END)`);
  }
  if (query.owner_id) out.push(`po.owner_id = $${add(query.owner_id)}`);
  if (query.health) out.push(`po.health = $${add(query.health)}`);
  if (query.status) out.push(`po.status = $${add(query.status)}`);
  if (query.lead_id) out.push(`po.lead_id = $${add(query.lead_id)}`);
  if (query.partner_id) out.push(`po.partner_id = $${add(query.partner_id)}`);
  if (query.q) {
    const n = add(query.q);
    out.push(`search_fold(po.number || ' ' || po.title || ' ' || COALESCE(po.event_title, '') || ' ' || COALESCE(p.name, l.name, '')) LIKE '%' || search_fold($${n}) || '%'`);
  }
  return out.map((s) => `AND ${s}`).join("\n        ");
}

/**
 * A page of deals the reader may see.
 * @param {{query: Function}} db
 * @param {object} query  DealListQuery
 * @param {object} scope
 * @param {string} [customSql]  the custom filter, from partner_pipeline.fields.filterSql
 * @param {Array} [customParams]
 */
function list(db, query, scope, { customSql = "", params: start = [] } = {}) {
  const params = [...start];
  const where = filters(query, params);
  const seen = dealSeen(scope, "po", params);
  return pageQuery(
    db,
    `SELECT ${ROW}, ${TOTAL_COL}
       ${FROM}
      WHERE TRUE ${where} ${customSql} ${seen}
      ORDER BY ${orderBy(query, DEAL_SORTS, "po.partnership_opportunity_id")}`,
    params,
    query,
  );
}

/** One deal whole (its own columns), seen by the reader, or null. */
async function get(db, id, scope) {
  const params = [id];
  const seen = scope ? dealSeen(scope, "po", params) : "";
  const { rows } = await db.query(`SELECT ${DETAIL} ${FROM} WHERE po.partnership_opportunity_id = $1 ${seen}`, params);
  return rows[0] || null;
}

/** A deal's options, in order. */
async function options(db, dealId) {
  const { rows } = await db.query(
    `SELECT deal_option_id, position, label, original_price, discount_pct::text AS discount_pct, deal_price, price_note,
            commission_amount, merchant_take
       FROM deal_option WHERE deal_id = $1 ORDER BY position`,
    [dealId],
  );
  return rows;
}

/** A deal's team, the owner first. */
async function members(db, dealId) {
  const { rows } = await db.query(
    `SELECT ${personJson("e", "d")} AS employee, m.role
       FROM deal_member m
       JOIN employee e ON e.employee_id = m.employee_id
       LEFT JOIN department d ON d.department_id = e.department_id
      WHERE m.deal_id = $1
      ORDER BY (m.role = 'owner') DESC, e.first_name, e.last_name, m.deal_member_id`,
    [dealId],
  );
  return rows;
}

/** Deliverables of some deals (raised on signing, M7 PR 5), each with its task's state. */
function deliverables(db, dealIds) {
  return pageQuery(
    db,
    `SELECT dd.deal_deliverable_id, dd.deal_id, dd.checklist_item_id, dd.title, dd.task_id, t.status, (t.due_at AT TIME ZONE 'Africa/Lagos')::date::text AS due_on,
            ${personJson("e", "d")} AS owner, ${TOTAL_COL}
       FROM deal_deliverable dd
       LEFT JOIN task t ON t.task_id = dd.task_id
       LEFT JOIN employee e ON e.employee_id = t.primary_assignee_id
       LEFT JOIN department d ON d.department_id = e.department_id
      WHERE dd.deal_id = ANY($1::uuid[])
      ORDER BY dd.created_at, dd.deal_deliverable_id`,
    [dealIds],
    { page: 1 },
  );
}

/** A deal's latest 25 stage and health lines, newest first. */
async function history(db, dealId) {
  const page = await pageQuery(
    db,
    `SELECT h.partnership_stage_history_id, h.kind, h.from_stage, h.to_stage,
            CASE WHEN h.kind = 'health' THEN hf.label ELSE COALESCE(sf.label, h.from_stage) END AS from_label,
            CASE WHEN h.kind = 'health' THEN COALESCE(ht.label, h.to_stage) ELSE COALESCE(st.label, h.to_stage) END AS to_label,
            h.reason, h.source, ${personJson("e", "d")} AS by, h.changed_at, ${TOTAL_COL}
       FROM partnership_stage_history h
       LEFT JOIN reference_value sf ON h.kind = 'stage' AND sf.domain = 'partnership_stage' AND sf.code = h.from_stage
       LEFT JOIN reference_value st ON h.kind = 'stage' AND st.domain = 'partnership_stage' AND st.code = h.to_stage
       LEFT JOIN reference_value hf ON h.kind = 'health' AND hf.domain = 'deal_health' AND hf.code = h.from_stage
       LEFT JOIN reference_value ht ON h.kind = 'health' AND ht.domain = 'deal_health' AND ht.code = h.to_stage
       LEFT JOIN app_user u ON u.user_id = h.changed_by
       LEFT JOIN employee e ON e.employee_id = u.employee_id
       LEFT JOIN department d ON d.department_id = e.department_id
      WHERE h.partnership_opportunity_id = $1
      ORDER BY h.changed_at DESC, h.partnership_stage_history_id`,
    [dealId],
    { page: 1 },
  );
  return page.data;
}

/**
 * The latest 25 stage and health lines of a record's deals the reader may see, newest first, each with
 * its deal (the Partner 360's Activity, §6.2).
 * @param {{kind: "lead"|"partner", id: string}} record
 */
async function historyOfRecord(db, { kind, id }, scope) {
  const params = [id];
  const seen = scope ? dealSeen(scope, "po", params) : "";
  const page = await pageQuery(
    db,
    `SELECT h.partnership_stage_history_id, h.kind, h.from_stage, h.to_stage,
            CASE WHEN h.kind = 'health' THEN hf.label ELSE COALESCE(sf.label, h.from_stage) END AS from_label,
            CASE WHEN h.kind = 'health' THEN COALESCE(ht.label, h.to_stage) ELSE COALESCE(st.label, h.to_stage) END AS to_label,
            h.reason, h.source, ${personJson("e", "d")} AS by, h.changed_at,
            po.partnership_opportunity_id AS deal_id, po.number AS deal_number, po.title AS deal_title, ${TOTAL_COL}
       FROM partnership_stage_history h
       JOIN partnership_opportunity po ON po.partnership_opportunity_id = h.partnership_opportunity_id
       LEFT JOIN reference_value sf ON h.kind = 'stage' AND sf.domain = 'partnership_stage' AND sf.code = h.from_stage
       LEFT JOIN reference_value st ON h.kind = 'stage' AND st.domain = 'partnership_stage' AND st.code = h.to_stage
       LEFT JOIN reference_value hf ON h.kind = 'health' AND hf.domain = 'deal_health' AND hf.code = h.from_stage
       LEFT JOIN reference_value ht ON h.kind = 'health' AND ht.domain = 'deal_health' AND ht.code = h.to_stage
       LEFT JOIN app_user u ON u.user_id = h.changed_by
       LEFT JOIN employee e ON e.employee_id = u.employee_id
       LEFT JOIN department d ON d.department_id = e.department_id
      WHERE po.${kind}_id = $1 ${seen}
      ORDER BY h.changed_at DESC, h.partnership_stage_history_id`,
    params,
    { page: 1 },
  );
  return page.data;
}

/** A page of a record's deals the reader may see, open and live first, then newest. */
function ofRecord(db, { kind, id }, scope) {
  const params = [id];
  const seen = scope ? dealSeen(scope, "po", params) : "";
  return pageQuery(
    db,
    `SELECT ${ROW}, ${TOTAL_COL} ${FROM}
      WHERE po.${kind}_id = $1 ${seen}
      ORDER BY (po.status IN ('open', 'live')) DESC, po.created_at DESC, po.partnership_opportunity_id`,
    params,
    { page: 1 },
  );
}

/** The lead's one deal, whole, or null. */
async function ofLead(db, leadId) {
  const { rows } = await db.query(`SELECT ${DETAIL} ${FROM} WHERE po.lead_id = $1 ORDER BY po.created_at LIMIT 1`, [leadId]);
  return rows[0] || null;
}

/* ------------------------------------------------------------------ *
 * Pipeline (§2, §10.1)
 * ------------------------------------------------------------------ */

/** Pipeline's figures within the reader's scope and filters, for the Lagos year `year`. */
async function pipelineFigures(db, query, scope, { from, to }) {
  const params = [from, to];
  const where = filters(query, params);
  const seen = dealSeen(scope, "po", params);
  const { rows } = await db.query(
    `SELECT count(*) FILTER (WHERE po.status = 'open')::int AS open_deals,
            count(*) FILTER (WHERE po.signed_at IS NOT NULL AND (po.signed_at AT TIME ZONE 'Africa/Lagos')::date BETWEEN $1::date AND $2::date)::int AS signed_this_year,
            COALESCE(sum(${signedValue("po")}) FILTER (WHERE po.currency = 'NGN' AND po.signed_at IS NOT NULL
              AND (po.signed_at AT TIME ZONE 'Africa/Lagos')::date BETWEEN $1::date AND $2::date), 0)::numeric(18,2)::text AS signed_value,
            count(*) FILTER (WHERE po.status IN ('open', 'live') AND po.health = 'stalled')::int AS stalled
       ${FROM}
      WHERE TRUE ${where} ${seen}`,
    params,
  );
  return rows[0];
}

/** Deals not yet finished (open or live) at each stage, with their Naira value. */
async function pipelineByStage(db, query, scope) {
  const params = [];
  const where = filters(query, params);
  const seen = dealSeen(scope, "po", params);
  const { rows } = await db.query(
    `SELECT po.stage, count(*)::int AS open, COALESCE(sum(po.estimated_value) FILTER (WHERE po.currency = 'NGN'), 0)::numeric(18,2)::text AS value
       ${FROM}
      WHERE po.status IN ('open', 'live') ${where} ${seen}
      GROUP BY po.stage`,
    params,
  );
  return rows;
}

const PIPELINE_DEAL = `po.partnership_opportunity_id AS deal_id, po.number, po.title,
  CASE WHEN p.partner_id IS NOT NULL THEN json_build_object('type', 'partner', 'id', p.partner_id, 'number', p.number, 'name', p.name)
       ELSE json_build_object('type', 'lead', 'id', l.lead_id, 'number', l.number::text, 'name', l.name) END AS record,
  po.stage, COALESCE(rv.label, po.stage) AS stage_label, ${lagosDaysSince(stageSince("po"))} AS days_at_stage, po.blockers,
  ${personJson("e", "d")} AS owner`;

/** The open deals longest at their stage (the first page; Pipeline shows ten). */
function longestAtStage(db, query, scope) {
  const params = [];
  const where = filters(query, params);
  const seen = dealSeen(scope, "po", params);
  return pageQuery(
    db,
    `SELECT ${PIPELINE_DEAL}, ${TOTAL_COL} ${FROM}
      WHERE po.status = 'open' ${where} ${seen}
      ORDER BY ${stageSince("po")}, po.partnership_opportunity_id`,
    params,
    { page: 1 },
  );
}

/** The stalled deals, longest at their stage first (the first page). */
function stalled(db, query, scope) {
  const params = [];
  const where = filters(query, params);
  const seen = dealSeen(scope, "po", params);
  return pageQuery(
    db,
    `SELECT ${PIPELINE_DEAL}, ${TOTAL_COL} ${FROM}
      WHERE po.status IN ('open', 'live') AND po.health = 'stalled' ${where} ${seen}
      ORDER BY ${stageSince("po")}, po.partnership_opportunity_id`,
    params,
    { page: 1 },
  );
}

/* ------------------------------------------------------------------ *
 * Writing deals (the service's transaction)
 * ------------------------------------------------------------------ */

const DEAL_COLUMNS = [
  "title",
  "event_title",
  "event_starts_on",
  "event_ends_on",
  "expected_attendance",
  "objective",
  "estimated_value",
  "commission_pct",
  "commission_deviates",
  "validity_days",
  "valid_until",
  "expected_close_on",
  "next_action",
  "next_action_on",
  "owner_id",
  "impact",
  "impact_rating",
  "impact_note",
  "comments",
  "custom",
];

/** A new deal; returns its id. */
async function insert(client, row) {
  const cols = ["number", "partner_id", "lead_id", "stage", "status", "health", "currency", "identified_on", "signed_at", ...DEAL_COLUMNS];
  const values = cols.map((k) => (k === "custom" ? JSON.stringify(row.custom || {}) : row[k] === undefined ? null : row[k]));
  const { rows } = await client.query(
    `INSERT INTO partnership_opportunity (${cols.join(", ")})
     VALUES (${cols.map((k, i) => (k === "custom" ? `$${i + 1}::jsonb` : `$${i + 1}`)).join(", ")})
     RETURNING partnership_opportunity_id AS deal_id`,
    values,
  );
  return rows[0].deal_id;
}

/** Change a deal's own columns (only those given). */
async function update(client, id, changes) {
  const keys = Object.keys(changes).filter((k) => changes[k] !== undefined);
  if (!keys.length) return;
  const sets = keys.map((k, i) => (k === "custom" ? `${k} = $${i + 2}::jsonb` : `${k} = $${i + 2}`));
  await client.query(`UPDATE partnership_opportunity SET ${sets.join(", ")} WHERE partnership_opportunity_id = $1`, [
    id,
    ...keys.map((k) => (k === "custom" ? JSON.stringify(changes[k] || {}) : changes[k])),
  ]);
}

/** A deal locked for a change: its own columns. */
async function lock(client, id) {
  const { rows } = await client.query(
    `SELECT po.partnership_opportunity_id AS deal_id, po.number, po.title, po.partner_id, po.lead_id, po.stage, po.status, po.health,
            po.blockers, po.owner_id, po.signed_at, po.estimated_value, po.commission_pct, po.custom, po.event_starts_on, po.event_ends_on
       FROM partnership_opportunity po WHERE po.partnership_opportunity_id = $1 FOR UPDATE`,
    [id],
  );
  return rows[0] || null;
}

/** Replace a deal's options. */
async function replaceOptions(client, dealId, rows) {
  await client.query("DELETE FROM deal_option WHERE deal_id = $1", [dealId]);
  for (const o of rows) {
    await client.query(
      `INSERT INTO deal_option (deal_id, position, label, original_price, discount_pct, deal_price, price_note, commission_amount, merchant_take)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [dealId, o.position, o.label, o.original_price ?? null, o.discount_pct ?? null, o.deal_price ?? null, o.price_note ?? null, o.commission_amount ?? null, o.merchant_take ?? null],
    );
  }
}

/** Set a deal's team: the owner as `owner`, the rest kept or added as `support`; anyone dropped leaves. */
async function setTeam(client, dealId, ownerId, memberIds) {
  const ids = [...new Set([ownerId, ...(memberIds || [])].filter(Boolean))];
  await client.query("DELETE FROM deal_member WHERE deal_id = $1 AND NOT (employee_id = ANY($2::uuid[]))", [dealId, ids]);
  await client.query("UPDATE deal_member SET role = 'support' WHERE deal_id = $1 AND role = 'owner' AND employee_id <> $2", [dealId, ownerId]);
  for (const id of ids) {
    await client.query(
      `INSERT INTO deal_member (deal_id, employee_id, role) VALUES ($1, $2, $3)
       ON CONFLICT (deal_id, employee_id) DO UPDATE SET role = CASE WHEN EXCLUDED.role = 'owner' THEN 'owner' ELSE deal_member.role END`,
      [dealId, id, id === ownerId ? "owner" : "support"],
    );
  }
}

/** Keep the owner on the team, as `owner`. */
async function ensureOwner(client, dealId, ownerId) {
  await client.query("UPDATE deal_member SET role = 'support' WHERE deal_id = $1 AND role = 'owner' AND employee_id <> $2", [dealId, ownerId]);
  await client.query(
    `INSERT INTO deal_member (deal_id, employee_id, role) VALUES ($1, $2, 'owner')
     ON CONFLICT (deal_id, employee_id) DO UPDATE SET role = 'owner'`,
    [dealId, ownerId],
  );
}

/** One line of a deal's history (append only: no update path here). */
async function addHistory(client, { deal_id, kind, from, to, reason = null, source, user_id = null }) {
  await client.query(
    `INSERT INTO partnership_stage_history (partnership_opportunity_id, kind, from_stage, to_stage, reason, source, changed_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [deal_id, kind, from, to, reason, source, user_id],
  );
}

/** The ids of a record's deals that are open or live, locked. */
async function unfinishedOf(client, { kind, id }) {
  const { rows } = await client.query(
    `SELECT partnership_opportunity_id AS deal_id FROM partnership_opportunity
      WHERE ${kind}_id = $1 AND status IN ('open', 'live') ORDER BY created_at FOR UPDATE`,
    [id],
  );
  return rows.map((r) => r.deal_id);
}

/** Whether a deal has a signed agreement (one sealed, or a signed copy recorded on it). */
async function hasSignedAgreement(db, dealId) {
  const { rows } = await db.query(
    `SELECT 1 FROM partnership_agreement WHERE partnership_opportunity_id = $1 AND status IN ('signed', 'active', 'expiring', 'renewed') LIMIT 1`,
    [dealId],
  );
  return rows.length > 0;
}

/* ------------------------------------------------------------------ *
 * Returns (§6.14)
 * ------------------------------------------------------------------ */

const RETURN_ROW = `r.deal_return_id, r.deal_id, r.month, r.units_sold, r.gross_sales, r.mycity_commission, r.paid_to_partner,
  r.downloads, r.note, r.source, btrim(e.first_name || ' ' || e.last_name) AS entered_by_name, r.updated_at`;
const RETURN_FROM = `FROM deal_return r LEFT JOIN app_user u ON u.user_id = r.entered_by LEFT JOIN employee e ON e.employee_id = u.employee_id`;

/** A page of a deal's months, newest first, optionally one year's. */
function returnsPage(db, dealId, query) {
  return pageQuery(
    db,
    `SELECT ${RETURN_ROW}, ${TOTAL_COL} ${RETURN_FROM}
      WHERE r.deal_id = $1 AND ($2::int IS NULL OR date_part('year', r.month) = $2)
      ORDER BY ${orderBy(query, { month: "r.month DESC" }, "r.deal_return_id")}`,
    [dealId, query.year || null],
    query,
  );
}

/** One month of a deal's returns, or null. */
async function returnOf(db, dealId, month) {
  const { rows } = await db.query(`SELECT ${RETURN_ROW} ${RETURN_FROM} WHERE r.deal_id = $1 AND r.month = $2`, [dealId, month]);
  return rows[0] || null;
}

/**
 * Save a month: a month saved again replaces its figures, and where they came from (`entered` on the
 * 360, `import` with its batch from Partnership Returns).
 */
async function upsertReturn(client, row) {
  await client.query(
    `INSERT INTO deal_return (deal_id, month, units_sold, gross_sales, mycity_commission, paid_to_partner, downloads, note, source, import_batch_id, entered_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (deal_id, month) DO UPDATE SET
       units_sold = EXCLUDED.units_sold, gross_sales = EXCLUDED.gross_sales, mycity_commission = EXCLUDED.mycity_commission,
       paid_to_partner = EXCLUDED.paid_to_partner, downloads = EXCLUDED.downloads, note = EXCLUDED.note,
       source = EXCLUDED.source, import_batch_id = EXCLUDED.import_batch_id, entered_by = EXCLUDED.entered_by`,
    [
      row.deal_id,
      row.month,
      row.units_sold ?? null,
      row.gross_sales ?? null,
      row.mycity_commission ?? null,
      row.paid_to_partner ?? null,
      row.downloads ?? null,
      row.note ?? null,
      row.source || "entered",
      row.import_batch_id ?? null,
      row.entered_by,
    ],
  );
}

/** Remove a month of returns (reverting the Partnership Returns import that made it). */
async function removeReturn(client, dealId, month) {
  await client.query("DELETE FROM deal_return WHERE deal_id = $1 AND month = $2", [dealId, month]);
}

/** A month of returns by its id, with its deal's number, or null. */
async function returnById(db, id) {
  const { rows } = await db.query(
    `SELECT ${RETURN_ROW}, r.import_batch_id, po.number AS deal_number ${RETURN_FROM} JOIN partnership_opportunity po ON po.partnership_opportunity_id = r.deal_id WHERE r.deal_return_id = $1`,
    [id],
  );
  return rows[0] || null;
}

/**
 * The deal a returns row names: by its number, else by its lead's or partner's name and its title
 * (case and spaces aside). Two deals answering the same name and title name none, never a guess.
 * @returns {Promise<{deal_id: string, number: string}|null>}
 */
async function dealForReturns(db, { number, partner, title }) {
  if (number) {
    const { rows } = await db.query("SELECT partnership_opportunity_id AS deal_id, number FROM partnership_opportunity WHERE upper(number) = upper($1)", [number]);
    return rows[0] || null;
  }
  if (!partner || !title) return null;
  const fold = (x) => `lower(btrim(regexp_replace(${x}, '\\s+', ' ', 'g')))`;
  const { rows } = await db.query(
    `SELECT po.partnership_opportunity_id AS deal_id, po.number, count(*) OVER () AS n
       FROM partnership_opportunity po
       LEFT JOIN partner p ON p.partner_id = po.partner_id
       LEFT JOIN lead l ON l.lead_id = po.lead_id
      WHERE ${fold("po.title")} = ${fold("$2")} AND ${fold("COALESCE(p.name, l.name)")} = ${fold("$1")}
      ORDER BY po.number LIMIT 1`,
    [partner, title],
  );
  return rows[0] && Number(rows[0].n) === 1 ? { deal_id: rows[0].deal_id, number: rows[0].number } : null;
}

/** Remove the deals of a record an import made and nothing uses (their options, team, history and venue go with them). */
async function removeDealsOf(client, { kind, id }) {
  const { rows } = await client.query(`DELETE FROM partnership_opportunity WHERE ${kind}_id = $1 RETURNING partnership_opportunity_id AS id`, [id]);
  for (const r of rows) await client.query("DELETE FROM place WHERE owner = 'deal.venue' AND owner_key = $1", [r.id]);
  return rows.map((r) => r.id);
}

/* ------------------------------------------------------------------ *
 * Praxis AI's cards (docs/guides/praxis-ai.md decision 32): the records a card's ids name
 * ------------------------------------------------------------------ */

/** The categories, leads, partners, deals and contacts some ids name, as a card shows them. */
async function cardNames(db, ids) {
  const want = (k) => [...new Set((ids[k] || []).filter(Boolean).map(String))];
  const { rows } = await db.query(
    `SELECT 'partner_category' AS type, partner_category_id::text AS id, name::text AS label FROM partner_category WHERE partner_category_id::text = ANY($1::text[])
     UNION ALL SELECT 'lead', lead_id::text, name || ' (' || number::text || ')' FROM lead WHERE lead_id::text = ANY($2::text[])
     UNION ALL SELECT 'partner', partner_id::text, name || ' (' || number || ')' FROM partner WHERE partner_id::text = ANY($3::text[])
     UNION ALL SELECT 'partner_deal', partnership_opportunity_id::text, title || ' (' || number || ')' FROM partnership_opportunity WHERE partnership_opportunity_id::text = ANY($4::text[])
     UNION ALL SELECT 'partner_contact', partner_contact_id::text, btrim(first_name || ' ' || last_name) FROM partner_contact WHERE partner_contact_id::text = ANY($5::text[])`,
    [want("categories"), want("leads"), want("partners"), want("deals"), want("contacts")],
  );
  return rows;
}

/* ------------------------------------------------------------------ *
 * Home's reads (docs/guides/home.md §4.1; partnerships.md §6.17), through its partners adapter
 * ------------------------------------------------------------------ */

const HOME_FROM = `FROM partnership_opportunity po
  LEFT JOIN partner p ON p.partner_id = po.partner_id
  LEFT JOIN lead l ON l.lead_id = po.lead_id
  LEFT JOIN reference_value rv ON rv.domain = 'partnership_stage' AND rv.code = po.stage
  LEFT JOIN employee e ON e.employee_id = po.owner_id
  LEFT JOIN department d ON d.department_id = e.department_id`;

const homeSearch = (n) => `($${n}::text IS NULL OR search_fold(po.title || ' ' || COALESCE(p.name, l.name, '')) LIKE '%' || search_fold($${n}) || '%')`;

/** How many deals are open, within the scope (Open Opportunities). */
async function homeOpenCount(db, scope) {
  const params = [];
  const seen = dealSeen(scope, "po", params);
  const { rows } = await db.query(`SELECT count(*)::int AS n FROM partnership_opportunity po WHERE po.status = 'open' ${seen}`, params);
  return rows[0].n;
}

/** A page of the open deals, within the scope, soonest expected to close first. */
function homeOpenPage(db, scope, query) {
  const params = [query.q || null];
  const seen = dealSeen(scope, "po", params);
  return pageQuery(
    db,
    `SELECT po.partnership_opportunity_id, po.title, COALESCE(p.name, l.name) AS partner, po.stage, COALESCE(rv.label, po.stage) AS stage_label,
            po.estimated_value, po.currency, po.expected_close_on, ${personJson("e", "d")} AS owner, ${TOTAL_COL}
       ${HOME_FROM}
      WHERE po.status = 'open' AND ${homeSearch(1)} ${seen}
      ORDER BY ${orderBy(query, { expected_close_on: "po.expected_close_on" }, "po.partnership_opportunity_id")}`,
    params,
    query,
  );
}

/** The open deals at each stage, within the scope, in the list's order (a stage it does not list comes last). */
async function homeOpenByStage(db, scope) {
  const params = [];
  const seen = dealSeen(scope, "po", params);
  const { rows } = await db.query(
    `SELECT po.stage, COALESCE(rv.label, po.stage) AS label, count(*)::int AS open
       FROM partnership_opportunity po
       LEFT JOIN reference_value rv ON rv.domain = 'partnership_stage' AND rv.code = po.stage
      WHERE po.status = 'open' ${seen}
      GROUP BY po.stage, rv.label, rv.display_order
      ORDER BY rv.display_order NULLS LAST, po.stage`,
    params,
  );
  return rows;
}

/** The deals signed between two Lagos days, within the scope: their Naira signed value and how many (every currency). */
async function homeSigned(db, { from, to }, scope) {
  const params = [from, to];
  const seen = dealSeen(scope, "po", params);
  const { rows } = await db.query(
    `SELECT COALESCE(sum(${signedValue("po")}) FILTER (WHERE po.currency = 'NGN'), 0)::numeric(18,2) AS amount, count(*)::int AS n
       FROM partnership_opportunity po
      WHERE po.signed_at IS NOT NULL AND (po.signed_at AT TIME ZONE 'Africa/Lagos')::date BETWEEN $1::date AND $2::date ${seen}`,
    params,
  );
  return rows[0];
}

/** A page of the deals signed between two Lagos days, within the scope, the most recent first. */
function homeSignedPage(db, { from, to }, scope, query) {
  const params = [from, to, query.q || null];
  const seen = dealSeen(scope, "po", params);
  return pageQuery(
    db,
    `SELECT po.partnership_opportunity_id, po.number, po.title, COALESCE(p.name, l.name) AS partner, po.signed_at,
            ${signedValue("po")} AS value, po.currency, ${personJson("e", "d")} AS owner, ${TOTAL_COL}
       ${HOME_FROM}
      WHERE po.signed_at IS NOT NULL AND (po.signed_at AT TIME ZONE 'Africa/Lagos')::date BETWEEN $1::date AND $2::date
        AND ${homeSearch(3)} ${seen}
      ORDER BY ${orderBy(query, { signed_at: "po.signed_at DESC" }, "po.partnership_opportunity_id")}`,
    params,
    query,
  );
}

/** The Naira value signed in each month between two Lagos days, within the scope, oldest first; a month with none has no row. */
async function homeSignedByMonth(db, { from, to }, scope) {
  const params = [from, to];
  const seen = dealSeen(scope, "po", params);
  const { rows } = await db.query(
    `SELECT to_char(date_trunc('month', po.signed_at AT TIME ZONE 'Africa/Lagos'), 'YYYY-MM') AS month,
            sum(${signedValue("po")})::numeric(18,2) AS amount
       FROM partnership_opportunity po
      WHERE po.signed_at IS NOT NULL AND po.currency = 'NGN' AND (po.signed_at AT TIME ZONE 'Africa/Lagos')::date BETWEEN $1::date AND $2::date ${seen}
      GROUP BY 1
      HAVING sum(${signedValue("po")}) IS NOT NULL
      ORDER BY 1`,
    params,
  );
  return rows;
}

module.exports = {
  removeReturn,
  returnById,
  dealForReturns,
  removeDealsOf,
  listCategories,
  getCategory,
  categoryByName,
  categoryChoices,
  categoryNamed,
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
  renumberValues,
  stagesCounting,
  stageInUse,
  homeOpenCount,
  homeOpenPage,
  homeOpenByStage,
  homeSigned,
  homeSignedPage,
  homeSignedByMonth,
  cardNames,
  dealSeen,
  recordSeen,
  regionLabel,
  regionHasCity,
  lastContact,
  lagosDaysSince,
  stageSince,
  signedValue,
  list,
  get,
  options,
  members,
  deliverables,
  history,
  historyOfRecord,
  ofRecord,
  ofLead,
  pipelineFigures,
  pipelineByStage,
  longestAtStage,
  stalled,
  insert,
  update,
  lock,
  replaceOptions,
  setTeam,
  ensureOwner,
  addHistory,
  unfinishedOf,
  hasSignedAgreement,
  returnsPage,
  returnOf,
  upsertReturn,
};
