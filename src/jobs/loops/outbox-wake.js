"use strict";
/**
 * The dispatcher woken by a commit instead of waiting for its one-second tick
 * (SYSTEM_ARCHITECTURE §6). emit() sends a Postgres NOTIFY on `mycity_outbox`, which
 * Postgres delivers only when the transaction commits; this loop LISTENs on its own
 * connection and runs the dispatcher at once, so a chat message reaches the other screen
 * in milliseconds rather than up to a second later. The tick in schedulers/outbox-dispatch
 * stays as the safety net: a wake lost to a dropped connection waits at most a second.
 * A dropped connection is reopened after five seconds.
 */
const { Client } = require("pg");
const { config, ENV_SHORT, PROCESS_NAME } = require("../../config/env");
const { logger } = require("../../config/logger");
const { WAKE_CHANNEL } = require("../../shared/events/emit");
const outbox = require("../../shared/events/outbox");

const RETRY_MS = 5_000;
/** How long a wake that finds a dispatch already running waits before it tries again. */
const BUSY_WAIT_MS = 25;

/**
 * @param {{run?: () => Promise<unknown>}} [opts]  the dispatch to run; the scheduler's by default
 * @returns {{stop: () => Promise<void>, wake: () => Promise<void>}}
 */
function start({ run = require("../schedulers/outbox-dispatch").run } = {}) {
  let client = null;
  let stopped = false;
  let retry = null;
  let pending = false;
  let waking = false;

  /** Run the dispatcher until no wake is left over, and again after one that found it busy. */
  async function wake() {
    pending = true;
    if (waking) return;
    waking = true;
    try {
      while (pending && !stopped) {
        pending = false;
        if (outbox.busy()) {
          await new Promise((r) => setTimeout(r, BUSY_WAIT_MS));
          pending = true;
          continue;
        }
        await run().catch((err) => logger.error({ err }, "outbox wake: dispatch failed"));
      }
    } finally {
      waking = false;
    }
  }

  async function connect() {
    if (stopped) return;
    const c = new Client({
      host: config.DB_HOST,
      port: config.DB_PORT,
      database: config.DB_NAME,
      user: config.DB_USER,
      password: config.DB_PASSWORD || undefined,
      ssl: config.DB_SSL ? { rejectUnauthorized: true } : false,
      application_name: `${PROCESS_NAME}-${ENV_SHORT}-outbox-wake`,
    });
    const again = (err) => {
      if (client !== c) return;
      client = null;
      c.end().catch(() => undefined);
      if (stopped) return;
      logger.warn({ err }, "outbox wake: connection lost; the one-second tick carries on");
      retry = setTimeout(connect, RETRY_MS);
      if (retry.unref) retry.unref();
    };
    c.on("error", again);
    c.on("end", () => again(new Error("connection ended")));
    c.on("notification", () => void wake());
    try {
      client = c;
      await c.connect();
      await c.query(`LISTEN ${WAKE_CHANNEL}`);
      // Anything committed while the connection was down is dispatched now.
      void wake();
    } catch (err) {
      again(err);
    }
  }

  void connect();
  return {
    wake,
    stop: async () => {
      stopped = true;
      if (retry) clearTimeout(retry);
      const c = client;
      client = null;
      if (c) await c.end().catch(() => undefined);
    },
  };
}

module.exports = { start };
