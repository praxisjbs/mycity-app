"use strict";
/**
 * Security: a person's own ways to sign in besides the password, as My Security
 * changes them, and an administrator's reset of someone's two-step sign-in
 * (docs/guides/identity.md §3, §6).
 *
 * Adding or removing any of them needs a fresh sign-in: the window after signing in
 * (CREDENTIAL_ENROL_WINDOW_MIN), or after confirming with the password, a passkey or
 * the PIN (confirm()). Past it the answer is 403 REAUTH_REQUIRED; the screen asks the
 * person to confirm, then tries again. 403 rather than 401, because the app reads a
 * 401 on a signed-in route as an expired session.
 *
 * Writes run in one transaction with emit(). Argon2, a passkey's signature and the QR
 * image run outside it. Every change tells the person (security.events.js).
 */
const argon2 = require("argon2");
const c = require("@mycity/contract");
const { pool } = require("../../config/db");
const { atomically } = require("../../shared/db/tx");
const { emit } = require("../../shared/events/emit");
const { AppError } = require("../../shared/errors");
const encryption = require("../../services/secrets/encryption.service");
const qr = require("../../services/qr/qr");
const identity = require("../identity/identity.service");
const { deviceLabel } = require("../identity/identity.device-label");
const challenge = require("./security.challenge");
const mfa = require("./security.mfa");
const passkeys = require("./security.passkeys");
const signin = require("./security.signin");
const repo = require("./security.repo");
const { EVENTS } = require("./security.events");

const ARGON = Object.freeze({ type: argon2.argon2id });
/** How long a new key waits for its first code. */
const SETUP_SECONDS = 15 * 60;
/** One passkey per device, and room for a replacement. */
const MAX_PASSKEYS = 10;

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
const iso = (d) => (d ? new Date(d).toISOString() : null);

const notFound = () => new AppError("NOT_FOUND", "Not found", 404);
const twoStepOff = () => new AppError("TWO_STEP_OFF", "Two-step sign-in is not on.", 422);
const expiredSetup = () =>
  new AppError("SETUP_EXPIRED", "The set-up has expired. Start again.", 422, { code: ["Set-up expired"] });

/* ------------------------------------------------------------------ *
 * The window, and the person's own view
 * ------------------------------------------------------------------ */

/** Refuse unless the session signed in, or confirmed it is them, within the window. */
async function assertFresh(db, actor) {
  if ((await identity.confirmedFor(db, actor)) <= 0)
    throw new AppError("REAUTH_REQUIRED", "Confirm it is you to continue.", 403);
}

async function stateOf(db, userId, opts) {
  const s = await repo.stateOf(db, userId, opts);
  if (!s) throw notFound();
  return s;
}

/** GET /security: My Security's view of two-step, passkeys and the PIN. */
async function methods(actor) {
  const s = await stateOf(pool, actor.user_id);
  return {
    two_step: {
      on: Boolean(s.mfa_enrolled_at),
      mfa_frequency: s.mfa_frequency,
      mfa_enrolled_at: iso(s.mfa_enrolled_at),
      recovery_codes_left: s.mfa_enrolled_at ? s.recovery_left : 0,
    },
    passkeys: s.passkeys,
    pin: { on: Boolean(s.pin_hash), pin_changed_at: iso(s.pin_changed_at) },
    confirmed_for: await identity.confirmedFor(pool, actor),
  };
}

/* ------------------------------------------------------------------ *
 * Two-step sign-in
 * ------------------------------------------------------------------ */

/**
 * POST /security/two-step/setup: a new key, waiting for its first code. Sign-in is
 * unchanged until a code proves it, so a mistyped set-up never locks anyone out;
 * when two-step is already on, the old app keeps working until the new one is proved.
 */
async function setUpTwoStep(actor) {
  await assertFresh(pool, actor);
  const s = await stateOf(pool, actor.user_id);
  const key = mfa.newKey();
  await tx(async (client) => {
    await repo.setPendingKey(client, actor.user_id, encryption.encrypt(key), SETUP_SECONDS);
    await emit(client, {
      key: EVENTS.AUTH_TWO_STEP_STARTED,
      entity: account(actor.user_id),
      actor,
      payload: { replacing: Boolean(s.mfa_enrolled_at) },
    });
  });
  const url = mfa.otpauthUrl(s.email, key);
  return {
    secret: mfa.groupKey(key),
    otpauth_url: url,
    qr_code: await qr.authenticator(url),
    expires_in: SETUP_SECONDS,
  };
}

