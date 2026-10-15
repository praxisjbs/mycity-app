"use strict";
/**
 * What is scrubbed from text and data before it leaves for a model
 * (BACKEND_STRUCTURE §14.2: "only what the actor may see is ever sent").
 *
 * Two egress classes, because they are not the same risk:
 *
 *   redactForReasoning()  the caller's own authorised data going into a prompt and
 *                         nowhere else. The caller is signed in and their grants
 *                         already decided which rows were read. Amounts, references,
 *                         names and contact details stay, because they are usually
 *                         the answer ("what is Ada's work email").
 *
 *   redactExternal()      text whose answer is kept or shown to others: a draft that
 *                         becomes a letter or a proposal, anything indexed or
 *                         summarised and stored. Contact details and the tax number
 *                         are masked too. `redact` is this one, so a caller that has
 *                         not thought about the question gets the strict answer.
 *
 * On every path: payment instruments (card numbers, IBANs, a labelled NUBAN account
 * number) and personal identity numbers (BVN, NIN, passport) are masked. They are
 * high harm if they leak and never the answer to a question.
 *
 * Numbers are masked by what surrounds them, not by length. A ten-digit run with
 * "account" before it is an account number; a bare 2500000000 is an amount, and the
 * model needs amounts. Only a run of 13 or more bare digits is masked for its length.
 *
 * Structured data first (redactValue): the restricted fields of shared/rbac/field-mask
 * (salary, bank, personal, statutory) are emptied wherever they appear, whoever is
 * asking, unless the caller names a field key in `keep` because the task needs it.
 * Then every string inside is scrubbed as above.
 *
 * Patterns, not a named-entity model: what leaks in this data is structured, and a
 * model call on every egress to find names would cost more than it saves.
 */
const { FIELDS, maskData } = require("../../shared/rbac/field-mask");

const CARD = /\b\d{4}[\s-]\d{4}[\s-]\d{4}[\s-]\d{1,7}\b/g;
const CARD_AMEX = /\b\d{4}[\s-]\d{6}[\s-]\d{5}\b/g;
const CARD_PLAIN =
  /\b(?:4\d{15}|5[1-5]\d{14}|2[2-7]\d{14}|506\d{15,16}|650\d{13})\b/g;
const IBAN = /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]){10,30}\b/g;

// A NUBAN is ten digits, the shape of any ten-digit figure, so only a labelled one.
const ACCOUNT_NUM =
  /\b((?:bank\s+)?(?:accounts?|acct|a\/c|nuban)\b[ \t]*(?:number|numbers|no\.?|num|#)?[ \t]*[:#=-]?[ \t]*)(\d{10})\b/gi;
const BVN = /\b(bvn\b[ \t]*(?:number|no\.?|#)?[ \t]*[:#=-]?[ \t]*)(\d{11})\b/gi;
const NIN = /\b(nin\b[ \t]*(?:number|no\.?|#)?[ \t]*[:#=-]?[ \t]*)(\d{11})\b/gi;
const PASSPORT_LABELLED =
  /\b(passports?|travel\s+document)\b([^\n]{0,24}?)\b([A-Z]\d{8})\b/gi;
const PASSPORT_TRAILING = /\b[A-Z]\d{8}\b(?=[^\n]{0,24}?\bpassports?\b)/gi;
const LONG_RUN = /\b\d{13,}\b/g;

// External egress only.
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const PHONE_INTL =
  /\+\d{1,3}[\s.-]?\(?\d{1,4}\)?[\s.-]?\d{1,4}[\s.-]?\d{1,4}[\s.-]?\d{0,4}/g;
const PHONE_NG = /\b0[789][01]\d[\s.-]?\d{3}[\s.-]?\d{4}\b/g;
const TIN = /\b\d{8}-\d{4}\b/g;

/**
 * @param {string} text
 * @param {boolean} contact  also mask contact details and the tax number
 */
function scrub(text, contact) {
  let s = String(text ?? "");
  s = s.replace(IBAN, "[IBAN]");
  s = s
    .replace(CARD, "[CARD]")
    .replace(CARD_AMEX, "[CARD]")
    .replace(CARD_PLAIN, "[CARD]");
  if (contact) {
    s = s.replace(TIN, "[TIN]");
    s = s.replace(EMAIL, "[EMAIL]");
    s = s.replace(PHONE_INTL, "[PHONE]").replace(PHONE_NG, "[PHONE]");
  }
  s = s.replace(BVN, "$1[BVN]").replace(NIN, "$1[NIN]");
  s = s
    .replace(PASSPORT_LABELLED, (_m, label, gap) => `${label}${gap}[PASSPORT]`)
    .replace(PASSPORT_TRAILING, "[PASSPORT]");
  s = s.replace(ACCOUNT_NUM, "$1[NUM]");
  s = s.replace(LONG_RUN, "[NUM]");
  return s;
}

/** Strict: for text that is kept, indexed or shown to others. */
function redactExternal(text) {
  return scrub(text, true);
}

/** For the caller's own authorised data on its way into a prompt and nowhere else. */
function redactForReasoning(text) {
  return scrub(text, false);
}

const ALL_FIELD_KEYS = Object.freeze(Object.keys(FIELDS));
const UNSAFE = new Set(["__proto__", "constructor", "prototype"]);

function scrubStrings(value, fn, depth = 0) {
  if (typeof value === "string") return fn(value);
  if (
    depth > 12 ||
    value === null ||
    typeof value !== "object" ||
    value instanceof Date
  )
    return value;
  if (Array.isArray(value))
    return value.map((v) => scrubStrings(v, fn, depth + 1));
  return Object.fromEntries(
    Object.entries(value)
      .filter(([k]) => !UNSAFE.has(k))
      .map(([k, v]) => [k, scrubStrings(v, fn, depth + 1)]),
  );
}

/**
 * Data on its way into a prompt: restricted fields emptied, then every string scrubbed.
 * @param {*} value
 * @param {{egress?: "external"|"reasoning", keep?: string[]}} [opts]
 *   keep  field keys (shared/rbac/field-mask FIELDS) this task genuinely needs
 */
function redactValue(value, { egress = "external", keep = [] } = {}) {
  for (const k of keep)
    if (!FIELDS[k]) throw new Error(`redactValue: "${k}" is not a field key`);
  const masked = maskData(
    value,
    ALL_FIELD_KEYS.filter((k) => !keep.includes(k)),
  );
  return scrubStrings(
    masked,
    egress === "reasoning" ? redactForReasoning : redactExternal,
  );
}

module.exports = {
  redactExternal,
  redactForReasoning,
  redact: redactExternal,
  redactValue,
};
