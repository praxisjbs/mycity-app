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
  if (!/^[a-z_][a-z0-9_]*$/.test(alias) || !Number.isInteger(paramIndex) || paramIndex < 1) {
    throw new Error("asOf(alias, paramIndex): a table alias and a parameter number");
  }
  return `(${alias}.effective_from <= $${paramIndex}::date AND (${alias}.effective_to IS NULL OR ${alias}.effective_to > $${paramIndex}::date))`;
}

function keyWhere(key, startAt = 1) {
  const cols = Object.keys(key);
  if (!cols.length) throw new Error("effective-dated: the key names at least one column");
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

/**
 * Start a new version of `key` from `from`, closing the version open at that date.
 * @returns {Promise<object>} the new row
 */
async function addVersion(client, { table: tableName, key, from, data, writable = null }) {
  assertDate(from, "from");
  const w = keyWhere(key);
  const t = table(tableName);

  // Lock every version of this key for the rest of the transaction.
  await client.query(`SELECT 1 FROM ${t} WHERE ${w.sql} FOR UPDATE`, w.params);

  const n = w.params.length + 1;
  const { rows: later } = await client.query(
    `SELECT effective_from FROM ${t} WHERE ${w.sql} AND effective_from >= $${n}::date ORDER BY effective_from LIMIT 1`,
    [...w.params, from],
  );
  if (later[0]) {
    throw new AppError(
      "VERSION_EXISTS",
      "A version already starts on or after this date. Change that version instead.",
      409,
      { effective_from: ["a version already starts on or after this date"] },
    );
  }

  await client.query(
    `UPDATE ${t} SET effective_to = $${n}::date WHERE ${w.sql} AND effective_to IS NULL AND effective_from < $${n}::date`,
    [...w.params, from],
  );

  const allowed = writable ? [...writable, ...Object.keys(key), "effective_from", "effective_to"] : null;
  return insertOne(client, tableName, { ...data, ...key, effective_from: from, effective_to: null }, { writable: allowed });
}

module.exports = { asOf, versionOn, addVersion };
