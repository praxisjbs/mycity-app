"use strict";
/**
 * The environment's VAPID key pair: who this server is to the push services that carry
 * its web pushes (RFC 8292). Each environment has its own pair (TB, 19/10/2026), read
 * through Settings · Integrations (shared/integrations/settings.js, connection `web_push`;
 * docs/guides/integrations.md §6.1, §6.6), in this order:
 *
 *   1. the pair kept in integration_secret (provider `web_push`, key `vapid`), encrypted
 *      with ENCRYPTION_KEY: made here the first time a browser asked, or by Replace Keys;
 *   2. VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY from .env, when both are set;
 *   3. a new pair, made once and stored. Two processes starting together may both make
 *      one: ON CONFLICT DO NOTHING keeps the first, and both read that one back. A stored
 *      pair that no longer decrypts (ENCRYPTION_KEY changed) is replaced the same way.
 *
 * The subject (who push services contact) is the one saved on Settings · Integrations,
 * else VAPID_SUBJECT.
 *
 * `keyId` is a short hash of the public key. A browser subscribed under another key is
 * refused by its push service (401 or 403), so the app compares ids and subscribes again
 * (PushConfig.key_id). Replace Keys stores a new pair and bumps the settings' version, so
 * the API and the worker use it within a second, with no restart.
 */
const crypto = require("node:crypto");
const webpush = require("web-push");
const { pool: defaultPool } = require("../../config/db");
const { logger } = require("../../config/logger");
const encryption = require("../secrets/encryption.service");
const integrations = require("../../shared/integrations/settings");
const providers = require("../../shared/integrations/providers");

const PROVIDER = "web_push";
const KEY = "vapid";

/** The first 12 characters of the base64url SHA-256 of a public key. */
function keyIdOf(publicKey) {
  return crypto.createHash("sha256").update(String(publicKey)).digest("base64url").slice(0, 12);
}

/** A new pair. */
const generate = () => webpush.generateVAPIDKeys();

/**
 * Keep a pair. `replace` overwrites the stored one (Replace Keys, an unreadable pair);
 * otherwise a pair already there wins (two processes starting together).
 * @param {{query: Function}} db
 * @param {{publicKey: string, privateKey: string}} pair
 * @param {{replace?: boolean, by?: string|null}} [opts]
 * @returns {Promise<boolean>} whether this pair was written
 */
async function store(db, pair, { replace = false, by = null } = {}) {
  const ciphertext = encryption.encrypt(JSON.stringify(pair), { aad: providers.aadOf(PROVIDER, KEY) });
  const hint = keyIdOf(pair.publicKey);
  const { rowCount } = await db.query(
    `INSERT INTO integration_secret (provider, key, ciphertext, hint, set_by, created_by)
     VALUES ($1, $2, $3, $4, $5, $5)
     ON CONFLICT (provider, key) DO ${
       replace
         ? "UPDATE SET ciphertext = EXCLUDED.ciphertext, hint = EXCLUDED.hint, set_by = EXCLUDED.set_by, active = true, rotated_at = now()"
         : "NOTHING"
     }`,
    [PROVIDER, KEY, ciphertext, hint, by],
  );
  return rowCount > 0;
}

/**
 * The pair, its subject and id.
 * @param {{db?: import("pg").Pool}} [opts]
 * @returns {Promise<{publicKey: string, privateKey: string, subject: string, keyId: string, source: "env"|"database"}>}
 */
async function keys({ db = defaultPool } = {}) {
  let s = await integrations.of(PROVIDER, { db });
  if (!s || !s.secrets[KEY]) {
    const fresh = generate();
    const unreadable = Boolean(s && s.unreadable.includes(KEY));
    if (await store(db, fresh, { replace: unreadable }))
      logger.info({ key_id: keyIdOf(fresh.publicKey), replaced_unreadable: unreadable }, "web push keys made for this environment");
    await integrations.bump();
    s = await integrations.of(PROVIDER, { db });
    if (!s || !s.secrets[KEY]) throw new Error("web push: the stored VAPID pair could not be read back");
  }
  const pair = JSON.parse(s.secrets[KEY]);
  return {
    publicKey: pair.publicKey,
    privateKey: pair.privateKey,
    subject: s.values.subject,
    keyId: keyIdOf(pair.publicKey),
    source: s.source === "saved" ? "database" : "env",
  };
}

/**
 * Settings · Integrations' test of a pair: sign the token a push service asks for. Throws
 * when the pair or the subject would be refused.
 * @param {{publicKey: string, privateKey: string}} pair
 * @param {string} subject
 */
async function sign(pair, subject) {
  return webpush.getVapidHeaders("https://fcm.googleapis.com", subject, pair.publicKey, pair.privateKey, "aes128gcm");
}

/** Tests only: forget what was read, so the next call reads the database again. */
function resetForTest() {
  integrations.forget();
}

module.exports = { keys, keyIdOf, generate, store, sign, PROVIDER, KEY, resetForTest };
