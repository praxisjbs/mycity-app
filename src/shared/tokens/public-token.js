"use strict";
/**
 * Links for people outside the staff app: a candidate's application, an
 * assessment, an offer to sign, an onboarding pack (M4, M5). The link carries
 * an opaque token; whoever holds it may do exactly one named thing for exactly
 * one record, until it expires.
 *
 *   const { token, expires_at } = await publicToken.issue(client, {
 *     scope: "offer.sign", subject_type: "offer", subject_id: offer.offer_id,
 *     ttl_hours: 168, single_use: true, created_by: actor.user_id,
 *   });
 *   // → https://go.mycityapp.io/offers/<token>
 *
 *   // on the public surface, middleware/public-token.js resolves it:
 *   req.public_token = { public_token_id, scope, subject_type, subject_id }
 *
 * Rules:
 *  - 32 random bytes, base64url: 256 bits, unguessable, nothing about the record
 *    inside it (never a sequential number: a stranger with offer 41 must not be
 *    able to try 40 and 42).
 *  - Only the SHA-256 of the token is stored. A database leak or a backup in the
 *    wrong hands yields no working link.
 *  - Every token has an expiry; a single-use token is spent by consume() in the
 *    same transaction as the action it authorised, so a double submit cannot use
 *    it twice. revoke() ends one early (offer withdrawn, candidate rejected).
 *  - A token that is unknown, expired, revoked, spent, or for another scope all
 *    look the same from outside: null here, 404 at the edge.
 *
 * Table (migration 0090): public_token (public_token_id, token_hash UNIQUE, scope,
 * subject_type, subject_id, single_use, expires_at, used_at, revoked_at,
 * created_by, created_at)
 */
const crypto = require("node:crypto");

const TOKEN_BYTES = 32;
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const SCOPE_RE = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;
const MAX_TTL_HOURS = 24 * 90;

const hash = (token) => crypto.createHash("sha256").update(token, "utf8").digest("hex");

/** True for something shaped like a token (cheap check before touching the database). */
const looksLikeToken = (t) => typeof t === "string" && TOKEN_RE.test(t);

/**
 * @param {import("pg").PoolClient} client
 * @param {{scope: string, subject_type: string, subject_id: string, ttl_hours: number,
 *          single_use?: boolean, created_by?: string|null}} p
 * @returns {Promise<{token: string, public_token_id: string, expires_at: Date}>}  the token is shown once, never stored
 */
async function issue(client, { scope, subject_type, subject_id, ttl_hours, single_use = false, created_by = null }) {
  if (!SCOPE_RE.test(scope || "")) throw new Error(`public token: scope is "<thing>.<action>", got ${JSON.stringify(scope)}`);
  if (!Number.isInteger(ttl_hours) || ttl_hours < 1 || ttl_hours > MAX_TTL_HOURS) {
    throw new Error(`public token: ttl_hours must be 1 to ${MAX_TTL_HOURS}`);
  }
  if (!subject_type || !subject_id) throw new Error("public token: name the record it opens");
  const token = crypto.randomBytes(TOKEN_BYTES).toString("base64url");
  const { rows } = await client.query(
    `INSERT INTO public_token (token_hash, scope, subject_type, subject_id, single_use, expires_at, created_by, created_at)
     VALUES ($1, $2, $3, $4, $5, now() + make_interval(hours => $6), $7, now())
     RETURNING public_token_id, expires_at`,
    [hash(token), scope, subject_type, subject_id, single_use, ttl_hours, created_by],
  );
  return { token, public_token_id: rows[0].public_token_id, expires_at: rows[0].expires_at };
}

/**
 * The live token for this scope, or null. `forUpdate` locks the row so a
 * single-use token can be checked and consumed in one transaction.
 * @returns {Promise<{public_token_id: string, scope: string, subject_type: string, subject_id: string, single_use: boolean, expires_at: Date}|null>}
 */
async function resolve(client, token, { scope, forUpdate = false } = {}) {
  if (!looksLikeToken(token) || !SCOPE_RE.test(scope || "")) return null;
  const { rows } = await client.query(
    `SELECT public_token_id, scope, subject_type, subject_id, single_use, expires_at
       FROM public_token
      WHERE token_hash = $1 AND scope = $2
        AND revoked_at IS NULL AND expires_at > now()
        AND NOT (single_use AND used_at IS NOT NULL)${forUpdate ? "\n      FOR UPDATE" : ""}`,
    [hash(token), scope],
  );
  return rows[0] || null;
}

/** Spend a single-use token. True when this call spent it; false when it was already spent. */
async function consume(client, publicTokenId) {
  const { rowCount } = await client.query(
    "UPDATE public_token SET used_at = now() WHERE public_token_id = $1 AND used_at IS NULL",
    [publicTokenId],
  );
  return rowCount === 1;
}

/** End every live token for a record (and scope, when given). Returns how many. */
async function revokeFor(client, { subject_type, subject_id, scope = null }) {
  const { rowCount } = await client.query(
    `UPDATE public_token SET revoked_at = now()
      WHERE subject_type = $1 AND subject_id = $2 AND revoked_at IS NULL
        AND ($3::text IS NULL OR scope = $3)`,
    [subject_type, subject_id, scope],
  );
  return rowCount;
}

module.exports = { issue, resolve, consume, revokeFor, looksLikeToken, hash, MAX_TTL_HOURS };
