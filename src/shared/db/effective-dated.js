"use strict";
/**
 * Values that change over time and must be read AS OF a date: statutory rates
 * (M6 payroll for a past month uses that month's rates), salary structures,
 * reporting lines, allowances. The past is never overwritten; a change is a new
 * version from a date.
 *
 * Every effective-dated table has, beside its own columns:
 *
 *   effective_from  date NOT NULL    first day the version applies
 *   effective_to    date NULL        first day it NO LONGER applies (exclusive); NULL = current
 *
 * and an exclusion or unique constraint so two versions of one key never overlap.
 *
 *   // read: the version in force on a date
 *   const p = [employeeId, "2026-09-30"];
 *   SELECT ... FROM salary_assignment s WHERE s.employee_id = $1 AND ${asOf("s", 2)}
 *
 *   // write: a new version from a date, closing the current one
 *   await addVersion(client, {
 *     table: "salary_assignment",
 *     key: { employee_id: id },
 *     from: "2026-11-01",
 *     data: { salary_structure_id, gross_monthly },
 *     writable: ["salary_structure_id", "gross_monthly"],
 *   });
 *
 * addVersion runs inside the caller's transaction and locks the key's versions
 * first, so two changes to one key cannot interleave. It refuses a date on or
 * before the start of an existing later-or-equal version: that is a correction
 * to history, which is a deliberate, audited action of its own, not a side
 * effect of saving a form.
 *
 * Two additions for settings a person enters from a day that has not passed
 * (payroll's setting, statutory rates, grades and pay splits;
 * docs/guides/payroll.md §6.11):
 *
 *   replace: true    a version that starts on `from` itself is replaced rather
 *                    than refused: a second change made for the same day joins
 *                    that day's version (updated in place, so a row that points
 *                    at it keeps pointing). The caller passes it only for a day
 *                    that is today or later, so nothing past is rewritten.
 *   addVersionSet    a version made of several rows that start and end together
 *                    (a PAYE table's bands, a person's pay components): every open
 *                    row of the key ends the day before, and the rows given start.
 *                    With `replace`, the rows already starting that day go first.
 */
const { AppError } = require("../errors");
const { ident, table, insertOne } = require("./query-helpers");
const { assertDate } = require("../time/lagos");

/**
 * SQL condition: the row of `alias` in force on the date bound at $paramIndex.
 * @param {string} alias
 * @param {number} paramIndex
 */
function asOf(alias, paramIndex) {
  if (
    !/^[a-z_][a-z0-9_]*$/.test(alias) ||
    !Number.isInteger(paramIndex) ||
    paramIndex < 1
  ) {
    throw new Error(
      "asOf(alias, paramIndex): a table alias and a parameter number",
    );
  }
  return `(${alias}.effective_from <= $${paramIndex}::date AND (${alias}.effective_to IS NULL OR ${alias}.effective_to > $${paramIndex}::date))`;
}

function keyWhere(key, startAt = 1) {
  const cols = Object.keys(key);
  if (!cols.length)
    throw new Error("effective-dated: the key names at least one column");
  return {
    sql: cols.map((c, i) => `${ident(c)} = $${startAt + i}`).join(" AND "),
    params: cols.map((c) => key[c]),
  };
}

/**
 * The version in force on the date `on`, or null.
 * @param {{query: Function}} client
 * @param {{table: string, key: object, on: string, columns?: string}} q
 */
async function versionOn(client, { table: tableName, key, on, columns = "*" }) {
  assertDate(on, "on");
  const w = keyWhere(key);
  const n = w.params.length + 1;
  const { rows } = await client.query(
    `SELECT ${columns} FROM ${table(tableName)} v WHERE ${w.sql} AND ${asOf("v", n)} ORDER BY effective_from DESC LIMIT 1`,
    [...w.params, on],
  );
  return rows[0] || null;
}

/** A unique index on a key's first day or its open version said no: another change to the key got there first. */
const versionExists = () =>
  new AppError(
    "VERSION_EXISTS",
    "A version already starts on or after this date. Change that version instead.",
    409,
    { effective_from: ["a version already starts on or after this date"] },
  );

/**
 * Lock every version of the key for the rest of the transaction, and refuse a version starting after `from` (or on
 * it, unless `sameDay` is allowed). Answers whether a version starts on `from` itself.
 */
