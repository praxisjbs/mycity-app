"use strict";
/**
 * The settings of each connection on Settings · Integrations, as the code uses them
 * (docs/guides/integrations.md §3 step 2, §6.1, §6.7). The one reader: system mail, the
 * mailbox, Geoapify, the AI and web push ask here, and never read the server file for
 * these values themselves.
 *
 *   const mail = await settings.of("mail_sender");
 *   //  { code, source: "saved" | "file", values: { host, port, ... },
 *   //    secrets: { password }, unreadable: [], saved_at, paused_at, integration_connection_id }
 *   //  or null: nothing is saved here and the server file has nothing (not set up)
 *   const key = await settings.secret("geoapify", "api_key");      // a string, or null
 *
 * Rules:
 *  - Whole, never mixed: the saved connection, else the server file, else null. No field
 *    is taken from one and its neighbour from the other.
 *  - A saved secret that will not decrypt (ENCRYPTION_KEY changed) is null and named in
 *    `unreadable`. The file is not used instead: a saved connection that quietly stopped
 *    being used would hide the fault.
 *  - Web push is read in parts, because its key pair is made by the app, never typed: the
 *    pair stored here (made here or by Replace Keys), else the file's; the subject saved
 *    here, else the file's.
 *  - Cached per process. Each read compares the version kept in Redis, read at most once a
 *    second; a save, a removal and Replace Keys call bump() after their commit, so the API
 *    and the worker reload within a second. Without Redis an answer is kept 30 seconds.
 *  - `paused_at`: when system mail was paused on the System Sender (guide §6.15), whatever the
 *    values come from; null when it is not. Pause and Resume bump the version like a save.
 *  - Before migration 9200 runs (a test database, a deploy mid-way) the saved settings
 *    read as none and the file applies.
 */
const { config } = require("../../config/env");
const { tryClient, rkey } = require("../../config/redis");
const encryption = require("../../services/secrets/encryption.service");
const providers = require("./providers");

/** How long an answer is kept when Redis cannot say whether it changed. */
const TTL_MS = 30_000;
/** How long the version read from Redis is trusted, so a burst of reads costs one GET. */
const VERSION_MS = 1000;

const versionKey = () => rkey("integrations", "version");

let memo = { at: 0, value: null };
const cache = new Map();

const pool = () => require("../../config/db").pool;

/** The version in Redis ("0" before any save), or null without Redis. */
async function version() {
  if (Date.now() - memo.at < VERSION_MS) return memo.value;
  const redis = tryClient();
  let value = null;
  if (redis) {
    try {
      value = (await redis.get(versionKey())) || "0";
    } catch {
      value = null;
    }
  }
  memo = { at: Date.now(), value };
  return value;
}

/** Undefined table or column: 9200 has not run here yet. */
const notMigrated = (err) => err && (err.code === "42P01" || err.code === "42703");

async function rowOf(db, code) {
  try {
    const { rows } = await db.query(
      `SELECT integration_connection_id, configuration, saved_at, paused_at
         FROM integration_connection WHERE code = $1`,
      [code],
    );
    return rows[0] || null;
  } catch (err) {
    if (notMigrated(err)) return null;
    throw err;
  }
}

/** The connection's stored secrets, decrypted: { key: value }, and the keys that would not decrypt. */
async function storedSecrets(db, def) {
  let rows;
  try {
    ({ rows } = await db.query(
      `SELECT key, ciphertext FROM integration_secret
        WHERE provider = $1 AND active AND ciphertext <> ''`,
      [def.code],
    ));
  } catch (err) {
    if (notMigrated(err)) return { secrets: {}, unreadable: [] };
    throw err;
  }
  const secrets = {};
  const unreadable = [];
  for (const r of rows) {
    if (!def.secrets.some((s) => s.key === r.key)) continue;
    try {
      secrets[r.key] = encryption.decrypt(r.ciphertext, { aad: providers.aadOf(def.code, r.key) });
    } catch {
      secrets[r.key] = null;
      unreadable.push(r.key);
    }
  }
  return { secrets, unreadable };
}

async function load(def, db) {
  const row = await rowOf(db, def.code);
  const savedAt = row && row.saved_at ? new Date(row.saved_at).toISOString() : null;
  const pausedAt = row && row.paused_at ? new Date(row.paused_at).toISOString() : null;
  const id = row ? row.integration_connection_id : null;
  const file = def.fromFile(config);

  if (def.keptHere.length) {
    // Read in parts (web push): each secret kept here, else the file's; values likewise.
    const kept = await storedSecrets(db, def);
    const secrets = {};
    for (const s of def.secrets) {
      if (s.key in kept.secrets) secrets[s.key] = kept.secrets[s.key];
      else secrets[s.key] = file ? (file.secrets[s.key] ?? null) : null;
    }
    const values = savedAt ? def.fromSaved(row.configuration || {}) : file ? file.values : {};
    const storedHere = def.keptHere.some((k) => k in kept.secrets);
    return {
      code: def.code,
      source: savedAt || storedHere ? "saved" : "file",
      values,
      secrets,
      unreadable: kept.unreadable,
      saved_at: savedAt,
      paused_at: pausedAt,
      integration_connection_id: id,
    };
  }

  if (savedAt) {
    const { secrets, unreadable } = await storedSecrets(db, def);
    for (const s of def.secrets) if (!(s.key in secrets)) secrets[s.key] = null;
    return {
      code: def.code,
      source: "saved",
      values: def.fromSaved(row.configuration || {}),
      secrets,
      unreadable,
      saved_at: savedAt,
      paused_at: pausedAt,
      integration_connection_id: id,
    };
  }

  if (!file) return null;
  return {
    code: def.code,
    source: "file",
    values: file.values,
    secrets: { ...file.secrets },
    unreadable: [],
    saved_at: null,
    paused_at: pausedAt,
    integration_connection_id: id,
  };
}

/**
 * The settings in use for one connection, or null when it is not set up.
 * @param {string} code
 * @param {{db?: {query: Function}}} [opts]
 */
async function of(code, { db } = {}) {
  const def = providers.get(code);
  const v = await version();
  const hit = cache.get(code);
  if (hit && (v === null ? Date.now() - hit.at < TTL_MS : hit.version === v)) return hit.value;
  const value = await load(def, db || pool());
  cache.set(code, { at: Date.now(), version: v, value });
  return value;
}

/** One secret of the settings in use, or null. */
async function secret(code, key, opts) {
  const s = await of(code, opts);
  return s ? s.secrets[key] ?? null : null;
}

/**
 * After a save, a removal or Replace Keys commits: this process forgets at once, and every
 * other process at its next read (the version moves in Redis).
 */
async function bump() {
  cache.clear();
  memo = { at: 0, value: null };
  const redis = tryClient();
  if (!redis) return;
  try {
    await redis.incr(versionKey());
  } catch {
    /* without Redis the other process reloads within TTL_MS */
  }
}

/** Tests: forget every answer. */
function forget() {
  cache.clear();
  memo = { at: 0, value: null };
}

module.exports = { of, secret, bump, forget, version, TTL_MS };
