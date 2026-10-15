"use strict";
/**
 * The one allocator of human-readable document numbers (README §7 rule 3,
 * BACKEND_STRUCTURE §7).
 *
 *   const { number } = await numbering.allocate(client, "query");                      // "QRY-0028"
 *   const { number } = await numbering.allocate(client, "payslip", { date: "2026-10-31" }); // "PAY-2026-10-0001"
 *
 * Rules, each the reason this file exists:
 *  - It runs INSIDE the caller's transaction. The counter row is incremented
 *    with one INSERT ... ON CONFLICT DO UPDATE ... RETURNING, which locks it, so
 *    concurrent allocations queue behind each other, and a transaction that rolls
 *    back takes its increment with it: no gaps from failed saves, no duplicates.
 *    Calling it outside a transaction is refused.
 *  - A number is never reused. The counter only goes up; deleting a record does
 *    not give its number back. Every numbered table has `number` UNIQUE.
 *  - The scheme is data (numbering_scheme), read in the same transaction. A
 *    type with no scheme row fails loudly, naming the type.
 *  - The period (for yearly and monthly resets) is the Lagos business date of
 *    the record, or today in Lagos: a payslip for October numbers in October
 *    even when it is generated on 1 November.
 *
 * Never MAX(number)+1 (two saves read the same max), never a Postgres sequence
 * (a rolled-back transaction burns the value, leaving gaps auditors ask about).
 *
 * Tables (migration 0055):
 *   numbering_scheme   doc_type PK, prefix, padding, separator, reset, include_period, updated_at, updated_by
 *   numbering_counter  doc_type, period, last_value, PRIMARY KEY (doc_type, period)
 *     period is "all" for reset never, "2026" for yearly, "2026-10" for monthly.
 */
const { AppError } = require("../errors");
const { inTransaction } = require("../db/tx");
const lagos = require("../time/lagos");
const { SCHEMES, DOC_TYPES, validateScheme } = require("./schemes");

/** "all" | "2026" | "2026-10" for a scheme and a business date. */
function periodOf(scheme, date) {
  if (scheme.reset === "never") return "all";
  if (scheme.reset === "yearly") return date.slice(0, 4);
  return date.slice(0, 7);
}

/** Pure: the number for a scheme, period and sequence value. */
function format(scheme, period, seq) {
  const parts = [scheme.prefix];
  if (scheme.include_period && period !== "all")
    parts.push(period.replace("-", scheme.separator || "-"));
  if (scheme.padding > 0) parts.push(String(seq).padStart(scheme.padding, "0"));
  return parts.join(scheme.separator);
}

async function schemeOf(client, docType) {
  const { rows } = await client.query(
    "SELECT prefix, padding, separator, reset, include_period FROM numbering_scheme WHERE doc_type = $1",
    [docType],
  );
  if (!rows[0]) {
    throw new AppError(
      "NUMBERING_SCHEME_MISSING",
      `No numbering scheme for "${docType}". Add it in Settings, Documents & Numbering.`,
      500,
    );
  }
  return { ...rows[0], padding: Number(rows[0].padding) };
}

/**
 * Allocate the next number for `docType`.
 * @param {import("pg").PoolClient} client  inside atomically()
 * @param {string} docType  a key of SCHEMES
 * @param {{date?: string}} [opts]  the record's business date, for the period; default today in Lagos
 * @returns {Promise<{number: string, seq: number, period: string}>}
 */
async function allocate(client, docType, { date } = {}) {
  if (!SCHEMES[docType])
    throw new Error(
      `numbering: "${docType}" is not in shared/numbering/schemes.js`,
    );
  if (!inTransaction(client))
    throw new Error(
      "numbering.allocate must run inside atomically(): a number commits with its record",
    );
  const day = date
    ? lagos.assertDate(String(date).slice(0, 10), "date")
    : lagos.today();
  const scheme = await schemeOf(client, docType);
  const period = periodOf(scheme, day);
  const { rows } = await client.query(
    `INSERT INTO numbering_counter (doc_type, period, last_value) VALUES ($1, $2, 1)
     ON CONFLICT (doc_type, period) DO UPDATE SET last_value = numbering_counter.last_value + 1
     RETURNING last_value`,
    [docType, period],
  );
  const seq = Number(rows[0].last_value);
  return { number: format(scheme, period, seq), seq, period };
}

/**
 * What the next number WOULD be, without taking it (the Settings screen's
 * preview). Never use it as a number: another save can take it first.
 */
async function preview(client, docType, { date } = {}) {
  const day = date
    ? lagos.assertDate(String(date).slice(0, 10), "date")
    : lagos.today();
  const scheme = await schemeOf(client, docType);
  const period = periodOf(scheme, day);
  const { rows } = await client.query(
    "SELECT last_value FROM numbering_counter WHERE doc_type = $1 AND period = $2",
    [docType, period],
  );
  return format(scheme, period, Number(rows[0] ? rows[0].last_value : 0) + 1);
}

/** Readiness: every type the code numbers has a valid scheme row. */
async function checkSchemes(client) {
  try {
    const { rows } = await client.query(
      "SELECT doc_type, prefix, padding, separator, reset, include_period FROM numbering_scheme WHERE doc_type = ANY($1)",
      [DOC_TYPES],
    );
    const have = new Map(
      rows.map((r) => [r.doc_type, { ...r, padding: Number(r.padding) }]),
    );
    const missing = DOC_TYPES.filter((t) => !have.has(t));
    const invalid = [...have.entries()]
      .filter(([, s]) => validateScheme(s).length)
      .map(([t]) => t);
    return {
      status: missing.length || invalid.length ? "down" : "up",
      missing,
      invalid,
    };
  } catch (err) {
    return {
      status: "down",
      error: err.code === "42P01" ? "no numbering_scheme table" : "unreadable",
    };
  }
}

module.exports = { allocate, preview, format, periodOf, checkSchemes };
