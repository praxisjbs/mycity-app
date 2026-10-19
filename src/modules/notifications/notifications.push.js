"use strict";
/**
 * Web push for the bell's notices: one notice to its person's phones and computers, or a
 * test to the devices they asked for (docs/guides/notifications.md §3, §6). The
 * `notification-push` job calls it; nothing here runs in a request.
 *
 *   pushNotice(id, style)   skips a notice its person has read meanwhile (Security is sent
 *                           anyway), sends to every live device not yet sent to, revokes a
 *                           device its push service refuses for good, and says how many
 *                           devices to try again
 *   pushTest(user, device)  always shown, even with the app open
 *
 * Each (notice, device) is recorded in push_delivery, so a retried job sends only to the
 * devices still owed. The link is the record's screen when its person may open its module,
 * as in the bell; otherwise none, and the device opens the bell.
 */
const { pool } = require("../../config/db");
const { atomically } = require("../../shared/db/tx");
const { emit } = require("../../shared/events/emit");
const grantsCache = require("../../shared/rbac/grants-cache");
const push = require("../../services/push/web-push");
const payloads = require("../../services/push/payload");
const { EVENTS } = require("./notifications.events");
const repo = require("./notifications.repo");
const service = require("./notifications.service");

const DAY_S = 24 * 60 * 60;
/** How long a push service keeps a push for a device that is off: a week for Security, a day otherwise. */
const TTL_S = { security: 7 * DAY_S };

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

/** A subscription its push service refused for good: off, and recorded. */
async function retire(sub, reason) {
  await tx(async (client) => {
    const done = await repo.revoke(client, sub.push_subscription_id, reason);
    if (!done) return;
    await emit(client, {
      key: EVENTS.PUSH_SUBSCRIPTION_REMOVED,
      entity: { type: "push_subscription", id: sub.push_subscription_id },
      actor: null,
      payload: { user_id: sub.user_id, push_subscription_ids: [sub.push_subscription_id], reason },
    });
  });
}

/** The record's screen, when the person may open its module. */
async function pathOf(row) {
  const user = await grantsCache.getAuthUser(pool, row.user_id);
  if (!user) return null;
  const [shown] = await service.present([row], service.opener(user));
  return shown && shown.link ? shown.link.path : null;
}

/** Sends one payload to each subscription; returns how many went and how many to try again. */
async function sendAll(subs, payload, { notificationId, ttl, urgency, topic }) {
  let sent = 0;
  let retry = 0;
  for (const sub of subs) {
    const out = await push.send(sub, payload, { ttl, urgency, topic });
    const record = (status) =>
      repo.recordDelivery(pool, {
        notificationId,
        subscriptionId: sub.push_subscription_id,
        status,
        httpStatus: out.status ?? null,
        error: out.ok ? null : out.error,
      });
    if (out.ok) {
      sent += 1;
      await record("sent");
      await repo.noteSuccess(pool, sub.push_subscription_id);
    } else if (out.gone) {
      await record("gone");
      await retire(sub, "refused");
    } else {
      await record("failed");
      await repo.noteFailure(pool, sub.push_subscription_id, out.error);
      if (out.retry) retry += 1;
    }
  }
  return { sent, retry };
}

/**
 * Pushes one notice.
 * @param {string} notificationId
 * @param {{tag?: string|null, mode?: string|null}|null} [style]  from the event's declaration
 */
async function pushNotice(notificationId, style = null) {
  const row = await repo.forPush(pool, notificationId);
  if (!row || !row.reachable || !(row.channels || []).includes("push")) return { skipped: "unreachable" };
  const subs = await repo.liveSubscriptions(pool, row.user_id);
  if (subs.length === 0) return { skipped: "no_device" };
  if (row.read_at && row.category !== "security") {
    for (const s of subs)
      await repo.recordDelivery(pool, { notificationId, subscriptionId: s.push_subscription_id, status: "skipped_read" });
    return { skipped: "read" };
  }
  const done = await repo.deliveriesOf(pool, notificationId);
  const owed = subs.filter((s) => {
    const d = done.get(s.push_subscription_id);
    return !d || d.status === "failed";
  });
  if (owed.length === 0) return { sent: 0, retry: 0 };
  const { tag, mode } = payloads.styleOf(row, style);
  const payload = payloads.build({
    id: row.notification_id,
    title: row.title,
    body: row.body,
    path: await pathOf(row),
    tag,
    mode,
    category: row.category,
    priority: row.priority,
    ts: row.created_at,
    unread: await repo.unreadCount(pool, row.user_id),
    test: false,
  });
  return sendAll(owed, payload, {
    notificationId,
    ttl: TTL_S[row.category] || DAY_S,
    urgency: row.priority === "high" ? "high" : mode === "quiet" ? "low" : "normal",
    topic: mode === "single" ? undefined : tag,
  });
}

/** Send Test: to one device of the person, or all of them; shown even with the app open. */
async function pushTest(userId, subscriptionId = null) {
  const subs = (await repo.liveSubscriptions(pool, userId)).filter(
    (s) => !subscriptionId || s.push_subscription_id === subscriptionId,
  );
  if (subs.length === 0) return { sent: 0, retry: 0 };
  const payload = payloads.build({
    id: null,
    title: "Test notification",
    body: "Notifications reach you on this device.",
    path: null,
    tag: "test",
    mode: "single",
    category: "system",
    priority: "high",
    ts: new Date(),
    unread: await repo.unreadCount(pool, userId),
    test: true,
  });
  return sendAll(subs, payload, { notificationId: null, ttl: 60 * 60, urgency: "high" });
}

module.exports = { pushNotice, pushTest };
