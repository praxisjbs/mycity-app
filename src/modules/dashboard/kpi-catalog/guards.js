"use strict";
/**
 * The KPI catalogue's guards: run one card's read, shape its figure, and turn a failure
 * into an absent card.
 *
 * The rule every figure obeys, in one place:
 *
 *   a number, 0 included, is a fact and is drawn   ("0 overdue tasks" says there are none)
 *   null means the figure could not be worked out  the card leaves the row; nothing takes its place
 *
 * Every table Home reads exists on every database (one schema, built by the migrations),
 * so a read that fails is a defect, not a module that is switched off: it is logged with
 * the card's id and costs that one card, never the whole row.
 *
 * The shapes, by the card's unit (resolved into a HomeKpiCard by index.js cardOf):
 *
 *   count, days   { value }                a whole count; days may hold a part day
 *   pct, pair     { value, denominator }   a ratio keeps what it is out of, so "0 of 30" and
 *                                          "0 of nothing" stay different (measurable when > 0)
 *   money         { amount }               Naira as a wire string, "1250000.00", never a number
 *
 * A figure may carry more facts beside these (`late`, `overdue`, `groups`) for its caption
 * and for the counts on the chips over its records.
 *
 *   const g = guards.forCard("tasks_overdue");
 *   await g.count(() => tasks.overdueCount(client, { now }, scope))   // { value: 7 } or null
 */
const { logger } = require("../../../config/logger");
const m = require("../../../shared/money/money");

/** A whole count from a query: node-pg hands back a bigint as a string, and NULL as null. */
function whole(n) {
  const v = n === null || n === undefined ? 0 : Number(n);
  if (!Number.isInteger(v) || v < 0) throw new TypeError(`a count must be a whole number, got ${n}`);
  return v;
}

/**
 * The guards for one card. Each takes a function that reads (a query, a module's own read)
 * and answers the figure, or null after logging why.
 * @param {string} id  the card's id, named in the log line
 */
function forCard(id) {
  async function guarded(read, shape) {
    try {
      return shape(await read());
    } catch (err) {
      logger.warn({ err, kpi: id }, "kpi card figure could not be read");
      return null;
    }
  }

  return Object.freeze({
    /** read → a count (a number or a numeric string) → { value }. */
    count: (read) => guarded(read, (n) => ({ value: whole(n) })),

    /** read → { value, denominator, ...facts } → the same with both whole; a NULL value is 0. */
    ratio: (read) =>
      guarded(read, (r) => ({ ...r, value: whole(r.value), denominator: whole(r.denominator) })),

    /** read → { amount, ...facts } → the amount as a Naira wire string; a NULL sum is "0.00". */
    money: (read) =>
      guarded(read, (r) => ({
        ...r,
        amount: m.toWire(r.amount === null || r.amount === undefined ? "0" : r.amount),
      })),

    /** read → a figure already shaped by the card (a roster summary, a leave year). */
    figure: (read) => guarded(read, (f) => f),
  });
}

module.exports = { forCard, whole };
