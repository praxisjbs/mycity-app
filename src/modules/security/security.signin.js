"use strict";
/**
 * What signing in needs from two-step, the PIN and passkeys. identity.service.js
 * calls these, and it alone opens sessions (docs/guides/identity.md §3).
 *
 * Every way in has the same shape: check outside any transaction (Argon2 and a
 * passkey's signature are slow, and a connection must not wait on them), then spend
 * inside the transaction that opens the session: the ticket, the code's step or the
 * recovery code, the passkey's counter. Each spend is a guarded UPDATE or a unique
 * INSERT, so two requests racing with the same code or the same answer open one
 * session between them, and the other is refused.
 *
 * Statuses: these answer the anonymous /auth routes, so a refusal is a 401. The
 * PIN's check returns an outcome instead of throwing, because a signed-in person
 * confirming with a wrong PIN must get a 422: the app reads a 401 on a signed-in
 * route as an expired session.
 */
const argon2 = require("argon2");
const { pool } = require("../../config/db");
const { atomically } = require("../../shared/db/tx");
const { emit } = require("../../shared/events/emit");
const { AppError } = require("../../shared/errors");
const encryption = require("../../services/secrets/encryption.service");
const challenge = require("./security.challenge");
const mfa = require("./security.mfa");
const passkeys = require("./security.passkeys");
const pinRules = require("./security.pin");
const repo = require("./security.repo");
const { EVENTS } = require("./security.events");

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

/** A person's own login, as an event entity (links to My Security). */
const account = (userId) => ({ type: "account", id: userId });

/* ------------------------------------------------------------------ *
 * Two-step: the code after the password or the PIN
 * ------------------------------------------------------------------ */

/** Days a device that has just proved a code may skip the next ones. */
const TRUST_DAYS = Object.freeze({ every_sign_in: 0, daily: 1, monthly: 30 });

/**
 * Is two-step on for this person, and how long may a device that proves a code skip
 * the next ones?
 * @returns {Promise<{on: boolean, frequency: string, trustDays: number}>}
 */
async function twoStepOf(db, userId) {
  const s = await repo.stateOf(db, userId);
  const frequency = s ? s.mfa_frequency : "daily";
  return { on: Boolean(s && s.mfa_enrolled_at), frequency, trustDays: TRUST_DAYS[frequency] || 0 };
}

/** The answer when the first step passed and a code is still needed: a ticket, never a session. */
function codeRequired(userId, via) {
  return {
    step: "code",
    challenge_token: challenge.issue("two_step", { sub: userId, via }),
    expires_in: challenge.TTL_SECONDS,
  };
}

/** The code step's ticket: who passed the first step, and with what. */
function readCodeTicket(token) {
  const claims = challenge.read(token, "two_step");
  if (!claims.sub || !["password", "pin"].includes(claims.via))
    throw new AppError("CHALLENGE_EXPIRED", "This request has expired. Start again.", 400);
  return claims;
}

const codeRefused = () =>
  new AppError("INVALID_CODE", "That code is not right.", 401, { code: ["Not the right code"] });

/**
 * Is this the person's code: the authenticator's six digits at a step not used
 * before, or one of their unused recovery codes? Writes nothing.
 * @returns {Promise<{kind: "totp", step: number}|{kind: "recovery", id: string}|null>}
 */
async function checkSecondStep(userId, code) {
  const s = await repo.stateOf(pool, userId);
  if (!s || !s.mfa_enrolled_at || !s.mfa_secret_enc) return null;
  const kind = mfa.kindOf(code);
  if (kind === "totp") {
    const r = mfa.checkCode(encryption.decrypt(s.mfa_secret_enc), code, s.mfa_last_step);
    return r.ok ? { kind: "totp", step: r.step } : null;
  }
  if (kind === "recovery") {
    const hit = await mfa.matchRecovery(await repo.liveRecoveryCodes(pool, userId), code);
    return hit ? { kind: "recovery", id: hit.mfa_recovery_code_id } : null;
  }
  return null;
}

/**
 * Inside the transaction that opens the session: spend the ticket and the code.
 * Anything already spent throws, and the session is not opened.
 */
async function spendSecondStep(client, userId, second, claims, actor) {
  await challenge.spend(client, claims, userId);
  if (second.kind === "totp") {
    if (!(await repo.takeStep(client, userId, second.step))) throw codeRefused();
    return;
  }
  if (!(await repo.spendRecoveryCode(client, second.id))) throw codeRefused();
  await emit(client, {
    key: EVENTS.AUTH_RECOVERY_CODE_USED,
    entity: account(userId),
    actor,
    payload: { codes_left: await repo.countRecoveryLeft(client, userId) },
  });
}

/* ------------------------------------------------------------------ *
 * The PIN
 * ------------------------------------------------------------------ */

