"use strict";
/**
 * Small, safe SQL builders for the statements every repo writes: insert one
 * row, update one row by id, read one row by id.
 *
 *   const row = await insertOne(client, "department", { name, code }, { writable: ["name", "code"] });
 *   const row = await updateOne(client, "department", "department_id", id, patch, { writable, touch: "updated_at" });
 *   const row = await getById(client, "department", "department_id", id);
 *
 * Values are always bound parameters. Identifiers (table and column names) are
 * checked against a strict pattern and double-quoted, so a key that arrives from
 * a request body can never become SQL. `writable` names the columns a caller may
 * set; anything else is refused with a 422 naming the field, instead of being
 * written (mass assignment) or silently dropped.
 *
 * Lists are not here: every list pages through shared/http/paged.js (§16).
 */
const { AppError } = require("../errors");

const IDENT_RE = /^[a-z_][a-z0-9_]{0,62}$/;

/**
 * Quote an identifier after checking it. Throws a 422 naming the field when it
 * came from input (`ctx` given), an Error when it is a programming mistake.
 * @param {string} name
 * @param {string} [ctx]  the input part it came from ("body"), when it came from input
 */
function ident(name, ctx) {
  if (typeof name !== "string" || !IDENT_RE.test(name)) {
    const shown = String(name).slice(0, 40);
    if (ctx) throw new AppError("INVALID_FIELD", `"${shown}" is not a field here`, 422, { [shown]: ["is not a field here"] });
    throw new Error(`query-helpers: "${shown}" is not a valid identifier`);
  }
  return `"${name}"`;
}

/** A table name, optionally schema-qualified ("public.employee"). */
function table(name) {
  const parts = String(name).split(".");
  if (parts.length > 2) throw new Error(`query-helpers: "${name}" is not a valid table name`);
  return parts.map((p) => ident(p)).join(".");
}

function assertWritable(keys, writable) {
  if (!writable) return;
  const allowed = writable instanceof Set ? writable : new Set(writable);
  const bad = keys.filter((k) => !allowed.has(k));
  if (bad.length) {
    throw new AppError(
      "FIELD_NOT_WRITABLE",
      `${bad.length === 1 ? "This field cannot" : "These fields cannot"} be set here: ${bad.join(", ")}`,
      422,
      Object.fromEntries(bad.map((b) => [b, ["cannot be set here"]])),
    );
  }
}

/** JSON-encode the named jsonb columns of a row before writing it. */
function jsonb(data, columns) {
  const out = { ...data };
  for (const col of columns) {
    if (Object.prototype.hasOwnProperty.call(out, col)) out[col] = out[col] === null || out[col] === undefined ? null : JSON.stringify(out[col]);
  }
  return out;
}

/** Drop undefined values: a key that is absent means "not given", not NULL. */
const defined = (data) => Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));

/**
 * INSERT one row and return it.
 * @param {{query: Function}} client
 * @param {string} tableName
 * @param {object} data
 * @param {{writable?: string[]|Set<string>, returning?: string}} [opts]
 */
async function insertOne(client, tableName, data, { writable = null, returning = "*" } = {}) {
  const row = defined(data);
  const keys = Object.keys(row);
  assertWritable(keys, writable);
  if (keys.length === 0) {
    const { rows } = await client.query(`INSERT INTO ${table(tableName)} DEFAULT VALUES RETURNING ${returning}`);
    return rows[0];
  }
  const cols = keys.map((k) => ident(k, "body")).join(", ");
  const params = keys.map((_, i) => `$${i + 1}`).join(", ");
  const { rows } = await client.query(
    `INSERT INTO ${table(tableName)} (${cols}) VALUES (${params}) RETURNING ${returning}`,
    keys.map((k) => row[k]),
  );
  return rows[0];
}

/**
 * UPDATE one row by primary key and return it, or null when there is no such row.
 * An empty patch changes nothing and returns the current row.
 * @param {{writable?: string[]|Set<string>, returning?: string, touch?: string}} [opts]
 *   touch  a timestamp column to set to now() on every update ("updated_at")
 */
async function updateOne(client, tableName, pk, id, patch, { writable = null, returning = "*", touch = null } = {}) {
  const row = defined(patch);
  const keys = Object.keys(row);
  if (keys.length === 0 && !touch) return getById(client, tableName, pk, id);
  assertWritable(keys, writable);
  const set = keys.map((k, i) => `${ident(k, "body")} = $${i + 2}`);
  if (touch) set.push(`${ident(touch)} = now()`);
  const { rows } = await client.query(
    `UPDATE ${table(tableName)} SET ${set.join(", ")} WHERE ${ident(pk)} = $1 RETURNING ${returning}`,
    [id, ...keys.map((k) => row[k])],
  );
  return rows[0] || null;
}

/**
 * One row by primary key, or null.
 * @param {{columns?: string, forUpdate?: boolean}} [opts]
 *   columns    a SELECT list written in code, never from input
 *   forUpdate  lock the row for the rest of the transaction
 */
async function getById(client, tableName, pk, id, { columns = "*", forUpdate = false } = {}) {
  const { rows } = await client.query(
    `SELECT ${columns} FROM ${table(tableName)} WHERE ${ident(pk)} = $1${forUpdate ? " FOR UPDATE" : ""}`,
    [id],
  );
  return rows[0] || null;
}

/** One row by primary key, or a 404 with the record's name in the message. */
async function getOr404(client, tableName, pk, id, label = "Record", opts = {}) {
  const row = await getById(client, tableName, pk, id, opts);
  if (!row) throw new AppError("NOT_FOUND", `${label} not found`, 404);
  return row;
}

module.exports = { ident, table, assertWritable, jsonb, defined, insertOne, updateOne, getById, getOr404, IDENT_RE };
