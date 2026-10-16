"use strict";
/**
 * Security's SQL (migration 0220): the two-step and PIN columns of app_user (identity
 * owns the rest of the row), the recovery codes, passkeys and spent challenges.
 *
 * Every function takes the client it runs on, so a caller inside atomically() keeps
 * the work in its transaction. Nothing here emits or decides; the service does.
 * The sets read whole here are a person's own: at most ten recovery codes and ten
 * passkeys, never a list a person pages through.
 */
const { pageQuery, TOTAL_COL } = require("../../shared/http/paged");

const one = async (db, sql, params) => (await db.query(sql, params)).rows[0] || null;

/* ------------------------------------------------------------------ *
 * One person's two-step and PIN
 * ------------------------------------------------------------------ */

/**
 * Everything the service needs about one login's ways in. `lock` holds the row for
 * the rest of the transaction.
 */
function stateOf(db, userId, { lock = false } = {}) {
  return one(
    db,
    `SELECT u.user_id, u.email::text AS email, u.status, u.mfa_secret_enc, u.mfa_enrolled_at,
            u.mfa_frequency, u.mfa_pending_secret_enc, (u.mfa_pending_until > now()) AS pending_live,
            u.mfa_last_step, u.pin_hash, u.pin_changed_at, u.pin_failed_count, u.pin_last_failed_at,
            u.pin_window_failures, e.date_of_birth,
            trim(e.first_name || ' ' || e.last_name) AS display_name,
            (SELECT count(*)::int FROM mfa_recovery_code r
              WHERE r.user_id = u.user_id AND r.used_at IS NULL) AS recovery_left,
            (SELECT count(*)::int FROM passkey p WHERE p.user_id = u.user_id) AS passkeys
       FROM app_user u JOIN employee e ON e.employee_id = u.employee_id
      WHERE u.user_id = $1
      ${lock ? "FOR UPDATE OF u" : ""}`,
    [userId],
  );
}

/** A key waiting for its first code, for `seconds`. */
function setPendingKey(db, userId, encrypted, seconds) {
  return db.query(
    `UPDATE app_user
        SET mfa_pending_secret_enc = $2, mfa_pending_until = now() + make_interval(secs => $3), updated_at = now()
      WHERE user_id = $1`,
    [userId, encrypted, seconds],
  );
}

/**
 * The pending key becomes the key, with the step its first code used. Only the key
 * that was checked, and only while it is still waiting. Returns whether it moved.
 */
async function turnOn(db, userId, { pendingEncrypted, step }) {
  const row = await one(
    db,
    `UPDATE app_user
        SET mfa_secret_enc = mfa_pending_secret_enc, mfa_pending_secret_enc = NULL,
            mfa_pending_until = NULL, mfa_enrolled_at = now(), mfa_last_step = $3, updated_at = now()
      WHERE user_id = $1 AND mfa_pending_secret_enc = $2 AND mfa_pending_until > now()
      RETURNING mfa_enrolled_at`,
    [userId, pendingEncrypted, step],
  );
  return Boolean(row);
}

/** No key, nothing waiting. Returns whether two-step was on. */
async function turnOff(db, userId) {
  const row = await one(
    db,
    `UPDATE app_user
        SET mfa_secret_enc = NULL, mfa_enrolled_at = NULL, mfa_pending_secret_enc = NULL,
            mfa_pending_until = NULL, mfa_last_step = NULL, updated_at = now()
      WHERE user_id = $1 AND mfa_enrolled_at IS NOT NULL
      RETURNING user_id`,
    [userId],
  );
  return Boolean(row);
}

/**
 * Keep the step a code was accepted at, only if it is later than the last one: the
 * same code, or an older one, presented again changes nothing. Returns whether it
 * was taken.
 */
async function takeStep(db, userId, step) {
  const row = await one(
    db,
    `UPDATE app_user SET mfa_last_step = $2, updated_at = now()
      WHERE user_id = $1 AND mfa_enrolled_at IS NOT NULL
        AND (mfa_last_step IS NULL OR mfa_last_step < $2)
      RETURNING user_id`,
    [userId, step],
  );
  return Boolean(row);
}

function setFrequency(db, userId, frequency) {
  return db.query(
    "UPDATE app_user SET mfa_frequency = $2, updated_at = now() WHERE user_id = $1",
    [userId, frequency],
  );
}

/* ------------------------------------------------------------------ *
 * Recovery codes
 * ------------------------------------------------------------------ */

