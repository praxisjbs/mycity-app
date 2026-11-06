"use strict";
/**
 * Custom fields (docs/guides/partnerships.md §6.3): holders of `partnerships.configure` define a field on
 * Categories for one category or for all, for leads, partners or deals, of a type. A field's key is made
 * from its label once and never changes: it is the key of every record's `custom` value. Retiring a field
 * keeps its values (shown as retired) and stops offering it. Values are checked by type here (`checkValue`)
 * wherever a record's `custom` is written (M7 PR 3 onward).
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

module.exports = { keyOf, list, create, update, checkValue };
