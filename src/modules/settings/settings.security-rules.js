"use strict";
/**
 * The security rules in force: session length, the idle lock and the password
 * minimum (docs/guides/foundation.md §6.4).
 *
 * Each is a setting row (`security.<rule>`, a whole number) changed on Settings ·
 * Security, and each has a floor in the server's .env: SESSION_MAX_AGE_MIN,
 * SESSION_INACTIVITY_MIN and PASSWORD_MIN_LENGTH. A setting may make a rule
 * stricter than its floor, never looser: a session no longer, an idle lock no
 * later, a password minimum no shorter. A stored value the floor has since moved
 * past gives way to the floor, so tightening .env always wins. Requiring two-step
 * by role is a column on the role (access), not a rule here.
 *
 *   await rules.load(pool);        // at the start of the work that applies them
 *   rules.current().idle_lock_min  // then, synchronously, wherever the policy is read
 *
 * Read by identity (session-policy, password-policy) on every sign-in and refresh,
 * so it is cached for 30 seconds per process; a change on Settings replaces the
 * cache of the process that made it at once. With nothing stored, or no table to
 * read (a fresh database, a unit test), the floors are the rules.
 *
 * Requires nothing from identity or security: they require this.
 */
const { config } = require("../../config/env");
const { logger } = require("../../config/logger");

const KEYS = Object.freeze({
  session_max_age_min: "security.session_max_age_min",
  idle_lock_min: "security.idle_lock_min",
  password_min_length: "security.password_min_length",
});
const RULES = Object.freeze(Object.keys(KEYS));

const CACHE_MS = 30_000;

/** The .env floors, read when asked so a test can change config. */
function floors() {
  return {
    session_max_age_min: Number(config.SESSION_MAX_AGE_MIN),
    idle_lock_min: Number(config.SESSION_INACTIVITY_MIN),
    password_min_length: Number(config.PASSWORD_MIN_LENGTH),
  };
}

const whole = (v) => (Number.isInteger(v) && v > 0 ? v : null);

/**
 * The rules in force for what is stored. Pure.
 * @param {{session_max_age_min?: number, idle_lock_min?: number, password_min_length?: number}} saved
 * @param {ReturnType<typeof floors>} [f]
 */
function effective(saved = {}, f = floors()) {
  const session = Math.min(whole(saved.session_max_age_min) || f.session_max_age_min, f.session_max_age_min);
  const idle = Math.min(whole(saved.idle_lock_min) || f.idle_lock_min, f.idle_lock_min, session);
  const password = Math.max(whole(saved.password_min_length) || f.password_min_length, f.password_min_length);
  return { session_max_age_min: session, idle_lock_min: idle, password_min_length: password };
}

/**
 * Why a change would loosen a rule past its floor, or break another rule, as field
 * marks naming the floor; an empty object when it may be saved.
 * @param {object} patch  the rules being changed (SecurityPolicyPatch)
 * @param {object} now    the rules in force
 * @param {ReturnType<typeof floors>} [f]
 * @returns {Record<string, string[]>}
 */
function problems(patch, now, f = floors()) {
  const out = {};
  const next = { ...now, ...patch };
  if (patch.session_max_age_min !== undefined && patch.session_max_age_min > f.session_max_age_min)
    out.session_max_age_min = [`At most ${f.session_max_age_min} minutes`];
  if (patch.idle_lock_min !== undefined && patch.idle_lock_min > f.idle_lock_min)
    out.idle_lock_min = [`At most ${f.idle_lock_min} minutes`];
  else if (
    (patch.idle_lock_min !== undefined || patch.session_max_age_min !== undefined) &&
    next.idle_lock_min > next.session_max_age_min &&
    !out.session_max_age_min
  )
    out.idle_lock_min = ["Within the session length"];
  if (patch.password_min_length !== undefined && patch.password_min_length < f.password_min_length)
    out.password_min_length = [`At least ${f.password_min_length}`];
  return out;
}

let cache = { at: 0, rules: null };

/** The rules last loaded in this process, or the floors when none were. */
function current() {
  return cache.rules || effective({});
}

/** Stored values, by rule name. */
async function stored(db) {
  const { rows } = await db.query("SELECT key, value FROM setting WHERE key = ANY($1::text[])", [
    Object.values(KEYS),
  ]);
  const out = {};
  for (const r of rows) {
    const rule = RULES.find((k) => KEYS[k] === r.key);
    if (rule) out[rule] = typeof r.value === "number" ? r.value : Number(r.value);
  }
  return out;
}

/**
 * The rules in force, from the database at most every 30 seconds.
 * @param {{query: Function}} db
 */
async function load(db, { now = Date.now() } = {}) {
  if (cache.rules && now - cache.at < CACHE_MS) return cache.rules;
  try {
    cache = { at: now, rules: effective(await stored(db)) };
  } catch (err) {
    // The floors stand in: they are the loosest the rules can ever be, never looser.
    logger.warn({ err }, "security rules could not be read; the .env floors apply");
    return current();
  }
  return cache.rules;
}

/** After a change in this process: the new rules apply to the next request. */
function remember(storedValues) {
  cache = { at: Date.now(), rules: effective(storedValues) };
  return cache.rules;
}

/** Tests: forget what was loaded. */
function reset() {
  cache = { at: 0, rules: null };
}

module.exports = { KEYS, RULES, floors, effective, problems, current, stored, load, remember, reset };
