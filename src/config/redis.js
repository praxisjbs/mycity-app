"use strict";
/**
 * Redis. One instance, one logical database per environment (production db 0,
 * staging db 1, checked in config/env.js), and every key prefixed with
 * `mycity:<env>:` so a key can never be read across environments even if the db
 * index were wrong.
 *
 *   const { getClient, rkey } = require("../config/redis");
 *   await getClient().set(rkey("session", sid), "1", "EX", 900);   // mycity:prod:session:<sid>
 *
 * Used for: the identity and grants cache, the session index, rate limits,
 * BullMQ (its own `prefix`, see jobs/queues.js), Socket.io's adapter and emitter,
 * and the scheduler locks.
 *
 * One shared client for ordinary commands, plus DEDICATED connections for
 * anything that blocks (BullMQ workers, the Socket.io subscriber), because ioredis
 * cannot multiplex around a blocking command and a shared socket would queue
 * every request behind a job read.
 *
 * The prefix is applied by rkey(), not by ioredis `keyPrefix`: BullMQ refuses a
 * connection that has one, and keyPrefix silently does not apply to SCAN
 * patterns or to keys inside Lua scripts.
 */
const IORedis = require("ioredis");
const { config, REDIS_PREFIX } = require("./env");
const { logger } = require("./logger");

let client = null;
const extras = new Set();

function options(label) {
  return {
    maxRetriesPerRequest: null, // BullMQ requires null
    enableReadyCheck: true,
    connectionName: `${REDIS_PREFIX}:${label}`,
    lazyConnect: false,
  };
}

function wire(c, label) {
  c.on("error", (err) => logger.error({ err, conn: label }, "redis error"));
  c.on("ready", () => logger.debug({ conn: label }, "redis ready"));
  return c;
}

/** Key with this environment's prefix: rkey("rl", "ip", "1.2.3.4") → "mycity:prod:rl:ip:1.2.3.4". */
function rkey(...parts) {
  return [REDIS_PREFIX, ...parts.map(String)].join(":");
}

/** Open the shared client and check it answers. Call once at boot. */
async function initRedis() {
  if (client) return client;
  client = wire(new IORedis(config.REDIS_URL, options("main")), "main");
  await client.ping();
  return client;
}

/** The shared client. Throws before initRedis(); callers that may run without Redis use tryClient(). */
function getClient() {
  if (!client) throw new Error("redis not initialised; call initRedis() at boot");
  return client;
}

/**
 * The shared client, or null when Redis was never initialised (unit tests,
 * describe mode). Caches use this and degrade to the database.
 */
function tryClient() {
  return client;
}

/**
 * A connection of its own, for a blocking consumer. Closed by closeRedis().
 * @param {string} label  shows in CLIENT LIST and in log lines
 */
function createConnection(label) {
  const c = wire(new IORedis(config.REDIS_URL, options(label)), label);
  extras.add(c);
  return c;
}

async function closeRedis() {
  await Promise.allSettled([client && client.quit(), ...[...extras].map((c) => c.quit())]);
  extras.clear();
  client = null;
}

module.exports = { initRedis, getClient, tryClient, createConnection, closeRedis, rkey, REDIS_PREFIX };
