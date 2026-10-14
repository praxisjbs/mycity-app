"use strict";
/**
 * Secrets at rest: AES-256-GCM with ENCRYPTION_KEY (32 bytes, hex). For things the
 * system must be able to read back and use, never for passwords people sign in with
 * (those are hashed): a mailbox password for IMAP (M1), an integration API key (M9).
 *
 *   const sealed = encrypt("imap-password", { aad: `mailbox:${userId}` });   // "v1:..."
 *   const plain  = decrypt(sealed, { aad: `mailbox:${userId}` });
 *
 *  - A fresh 12-byte IV per value; the GCM tag authenticates it, so a value that was
 *    altered, truncated or encrypted under another key fails loudly instead of
 *    decrypting to garbage.
 *  - `aad` binds a value to what it belongs to. A ciphertext copied from one user's row
 *    to another's does not decrypt there, because the aad differs.
 *  - Values are prefixed with a version ("v1:"), so a future key rotation can read old
 *    values while writing new ones.
 *  - The plaintext is never logged; errors name the failure, not the value.
 */
const crypto = require("node:crypto");
const { config } = require("../../config/env");

const ALGO = "aes-256-gcm";
const VERSION = "v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;

function key() {
  const k = Buffer.from(String(config.ENCRYPTION_KEY || ""), "hex");
  if (k.length !== 32) throw new Error("ENCRYPTION_KEY must be 64 hex characters");
  return k;
}

/**
 * @param {string} plaintext
 * @param {{aad?: string}} [opts]
 * @returns {string} "v1:<base64 iv|tag|ciphertext>"
 */
function encrypt(plaintext, { aad = "" } = {}) {
  if (typeof plaintext !== "string") throw new TypeError("encrypt: give a string");
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGO, key(), iv);
  if (aad) cipher.setAAD(Buffer.from(aad, "utf8"));
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return `${VERSION}:${Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64")}`;
}

/**
 * @param {string} sealed  from encrypt()
 * @param {{aad?: string}} [opts]  the same aad it was sealed with
 * @returns {string}
 */
function decrypt(sealed, { aad = "" } = {}) {
  const text = String(sealed || "");
  if (!text.startsWith(`${VERSION}:`)) throw new Error("decrypt: not a sealed value");
  const buf = Buffer.from(text.slice(VERSION.length + 1), "base64");
  if (buf.length < IV_BYTES + TAG_BYTES) throw new Error("decrypt: sealed value is truncated");
  const decipher = crypto.createDecipheriv(ALGO, key(), buf.subarray(0, IV_BYTES));
  decipher.setAuthTag(buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
  if (aad) decipher.setAAD(Buffer.from(aad, "utf8"));
  try {
    return Buffer.concat([decipher.update(buf.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("decrypt: the value was altered, or belongs to another record or key");
  }
}

const encryptJson = (value, opts) => encrypt(JSON.stringify(value), opts);
const decryptJson = (sealed, opts) => JSON.parse(decrypt(sealed, opts));

/** Show that a secret is set without showing it: "••••••••abcd". */
function hint(plaintext) {
  const s = String(plaintext || "");
  return s.length <= 4 ? "••••" : `••••••••${s.slice(-4)}`;
}

module.exports = { encrypt, decrypt, encryptJson, decryptJson, hint };
