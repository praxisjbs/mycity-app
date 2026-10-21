"use strict";
/**
 * Every minute: any queued message whose time has come and whose job was lost, then, once
 * the staff mail server's sync interval has passed since the last full pass, every
 * connected mailbox synced in turn, one IMAP connection at a time. The safety net behind
 * IMAP IDLE and the mail-send job (mailbox.md §7).
 *
 * The interval is the staff mail server's (Settings · Integrations, else
 * MAILBOX_SYNC_EVERY_MIN; docs/guides/integrations.md §6.7), read at each tick, so a change
 * applies at the next minute without restarting the worker. When the last full pass was is
 * kept in Redis, so a restart or a second worker does not sync early; without Redis, in
 * this process.
 */
const { defineSchedule } = require("../registry");
const { tryClient, rkey } = require("../../config/redis");

const TICK_MS = 60 * 1000;
let lastPassLocal = 0;

async function lastPass() {
  const redis = tryClient();
  if (!redis) return lastPassLocal;
  try {
    return Number(await redis.get(rkey("mail", "last-full-sync"))) || 0;
  } catch {
    return lastPassLocal;
  }
}

async function markPass(at) {
  lastPassLocal = at;
  const redis = tryClient();
  if (redis) await redis.set(rkey("mail", "last-full-sync"), String(at), "EX", 24 * 60 * 60).catch(() => {});
}

module.exports = defineSchedule({
  name: "mail-sync",
  every: TICK_MS,
  summary: "Due mail sent every minute, and every mailbox synced at the staff mail server's interval",
  run: async () => {
    const service = require("../../modules/mailbox/mailbox.service");
    const integrations = require("../../shared/integrations/settings");
    const sent = await service.flush();
    const everyMin = Number((await integrations.of("mailbox_server")).values.sync_every_min) || 2;
    const now = Date.now();
    // A few seconds' slack, so a pass due "now" is not put off by a tick that fired early.
    if (now - (await lastPass()) < everyMin * TICK_MS - 5000) return { sent: sent.length, synced: false };
    await markPass(now);
    const synced = await service.syncAll();
    return { ...synced, sent: sent.length };
  },
});
