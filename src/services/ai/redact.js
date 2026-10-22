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
 * asking, unless the caller names a field key in `keep` because the task needs it. The
 * payment and identity numbers among them (NEVER_PROPS) are emptied whatever `keep` says,
 * since a key in `keep` brings its whole field (NIN sits with the personal details).
 * Then every string inside is scrubbed as above.
 *
 * Patterns, not a named-entity model: what leaks in this data is structured, and a
 * model call on every egress to find names would cost more than it saves.
 *
 * shield() is for an answer that must carry what the model may not see (a mail draft that
 * gives the sender's number): each value the redaction would mask is swapped for a token
 * (KEPT001), the same value always for the same token, and restore() puts the values back
 * into the answer. The model reasons about "KEPT003" and never sees the number.
 */
const { FIELDS, maskData, applyMask } = require("../../shared/rbac/field-mask");

/** Payment and identity numbers, by name: emptied on every path, whatever a caller keeps. */
const NEVER_PROPS = Object.freeze(
  new Set(["account_number", "bank_account_number", "bvn", "nin", "tax_id", "tin", "pension_pin", "nhf_number", "nsitf_number", "passport_number"]),
);

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
 * What is masked, in order. Each step replaces a value through `put(kind, value)`: scrub() puts
 * the kind's mark ([EMAIL]), shield() a token it can restore. A labelled number keeps its label.
 * `contact` steps run on external egress only.
 */
const STEPS = [
  { contact: false, run: (s, put) => s.replace(IBAN, (m) => put("IBAN", m)) },
  {
    contact: false,
    run: (s, put) =>
      s
        .replace(CARD, (m) => put("CARD", m))
        .replace(CARD_AMEX, (m) => put("CARD", m))
        .replace(CARD_PLAIN, (m) => put("CARD", m)),
  },
  { contact: true, run: (s, put) => s.replace(TIN, (m) => put("TIN", m)) },
  { contact: true, run: (s, put) => s.replace(EMAIL, (m) => put("EMAIL", m)) },
  {
    contact: true,
    run: (s, put) => s.replace(PHONE_INTL, (m) => put("PHONE", m)).replace(PHONE_NG, (m) => put("PHONE", m)),
  },
  {
    contact: false,
    run: (s, put) =>
      s.replace(BVN, (_m, label, n) => label + put("BVN", n)).replace(NIN, (_m, label, n) => label + put("NIN", n)),
  },
  {
    contact: false,
    run: (s, put) =>
      s
        .replace(PASSPORT_LABELLED, (_m, label, gap, n) => `${label}${gap}${put("PASSPORT", n)}`)
        .replace(PASSPORT_TRAILING, (m) => put("PASSPORT", m)),
  },
  { contact: false, run: (s, put) => s.replace(ACCOUNT_NUM, (_m, label, n) => label + put("NUM", n)) },
  { contact: false, run: (s, put) => s.replace(LONG_RUN, (m) => put("NUM", m)) },
];

/** Every step a text goes through, contact ones only when `contact`. */
function apply(text, contact, put) {
  let s = String(text ?? "");
  for (const step of STEPS) if (contact || !step.contact) s = step.run(s, put);
  return s;
}

/**
 * @param {string} text
 * @param {boolean} contact  also mask contact details and the tax number
 */
function scrub(text, contact) {
  return apply(text, contact, (kind) => `[${kind}]`);
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
  const masked = applyMask(
    maskData(
      value,
      ALL_FIELD_KEYS.filter((k) => !keep.includes(k)),
    ),
    NEVER_PROPS,
  );
  return scrubStrings(
    masked,
    egress === "reasoning" ? redactForReasoning : redactExternal,
  );
}

/** A token shield() hands out, as a model may write it back. */
const TOKEN = /\bKEPT ?(\d{3,})\b/g;

/**
 * Swap what the redaction would mask for tokens the model can use, and give back the way home.
 *
 *   const s = shield({ thread }, { egress: "external" });
 *   const run = await ai.complete({ input: s.value, egress: "external", ... });
 *   const draft = s.restore(run.text);
 *
 * Restricted fields are still emptied by complete()'s own redaction; a token never stands for one.
 * @param {*} value  text or data; every string inside is shielded
 * @param {{egress?: "external"|"reasoning", also?: RegExp[]}} [opts]
 *   also  more patterns (each with the g flag) shielded first, a whole match each: what a task
 *         needs kept word for word (a policy's links)
 * @returns {{value: *, restore: (text: string) => string, known: (token: string) => boolean}}
 */
function shield(value, { egress = "external", also = [] } = {}) {
  const tokens = new Map();
  const values = [];
  const put = (_kind, original) => {
    let token = tokens.get(original);
    if (!token) {
      values.push(original);
      token = `KEPT${String(values.length).padStart(3, "0")}`;
      tokens.set(original, token);
    }
    return token;
  };
  const one = (text) => {
    let s = String(text ?? "");
    for (const re of also) s = s.replace(re, (m) => put("KEPT", m));
    return apply(s, egress !== "reasoning", put);
  };
  const out = scrubStrings(value, one);
  const at = (n) => values[Number(n) - 1];
  return {
    value: out,
    restore: (text) => String(text ?? "").replace(TOKEN, (m, n) => at(n) ?? m),
    known: (token) => {
      const m = /^KEPT ?(\d{3,})$/.exec(String(token).trim());
      return Boolean(m) && at(m[1]) !== undefined;
    },
  };
}

module.exports = {
  redactExternal,
  redactForReasoning,
  redact: redactExternal,
  redactValue,
  NEVER_PROPS,
  shield,
  TOKEN,
};
