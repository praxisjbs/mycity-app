"use strict";
/**
 * System mail pacing: never more than the mailbox's hourly sending limit
 * (MAIL_SEND_PER_HOUR; docs/runbooks/dns-and-mail.md).
 *
 *   const r = await pace.reserve(2);          // two recipients
 *   if (!r.ok) throw new pace.MailPacedError(r.wait_ms);
 *
 * The hosting plan counts every recipient of every message against a limit per rolling hour
 * (50 on MyCity's Namecheap plan), and a mailbox that goes over is refused or suspended. So a
 * message is sent only when its recipients still fit in the last 60 minutes; otherwise the job
 * that wanted to send it is put back in the queue until they do (postpone below), without
 * using up a retry. Payslips for every employee then go out over a few hours instead of being
 * lost.
 *
 * Rules:
 *  - one rolling window per environment, in Redis (a sorted set of send times, kept by one Lua
 *    script so every worker process shares it); without Redis (tests) the same arithmetic in
 *    this process;
 *  - production and staging send from the same mailbox, so their two MAIL_SEND_PER_HOUR
 *    values must add up to the plan's limit at most (40 + 10 of 50);
 *  - 0 turns pacing off (a laptop, CI). A server refuses to boot with 0 (config/env.js).
 */
const { config } = require("../../config/env");
const { tryClient, rkey } = require("../../config/redis");

const WINDOW_MS = 60 * 60 * 1000;
const local = []; // send times, this process only (no Redis)

class MailPacedError extends Error {
  constructor(waitMs) {
    super(`system mail paced: the hourly sending limit is reached; next slot in ${Math.ceil(waitMs / 1000)} s`);
    this.name = "MailPacedError";
    this.code = "MAIL_PACED";
    this.retryAfterMs = waitMs;
  }
}

// KEYS[1] the window; ARGV now, window, limit, n, id. Returns {fits, wait_ms, used}.
const RESERVE = `
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', tonumber(ARGV[1]) - tonumber(ARGV[2]))
local count = redis.call('ZCARD', KEYS[1])
local limit, n = tonumber(ARGV[3]), tonumber(ARGV[4])
if count + n > limit then
  local idx = count + n - limit - 1
  local e = redis.call('ZRANGE', KEYS[1], idx, idx, 'WITHSCORES')
  return {0, tonumber(e[2]) + tonumber(ARGV[2]) - tonumber(ARGV[1]), count}
end
for i = 1, n do redis.call('ZADD', KEYS[1], ARGV[1], ARGV[5] .. ':' .. i) end
redis.call('PEXPIRE', KEYS[1], ARGV[2])
return {1, 0, count + n}
`;

function reserveLocal(n, limit, now) {
  while (local.length && local[0] <= now - WINDOW_MS) local.shift();
  if (local.length + n > limit) {
    const oldest = local[local.length + n - limit - 1];
    return { ok: false, wait_ms: oldest + WINDOW_MS - now, used: local.length };
  }
  for (let i = 0; i < n; i += 1) local.push(now);
  return { ok: true, wait_ms: 0, used: local.length };
}

/**
 * Take n recipient slots from this hour's allowance.
 * @param {number} n recipients of one message
 * @param {{limit?: number, now?: number}} [opts]
 * @returns {Promise<{ok: boolean, wait_ms: number, used: number}>}
 */
async function reserve(n, { limit = config.MAIL_SEND_PER_HOUR, now = Date.now() } = {}) {
  if (!limit) return { ok: true, wait_ms: 0, used: 0 };
  if (n > limit)
    throw new Error(`system mail: ${n} recipients is more than the hourly sending limit of ${limit}`);
  const redis = tryClient();
  if (!redis) return reserveLocal(n, limit, now);
  const id = `${now}:${process.pid}:${Math.random().toString(36).slice(2, 10)}`;
  const [fits, wait, used] = await redis.eval(RESERVE, 1, rkey("mail", "sent"), now, WINDOW_MS, limit, n, id);
  return { ok: fits === 1, wait_ms: fits === 1 ? 0 : Math.max(1000, Number(wait) || 0), used: Number(used) };
}

/** Recipients sent to in the last hour, for readiness. */
async function usage(now = Date.now()) {
  const redis = tryClient();
  if (!redis) return local.filter((t) => t > now - WINDOW_MS).length;
  return redis.zcount(rkey("mail", "sent"), now - WINDOW_MS, "+inf");
}

/**
 * Put a job back in its queue until the next slot, without counting it as a failed attempt.
 * Throws BullMQ's DelayedError, which is how a processor says "later": always `throw` the result.
 * A few seconds of jitter keeps a batch of postponed jobs from all waking at the same moment.
 */
async function postpone(job, token, waitMs) {
  const { DelayedError } = require("bullmq");
  const jitter = Math.floor(Math.random() * 15000);
  await job.moveToDelayed(Date.now() + waitMs + jitter, token);
  return new DelayedError(`postponed ${Math.ceil((waitMs + jitter) / 1000)} s: hourly mail limit`);
}

function __reset() {
  local.length = 0;
}

module.exports = { reserve, usage, postpone, MailPacedError, WINDOW_MS, __reset };
