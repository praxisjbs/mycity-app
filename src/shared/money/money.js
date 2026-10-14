"use strict";
/**
 * Money. Naira only, kobo precision, never a JavaScript number (README §7 rule 1, gate 20).
 *
 *   const m = require("../../shared/money/money");
 *
 *   const gross = m.money(row.gross_monthly);            // "450000.00" from Postgres → Decimal
 *   const tax   = m.percentOf(gross, "7.5");             // Decimal
 *   const net   = gross.minus(tax);                      // Decimal arithmetic, exact
 *   m.toWire(net)                                        // "416250.00"  for the API and SQL
 *   m.formatNaira(net)                                   // "₦416,250.00" for a person (PDF, mail, export)
 *
 * Where money lives:
 *   Postgres   numeric(18,2)            node-postgres returns it as a string (shared/db/pg-types.js)
 *   the wire   "1250000.00"             contract common.money: a string, exactly two places
 *   the code   Decimal                  this file; never Number(), parseFloat, unary +, or `a + b`
 *
 * Rounding is half-up to the kobo, the convention on Nigerian payslips and
 * invoices. Rounding happens once, at toWire() or round(), never in between: an
 * intermediate value keeps its full precision so a sum of rounded lines and a
 * rounded sum cannot drift apart without allocate() deciding where the kobo go.
 */
const Decimal = require("decimal.js");

/** A private Decimal constructor, so another library's Decimal.set() cannot change ours. */
const D = Decimal.clone({ precision: 34, rounding: Decimal.ROUND_HALF_UP });

const CURRENCY = "NGN";
const ZERO = new D(0);

/**
 * Parse an amount. Accepts a Decimal, a numeric string ("1250000.00", "-12.5"),
 * or an integer number (counts, never a fractional float). Refuses everything else.
 * @param {Decimal|string|number} value
 * @returns {Decimal}
 */
function money(value) {
  if (value === null || value === undefined || value === "") throw new TypeError("money(): no value");
  if (typeof value === "number" && !Number.isInteger(value)) {
    throw new TypeError(`money(): ${value} is a fractional JS number; pass the string from the database or the wire`);
  }
  if (typeof value === "string" && !/^-?\d+(\.\d+)?$/.test(value.trim())) {
    throw new TypeError(`money(): "${value}" is not an amount`);
  }
  const d = new D(typeof value === "string" ? value.trim() : value);
  if (!d.isFinite()) throw new TypeError("money(): not a finite amount");
  return d;
}

/** Round to the kobo, half-up. */
function round(value) {
  return money(value).toDecimalPlaces(2, D.ROUND_HALF_UP);
}

/** The wire and SQL form: "1250000.00". */
function toWire(value) {
  return round(value).toFixed(2);
}

/** Sum a list of amounts; an empty list is zero. */
function sum(values) {
  return (values || []).reduce((acc, v) => acc.plus(money(v)), ZERO);
}

/** `amount` × `percent` / 100, unrounded. percentOf("200000", "7.5") → 15000 */
function percentOf(amount, percent) {
  return money(amount).times(money(percent)).dividedBy(100);
}

/** -1, 0 or 1. */
function compare(a, b) {
  return money(a).comparedTo(money(b));
}

const isZero = (v) => money(v).isZero();
const isNegative = (v) => money(v).isNegative() && !money(v).isZero();

/**
 * Split `total` into parts by weight so the parts add up to the total exactly,
 * to the kobo. The kobo left over by rounding go to the largest remainders
 * first (ties to the earliest part). Used for prorating, splitting a
 * disbursement across budget lines, and spreading a deduction over months.
 *
 *   allocate("100.00", [1, 1, 1]) → ["33.34", "33.33", "33.33"]
 *
 * @param {Decimal|string|number} total
 * @param {Array<Decimal|string|number>} weights  non-negative, not all zero
 * @returns {string[]} wire-form amounts, same order as weights
 */
function allocate(total, weights) {
  const t = round(total);
  const w = weights.map((x) => money(x));
  if (!w.length) throw new TypeError("allocate(): no weights");
  if (w.some((x) => x.isNegative())) throw new TypeError("allocate(): a weight is negative");
  const wsum = w.reduce((a, b) => a.plus(b), ZERO);
  if (wsum.isZero()) throw new TypeError("allocate(): weights add up to zero");

  const kobo = t.times(100);
  const exact = w.map((x) => kobo.times(x).dividedBy(wsum));
  const floors = exact.map((x) => (kobo.isNegative() ? x.ceil() : x.floor()));
  let left = kobo.minus(floors.reduce((a, b) => a.plus(b), ZERO)).toNumber(); // a small integer count of kobo
  const step = left >= 0 ? 1 : -1;
  const order = exact
    .map((x, i) => ({ i, rem: x.minus(floors[i]).abs() }))
    .sort((a, b) => b.rem.comparedTo(a.rem) || a.i - b.i);
  for (let k = 0; left !== 0; k = (k + 1) % order.length) {
    floors[order[k].i] = floors[order[k].i].plus(step);
    left -= step;
  }
  return floors.map((x) => x.dividedBy(100).toFixed(2));
}

const GROUPS = /\B(?=(\d{3})+(?!\d))/g;

/**
 * For a person to read: "₦1,250,000.00", "-₦500.00". Never parse this back.
 * @param {Decimal|string|number} value
 * @param {{symbol?: boolean}} [opts]  symbol: false gives "1,250,000.00" (table cells with a ₦ header)
 */
function formatNaira(value, { symbol = true } = {}) {
  const r = round(value);
  const [whole, kobo] = r.abs().toFixed(2).split(".");
  const body = `${whole.replace(GROUPS, ",")}.${kobo}`;
  return `${r.isNegative() && !r.isZero() ? "-" : ""}${symbol ? "₦" : ""}${body}`;
}

module.exports = {
  Decimal: D,
  CURRENCY,
  ZERO,
  money,
  round,
  toWire,
  sum,
  percentOf,
  compare,
  isZero,
  isNegative,
  allocate,
  formatNaira,
};
