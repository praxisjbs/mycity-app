"use strict";
/**
 * Remove secrets and personal data from FREE TEXT before it is stored or sent:
 * error messages, stack traces, routes, anything headed for error_event or the
 * alert webhook. Pino's redaction works on keys; a message string has none, so
 * this works on patterns.
 *
 *   scrub("connect ECONNREFUSED postgres://mycity:hunter2@db:5432")
 *     → "connect ECONNREFUSED postgres://<credentials>@db:5432"
 *
 * Rules: URL credentials, private keys, JWTs, bearer tokens, vendor API keys,
 * key=value secrets, email, international and Nigerian local phone numbers
 * (0803 123 4567), and Luhn-valid card numbers.
 *
 * It never throws: a scrubber that fails must not take the error report with it.
 */
const { SENSITIVE_KEYS } = require("../../config/logger");

const KEY_ALTERNATION = [
  ...SENSITIVE_KEYS,
  "authorization",
  "auth",
  "cookie",
  "session",
  "passwd",
  "pwd",
]
  .sort((a, b) => b.length - a.length)
  .map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  .join("|");

/** [pattern, replacement], applied in order. */
const RULES = [
  // scheme://user:pass@host
  [/\b([a-z][a-z0-9+.-]*:\/\/)[^\s:/@]+:[^\s@]+@/gi, "$1<credentials>@"],
  [
    /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    "<private-key>",
  ],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, "<jwt>"],
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{12,}/gi, "$1 <token>"],
  [/\bAIza[0-9A-Za-z_-]{35}/g, "<api-key>"],
  [/\bsk-[A-Za-z0-9_-]{20,}/g, "<api-key>"],
  [/\bghp_[A-Za-z0-9]{36}/g, "<api-key>"],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}/g, "<api-key>"],
  // password=..., "token": "...", api_key: ...
  [
    new RegExp(
      `\\b(${KEY_ALTERNATION})(["']?\\s*[:=]\\s*)(["']?)((?:Bearer|Basic)\\s+)?([^"'\\s,;&})\\]]{3,})`,
      "gi",
    ),
    (m, key, sep, quote, scheme, value) =>
      /^<[a-z-]+>$/i.test(value)
        ? m
        : `${key}${sep}${quote}${scheme || ""}<redacted>`,
  ],
  [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "<email>"],
  [/\+\d[\d\s().-]{7,16}\d/g, "<phone>"],
  // Nigerian local format: 0 then 7, 8 or 9, then 9 more digits, spaces allowed.
  [/\b0[789][01]\d[\s-]?\d{3}[\s-]?\d{4}\b/g, "<phone>"],
];

function luhnValid(digits) {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let d = digits.charCodeAt(i) - 48;
    if (alt) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    alt = !alt;
  }
  return sum % 10 === 0;
}

function scrubCards(text) {
  return text.replace(/\b(?:\d[ -]?){12,18}\d\b/g, (match) => {
    const digits = match.replace(/\D/g, "");
    if (digits.length < 13 || digits.length > 19) return match;
    return luhnValid(digits) ? "<card>" : match;
  });
}

/**
 * @param {string} value
 * @param {{max?: number}} [opts]  truncate after scrubbing
 */
function scrub(value, opts = {}) {
  if (typeof value !== "string" || value === "") return value;
  try {
    let out = value;
    for (const [pattern, replacement] of RULES)
      out = out.replace(pattern, replacement);
    out = scrubCards(out);
    return opts.max ? out.slice(0, opts.max) : out;
  } catch {
    return "<unscrubbable>";
  }
}

/** Scrub every string in a small object (bounded depth), and drop sensitive keys outright. */
function scrubObject(obj, depth = 0) {
  if (!obj || typeof obj !== "object" || depth > 3) return obj;
  if (Array.isArray(obj))
    return obj.map((v) =>
      typeof v === "string" ? scrub(v) : scrubObject(v, depth + 1),
    );
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.includes(k)) out[k] = "<redacted>";
    else if (typeof v === "string") out[k] = scrub(v);
    else if (v && typeof v === "object") out[k] = scrubObject(v, depth + 1);
    else out[k] = v;
  }
  return out;
}

module.exports = { scrub, scrubObject, luhnValid };
