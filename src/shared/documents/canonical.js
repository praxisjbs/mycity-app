"use strict";
/**
 * Canonical form of a document's content, and its hash (A12, used by M5 signatures).
 *
 * A signed document carries two hashes:
 *   artifact_hash  over the PDF bytes as stored (document.content_hash)
 *   content_hash   over the canonical payload: the facts the document states
 *
 * The PDF's bytes change if Chromium or a font changes, even when the offer says
 * exactly the same thing; the canonical payload does not. So the verification page
 * gives two verdicts: "these are the same bytes" and "this says the same thing".
 *
 * Canonical means one spelling for one value:
 *  - object keys sorted (by UTF-16 code unit), undefined members dropped;
 *  - strings Unicode-normalised (NFC), so "é" typed two ways is one string;
 *  - numbers only as safe integers. Money and anything fractional must already be a
 *    string ("1250000.00"): a float has no single canonical spelling;
 *  - Dates as ISO 8601 UTC strings; nothing else that is not plain JSON.
 */
const { sha256 } = require("../files/hash");

function canon(value, path) {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return JSON.stringify(value.normalize("NFC"));
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error(`canonical: ${path} is ${value}; give fractional numbers and money as strings`);
    return String(value);
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new Error(`canonical: ${path} is an invalid date`);
    return JSON.stringify(value.toISOString());
  }
  if (Array.isArray(value)) return `[${value.map((v, i) => canon(v === undefined ? null : v, `${path}[${i}]`)).join(",")}]`;
  if (typeof value === "object") {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) throw new Error(`canonical: ${path} is not a plain object`);
    const keys = Object.keys(value)
      .filter((k) => value[k] !== undefined)
      .sort();
    return `{${keys.map((k) => `${JSON.stringify(k.normalize("NFC"))}:${canon(value[k], `${path}.${k}`)}`).join(",")}}`;
  }
  throw new Error(`canonical: ${path} is a ${typeof value}`);
}

/** The canonical JSON text of a payload. */
function canonicalize(payload) {
  return canon(payload, "$");
}

/** SHA-256 hex of the canonical text (UTF-8). */
function canonicalHash(payload) {
  return sha256(Buffer.from(canonicalize(payload), "utf8"));
}

module.exports = { canonicalize, canonicalHash };
