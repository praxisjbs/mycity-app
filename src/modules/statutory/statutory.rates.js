"use strict";
/**
 * The statutory rates as the engine and the screens read them, and how a version is written (docs/guides/payroll.md
 * §6.11, §6.12). No rate is in this file or any seed: every figure is a row MyCity entered on Configurations, read
 * as of a day.
 *
 *   ratesOn(db, date)        the rows in force on a day as computeStatutory takes them (payroll.calc.js), with the
 *                            rows themselves for a run's snapshot
 *   anyInForce(db, date)     whether any rate is in force on a day: Switch On needs one (409 NO_RATES)
 *   saveVersion(client, …)   a new version of one item from a day that has not passed, with its legal source; the
 *                            version before it ends the day before, and one already starting that day is replaced
 *                            (shared/db/effective-dated)
 *   removeVersion(client, …) Remove Change: the version of one item starting on a day still to come is taken back, and
 *                            the version before it runs on (shared/db/effective-dated removeVersion)
 *   sourceOf(row), present(row)   a row's source, and a row as the contract's StatutoryRate
 */
const c = require("@mycity/contract");
const { addVersionSet, removeVersion: removeDated } = require("../../shared/db/effective-dated");
const m = require("../../shared/money/money");
const repo = require("./statutory.repo");

/** A stored rate ("7.500000") as people read it ("7.5"). */
const rateOf = (stored) => m.money(String(stored)).toFixed();

/**
 * A row's legal source, as the contract's StatutorySource: the instrument, or No Legal Source with its reason. Every row
 * of a version carries the same one (§4.2).
 */
function sourceOf(row) {
  return {
    source_title: row.source_title ?? null,
    source_section: row.source_section ?? null,
    source_url: row.source_url ?? null,
    source_document_id: row.source_document_id ?? null,
    source_checked_on: row.source_checked_on ?? null,
    no_legal_source: row.no_legal_source === true,
    no_source_reason: row.no_source_reason ?? null,
  };
}

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
    ...sourceOf(row),
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
 * The source columns a save writes: the instrument (title, section, the day checked, a link and a document when given),
 * or No Legal Source with the reason; the contract has already held it to one or the other.
 * @param {object} body  a StatutoryRatesSave
 */
function sourceColumns(body) {
  if (body.no_legal_source === true)
    return {
      no_legal_source: true,
      no_source_reason: body.no_source_reason,
      source_title: null,
      source_section: null,
      source_url: null,
      source_document_id: null,
      source_checked_on: null,
    };
  return {
    no_legal_source: false,
    no_source_reason: null,
    source_title: body.source_title,
    source_section: body.source_section,
    source_url: body.source_url || null,
    source_document_id: body.source_document_id || null,
    source_checked_on: body.source_checked_on,
  };
}

/**
 * The rows of a version as they are written: a PAYE table one row a band in its place, the relief its flat amount and
 * rate, every other item one rate, each with the version's source. The side an item falls on is code (`ITEM_KIND`); its
 * base is the one named, or the item's own.
 * @param {object} body  a StatutoryRatesSave
 * @param {string|null} userId  who entered it
 */
function rowsOf(body, userId) {
  const kind = c.statutory.ITEM_KIND[body.item];
  const base = body.base || c.statutory.ITEM_BASES[body.item][0];
  const common = { item: body.item, kind, base, ...sourceColumns(body), created_by: userId };
  if (body.item === "paye")
    return body.bands.map((b, i) => ({ ...common, rate: b.rate, band_from: b.band_from, band_to: b.band_to, position: i + 1 }));
  if (body.item === "relief") return [{ ...common, rate: body.rate || "0", flat_amount: body.flat_amount || "0.00" }];
  return [{ ...common, rate: body.rate }];
}

const WRITABLE = [
  "item",
  "kind",
  "base",
  "rate",
  "band_from",
  "band_to",
  "flat_amount",
  "position",
  "created_by",
  ...c.statutory.SOURCE_KEYS,
  "no_legal_source",
  "no_source_reason",
];

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

/**
 * Remove Change: the version of `item` that starts on `from`, a day still to come, is taken back inside the caller's
 * transaction, and the version before it runs on again. In force today or before: 409 VERSION_IN_FORCE; no version
 * that day: 404.
 * @param {import("pg").PoolClient} client
 * @param {{item: string, effective_from: string}} version
 * @returns {Promise<{removed: object[], reopened: object[]}>}
 */
function removeVersion(client, { item, effective_from: from }) {
  return removeDated(client, { table: "statutory_rate", key: { item }, from });
}

module.exports = { present, sourceOf, sourceColumns, ratesOn, anyInForce, rowsOf, saveVersion, removeVersion };
