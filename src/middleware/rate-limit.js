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
 *   forgotLimiter       reset request  per IP, every request, 5 per 15 minutes
 *   resetLimiter        reset links    per IP, 10 per 15 minutes
 *   changePasswordLimiter  password change, per signed-in person, 10 per 15 minutes
 *   deviceLimiter       sign-in greeting  per IP, 300 per 15 minutes
 *   twoStepLimiter      the code step     per IP, failed attempts only, 10 per 15 minutes
 *   pinLimiter          PIN sign-in       per IP, failed attempts only, 10 per 15 minutes
 *   passkeyLimiter      passkey sign-in   per IP, every request, 60 per 15 minutes
 *   confirmLimiter      confirming it is you, per signed-in person, 10 per 15 minutes
 *   linkPreviewLimiter  a link's card for the composer, per signed-in person, 30 per minute
 *   forwardLimiter      forwarding in Staff Community, per signed-in person, 20 per minute
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
      // The library refuses one request counted twice under one store and key. Every
      // limiter's store is this same plain shape, so the prefix tells them apart: the
      // staff limiter and the sign-in limiter both key an anonymous caller by address.
      prefix: `${name}:`,
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

/** Asking for a reset link: every request counts, so nobody can fill an inbox. */
const forgotLimiter = makeLimiter({
  name: "forgot",
  max: 5,
  windowMs: 15 * 60_000,
});

/** Opening and using a reset or invitation link. */
const resetLimiter = makeLimiter({
  name: "reset",
  max: 10,
  windowMs: 15 * 60_000,
});

/**
 * Changing a password while signed in: per person, after auth has established who.
 * A stolen access token must not be a licence to guess the current password.
 */
const changePasswordLimiter = makeLimiter({
  name: "change-password",
  max: 10,
  windowMs: 15 * 60_000,
  key: (req) =>
    req.user && req.user.user_id ? `user:${req.user.user_id}` : `ip:${req.ip}`,
});

/** The sign-in screen's greeting: cheap, public, and still bounded. */
const deviceLimiter = makeLimiter({
  name: "device",
  max: 300,
  windowMs: 15 * 60_000,
});

/*
 * The second step and the other ways in. Each account also waits on its own
 * (identity.throttle.js, security.pin.js); these stop one machine trying many.
 */
const twoStepLimiter = makeLimiter({
  name: "two-step",
  max: 10,
  windowMs: 15 * 60_000,
  failuresOnly: true,
});
const pinLimiter = makeLimiter({
  name: "pin",
  max: 10,
  windowMs: 15 * 60_000,
  failuresOnly: true,
});
const passkeyLimiter = makeLimiter({
  name: "passkey",
  max: 60,
  windowMs: 15 * 60_000,
});

/**
 * A service worker's two calls with its device token (Mark Read, renewing its push
 * subscription). Only a refused token counts, so a busy person never waits.
 */
const pushDeviceLimiter = makeLimiter({
  name: "push-device",
  max: 30,
  windowMs: 15 * 60_000,
  failuresOnly: true,
});

/**
 * A link's card for the composer (community.md §6): the server reads a page on the web for
 * it, so one person cannot have it read thousands. Per person, after auth.
 */
const linkPreviewLimiter = makeLimiter({
  name: "link-preview",
  max: 30,
  windowMs: 60_000,
  key: (req) =>
    req.user && req.user.user_id ? `user:${req.user.user_id}` : `ip:${req.ip}`,
});

/**
 * Forwarding (docs/guides/community.md §3 step 19): one forward posts up to 25 messages in up
 * to 5 chats, so one person cannot flood the company's conversations. Per person, after auth.
 */
const forwardLimiter = makeLimiter({
  name: "forward",
  max: 20,
  windowMs: 60_000,
  key: (req) =>
    req.user && req.user.user_id ? `user:${req.user.user_id}` : `ip:${req.ip}`,
});

/** Confirming it is you before a sign-in method changes: per person, after auth. */
const confirmLimiter = makeLimiter({
  name: "confirm",
  max: 10,
  windowMs: 15 * 60_000,
  key: (req) =>
    req.user && req.user.user_id ? `user:${req.user.user_id}` : `ip:${req.ip}`,
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
  forgotLimiter,
  resetLimiter,
  changePasswordLimiter,
  deviceLimiter,
  twoStepLimiter,
  pinLimiter,
  pushDeviceLimiter,
  passkeyLimiter,
  confirmLimiter,
  linkPreviewLimiter,
  forwardLimiter,
  TOO_MANY,
};
