"use strict";
/**
 * Custom fields (docs/guides/partnerships.md §6.3): holders of `partnerships.configure` define a field on
 * Categories for one category or for all, for leads, partners or deals, of a type. A field's key is made
 * from its label once and never changes: it is the key of every record's `custom` value. Retiring a field
 * keeps its values (shown as retired) and stops offering it. Values are checked by type here (`checkValue`)
 * wherever a record's `custom` is written (`checkCustom`, M7 PR 3), and a list is narrowed by its
 * filterable fields (`filterSql`).
 */
const c = require("@mycity/contract");
const { pool } = require("../../config/db");
const { atomically } = require("../../shared/db/tx");
const { AppError } = require("../../shared/errors");
const { emit } = require("../../shared/events/emit");
const money = require("../../shared/money/money");
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

const PICKS = new Set(["pick", "multi_pick"]);

/** `ticketing_terms` from "Ticketing Terms"; a letter first, at most 60 characters. */
function keyOf(label) {
  const base = String(label)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 52);
  return /^[a-z]/.test(base) ? base : `f_${base || "field"}`;
}

async function freeKey(db, label) {
  const base = keyOf(label);
  for (let n = 1; n < 100; n += 1) {
    const key = n === 1 ? base : `${base}_${n}`;
    if (!(await repo.fieldKeyTaken(db, key))) return key;
  }
  throw new AppError("FIELD_KEY", "Give the field a different name", 409, { label: ["Name in use"] });
}

const list = async (query) => ({ data: await repo.listFields(pool, query) });

const notFound = () => new AppError("NOT_FOUND", "That field does not exist", 404);

async function create(actor, body) {
  const id = await tx(async (client) => {
    if (body.partner_category_id && !(await repo.getCategory(client, body.partner_category_id)))
      throw new AppError("NOT_FOUND", "That category does not exist", 404, { partner_category_id: ["No such category"] });
    if (body.options && !PICKS.has(body.field_type))
      throw new AppError("OPTIONS_NOT_ALLOWED", "Only a pick has choices", 422, { options: ["Picks only"] });
    const key = await freeKey(client, body.label);
    const row = await repo.insertField(client, { ...body, key, position: await repo.nextFieldPosition(client) });
    const after = await repo.getField(client, row.partnership_field_id);
    await emit(client, {
      key: EVENTS.PARTNERSHIP_FIELD_CREATED,
      entity: { type: "partnership_field", id: after.partnership_field_id },
      actor,
      after,
      payload: { partnership_field_id: after.partnership_field_id, key, applies_to: after.applies_to },
    });
    return after.partnership_field_id;
  });
  return repo.getField(pool, id);
}

async function update(actor, id, body) {
  await tx(async (client) => {
    const before = await repo.getField(client, id);
    if (!before) throw notFound();
    if (body.options && !PICKS.has(before.field_type))
      throw new AppError("OPTIONS_NOT_ALLOWED", "Only a pick has choices", 422, { options: ["Picks only"] });
    await repo.updateField(client, id, body);
    const after = await repo.getField(client, id);
    await emit(client, {
      key: EVENTS.PARTNERSHIP_FIELD_UPDATED,
      entity: { type: "partnership_field", id },
      actor,
      before,
      after,
      payload: { partnership_field_id: id, key: after.key, active: after.active },
    });
  });
  return repo.getField(pool, id);
}

/**
 * One custom value checked by its field's type, as stored in a record's `custom`: text and links as
 * trimmed strings, numbers as numbers, money as a two-place string, dates as YYYY-MM-DD, yes or no as a
 * boolean, a pick as one of the field's options and a multi-pick as some of them. Returns the value to keep;
 * throws a 422 naming the field.
 * @param {{key: string, label: string, field_type: string, options: string[]|null}} field
 */
function checkValue(field, value) {
  const bad = (message) => new AppError("FIELD_VALUE_INVALID", message, 422, { [`custom.${field.key}`]: [message] });
  if (value === null || value === undefined || value === "") return null;
  switch (field.field_type) {
    case "text":
    case "long_text": {
      if (typeof value !== "string") throw bad("Words only");
      return value.trim().slice(0, field.field_type === "text" ? 200 : 5000);
    }
    case "url": {
      if (typeof value !== "string" || !/^https?:\/\/[^\s]+$/i.test(value.trim())) throw bad("Not a link");
      return value.trim();
    }
    case "number": {
      const n = typeof value === "number" ? value : Number(value);
      if (!Number.isFinite(n)) throw bad("Not a number");
      return n;
    }
    case "money": {
      try {
        return money.toWire(money.money(value));
      } catch {
        throw bad("Not an amount");
      }
    }
    case "date": {
      if (!c.common.isoDate.safeParse(value).success) throw bad("Not a real date");
      return value;
    }
    case "yes_no": {
      if (typeof value !== "boolean") throw bad("Yes or no");
      return value;
    }
    case "pick": {
      if (typeof value !== "string" || !(field.options || []).includes(value)) throw bad("Pick a listed choice");
      return value;
    }
    case "multi_pick": {
      if (!Array.isArray(value) || value.some((v) => !(field.options || []).includes(v))) throw bad("Pick listed choices");
      return [...new Set(value)];
    }
    default:
      throw bad("Unknown field type");
  }
}

/* ------------------------------------------------------------------ *
 * Values on records, and lists narrowed by them (M7 PR 3)
 * ------------------------------------------------------------------ */

/** The fields a record of `appliesTo` in `categoryId` carries: its category's and every category's, retired ones included. */
async function defsFor(db, appliesTo, categoryId) {
  return (await repo.listFields(db, { applies_to: appliesTo, partner_category_id: categoryId || undefined })).filter(
    (f) => !f.partner_category_id || f.partner_category_id === categoryId,
  );
}

const unknown = (key) => new AppError("VALIDATION_FAILED", "Check the highlighted fields", 422, { [`custom.${key}`]: ["Unknown field"] });

/**
 * The custom values a write keeps: each given key held to its field by `checkValue`, null (or empty)
 * clearing it, merged over what the record had. A key no field of the record has, or one retired, is
 * refused: a retired field keeps its values and is offered no more.
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
    if (!def || !def.active) throw unknown(key);
    const kept = checkValue(def, value);
    if (kept === null) delete out[key];
    else out[key] = kept;
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
  const defs = new Map((await repo.listFields(db, { applies_to: appliesTo, active: true })).map((d) => [d.key, d]));
  const wanted = {};
  for (const [key, value] of entries) {
    const def = defs.get(key);
    if (!def || !def.filterable) throw new AppError("VALIDATION_FAILED", "Check the filters", 422, { custom: [`No filter ${key}`] });
    wanted[key] = def.field_type === "multi_pick" && !Array.isArray(value) ? [value] : value;
  }
  params.push(JSON.stringify(wanted));
  return `AND ${column} @> $${params.length}::jsonb`;
}

module.exports = { keyOf, list, create, update, checkValue, defsFor, checkCustom, filterSql };
