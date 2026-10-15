"use strict";
/**
 * The same write, sent twice, happens once.
 *
 *   POST /api/v1/expenses
 *   Idempotency-Key: 6f1c2a0e-...        (the app sends one per Save press)
 *
 * A phone on a bad connection cannot tell "the request never left" from "it was
 * done and the answer was lost", so it retries. Without this, one press of Save
 * on an expense claim can file it twice.
 *
 * Four outcomes:
 *
 *   claimed           new key: this request owns it, runs, and its response is stored
 *   replayed    2xx   key done before for the SAME request: the stored response, no work
 *   in progress 409   key claimed and still running: refused, the client retries shortly
 *   reused      422   key done before for a DIFFERENT request: a bug or an attack, refused
 *
 * A request that ends 4xx or 5xx releases its key, so the user can fix the input
 * and save again. A response that is not JSON (a 204, a file) releases it too.
 * Every failure of this mechanism itself is logged and the request goes through
 * unprotected: it never blocks a write.
 *
 * The request hash includes the VERIFIED user id, so two people can never match
 * each other's key, and a key with no valid token is never claimed (a request
 * that will 401 has nothing to protect, and must not get to write rows).
 *
 * Mounted once on the staff router, above the module routers (http/routes.js).
 *
 * Table (migration 0030): idempotency_key (key PK, method, path, request_hash,
 * state 'in_flight' | 'completed', status_code, response_body jsonb, user_id,
 * created_at, completed_at, expires_at).
 */
const crypto = require("node:crypto");
const { pool } = require("../config/db");
const { logger } = require("../config/logger");
const { AppError } = require("../shared/errors");
const { userIdFromRequest } = require("./auth");

const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const KEY_PATTERN = /^[A-Za-z0-9._:-]{8,200}$/;
const STALE_CLAIM = "5 minutes";
const KEEP_FOR = "48 hours";

function hashRequest(userId, method, path, body) {
  const h = crypto.createHash("sha256");
  h.update(`${userId}\n${method}\n${path}\n`);
  try {
    h.update(JSON.stringify(body ?? null));
  } catch {
    h.update("unserialisable");
  }
  return h.digest("hex");
}

/** Take the key, or learn who has it. One statement, so two racing replays cannot both win. */
async function claim(db, { key, method, path, hash, userId }) {
  const { rows } = await db.query(
    `INSERT INTO idempotency_key (key, method, path, request_hash, user_id, state, created_at, expires_at)
     VALUES ($1, $2, $3, $4, $5, 'in_flight', now(), now() + interval '${KEEP_FOR}')
     ON CONFLICT (key) DO UPDATE
        SET method = EXCLUDED.method, path = EXCLUDED.path, request_hash = EXCLUDED.request_hash,
            user_id = EXCLUDED.user_id, state = 'in_flight', status_code = NULL, response_body = NULL,
            completed_at = NULL, created_at = now(), expires_at = now() + interval '${KEEP_FOR}'
      WHERE idempotency_key.expires_at <= now()
         OR (idempotency_key.state = 'in_flight' AND idempotency_key.created_at < now() - interval '${STALE_CLAIM}')
     RETURNING key`,
    [key, method, path, hash, userId],
  );
  return rows.length > 0;
}

async function existing(db, key) {
  const { rows } = await db.query(
    `SELECT state, status_code, response_body, request_hash
       FROM idempotency_key WHERE key = $1 AND expires_at > now()`,
    [key],
  );
  return rows[0] || null;
}

function release(key) {
  return pool
    .query("DELETE FROM idempotency_key WHERE key = $1", [key])
    .catch((err) =>
      logger.warn({ err }, "could not release an idempotency key"),
    );
}

/**
 * Store the outcome BEFORE the response goes out, so a replay arriving in the
 * gap finds "completed", not "in flight". Responses that are not res.json()
 * (204, files) release the key instead: there is no body to replay.
 */
function capture(req, res, key) {
  const send = res.json.bind(res);
  const end = res.end.bind(res);
  let done = false;

  res.end = (...args) => {
    if (!done) {
      done = true;
      release(key);
    }
    return end(...args);
  };

  res.json = (body) => {
    if (done) return send(body);
    done = true;
    const status = res.statusCode || 200;
    const write =
      status >= 200 && status < 300
        ? pool.query(
            `UPDATE idempotency_key
                SET state = 'completed', status_code = $2, response_body = $3, completed_at = now()
              WHERE key = $1`,
            [key, status, JSON.stringify(body ?? null)],
          )
        : release(key);
    Promise.resolve(write)
      .catch((err) =>
        logger.warn({ err }, "could not record an idempotency outcome"),
      )
      .finally(() => send(body));
    return res;
  };
}

async function idempotency(req, res, next) {
  const method = String(req.method || "").toUpperCase();
  if (!UNSAFE.has(method)) return next();
  const key = String(req.headers["idempotency-key"] || "").trim();
  if (!key) return next();

  const userId = userIdFromRequest(req);
  if (!userId) return next();

  if (!KEY_PATTERN.test(key)) {
    throw new AppError(
      "IDEMPOTENCY_KEY_INVALID",
      "Idempotency-Key must be 8 to 200 characters: letters, digits and . _ : -",
      400,
    );
  }

  const path = req.originalUrl || req.url;
  const hash = hashRequest(userId, method, path, req.body);

  let row;
  try {
    if (await claim(pool, { key, method, path, hash, userId })) {
      capture(req, res, key);
      return next();
    }
    row = await existing(pool, key);
  } catch (err) {
    logger.warn(
      { err },
      "idempotency unavailable; the request runs without replay protection",
    );
    return next();
  }

  if (!row) {
    capture(req, res, key);
    return next();
  }
  if (row.request_hash !== hash) {
    throw new AppError(
      "IDEMPOTENCY_KEY_REUSED",
      "This Idempotency-Key was used for a different request. Use a new key.",
      422,
    );
  }
  if (row.state === "in_flight") {
    res.setHeader("Retry-After", "2");
    throw new AppError(
      "IDEMPOTENCY_IN_PROGRESS",
      "The same request is still being processed. Try again in a moment.",
      409,
    );
  }
  res.setHeader("Idempotency-Replayed", "true");
  return res.status(row.status_code || 200).json(row.response_body);
}

module.exports = { idempotency, hashRequest, KEY_PATTERN };