/**
 * POST /security/two-step: the first code from the app proves the new key. Two-step
 * is on (or moves to the new app), ten recovery codes are made and shown this once,
 * and every browser asks for a code at its next sign-in.
 */
async function turnOnTwoStep(actor, { code }) {
  const s = await stateOf(pool, actor.user_id);
  if (!s.mfa_pending_secret_enc || !s.pending_live) throw expiredSetup();
  const r = mfa.checkCode(encryption.decrypt(s.mfa_pending_secret_enc), code, null);
  if (!r.ok) throw new AppError("INVALID_CODE", "That code is not right.", 422, { code: ["Not the right code"] });
  const { codes, hashes } = await mfa.newRecoveryCodes();
  await tx(async (client) => {
    if (!(await repo.turnOn(client, actor.user_id, { pendingEncrypted: s.mfa_pending_secret_enc, step: r.step })))
      throw expiredSetup();
    await repo.replaceRecoveryCodes(client, actor.user_id, hashes);
    await identity.clearDeviceTrust(client, actor.user_id);
    await emit(client, {
      key: s.mfa_enrolled_at ? EVENTS.AUTH_TWO_STEP_CHANGED : EVENTS.AUTH_TWO_STEP_ON,
      entity: account(actor.user_id),
      actor,
      payload: { mfa_frequency: s.mfa_frequency },
    });
  });
  return { recovery_codes: codes };
}

/** POST /security/two-step/off: no code any more; the recovery codes and every browser's window go. */
async function turnOffTwoStep(actor) {
  await tx(async (client) => {
    await assertFresh(client, actor);
    if (!(await repo.turnOff(client, actor.user_id))) throw twoStepOff();
    await repo.deleteRecoveryCodes(client, actor.user_id);
    await identity.clearDeviceTrust(client, actor.user_id);
    await emit(client, { key: EVENTS.AUTH_TWO_STEP_OFF, entity: account(actor.user_id), actor });
  });
  return methods(actor);
}

/** POST /security/two-step/recovery-codes: a new set, shown once; the old set stops working. */
async function renewRecoveryCodes(actor) {
  await assertFresh(pool, actor);
  const { codes, hashes } = await mfa.newRecoveryCodes();
  await tx(async (client) => {
    const s = await stateOf(client, actor.user_id, { lock: true });
    if (!s.mfa_enrolled_at) throw twoStepOff();
    await repo.replaceRecoveryCodes(client, actor.user_id, hashes);
    await emit(client, { key: EVENTS.AUTH_RECOVERY_CODES_RENEWED, entity: account(actor.user_id), actor });
  });
  return { recovery_codes: codes };
}

/**
 * POST /security/two-step/frequency: how often a device is asked. Every window a
 * device earned goes, in either direction: the next sign-in asks once, then the new
 * rule runs, so a looser rule never stretches a window earned under a tighter one.
 */
async function setFrequency(actor, { mfa_frequency }) {
  await tx(async (client) => {
    await assertFresh(client, actor);
    const s = await stateOf(client, actor.user_id, { lock: true });
    if (!s.mfa_enrolled_at) throw twoStepOff();
    if (s.mfa_frequency === mfa_frequency) return;
    await repo.setFrequency(client, actor.user_id, mfa_frequency);
    await identity.clearDeviceTrust(client, actor.user_id);
    await emit(client, {
      key: EVENTS.AUTH_TWO_STEP_FREQUENCY_SET,
      entity: account(actor.user_id),
      actor,
      before: { frequency: s.mfa_frequency },
      after: { frequency: mfa_frequency },
      payload: { mfa_frequency },
    });
  });
  return methods(actor);
}

/* ------------------------------------------------------------------ *
 * Passkeys
 * ------------------------------------------------------------------ */

/** GET /security/passkeys */
async function listPasskeys(actor, query) {
  return repo.listPasskeys(pool, actor.user_id, query, await identity.sessionDevice(pool, actor));
}

