"use strict";
/**
 * The signed tickets that carry a person from one step of a ceremony to the next
 * (the code step after a password, a passkey's options to its answer), and the rule
 * that each is used once.
 *
 *   const token = challenge.issue("two_step", { sub: userId, via: "password" });
 *   const claims = challenge.read(token, "two_step");   // AppError when expired, forged or another kind
 *   await challenge.spend(client, claims, userId);       // in the transaction that acts on it
 *
 * A ticket is a JWT (HS256 on the access secret, typ "challenge", five minutes; fifteen
 * for setting two-step up at sign-in, which waits while the person installs an app).
 * middleware/auth.js refuses any token whose typ is not "access", so a ticket can
 * never stand in for a session. Reading one needs no table, so starting a ceremony
 * writes nothing for a stranger to fill up; spending one records its id in
 * spent_challenge inside the transaction that uses it, so the same ticket presented
 * again, from any process, finds its id taken and is refused.
 */
const crypto = require("node:crypto");
const jwt = require("jsonwebtoken");
const { config } = require("../../config/env");
const { AppError } = require("../../shared/errors");
const repo = require("./security.repo");

const TTL_SECONDS = 5 * 60;
/** As long as a new key waits for its first code (security.service SETUP_SECONDS). */
const SETUP_TTL_SECONDS = 15 * 60;
const PURPOSES = Object.freeze(["two_step", "two_step_setup", "passkey_sign_in", "passkey_add", "passkey_confirm"]);

/** Seconds a ticket of this purpose lasts. */
const ttlOf = (purpose) => (purpose === "two_step_setup" ? SETUP_TTL_SECONDS : TTL_SECONDS);

/**
 * @param {"two_step"|"two_step_setup"|"passkey_sign_in"|"passkey_add"|"passkey_confirm"} purpose
 * @param {object} [claims]  what the next step needs back: sub, via, the WebAuthn challenge, an email
 * @returns {string}
 */
function issue(purpose, claims = {}) {
  if (!PURPOSES.includes(purpose)) throw new Error(`challenge: unknown purpose "${purpose}"`);
  return jwt.sign({ ...claims, typ: "challenge", purpose }, config.JWT_ACCESS_SECRET, {
    algorithm: "HS256",
    expiresIn: ttlOf(purpose),
    jwtid: crypto.randomUUID(),
  });
}

const expired = () =>
  new AppError("CHALLENGE_EXPIRED", "This request has expired. Start again.", 400);

/**
 * The claims of a live ticket of this purpose.
 * @returns {{sub?: string, via?: string, challenge?: string, email?: string|null, jti: string, exp: number, purpose: string}}
 */
function read(token, purpose) {
  let claims;
  try {
    claims = jwt.verify(String(token || ""), config.JWT_ACCESS_SECRET, { algorithms: ["HS256"] });
  } catch {
    throw expired();
  }
  if (!claims || claims.typ !== "challenge" || claims.purpose !== purpose || !claims.jti) throw expired();
  return claims;
}

const hashOf = (jti) => crypto.createHash("sha256").update(String(jti), "utf8").digest("hex");

/** Record the ticket as used. Throws when it already was. Call inside the transaction that acts on it. */
async function spend(client, claims, userId) {
  const fresh = await repo.spendChallenge(client, {
    hash: hashOf(claims.jti),
    purpose: claims.purpose,
    userId,
    expiresAt: new Date(Number(claims.exp) * 1000),
  });
  if (!fresh)
    throw new AppError("CHALLENGE_USED", "This request was already used. Start again.", 400);
}

module.exports = { issue, read, spend, ttlOf, TTL_SECONDS, SETUP_TTL_SECONDS, PURPOSES };
