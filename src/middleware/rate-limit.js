"use strict";
/**
 * Rate limits (SYSTEM_ARCHITECTURE §3, §4). Redis-backed, keys prefixed by
 * environment (`mycity:<env>:rl:`), so staging traffic never spends
 * production's budget and a restart does not reset anyone's count.
 *
 *   staffLimiter        /api/v1        per signed-in user (per IP before sign-in), RATE_LIMIT_STAFF_PER_MIN
 *   publicLimiter       /api/public    per IP, RATE_LIMIT_PUBLIC_PER_MIN
 *   publicWriteLimiter  /api/public    per IP, writes only, RATE_LIMIT_PUBLIC_WRITES_PER_MIN
 *   signInLimiter       sign-in        per IP, failed attempts only, 10 per 15 minutes
 *   refreshLimiter      token refresh  per IP, failed attempts only, 60 per 15 minutes
 *
 * Limiters are built when this file loads, but Redis connects later at boot, so
 * each limiter asks for its store on every call and uses Redis once it exists.
 * Before initRateLimitStore() (and in unit tests) it counts in memory, per
 * process. Each limiter gets its OWN Redis store: a store takes its expiry window
 * from the first limiter that initialises it, so a shared one would make a
 * 15-minute limiter count in 1-minute windows.
 *
 * The staff key is the VERIFIED user id: keying on an unverified token would let
 * anyone spend a colleague's budget by forging a token with their id.
 */
const rateLimit = require("express-rate-limit");
const { MemoryStore } = rateLimit;
const { config } = require("../config/env");
const { logger } = require("../config/logger");
const { userIdFromRequest } = require("./auth");

const TOO_MANY = {
  error: {
    code: "RATE_LIMITED",
    message: "Too many requests. Wait a moment and try again.",
  },
};

/** Builds a Redis store for one limiter; null until initRateLimitStore(). */
let makeRedisStore = null;

/** Switch every limiter to Redis. Call once after initRedis(). */
function initRateLimitStore() {
  try {
    const { RedisStore } = require("rate-limit-redis");
    const { getClient, rkey } = require("../config/redis");
    const client = getClient();
    makeRedisStore = (name) =>
      new RedisStore({
        sendCommand: (...args) => client.call(...args),
        prefix: `${rkey("rl", name)}:`,
      });
    return "redis";
  } catch (err) {
    logger.warn({ err }, "rate limits are counting in memory, per process");
    return "memory";
  }
}

function storeKind() {
  return makeRedisStore ? "redis" : "memory";
}

/**
 * @param {{name: string, max: number, windowMs?: number, key?: (req) => string,
 *          failuresOnly?: boolean, skip?: (req) => boolean}} opts
 */
function makeLimiter({
  name,
  max,
  windowMs = 60_000,
  key,
  failuresOnly = false,
  skip,
}) {
  const limiter = rateLimit({
    windowMs,
    limit: max,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: TOO_MANY,
    skipSuccessfulRequests: failuresOnly,
    ...(skip ? { skip } : {}),
    keyGenerator: (req) => (key ? key(req) : `ip:${req.ip}`),
    store: {
      init(options) {
        this.options = options;
      },
      active() {
        if (makeRedisStore) {
          if (!this.redis) {
            this.redis = makeRedisStore(name);
            this.redis.init(this.options);
          }
          return this.redis;
        }
        if (!this.memory) {
          this.memory = new MemoryStore();
          this.memory.init(this.options);
        }
        return this.memory;
      },
      increment(k) {
        return this.active().increment(k);
      },
      decrement(k) {
        return this.active().decrement(k);
      },
      resetKey(k) {
        return this.active().resetKey(k);
      },
    },
  });
  limiter.limiterName = name;
  return limiter;
}

const WRITE = new Set(["POST", "PUT", "PATCH", "DELETE"]);

const staffLimiter = makeLimiter({
  name: "staff",
  max: config.RATE_LIMIT_STAFF_PER_MIN,
  key: (req) => {
    const userId = userIdFromRequest(req);
    return userId ? `user:${userId}` : `ip:${req.ip}`;
  },
});

const publicLimiter = makeLimiter({
  name: "public",
  max: config.RATE_LIMIT_PUBLIC_PER_MIN,
});

const publicWriteLimiter = makeLimiter({
  name: "public-write",
  max: config.RATE_LIMIT_PUBLIC_WRITES_PER_MIN,
  skip: (req) => !WRITE.has(req.method),
});

const signInLimiter = makeLimiter({
  name: "sign-in",
  max: 10,
  windowMs: 15 * 60_000,
  failuresOnly: true,
});
const refreshLimiter = makeLimiter({
  name: "refresh",
  max: 60,
  windowMs: 15 * 60_000,
  failuresOnly: true,
});

module.exports = {
  initRateLimitStore,
  storeKind,
  makeLimiter,
  staffLimiter,
  publicLimiter,
  publicWriteLimiter,
  signInLimiter,
  refreshLimiter,
  TOO_MANY,
};
