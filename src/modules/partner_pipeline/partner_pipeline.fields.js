"use strict";
/**
 * Custom fields (docs/guides/partnerships.md §4.2, §6.3), read and enforced: the definitions a form
 * needs at once (whole, at most 200), every value a lead, a partner or a deal carries checked by its
 * field's type on the server, and a list narrowed by its filterable fields. Holders of
 * `partnerships.configure` add and retire fields on Categories (M7 PR 2).
 *
 *   text, long_text   a string (500 and 5,000 characters)
 *   number            a finite number
 *   money             an amount through shared/money, kept as its two-place string
 *   date              an ISO day
 *   pick, multi_pick  one, or several, of the field's options
 *   yes_no            true or false
 *   url               an http or https address
 *
 * A field applies to leads, partners or deals, of one category or of every category. A key no
 * field of the record has, or one retired, is refused: a retired field keeps its values and is
 * offered no more. Null clears a value.
 */
const c = require("@mycity/contract");
const money = require("../../shared/money/money");
const { completeQuery } = require("../../shared/http/paged");
const { AppError } = require("../../shared/errors");

const COLUMNS = `partnership_field_id, key, label, field_type, options, applies_to, partner_category_id, filterable, position, active`;

const shape = (r) => ({ ...r, options: Array.isArray(r.options) ? r.options.map(String) : null });

/**
 * The field definitions, whole (FieldList): a form needs every one of them at once.
 * @param {{query: Function}} db
 * @param {{applies_to?: string, partner_category_id?: string, active?: boolean}} query
 */
async function list(db, query = {}) {
  // pagination:complete every field a form draws is needed at once (FieldList, at most 200)
  const { rows } = await completeQuery(
    db,
    `SELECT ${COLUMNS} FROM partnership_field
      WHERE ($1::text IS NULL OR applies_to = $1)
        AND ($2::uuid IS NULL OR partner_category_id IS NULL OR partner_category_id = $2)
        AND ($3::boolean IS NULL OR active = $3)
      ORDER BY position, label, partnership_field_id`,
    [query.applies_to || null, query.partner_category_id || null, query.active === undefined ? null : query.active],
    { label: "the custom fields", ceiling: 200 },
  );
  return { data: rows.map(shape) };
}

/** The fields a record of `appliesTo` in `categoryId` carries: its category's and every category's, retired ones included. */
async function defsFor(db, appliesTo, categoryId) {
  return (await list(db, { applies_to: appliesTo, partner_category_id: categoryId || undefined })).data.filter(
    (f) => !f.partner_category_id || f.partner_category_id === categoryId,
  );
}

const bad = (key, message) => new AppError("VALIDATION_FAILED", "Check the highlighted fields", 422, { [`custom.${key}`]: [message] });

/** One value held to its field's type; returns what is kept. */
function valueOf(def, value) {
  const k = def.key;
  const opts = def.options || [];
  switch (def.field_type) {
    case "text":
    case "long_text": {
      const max = def.field_type === "text" ? 500 : 5000;
      if (typeof value !== "string") throw bad(k, "Not text");
      const t = value.trim();
      if (t.length > max) throw bad(k, `At most ${max} characters`);
      return t;
    }
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) throw bad(k, "Not a number");
      return value;
    case "money":
      if (!c.common.money.safeParse(typeof value === "string" ? value : "").success) throw bad(k, "Not an amount");
      return money.toWire(value);
    case "date":
      if (!c.common.isoDate.safeParse(value).success) throw bad(k, "Not a real date");
      return value;
    case "pick":
      if (typeof value !== "string" || !opts.includes(value)) throw bad(k, "Pick a choice");
      return value;
    case "multi_pick":
      if (!Array.isArray(value) || value.some((v) => typeof v !== "string" || !opts.includes(v))) throw bad(k, "Pick from the choices");
      return [...new Set(value)];
    case "yes_no":
      if (typeof value !== "boolean") throw bad(k, "Yes or no");
      return value;
    case "url":
      if (typeof value !== "string" || !/^https?:\/\/\S+\.\S+$/i.test(value.trim())) throw bad(k, "Not a web address");
      return value.trim();
    default:
      throw bad(k, "Unknown field");
  }
}

/**
 * The custom values a write keeps: each given key held to its field, null clearing it, merged over
 * what the record had.
 * @param {{query: Function}} db
 * @param {{appliesTo: "lead"|"partner"|"deal", categoryId: string|null, values?: object, had?: object}} opts
 * @returns {Promise<object>}
 */
async function checkCustom(db, { appliesTo, categoryId, values, had = {} }) {
  const out = { ...(had || {}) };
  const given = Object.entries(values || {});
  if (!given.length) return out;
  const defs = new Map((await defsFor(db, appliesTo, categoryId)).map((d) => [d.key, d]));
  for (const [key, value] of given) {
    const def = defs.get(key);
    if (!def || !def.active) throw bad(key, "Unknown field");
    if (value === null) delete out[key];
    else out[key] = valueOf(def, value);
  }
  return out;
}

/**
 * The SQL that narrows a list by its filterable custom fields (`{"ticketing":"exclusive"}`); a key
 * that is no filterable field of the records is a 422.
 * @param {{query: Function}} db
 * @param {"lead"|"partner"|"deal"} appliesTo
 * @param {object|undefined} filter  the parsed CustomFilter
 * @param {string} column  the records' `custom` column, qualified
 * @param {Array} params   appended to
 * @returns {Promise<string>} "" or "AND ..."
 */
async function filterSql(db, appliesTo, filter, column, params) {
  const entries = Object.entries(filter || {});
  if (!entries.length) return "";
  const defs = new Map((await list(db, { applies_to: appliesTo, active: true })).data.map((d) => [d.key, d]));
  const wanted = {};
  for (const [key, value] of entries) {
    const def = defs.get(key);
    if (!def || !def.filterable) throw new AppError("VALIDATION_FAILED", "Check the filters", 422, { custom: [`No filter ${key}`] });
    wanted[key] = def.field_type === "multi_pick" && !Array.isArray(value) ? [value] : value;
  }
  params.push(JSON.stringify(wanted));
  return `AND ${column} @> $${params.length}::jsonb`;
}

module.exports = { list, defsFor, checkCustom, filterSql };