/** A new set replaces the old one whole: a code from an earlier set never works again. */
async function replaceRecoveryCodes(db, userId, hashes) {
  await db.query("DELETE FROM mfa_recovery_code WHERE user_id = $1", [userId]);
  await db.query(
    `INSERT INTO mfa_recovery_code (user_id, code_hash)
     SELECT $1, h FROM unnest($2::text[]) AS h`,
    [userId, hashes],
  );
}

/** The unused codes, to check one typed against. */
async function liveRecoveryCodes(db, userId) {
  const { rows } = await db.query(
    `SELECT mfa_recovery_code_id, code_hash FROM mfa_recovery_code
      WHERE user_id = $1 AND used_at IS NULL
      ORDER BY created_at, mfa_recovery_code_id`,
    [userId],
  );
  return rows;
}

/** Spend one. Two requests racing on the same code: exactly one gets true. */
async function spendRecoveryCode(db, codeId) {
  const row = await one(
    db,
    `UPDATE mfa_recovery_code SET used_at = now(), updated_at = now()
      WHERE mfa_recovery_code_id = $1 AND used_at IS NULL
      RETURNING mfa_recovery_code_id`,
    [codeId],
  );
  return Boolean(row);
}

async function countRecoveryLeft(db, userId) {
  const row = await one(
    db,
    "SELECT count(*)::int AS n FROM mfa_recovery_code WHERE user_id = $1 AND used_at IS NULL",
    [userId],
  );
  return row ? row.n : 0;
}

function deleteRecoveryCodes(db, userId) {
  return db.query("DELETE FROM mfa_recovery_code WHERE user_id = $1", [userId]);
}

/* ------------------------------------------------------------------ *
 * The PIN
 * ------------------------------------------------------------------ */

/** Set or replace the PIN: a new PIN starts with no wrong tries against it. */
function setPin(db, userId, hash) {
  return one(
    db,
    `UPDATE app_user
        SET pin_hash = $2, pin_changed_at = now(), pin_failed_count = 0, pin_last_failed_at = NULL,
            pin_window_started_at = NULL, pin_window_failures = 0, updated_at = now()
      WHERE user_id = $1
      RETURNING pin_changed_at`,
    [userId, hash],
  );
}

/** No PIN. Returns whether there was one. */
async function clearPin(db, userId) {
  const row = await one(
    db,
    `UPDATE app_user
        SET pin_hash = NULL, pin_changed_at = NULL, pin_failed_count = 0, pin_last_failed_at = NULL,
            pin_window_started_at = NULL, pin_window_failures = 0, updated_at = now()
      WHERE user_id = $1 AND pin_hash IS NOT NULL
      RETURNING user_id`,
    [userId],
  );
  return Boolean(row);
}

/**
 * One more wrong PIN, counted in a row and in the rolling 30 days (a window older
 * than that starts again at this try). Returns both totals.
 */
async function pinFailure(db, userId) {
  const row = await one(
    db,
    `UPDATE app_user
        SET pin_failed_count = pin_failed_count + 1,
            pin_last_failed_at = now(),
            pin_window_failures = CASE
              WHEN pin_window_started_at IS NULL OR pin_window_started_at < now() - interval '30 days'
              THEN 1 ELSE pin_window_failures + 1 END,
            pin_window_started_at = CASE
              WHEN pin_window_started_at IS NULL OR pin_window_started_at < now() - interval '30 days'
              THEN now() ELSE pin_window_started_at END,
            updated_at = now()
      WHERE user_id = $1 AND pin_hash IS NOT NULL
      RETURNING pin_failed_count, pin_window_failures`,
    [userId],
  );
  return row || { pin_failed_count: 0, pin_window_failures: 0 };
}

/** The right PIN ends the run of wrong ones. The 30 days are not reset: that is their point. */
function pinSuccess(db, userId) {
  return db.query(
    `UPDATE app_user SET pin_failed_count = 0, pin_last_failed_at = NULL, updated_at = now()
      WHERE user_id = $1 AND pin_failed_count > 0`,
    [userId],
  );
}

/* ------------------------------------------------------------------ *
 * Passkeys
 * ------------------------------------------------------------------ */

/** A passkey as My Security lists it; $n is the asking session's device. */
const PASSKEY_ROW = (n) => `
  p.passkey_id, p.label, p.backed_up, p.created_at, p.last_used_at,
  COALESCE(p.known_device_id = $${n}::uuid, false) AS this_device`;

