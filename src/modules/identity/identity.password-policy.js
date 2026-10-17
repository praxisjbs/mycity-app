"use strict";
/**
 * What counts as an acceptable new password, everywhere a password is chosen:
 * the reset and invitation links, the signed-in change, create-admin.
 *
 *   await passwordPolicy.assert(password, { email, field: "new_password" });
 *
 * Rules (decided 16/10/2026):
 *  - the shape is the contract's NewPassword: at least 8 characters, a lowercase
 *    letter, an uppercase letter, a number and a symbol. One definition, so the form
 *    marks the field with the same rule the API applies;
 *  - at least the minimum in force, when Settings · Security has raised it above the
 *    contract's eight (settings.security-rules.js; the caller loads the rules first);
 *  - not the name part of the person's own email ("ada" in ada@...);
 *  - not in the Have I Been Pwned breach corpus. The k-anonymity range API is sent
 *    the first 5 characters of the password's SHA-1 and nothing else; the match is
 *    made here. When the service cannot be reached the password is allowed: an
 *    outage elsewhere must never stop a person resetting their own password.
 *
 * A refusal is a 422 on the field, worded as a field mark (at most four words).
 */
const crypto = require("node:crypto");
const c = require("@mycity/contract");
const { config } = require("../../config/env");
const { logger } = require("../../config/logger");
const { AppError } = require("../../shared/errors");
const rules = require("../settings/settings.security-rules");

const RANGE_URL = "https://api.pwnedpasswords.com/range/";
const TIMEOUT_MS = 3000;

/**
 * Has this password appeared in a known breach?
 * @param {string} password
 * @param {{fetchImpl?: typeof fetch}} [opts]
 * @returns {Promise<{checked: boolean, breached: boolean}>}  checked false: the service was not reached
 */
async function checkBreached(password, { fetchImpl = fetch } = {}) {
  const sha1 = crypto
    .createHash("sha1")
    .update(String(password))
    .digest("hex")
    .toUpperCase();
  const prefix = sha1.slice(0, 5);
  const suffix = sha1.slice(5);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    // Add-Padding: the response size says nothing about how many hashes matched.
    const res = await fetchImpl(RANGE_URL + prefix, {
      headers: { "Add-Padding": "true" },
      signal: ctrl.signal,
    });
    if (!res || !res.ok) return { checked: false, breached: false };
    const body = await res.text();
    const breached = body.split("\n").some((line) => {
      const [hash, count] = line.trim().split(":");
      return hash === suffix && Number(count) > 0;
    });
    return { checked: true, breached };
  } catch {
    return { checked: false, breached: false };
  } finally {
    clearTimeout(timer);
  }
}

function refuse(field, message) {
  return new AppError("WEAK_PASSWORD", message, 422, { [field]: [message] });
}

/**
 * Throws a 422 naming the field when the password fails; resolves otherwise.
 * @param {string} password
 * @param {{email?: string|null, field?: string, fetchImpl?: typeof fetch}} [ctx]
 * @returns {Promise<{breach_checked: boolean}>}
 */
async function assert(password, ctx = {}) {
  const field = ctx.field || "new_password";
  const shape = c.identity.NewPassword.safeParse(password);
  if (!shape.success) throw refuse(field, shape.error.issues[0].message);
  const min = rules.current().password_min_length;
  if (String(password).length < min) throw refuse(field, `At least ${min} characters`);

  const local = String(ctx.email || "")
    .toLowerCase()
    .split("@")[0];
  if (local.length >= 3 && String(password).toLowerCase().includes(local))
    throw refuse(field, "Contains your email name");

  // Tests never reach the network; checkBreached is tested with its own fetch.
  if (!config.PASSWORD_BREACH_CHECK || config.APP_ENV === "test")
    return { breach_checked: false };
  const { checked, breached } = await checkBreached(password, ctx);
  if (breached) throw refuse(field, "Found in a breach");
  if (!checked)
    logger.warn("password breach check skipped: the service was not reached");
  return { breach_checked: checked };
}

module.exports = { assert, checkBreached };