/** POST /security/passkeys/options: what the browser needs to make a passkey for this person. */
async function passkeyOptions(actor) {
  await assertFresh(pool, actor);
  const s = await stateOf(pool, actor.user_id);
  if (s.passkeys >= MAX_PASSKEYS)
    throw new AppError("PASSKEY_LIMIT", `You have ${MAX_PASSKEYS} passkeys. Remove one first.`, 422);
  const options = await passkeys.creationOptions({
    userId: actor.user_id,
    email: s.email,
    displayName: s.display_name,
    exclude: await repo.credentialsOf(pool, actor.user_id),
  });
  return {
    challenge_token: challenge.issue("passkey_add", { sub: actor.user_id, challenge: options.challenge }),
    options,
  };
}

/** POST /security/passkeys: the browser's answer. The passkey signs in from now on. */
async function addPasskey(actor, { challenge_token, credential, label }, { userAgent }) {
  const claims = challenge.read(challenge_token, "passkey_add");
  if (claims.sub !== actor.user_id)
    throw new AppError("CHALLENGE_EXPIRED", "This request has expired. Start again.", 400);
  const made = await passkeys.checkCreation({ credential, challenge: claims.challenge });
  const name = (label && label.trim()) || deviceLabel(userAgent);
  const deviceId = await identity.sessionDevice(pool, actor);
  const passkeyId = await tx(async (client) => {
    await challenge.spend(client, claims, actor.user_id);
    if (await repo.passkeyByCredential(client, made.credentialId))
      throw new AppError("PASSKEY_TAKEN", "This passkey is already added.", 409);
    const row = await repo.insertPasskey(client, {
      userId: actor.user_id,
      ...made,
      label: name,
      knownDeviceId: deviceId,
    });
    await emit(client, {
      key: EVENTS.AUTH_PASSKEY_ADDED,
      entity: account(actor.user_id),
      actor,
      payload: { passkey_id: row.passkey_id, label: name },
    });
    return row.passkey_id;
  });
  return repo.passkeyOf(pool, actor.user_id, passkeyId, deviceId);
}

/** POST /security/passkeys/:id/rename: its name changes, not what it can do. */
async function renamePasskey(actor, passkeyId, { label }) {
  await tx(async (client) => {
    const r = await repo.renamePasskey(client, actor.user_id, passkeyId, label);
    if (!r) throw notFound();
    await emit(client, {
      key: EVENTS.AUTH_PASSKEY_RENAMED,
      entity: account(actor.user_id),
      actor,
      before: { label: r.before },
      after: { label: r.label },
      payload: { passkey_id: passkeyId },
    });
  });
  return repo.passkeyOf(pool, actor.user_id, passkeyId, await identity.sessionDevice(pool, actor));
}

/** POST /security/passkeys/:id/remove: it no longer signs in, on any device. */
async function removePasskey(actor, passkeyId) {
  await tx(async (client) => {
    await assertFresh(client, actor);
    const r = await repo.deletePasskey(client, actor.user_id, passkeyId);
    if (!r) throw notFound();
    await emit(client, {
      key: EVENTS.AUTH_PASSKEY_REMOVED,
      entity: account(actor.user_id),
      actor,
      payload: { passkey_id: passkeyId, label: r.label },
    });
  });
  return methods(actor);
}

/* ------------------------------------------------------------------ *
 * The PIN
 * ------------------------------------------------------------------ */

/**
 * POST /security/pin: set or change. The contract refuses the shapes people reach for
 * first; this adds their birthday, which only the server knows.
 */
async function setPin(actor, { pin }) {
  const s = await stateOf(pool, actor.user_id);
  const weak = c.security.weakPinReason(pin, { birthDate: s.date_of_birth });
  if (weak) throw new AppError("WEAK_PIN", weak, 422, { pin: [weak] });
  await assertFresh(pool, actor);
  const hash = await argon2.hash(String(pin), ARGON);
  await tx(async (client) => {
    const had = Boolean((await stateOf(client, actor.user_id, { lock: true })).pin_hash);
    await repo.setPin(client, actor.user_id, hash);
    await emit(client, {
      key: had ? EVENTS.AUTH_PIN_CHANGED : EVENTS.AUTH_PIN_SET,
      entity: account(actor.user_id),
      actor,
    });
  });
  return methods(actor);
}

/** POST /security/pin/remove */
async function removePin(actor) {
  await tx(async (client) => {
    await assertFresh(client, actor);
    if (!(await repo.clearPin(client, actor.user_id)))
      throw new AppError("PIN_OFF", "No PIN is set.", 422);
    await emit(client, { key: EVENTS.AUTH_PIN_REMOVED, entity: account(actor.user_id), actor });
  });
  return methods(actor);
}