function insertPasskey(db, p) {
  return one(
    db,
    `INSERT INTO passkey
       (user_id, credential_id, public_key, sign_count, transports, backed_up, label, known_device_id)
     VALUES ($1, $2, $3, $4, $5::text[], $6, $7, $8)
     RETURNING passkey_id`,
    [p.userId, p.credentialId, p.publicKey, p.signCount, p.transports, p.backedUp, p.label, p.knownDeviceId || null],
  );
}

/** One of this person's passkeys, as listed. */
function passkeyOf(db, userId, passkeyId, knownDeviceId) {
  return one(
    db,
    `SELECT ${PASSKEY_ROW(3)} FROM passkey p WHERE p.passkey_id = $1 AND p.user_id = $2`,
    [passkeyId, userId, knownDeviceId || null],
  );
}

/** The person's passkeys, newest first. */
function listPasskeys(db, userId, query, knownDeviceId) {
  return pageQuery(
    db,
    `SELECT ${PASSKEY_ROW(2)}, ${TOTAL_COL}
       FROM passkey p
      WHERE p.user_id = $1
      ORDER BY p.created_at DESC, p.passkey_id`,
    [userId, knownDeviceId || null],
    query,
  );
}

/** A passkey by the id the browser names, with its login, to check an answer against. */
function passkeyByCredential(db, credentialId) {
  return one(
    db,
    `SELECT p.passkey_id, p.user_id, p.credential_id, p.public_key, p.sign_count::text AS sign_count,
            p.transports, p.label, u.email::text AS email, u.status
       FROM passkey p JOIN app_user u ON u.user_id = p.user_id
      WHERE p.credential_id = $1`,
    [credentialId],
  );
}

/** The ids and transports of this person's passkeys: to exclude when adding, to offer when confirming. */
async function credentialsOf(db, userId) {
  const { rows } = await db.query(
    "SELECT credential_id, transports FROM passkey WHERE user_id = $1 ORDER BY created_at, passkey_id",
    [userId],
  );
  return rows;
}

/** A passkey signed in: keep its counter, never lower, and when. */
function usePasskey(db, passkeyId, signCount) {
  return db.query(
    `UPDATE passkey SET sign_count = GREATEST(sign_count, $2::bigint), last_used_at = now(), updated_at = now()
      WHERE passkey_id = $1`,
    [passkeyId, signCount],
  );
}

/** Returns the label before and after, or null when it is not this person's. */
function renamePasskey(db, userId, passkeyId, label) {
  return one(
    db,
    `UPDATE passkey p SET label = $3, updated_at = now()
       FROM (SELECT passkey_id, label AS before FROM passkey WHERE passkey_id = $1 AND user_id = $2) old
      WHERE p.passkey_id = old.passkey_id
      RETURNING old.before, p.label`,
    [passkeyId, userId, label],
  );
}

/** Returns the label, or null when it is not this person's. */
function deletePasskey(db, userId, passkeyId) {
  return one(
    db,
    "DELETE FROM passkey WHERE passkey_id = $1 AND user_id = $2 RETURNING label",
    [passkeyId, userId],
  );
}

/* ------------------------------------------------------------------ *
 * Spent challenges
 * ------------------------------------------------------------------ */

/**
 * Record a ticket as used, clearing ones long expired. Returns false when it was
 * already recorded: a replay.
 */
async function spendChallenge(db, { hash, purpose, userId, expiresAt }) {
  await db.query("DELETE FROM spent_challenge WHERE expires_at < now() - interval '1 day'");
  const row = await one(
    db,
    `INSERT INTO spent_challenge (challenge_hash, purpose, user_id, expires_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (challenge_hash) DO NOTHING
     RETURNING spent_challenge_id`,
    [hash, purpose, userId, expiresAt],
  );
  return Boolean(row);
}

module.exports = {
  stateOf,
  setPendingKey,
  turnOn,
  turnOff,
  takeStep,
  setFrequency,
  replaceRecoveryCodes,
  liveRecoveryCodes,
  spendRecoveryCode,
  countRecoveryLeft,
  deleteRecoveryCodes,
  setPin,
  clearPin,
  pinFailure,
  pinSuccess,
  insertPasskey,
  passkeyOf,
  listPasskeys,
  passkeyByCredential,
  credentialsOf,
  usePasskey,
  renamePasskey,
  deletePasskey,
  spendChallenge,
};