async function lockAndCheck(client, { tableName, key, from, sameDay }) {
  const w = keyWhere(key);
  const t = table(tableName);
  await client.query(`SELECT 1 FROM ${t} WHERE ${w.sql} FOR UPDATE`, w.params);
  const n = w.params.length + 1;
  const { rows: later } = await client.query(
    `SELECT effective_from::text AS effective_from FROM ${t} WHERE ${w.sql} AND effective_from >= $${n}::date ORDER BY effective_from DESC LIMIT 1`,
    [...w.params, from],
  );
  const last = later[0] || null;
  if (last && (!sameDay || last.effective_from > from)) throw versionExists();
  return { w, t, n, startsThatDay: Boolean(last) };
}

/** End every open row of the key the day before `from`. */
function closeOpen(client, { w, t, n }, from) {
  return client.query(
    `UPDATE ${t} SET effective_to = $${n}::date WHERE ${w.sql} AND effective_to IS NULL AND effective_from < $${n}::date`,
    [...w.params, from],
  );
}

/** Insert one row of a version; a unique index's refusal is another change to the key that got there first. */
async function insertVersionRow(client, tableName, row, writable) {
  try {
    return await insertOne(client, tableName, row, { writable });
  } catch (err) {
    if (err && err.code === "23505") throw versionExists();
    throw err;
  }
}

/** The columns a caller may write, the key and the two days included; null when the caller names none. */
const allowedOf = (writable, key) =>
  writable ? [...writable, ...Object.keys(key), "effective_from", "effective_to"] : null;

/**
 * Start a new version of `key` from `from`, closing the version open at that date. With `replace`, a version that
 * already starts on `from` takes the new values in place instead of being refused.
 * @returns {Promise<object>} the new (or replaced) row
 */
async function addVersion(
  client,
  { table: tableName, key, from, data, writable = null, replace = false },
) {
  assertDate(from, "from");
  const ctx = await lockAndCheck(client, { tableName, key, from, sameDay: replace });
  const allowed = allowedOf(writable, key);

  if (ctx.startsThatDay) {
    // The same day's version: its own columns take the new values; its key and its days stay.
    const cols = Object.keys(data).filter((c) => data[c] !== undefined);
    if (allowed) {
      const refused = cols.find((c) => !allowed.includes(c));
      if (refused) throw new AppError("VALIDATION", `${refused} cannot be set`, 422, { [refused]: ["cannot be set"] });
    }
    const base = [...ctx.w.params, from];
    const sets = cols.map((c, i) => `${ident(c)} = $${base.length + 1 + i}`);
    const sql = sets.length
      ? `UPDATE ${ctx.t} SET ${sets.join(", ")} WHERE ${ctx.w.sql} AND effective_from = $${ctx.n}::date RETURNING *`
      : `SELECT * FROM ${ctx.t} WHERE ${ctx.w.sql} AND effective_from = $${ctx.n}::date`;
    const { rows } = await client.query(sql, [...base, ...cols.map((c) => data[c])]);
    return rows[0];
  }

  await closeOpen(client, ctx, from);
  return insertVersionRow(client, tableName, { ...data, ...key, effective_from: from, effective_to: null }, allowed);
}

/**
 * Start a new version of `key` from `from` made of several rows that start and end together (a PAYE table's bands,
 * a person's pay components): every open row of the key ends the day before, and each of `rows` starts. With
 * `replace`, the rows that already start on `from` are taken out first, so the day's version is the one given.
 * @returns {Promise<object[]>} the new rows, in the order given
 */
async function addVersionSet(
  client,
  { table: tableName, key, from, rows, writable = null, replace = false },
) {
  assertDate(from, "from");
  if (!Array.isArray(rows) || rows.length === 0)
    throw new Error("addVersionSet: a version has at least one row");
  const ctx = await lockAndCheck(client, { tableName, key, from, sameDay: replace });
  if (ctx.startsThatDay)
    await client.query(
      `DELETE FROM ${ctx.t} WHERE ${ctx.w.sql} AND effective_from = $${ctx.n}::date`,
      [...ctx.w.params, from],
    );
  await closeOpen(client, ctx, from);
  const allowed = allowedOf(writable, key);
  const out = [];
  for (const data of rows)
    out.push(await insertVersionRow(client, tableName, { ...data, ...key, effective_from: from, effective_to: null }, allowed));
  return out;
}

module.exports = { asOf, versionOn, addVersion, addVersionSet };
