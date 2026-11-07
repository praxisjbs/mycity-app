"use strict";
/**
 * The six-digit email code a signer proves their address with (docs/guides/partnerships.md §6.9
 * step 3): emailed to the address the link was sent to, it lasts ten minutes, allows five tries,
 * and a new one may be asked for after sixty seconds. Only its hash is kept, salted with the
 * signature row, so a leaked table yields no code and a code works for one row only.
 */
const crypto = require("node:crypto");

const CODE_MINUTES = 10;
const CODE_TRIES = 5;
const RESEND_SECONDS = 60;
/** How long an entered code lets the signer press Accept and Sign. */
const VERIFIED_MINUTES = 30;

/** A fresh code: six digits, leading zeros kept. */
function fresh() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, "0");
}

/** The hash kept for a code on one signature row. */
function hashOf(signatureId, code) {
  return crypto.createHash("sha256").update(`${signatureId}:${code}`, "utf8").digest("hex");
}

/** True when `code` is the one whose hash is kept (constant time). */
function matches(signatureId, code, kept) {
  if (!kept || !/^\d{6}$/.test(String(code))) return false;
  const a = Buffer.from(hashOf(signatureId, code), "hex");
  const b = Buffer.from(String(kept), "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** "ada.obi@example.com" → "a••••i@example.com": enough to recognise, not to read. */
function maskEmail(email) {
  const [user, domain] = String(email).split("@");
  if (!domain) return "your email";
  const shown = user.length <= 2 ? user.charAt(0) : `${user.charAt(0)}${"•".repeat(4)}${user.charAt(user.length - 1)}`;
  return `${shown}@${domain}`;
}

module.exports = { CODE_MINUTES, CODE_TRIES, RESEND_SECONDS, VERIFIED_MINUTES, fresh, hashOf, matches, maskEmail };
