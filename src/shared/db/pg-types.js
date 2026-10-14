"use strict";
/**
 * How Postgres values reach JavaScript, set once for every pool.
 *
 * `date` (OID 1082) comes back as the string Postgres sent, "2026-10-13".
 * node-postgres would otherwise build a JS Date at local midnight, and
 * res.json() would send "2026-10-12T23:00:00.000Z" from a server on
 * Africa/Lagos: the wrong day, and a value the contract's isoDate refuses, so a
 * form could not re-save a row it had just loaded.
 *
 * `numeric` (OID 1700) stays a string, which is node-postgres's default. Money
 * is numeric(18,2) and must never become a JS number (gate 20); shared/money
 * turns the string into a Decimal when arithmetic is needed.
 *
 * `int8` / bigint (OID 20) stays a string too. COUNT(*) is bigint: cast it in
 * SQL (`COUNT(*)::int`) where a number is wanted.
 *
 * timestamp and timestamptz keep their default parsers: they name an instant,
 * and a Date is right for those.
 */
const { types } = require("pg");

const OID = Object.freeze({ DATE: 1082, NUMERIC: 1700, INT8: 20 });

let applied = false;

/** Idempotent. Required by config/db.js before the pool is created. */
function applyTypeParsers() {
  if (applied) return;
  types.setTypeParser(OID.DATE, (value) => value);
  applied = true;
}

applyTypeParsers();

module.exports = { applyTypeParsers, OID };
