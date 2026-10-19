"use strict";
/**
 * The environment's VAPID key pair: who this server is to the push services that carry
 * its web pushes (RFC 8292). Each environment has its own pair (TB, 19/10/2026), taken in
 * this order:
 *
 *   1. VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY from .env, when both are set;
 *   2. the pair kept in integration_secret (provider `web_push`, key `vapid`), encrypted
 *      with ENCRYPTION_KEY;
 *   3. a new pair, made once and stored there. Two processes starting together may both
 *      make one: ON CONFLICT DO NOTHING keeps the first, and both read that one back.
 *
 * `keyId` is a short hash of the public key. A browser subscribed under another key is
 * refused by its push service (401 or 403), so the app compares ids and subscribes again
 * (PushConfig.key_id). Changing the pair is a restart of the API and the worker after the
 * .env change or after the stored row is deleted (docs/runbooks/push-notifications.md).
 */
const crypto = require("node:crypto");
const webpush = require("web-push");
const { config } = require("../../config/env");
const { pool: defaultPool } = require("../../config/db");
const { logger } = require("../../config/logger");
const encryption = require("../secrets/encryption.service");

const PROVIDER = "web_push";
const KEY = "vapid";

let cached = null;

/** The first 12 characters of the base64url SHA-256 of a public key. */
function keyIdOf(publicKey) {
  return crypto.createHash("sha256").update(String(publicKey)).digest("base64url").slice(0, 12);
}

async function readStored(db) {
  const { rows } = await db.query(
    "SELECT ciphertext FROM integration_secret WHERE provider = $1 AND key = $2 AND active",
    [PROVIDER, KEY],
  );
  if (!rows[0] || !rows[0].ciphertext) return null;
  const pair = JSON.parse(encryption.decrypt(rows[0].ciphertext));
  return pair && pair.publicKey && pair.privateKey ? pair : null;
}

async function storedPair(db) {
  const found = await readStored(db);
  if (found) return found;
  const fresh = webpush.generateVAPIDKeys();
  const { rowCount } = await db.query(
    `INSERT INTO integration_secret (provider, key, ciphertext)
     VALUES ($1, $2, $3)
     ON CONFLICT (provider, key) DO NOTHING`,
    [PROVIDER, KEY, encryption.encrypt(JSON.stringify(fresh))],
  );
  if (rowCount) logger.info({ key_id: keyIdOf(fresh.publicKey) }, "web push keys made for this environment");
  const kept = await readStored(db);
  if (!kept) throw new Error("web push: the stored VAPID pair could not be read back");
  return kept;
}

/**
 * The pair, its subject and id. Cached for the life of the process.
 * @param {{db?: import("pg").Pool}} [opts]
 * @returns {Promise<{publicKey: string, privateKey: string, subject: string, keyId: string, source: "env"|"database"}>}
 */
async function keys({ db = defaultPool } = {}) {
  if (cached) return cached;
  const fromEnv = Boolean(config.VAPID_PUBLIC_KEY && config.VAPID_PRIVATE_KEY);
  const pair = fromEnv
    ? { publicKey: config.VAPID_PUBLIC_KEY, privateKey: config.VAPID_PRIVATE_KEY }
    : await storedPair(db);
  cached = {
    publicKey: pair.publicKey,
    privateKey: pair.privateKey,
    subject: config.VAPID_SUBJECT,
    keyId: keyIdOf(pair.publicKey),
    source: fromEnv ? "env" : "database",
  };
  return cached;
}

/** Tests only: forget the cached pair. */
function resetForTest() {
  cached = null;
}

module.exports = { keys, keyIdOf, PROVIDER, KEY, resetForTest };