/* ------------------------------------------------------------------ *
 * Confirming it is you
 * ------------------------------------------------------------------ */

/** POST /security/confirm/options: a passkey request limited to this person's own passkeys. */
async function confirmOptions(actor) {
  const allow = await repo.credentialsOf(pool, actor.user_id);
  if (!allow.length)
    throw new AppError("NO_PASSKEY", "You have no passkey. Use your password or PIN.", 422);
  const options = await passkeys.requestOptions({ allow });
  return {
    challenge_token: challenge.issue("passkey_confirm", { sub: actor.user_id, challenge: options.challenge }),
    options,
  };
}

/**
 * POST /security/confirm: prove it is still you, with the password, the PIN or one
 * of your passkeys. The window opens again, so the change that asked can go ahead.
 */
async function confirm(actor, body) {
  let within = null;
  if (body.method === "password") {
    const user = await identity.findUserById(pool, actor.user_id);
    if (!user || !(await identity.verifyPassword(user.password_hash, body.password)))
      throw new AppError("INVALID_CURRENT_PASSWORD", "That is not your password.", 422, {
        password: ["Not your password"],
      });
  } else if (body.method === "pin") {
    const r = await signin.verifyPin(actor.user_id, body.pin, { actor, purpose: "confirm" });
    if (!r.ok)
      throw new AppError(
        r.code,
        r.message,
        r.code === "PIN_THROTTLED" ? 429 : 422,
        r.code === "INVALID_PIN" ? { pin: ["Not the right PIN"] } : null,
      );
    within = (client) => signin.pinUsed(client, actor.user_id);
  } else {
    const claims = challenge.read(body.challenge_token, "passkey_confirm");
    const id = passkeys.credentialIdOf(body.credential);
    const stored = id ? await repo.passkeyByCredential(pool, id) : null;
    if (claims.sub !== actor.user_id || !stored || stored.user_id !== actor.user_id)
      throw new AppError("PASSKEY_NOT_YOURS", "Use one of your own passkeys.", 422);
    const signCount = await passkeys.checkAssertion({
      credential: body.credential,
      challenge: claims.challenge,
      stored,
      status: 422,
    });
    within = async (client) => {
      await challenge.spend(client, claims, actor.user_id);
      await repo.usePasskey(client, stored.passkey_id, signCount);
    };
  }
  await tx(async (client) => {
    if (within) await within(client);
    await identity.markReauthenticated(client, actor);
    await emit(client, {
      key: EVENTS.AUTH_REAUTHENTICATED,
      entity: account(actor.user_id),
      actor,
      payload: { method: body.method },
    });
  });
  return { confirmed_for: await identity.confirmedFor(pool, actor) };
}

/* ------------------------------------------------------------------ *
 * Settings · Users
 * ------------------------------------------------------------------ */

/**
 * An administrator removes someone's authenticator: the path for a lost phone with no
 * recovery code left. Their key, recovery codes and every browser's window go, and
 * every session ends (the phone may be in someone else's hands). No new key is handed
 * out: the person sets two-step up again from My Security, so an administrator never
 * holds a working factor for anyone. Runs in the caller's transaction; returns the
 * session ids ended, to clear from the fast index after commit.
 */
async function resetTwoStep(client, userId, actor) {
  const s = await repo.stateOf(client, userId, { lock: true });
  if (!s) throw notFound();
  if (!s.mfa_enrolled_at)
    throw new AppError("TWO_STEP_OFF", "Two-step sign-in is not on for this login.", 422);
  await repo.turnOff(client, userId);
  await repo.deleteRecoveryCodes(client, userId);
  await identity.clearDeviceTrust(client, userId);
  const ended = await identity.endAllSessions(client, userId, actor);
  await emit(client, {
    key: EVENTS.AUTH_TWO_STEP_RESET,
    entity: account(userId),
    actor,
    payload: { sessions_ended: ended.length },
  });
  return ended;
}

module.exports = {
  assertFresh,
  methods,
  setUpTwoStep,
  turnOnTwoStep,
  turnOffTwoStep,
  renewRecoveryCodes,
  setFrequency,
  listPasskeys,
  passkeyOptions,
  addPasskey,
  renamePasskey,
  removePasskey,
  setPin,
  removePin,
  confirmOptions,
  confirm,
  resetTwoStep,
  SETUP_SECONDS,
  MAX_PASSKEYS,
};
