/**
 * AES-256-GCM encryption for credentials at rest.
 * Used for: mailbox (IMAP) passwords, integration API keys, anything the system must
 * read back and use. Never for passwords people sign in with; those are hashed.
 * Key sourced from ENCRYPTION_KEY env var (must be 32 bytes hex-encoded).
 *
 * Stored form: base64 of iv (12 bytes) | GCM tag (16 bytes) | ciphertext. A fresh IV per
 * value; the tag authenticates it, so a value that was altered or encrypted under another
 * key fails to decrypt instead of returning garbage.
 *
 * Bound to its record (BACKEND_GUIDE §4): with `aad`, the value is encrypted with that
 * string as additional data and stored as "a1." followed by the same base64, so a
 * ciphertext copied onto another row fails to decrypt there. Pass the same `aad` to
 * decrypt it. Values written without one (no prefix) read as before, `aad` or not.
 *
 *   const stored = encrypt(key, { aad: "integration_secret:geoapify:api_key" });
 *   decrypt(stored, { aad: "integration_secret:geoapify:api_key" });   // → key
 */

"use strict";

const crypto = require("crypto");
const { config } = require("../../config/env");

const ALGO = "aes-256-gcm";
/** Prefix of a value bound to its record. "." is not in the base64 alphabet. */
const BOUND = "a1.";

function getKey() {
  return Buffer.from(config.ENCRYPTION_KEY, "hex");
}

/**
 * @param {string} plaintext
 * @param {{aad?: string}} [opts]  the record the value belongs to
 * @returns {string}
 */
function encrypt(plaintext, { aad } = {}) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, getKey(), iv);
  if (aad) cipher.setAAD(Buffer.from(String(aad), "utf8"));
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  const body = Buffer.concat([iv, tag, ciphertext]).toString("base64");
  return aad ? `${BOUND}${body}` : body;
}

/**
 * @param {string} encoded
 * @param {{aad?: string}} [opts]  required for a bound value: the same record it was bound to
 * @returns {string}
 */
function decrypt(encoded, { aad } = {}) {
  const value = String(encoded);
  const bound = value.startsWith(BOUND);
  if (bound && !aad)
    throw new Error("encryption: this value is bound to its record; pass its aad");
  const buf = Buffer.from(bound ? value.slice(BOUND.length) : value, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ciphertext = buf.subarray(28);
  const decipher = crypto.createDecipheriv(ALGO, getKey(), iv);
  if (bound) decipher.setAAD(Buffer.from(String(aad), "utf8"));
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString("utf8");
}

/** Whether a stored value is bound to its record. */
const isBound = (encoded) => String(encoded).startsWith(BOUND);

module.exports = { encrypt, decrypt, isBound };
