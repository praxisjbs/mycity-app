"use strict";
/**
 * Exchange rates, read (docs/guides/integrations.md §1.2 decision 10). The one reader of
 * `exchange_rate`: AI prices in naira today, any module that later bills in another currency
 * tomorrow. Written by the integrations module's service only (Sync Rates and the midnight job).
 *
 *   const r = await fx.rate("USD", "NGN");                       // "1534.21", the newest table
 *   const r = await fx.rate("EUR", "NGN", { day: "2026-10-01" }); // through the dollar, that day or before
 *   const naira = await fx.convert("0.30", "USD", "NGN");         // a Decimal
 *
 * Each day's table is kept against the dollar. A pair without the dollar is worked out through
 * it. A day with no table uses the newest one before it; with none at all the answer is null,
 * and the caller decides what an unknown rate means.
 */
const { money } = require("./money");

const BASE = "USD";

const pool = () => require("../../config/db").pool;

/** Undefined table: 9220 has not run here yet. */
const notMigrated = (err) => err && (err.code === "42P01" || err.code === "42703");

async function against(db, currency, day) {
  if (currency === BASE) return { rate: "1", day };
  try {
    const { rows } = await db.query(
      `SELECT rate::text AS rate, to_char(day, 'YYYY-MM-DD') AS day
         FROM exchange_rate
        WHERE base = $1 AND currency = $2 AND ($3::date IS NULL OR day <= $3::date)
        ORDER BY day DESC
        LIMIT 1`,
      [BASE, currency, day || null],
    );
    return rows[0] || null;
  } catch (err) {
    if (notMigrated(err)) return null;
    throw err;
  }
}

/**
 * Units of `to` for one `from`, as a decimal string, or null when either is unknown.
 * @param {string} from  ISO 4217, e.g. "USD"
 * @param {string} to
 * @param {{day?: string, db?: {query: Function}}} [opts]  day: Lagos, YYYY-MM-DD; the newest when absent
 */
async function rate(from, to, { day, db } = {}) {
  const a = String(from).toUpperCase();
  const b = String(to).toUpperCase();
  if (a === b) return "1";
  const d = db || pool();
  const [ra, rb] = await Promise.all([against(d, a, day), against(d, b, day)]);
  if (!ra || !rb) return null;
  return money(rb.rate).dividedBy(money(ra.rate)).toDecimalPlaces(10).toString();
}

/**
 * An amount in `from` as `to`, unrounded (a Decimal), or null when the rate is unknown.
 * @param {string|object} amount
 * @param {string} from
 * @param {string} to
 * @param {{day?: string, db?: {query: Function}}} [opts]
 */
async function convert(amount, from, to, opts) {
  const r = await rate(from, to, opts);
  return r === null ? null : money(amount).times(money(r));
}

/**
 * The newest table kept: its day, when it was fetched, the dollar to naira rate and how many
 * currencies it holds; null before the first fetch.
 * @param {{db?: {query: Function}}} [opts]
 */
async function newest({ db } = {}) {
  try {
    const { rows } = await (db || pool()).query(
      `SELECT to_char(day, 'YYYY-MM-DD') AS day, max(updated_at) AS fetched_at, count(*)::int AS currencies,
              max(CASE WHEN currency = 'NGN' THEN rate END)::text AS usd_ngn
         FROM exchange_rate
        WHERE base = $1 AND day = (SELECT max(day) FROM exchange_rate WHERE base = $1)
        GROUP BY day`,
      [BASE],
    );
    return rows[0] || null;
  } catch (err) {
    if (notMigrated(err)) return null;
    throw err;
  }
}

module.exports = { rate, convert, newest, BASE };
