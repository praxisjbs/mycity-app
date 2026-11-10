"use strict";
/**
 * The statutory rates as the engine and the screens read them, and how a version is written (docs/guides/payroll.md
 * §6.11, §6.12). No rate is in this file or any seed: every figure is a row MyCity entered on Configurations, read
 * as of a day.
 *
 *   ratesOn(db, date)        the rows in force on a day as computeStatutory takes them (payroll.calc.js), with the
 *                            rows themselves for a run's snapshot
 *   anyInForce(db, date)     whether any rate is in force on a day: Switch On needs one (409 NO_RATES)
 *   saveVersion(client, …)   a new version of one item from a day that has not passed; the version before it ends the
 *                            day before, and one already starting that day is replaced (shared/db/effective-dated)
 *   present(row)             a row as the contract's StatutoryRate
 */
const c = require("@mycity/contract");
const { addVersionSet } = require("../../shared/db/effective-dated");
const m = require("../../shared/money/money");
const repo = require("./statutory.repo");

/** A stored rate ("7.500000") as people read it ("7.5"). */
const rateOf = (stored) => m.money(String(stored)).toFixed();

/** A row as the contract's StatutoryRate. */
function present(row) {
  return {
    statutory_rate_id: row.statutory_rate_id,
    item: row.item,
    kind: row.kind,
    base: row.base,
    rate: rateOf(row.rate),
    band_from: row.band_from ?? null,
    band_to: row.band_to ?? null,
    flat_amount: row.flat_amount ?? null,
    position: row.position === null || row.position === undefined ? null : Number(row.position),
    effective_from: row.effective_from,
    effective_to: row.effective_to ?? null,
    created_by_name: row.created_by_name ?? null,
    created_at: new Date(row.created_at).toISOString(),
  };
}

/**
 * The rows in force on a day, shaped for computeStatutory: `paye` with its bands in order, `relief` with its flat
 * amount and rate, every other item its base and rate. An item with no row is absent, and is not computed.
 * @param {{query: Function}} db
 * @param {string} date
 * @returns {Promise<{rates: Record<string, object>, rows: object[]}>}
 */
async function ratesOn(db, date) {
  const rows = (await repo.inForce(db, date)).map(present);
  const rates = {};
  for (const r of rows) {
    if (r.item === "paye") {
      rates.paye ||= { base: r.base, bands: [] };
      rates.paye.bands.push({ band_from: r.band_from, band_to: r.band_to, rate: r.rate, position: r.position });
    } else if (r.item === "relief") rates.relief = { base: r.base, rate: r.rate, flat_amount: r.flat_amount || "0.00" };
    else rates[r.item] = { base: r.base, rate: r.rate };
  }
  return { rates, rows };
}

/** Whether any statutory rate is in force on a day. */
async function anyInForce(db, date) {
  return (await repo.inForce(db, date)).length > 0;
}

/**
 * The rows of a version as they are written: a PAYE table one row a band in its place, the relief its flat amount and
 * rate, every other item one rate. The side an item falls on is code (`ITEM_KIND`); its base is the one named, or the
 * item's own.
 * @param {object} body  a StatutoryRatesSave
 * @param {string|null} userId  who entered it
 */
function rowsOf(body, userId) {
  const kind = c.statutory.ITEM_KIND[body.item];
  const base = body.base || c.statutory.ITEM_BASES[body.item][0];
  const common = { item: body.item, kind, base, created_by: userId };
  if (body.item === "paye")
    return body.bands.map((b, i) => ({ ...common, rate: b.rate, band_from: b.band_from, band_to: b.band_to, position: i + 1 }));
  if (body.item === "relief") return [{ ...common, rate: body.rate || "0", flat_amount: body.flat_amount || "0.00" }];
  return [{ ...common, rate: body.rate }];
}

const WRITABLE = ["item", "kind", "base", "rate", "band_from", "band_to", "flat_amount", "position", "created_by"];

/**
 * A new version of one item from `effective_from`, inside the caller's transaction. The service has already held the
 * day to today or later. The item is the version's key: every open row of it ends the day before (a PAYE table of
 * seven bands replaced by one of six leaves no band open), and a version that already starts that day is replaced.
 * @param {import("pg").PoolClient} client
 * @param {object} body  a StatutoryRatesSave
 * @param {{user_id: string|null}} actor
 * @returns {Promise<object[]>} the rows written
 */
function saveVersion(client, body, actor) {
  return addVersionSet(client, {
    table: "statutory_rate",
    key: { item: body.item },
    from: body.effective_from,
    rows: rowsOf(body, actor ? actor.user_id || null : null),
    writable: WRITABLE,
    replace: true,
  });
}

module.exports = { present, ratesOn, anyInForce, rowsOf, saveVersion };
