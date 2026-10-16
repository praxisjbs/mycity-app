"use strict";
/**
 * Two-step sign-in's arithmetic (docs/guides/identity.md §6): the authenticator key,
 * its codes, and the recovery codes. No database and no request here; the service
 * keeps the key encrypted (services/secrets) and the recovery codes hashed.
 *
 * The codes are RFC 6238 TOTP, as every authenticator app reads an otpauth://
 * address: HMAC-SHA-1 over the 30-second step (RFC 4226's truncation), six digits,
 * the key in RFC 4648 base32. It is a few lines over node:crypto, so the server
 * carries no TOTP library. One step either side is accepted, so a phone a little
 * behind or ahead still works. Each step is accepted once: the caller passes the
 * last step it accepted and keeps the one this returns, so a code read over a
 * shoulder has already been spent.
 *
 * Recovery codes stand in for a lost phone: ten, of ten characters each, from the
 * letters and numbers nobody misreads off a screenshot or a printout (no 0, O, 1,
 * I or L), shown once as XXXXX-XXXXX. Case, spaces and the dash do not matter when
 * one is typed back. Each works once. They are hashed with Argon2id at OWASP's
 * baseline cost: ten random characters are about 49 bits, beyond guessing behind
 * Argon2, and ten checked one after another stay well under a second.
 */
const crypto = require("node:crypto");
const argon2 = require("argon2");

const ISSUER = "MyCity App";
const STEP_SECONDS = 30;
const DIGITS = 6;
/** Steps either side of now that still count. */
const DRIFT_STEPS = 1;
const KEY_BYTES = 20;
const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

const RECOVERY_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const RECOVERY_COUNT = 10;
const RECOVERY_LENGTH = 10;
const RECOVERY_ARGON = Object.freeze({
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
});

/** Bytes as RFC 4648 base32, unpadded (20 bytes are exactly 32 characters). */
function toBase32(bytes) {
  let out = "";
  let bits = 0;
  let acc = 0;
  for (const byte of bytes) {
    acc = (acc << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += BASE32[(acc >> bits) & 31];
    }
    acc &= (1 << bits) - 1;
  }
  if (bits > 0) out += BASE32[(acc << (5 - bits)) & 31];
  return out;
}

/** A base32 key back to its bytes; null when it is not base32. */
function fromBase32(text) {
  const clean = String(text || "").toUpperCase().replace(/[\s=]/g, "");
  if (!/^[A-Z2-7]+$/.test(clean)) return null;
  const out = [];
  let bits = 0;
  let acc = 0;
  for (const ch of clean) {
    acc = (acc << 5) | BASE32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 0xff);
    }
    acc &= (1 << bits) - 1;
  }
  return Buffer.from(out);
}

/** RFC 4226: the code for one counter value. */
function hotp(keyBytes, counter) {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const mac = crypto.createHmac("sha1", keyBytes).update(message).digest();
  const at = mac[mac.length - 1] & 0x0f;
  const number = mac.readUInt32BE(at) & 0x7fffffff;
  return String(number % 10 ** DIGITS).padStart(DIGITS, "0");
}

/** The 30-second step a moment falls in. */
const stepAt = (when = Date.now()) => Math.floor(Number(when) / 1000 / STEP_SECONDS);

/** A new authenticator key: 20 random bytes, base32 (32 characters). */
const newKey = () => toBase32(crypto.randomBytes(KEY_BYTES));

/** The address an authenticator app adds the key from, named MyCity App and the person's email. */
const otpauthUrl = (email, key) =>
  `otpauth://totp/${encodeURIComponent(ISSUER)}:${encodeURIComponent(email)}` +
  `?secret=${key}&issuer=${encodeURIComponent(ISSUER)}`;

/** The key in groups of four, for typing in by hand. */
const groupKey = (key) => (String(key).match(/.{1,4}/g) || []).join(" ");

/**
 * The code an authenticator app shows for this key at this moment.
 * @param {string} key  the base32 key
 * @param {number|Date} [when]  milliseconds since the epoch
 */
function codeAt(key, when = Date.now()) {
  const bytes = fromBase32(key);
  if (!bytes || bytes.length === 0) throw new Error("The authenticator key is not base32");
  return hotp(bytes, stepAt(when));
}

/**
 * Is this the code for this key, at a step after `afterStep`?
 * @param {string} key        the base32 key
 * @param {string} code       what the person typed
 * @param {number|null} [afterStep]  the last step already accepted for this person
 * @param {number} [now]      milliseconds since the epoch
 * @returns {{ok: true, step: number}|{ok: false}}
 */
function checkCode(key, code, afterStep = null, now = Date.now()) {
  const token = String(code || "").replace(/\s+/g, "");
  if (!/^\d{6}$/.test(token)) return { ok: false };
  const bytes = fromBase32(key);
  // A key that cannot be read matches no code.
  if (!bytes || bytes.length === 0) return { ok: false };
  const floor = afterStep === null || afterStep === undefined ? -Infinity : Number(afterStep);
  const current = stepAt(now);
  // Now first, then the step behind, then the one ahead.
  for (const step of [current, current - DRIFT_STEPS, current + DRIFT_STEPS]) {
    if (step <= floor) continue;
    if (crypto.timingSafeEqual(Buffer.from(hotp(bytes, step)), Buffer.from(token))) return { ok: true, step };
  }
  return { ok: false };
}

/** What the person typed, reduced to what was generated. */
const normaliseRecovery = (input) => String(input || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/** Which kind of code this looks like: the app's, a recovery code, or neither. */
function kindOf(code) {
  if (/^\d{6}$/.test(String(code || "").replace(/\s+/g, ""))) return "totp";
  if (normaliseRecovery(code).length === RECOVERY_LENGTH) return "recovery";
  return null;
}

function newRecoveryCode() {
  let out = "";
  // randomInt, not randomBytes % n: the modulo would favour some characters.
  for (let i = 0; i < RECOVERY_LENGTH; i += 1)
    out += RECOVERY_ALPHABET[crypto.randomInt(RECOVERY_ALPHABET.length)];
  return `${out.slice(0, 5)}-${out.slice(5)}`;
}

/**
 * A new set: the codes to show once, and the hashes to keep. Argon2 is slow on
 * purpose: call this before the transaction that stores them.
 * @returns {Promise<{codes: string[], hashes: string[]}>}
 */
async function newRecoveryCodes() {
  const codes = Array.from({ length: RECOVERY_COUNT }, newRecoveryCode);
  const hashes = [];
  for (const code of codes) hashes.push(await argon2.hash(normaliseRecovery(code), RECOVERY_ARGON));
  return { codes, hashes };
}

/**
 * The stored code this is, or null.
 * @param {Array<{mfa_recovery_code_id: string, code_hash: string}>} rows  the unused codes
 * @param {string} presented
 */
async function matchRecovery(rows, presented) {
  const candidate = normaliseRecovery(presented);
  if (candidate.length !== RECOVERY_LENGTH) return null;
  for (const row of rows) {
    if (await argon2.verify(row.code_hash, candidate).catch(() => false)) return row;
  }
  return null;
}

module.exports = {
  ISSUER,
  RECOVERY_COUNT,
  newKey,
  otpauthUrl,
  groupKey,
  codeAt,
  checkCode,
  kindOf,
  normaliseRecovery,
  newRecoveryCodes,
  matchRecovery,
};
