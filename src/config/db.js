"use strict";
/**
 * The one Postgres pool. Every query in the API, the worker and the scripts
 * goes through it.
 *
 *   const { pool } = require("../config/db");
 *   const client = await pool.connect();         // for a transaction (shared/db/tx.js)
 *   const { rows } = await query(sql, params);    // a one-shot read
 *
 * One database per environment (mycity_prod, mycity_stg), one role, no
 * row-level security (A2: no entity layer). The pool is created when this file is
 * first required but opens no connection until the first query, so the contract
 * generator and unit tests can load modules without a database.
 *
 * application_name says which process holds a connection, so
 * pg_stat_activity answers "who is holding the locks" during an incident.
 */
const { Pool } = require("pg");
require("../shared/db/pg-types");
const { config, ENV_SHORT, PROCESS_NAME } = require("./env");
const { logger } = require("./logger");

const pool = new Pool({
  host: config.DB_HOST,
  port: config.DB_PORT,
  database: config.DB_NAME,
  user: config.DB_USER,
  password: config.DB_PASSWORD || undefined,
  ssl: config.DB_SSL ? { rejectUnauthorized: true } : false,
  max: config.DB_POOL_MAX,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  statement_timeout: config.DB_STATEMENT_TIMEOUT_MS,
  application_name: `${PROCESS_NAME}-${ENV_SHORT}`,
});

// An idle client erroring (Postgres restarted, network blip) must not crash the
// process; the pool discards it and the next checkout gets a fresh one.
pool.on("error", (err) =>
  logger.error({ err }, "postgres pool: idle client error"),
);

/**
 * One-shot query on any pooled connection. Not for anything that must be
 * atomic with another statement: use pool.connect() and shared/db/tx.js.
 *
 * @param {string} sql
 * @param {Array} [params]
 * @returns {Promise<import("pg").QueryResult>}
 */
async function query(sql, params = []) {
  const started = Date.now();
  try {
    return await pool.query(sql, params);
  } finally {
    const ms = Date.now() - started;
    if (ms >= config.DB_SLOW_QUERY_MS) {
      logger.warn({ ms, sql: String(sql).slice(0, 200) }, "slow query");
    }
  }
}

/**
 * Check a client out, run `fn(client)`, always release it.
 * @template T
 * @param {(client: import("pg").PoolClient) => Promise<T>} fn
 * @returns {Promise<T>}
 */
async function withClient(fn) {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

/**
 * Boot check: reachable, and not connected as a superuser
 * (SYSTEM_ARCHITECTURE §5: no superuser in any .env).
 */
async function checkDatabase() {
  const { rows } = await pool.query(
    "SELECT current_database() AS db, current_user AS usr, current_setting('is_superuser') AS su",
  );
  const r = rows[0];
  if (
    r.su === "on" &&
    config.APP_ENV !== "development" &&
    config.APP_ENV !== "test"
  ) {
    throw new Error(
      `Refusing to run as a Postgres superuser (${r.usr}) on ${config.APP_ENV}`,
    );
  }
  logger.info({ db: r.db, user: r.usr }, "postgres ready");
  return r;
}

async function closeDb() {
  await pool.end();
}

module.exports = { pool, query, withClient, checkDatabase, closeDb };