/**
 * Check a person's PIN, counting a wrong one (security.pin.js): the password's
 * doubling wait, and the PIN switched off after 10 wrong in a row or 20 in 30 days.
 * A wrong try is counted in a transaction of its own, so it stands whatever the
 * caller does next. Used to sign in and unlock, to confirm it is you, and later by
 * attendance to confirm a clock-in on a registered device.
 * @param {string} userId
 * @param {string} pin
 * @param {{actor?: object|null, ip?: string|null, purpose?: string}} [ctx]
 * @returns {Promise<{ok: true, hadFailures: boolean}|{ok: false, code: string, message: string}>}
 */
async function verifyPin(userId, pin, { actor = null, ip = null, purpose = "sign_in" } = {}) {
  const row = await repo.stateOf(pool, userId);
  if (!row || !row.pin_hash)
    return { ok: false, code: "PIN_UNAVAILABLE", message: "No PIN is set up. Use your password." };
  const wait = pinRules.waitSeconds(row);
  if (wait > 0)
    return { ok: false, code: "PIN_THROTTLED", message: `Too many wrong PINs. Try again in ${pinRules.sayWait(wait)}.` };
  if (await argon2.verify(row.pin_hash, String(pin || "")).catch(() => false))
    return { ok: true, hadFailures: Number(row.pin_failed_count) > 0 };

  const who = actor || { user_id: null, ip };
  const out = await tx(async (client) => {
    const counts = await repo.pinFailure(client, userId);
    const payload = { purpose, failed_count: counts.pin_failed_count, failed_30_days: counts.pin_window_failures };
    await emit(client, { key: EVENTS.AUTH_PIN_FAILED, entity: account(userId), actor: who, payload });
    if (pinRules.switchesOff(counts)) {
      await repo.clearPin(client, userId);
      await emit(client, { key: EVENTS.AUTH_PIN_SWITCHED_OFF, entity: account(userId), actor: who, payload });
      return { off: true };
    }
    if (counts.pin_failed_count === pinRules.FIRST_THROTTLED)
      await emit(client, { key: EVENTS.AUTH_PIN_THROTTLED, entity: account(userId), actor: who, payload });
    return { off: false, left: pinRules.triesLeft(counts) };
  });
  if (out.off)
    return { ok: false, code: "PIN_SWITCHED_OFF", message: "Too many wrong PINs, so your PIN is off. Use your password." };
  return {
    ok: false,
    code: "INVALID_PIN",
    message:
      out.left <= 3 ? `That PIN is not right. ${out.left} ${out.left === 1 ? "try" : "tries"} left.` : "That PIN is not right.",
  };
}

/** Inside the transaction a right PIN led to: it ends the run of wrong ones. */
const pinUsed = (client, userId) => repo.pinSuccess(client, userId);

/* ------------------------------------------------------------------ *
 * Passkeys
 * ------------------------------------------------------------------ */

/**
 * Options for signing in with a passkey. With an email (the lock screen, a known
 * browser) only that person's passkey finishes it. Reads and writes nothing.
 */
async function passkeySignInOptions({ email = null } = {}) {
  const options = await passkeys.requestOptions();
  return {
    challenge_token: challenge.issue("passkey_sign_in", { challenge: options.challenge, email: email || null }),
    options,
  };
}

/**
 * Check a passkey's answer for signing in. Who it is comes from the stored passkey
 * the answer names, and only once its signature checks out. Writes nothing.
 * @returns {Promise<{userId: string, passkey: object, claims: object, signCount: number}>}
 */
async function checkPasskeySignIn({ challenge_token, credential }) {
  const claims = challenge.read(challenge_token, "passkey_sign_in");
  const id = passkeys.credentialIdOf(credential);
  const stored = id ? await repo.passkeyByCredential(pool, id) : null;
  if (!stored)
    throw new AppError("PASSKEY_UNKNOWN", "This passkey is not on any account here. Use your password.", 401);
  if (claims.email && String(stored.email).toLowerCase() !== String(claims.email).toLowerCase())
    throw new AppError("PASSKEY_NOT_YOURS", "That passkey belongs to someone else.", 401);
  const signCount = await passkeys.checkAssertion({ credential, challenge: claims.challenge, stored, status: 401 });
  return { userId: stored.user_id, passkey: stored, claims, signCount };
}

/** Inside the transaction that opens the session: spend the ticket, keep the counter. */
async function spendPasskey(client, found) {
  await challenge.spend(client, found.claims, found.userId);
  await repo.usePasskey(client, found.passkey.passkey_id, found.signCount);
}

module.exports = {
  TRUST_DAYS,
  twoStepOf,
  codeRequired,
  readCodeTicket,
  checkSecondStep,
  spendSecondStep,
  codeRefused,
  verifyPin,
  pinUsed,
  passkeySignInOptions,
  checkPasskeySignIn,
  spendPasskey,
};
