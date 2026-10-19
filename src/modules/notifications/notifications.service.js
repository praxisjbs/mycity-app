"use strict";
/**
 * The bell: the caller's own notifications, their unread count, the badges per module,
 * and the read mark. Also the person's preferences per category and channel, and their
 * devices with web push on (docs/guides/notifications.md §5, §6).
 *
 * A notification's link is derived when it is read (shared/route-map.js), and only kept
 * when the reader may open that module: a notice about a record they cannot open still
 * says what happened, without a button that lands on a refusal.
 */
const crypto = require("node:crypto");
const { pool } = require("../../config/db");
const { logger } = require("../../config/logger");
const { atomically } = require("../../shared/db/tx");
const { emit } = require("../../shared/events/emit");
const { AppError } = require("../../shared/errors");
const routeMap = require("../../shared/route-map");
const grantsCache = require("../../shared/rbac/grants-cache");
const categories = require("../../shared/notifications/categories");
const vapid = require("../../services/push/vapid");
const { deviceLabel, platformOf } = require("../identity/identity.device-label");
const { EVENTS } = require("./notifications.events");
const repo = require("./notifications.repo");

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

/** Which modules the caller may open, asked once per module per call. */
function opener(user) {
  const seen = new Map();
  return async (moduleKey) => {
    if (!moduleKey) return false;
    if (user.is_ceo) return true;
    if (!seen.has(moduleKey)) {
      const grants = await grantsCache.getGrants(pool, { role_ids: user.role_ids, module: moduleKey });
      seen.set(moduleKey, grants.some((g) => g.can_view));
    }
    return seen.get(moduleKey);
  };
}

async function present(rows, canOpen) {
  const out = [];
  for (const row of rows) {
    const link = routeMap.linkFor(row.entity_type, row.entity_id);
    const shown = link && (await canOpen(link.module)) ? { module: link.module, tab: link.tab, path: link.path } : null;
    out.push({ ...row, body: row.body || null, link: shown });
  }
  return out;
}

async function list(user, query) {
  const page = await repo.list(pool, user.user_id, query);
  return { ...page, data: await present(page.data, opener(user)) };
}

async function unreadCount(user) {
  return { unread: await repo.unreadCount(pool, user.user_id) };
}

/** Unread notifications per module the caller may open; modules with none are left out. */
async function badges(user) {
  const canOpen = opener(user);
  const out = {};
  for (const { entity_type: type, unread } of await repo.unreadByEntityType(pool, user.user_id)) {
    const moduleKey = routeMap.moduleOf(type);
    if (moduleKey && (await canOpen(moduleKey))) out[moduleKey] = (out[moduleKey] || 0) + unread;
  }
  return out;
}

/** Marks one of the caller's own notifications read. Already read is a quiet no-op. */
async function markRead(user, notificationId) {
  await tx(async (client) => {
    const before = await repo.findOwnForUpdate(client, user.user_id, notificationId);
    if (!before) throw new AppError("NOT_FOUND", "There is no such notification.", 404);
    if (before.read_at) return;
    const after = await repo.markRead(client, notificationId);
    await emit(client, {
      key: EVENTS.NOTIFICATION_READ,
      entity: { type: "notification", id: notificationId },
      actor: user,
      before,
      after,
      payload: { user_id: user.user_id, notification_id: notificationId },
    });
  });
}

/** Marks every unread notification of the caller read; nothing is recorded when there was none. */
async function markAllRead(user) {
  await tx(async (client) => {
    const marked = await repo.markAllRead(client, user.user_id);
    if (marked === 0) return;
    await emit(client, {
      key: EVENTS.NOTIFICATION_READ_ALL,
      entity: { type: "account", id: user.user_id },
      actor: user,
      payload: { user_id: user.user_id },
      metadata: { count: marked },
    });
  });
}


/* ------------------------------------------------------------------ *
 * Read state and read marks made elsewhere
 * ------------------------------------------------------------------ */

/** Which of these ids, the caller's own, are read: the app closes their shown notifications. */
async function readState(user, query) {
  return { read: await repo.readIds(pool, user.user_id, query.ids) };
}

/**
 * Marks the person's notices about one record read, inside the caller's transaction: reading
 * a mail conversation clears its "new mail" notices (mailbox.service markRead).
 */
async function markReadForRecord(client, user, entityType, entityId) {
  const ids = await repo.markReadForRecord(client, user.user_id, entityType, entityId);
  for (const id of ids) {
    await emit(client, {
      key: EVENTS.NOTIFICATION_READ,
      entity: { type: "notification", id },
      actor: user,
      payload: { user_id: user.user_id, notification_id: id },
      metadata: { by_record: `${entityType}:${entityId}` },
    });
  }
  return ids.length;
}

/* ------------------------------------------------------------------ *
 * Preferences
 * ------------------------------------------------------------------ */

/** Every category with its channels as they are for this person, defaults applied. */
async function preferences(user) {
  const stored = new Map();
  for (const r of await repo.preferenceRows(pool, user.user_id)) {
    if (!stored.has(r.category)) stored.set(r.category, {});
    stored.get(r.category)[r.channel] = r.enabled;
  }
  const three = (fn) => ({ in_app: fn("in_app"), email: fn("email"), push: fn("push") });
  return {
    categories: categories.CATEGORIES.map((c) => {
      const mine = stored.get(c.key) || {};
      return {
        category: c.key,
        label: c.label,
        locked: Boolean(c.locked),
        channels: three((ch) => categories.isOn(c.key, ch, mine[ch])),
        defaults: three((ch) => categories.defaultOn(c.key, ch)),
      };
    }),
  };
}

/** Switches one channel of one category; a locked channel stays on. */
async function setPreference(user, body) {
  if (!categories.isCategory(body.category))
    throw new AppError("NOT_FOUND", "There is no such category.", 404);
  if (!body.enabled && categories.isLocked(body.category) && categories.defaultOn(body.category, body.channel))
    throw new AppError("CATEGORY_LOCKED", "Security notices stay on.", 422);
  await tx(async (client) => {
    const after = await repo.savePreference(client, {
      userId: user.user_id,
      category: body.category,
      channel: body.channel,
      enabled: body.enabled,
    });
    await emit(client, {
      key: EVENTS.NOTIFICATION_PREFERENCE_CHANGED,
      entity: { type: "account", id: user.user_id },
      actor: user,
      after,
      payload: { user_id: user.user_id, category: body.category, channel: body.channel, enabled: body.enabled },
    });
  });
  return preferences(user);
}

/* ------------------------------------------------------------------ *
 * Web push: devices
 * ------------------------------------------------------------------ */

const newToken = () => crypto.randomBytes(32).toString("base64url");
const hashOf = (token) => crypto.createHash("sha256").update(String(token), "utf8").digest("hex");

/** Constant-time check of a device token against its stored hash. */
function tokenMatches(hash, token) {
  if (!hash || !token) return false;
  const a = Buffer.from(String(hash), "hex");
  const b = Buffer.from(hashOf(token), "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** What a browser subscribes with; push is off when the keys cannot be had. */
async function pushConfig() {
  try {
    const k = await vapid.keys();
    return { enabled: true, public_key: k.publicKey, key_id: k.keyId };
  } catch (err) {
    logger.error({ err }, "web push keys unavailable");
    return { enabled: false, public_key: null, key_id: null };
  }
}

/**
 * Saves this browser's subscription for the caller. One row per browser: found by its
 * endpoint, or by the id and token the browser kept when the endpoint changed. A row of
 * someone else moves to the caller (someone else signed in on that browser). The token is
 * kept when the browser proved it, else a new one is issued and returned once.
 * @param {object} user  req.user
 * @param {object} body  PushSubscriptionCreate
 * @param {{userAgent?: string, deviceCookie?: string|null}} ctx
 */
async function savePushSubscription(user, body, { userAgent, deviceCookie } = {}) {
  const k = await vapid.keys();
  const label = deviceLabel(userAgent);
  const platform = platformOf(userAgent) || null;
  return tx(async (client) => {
    const byEndpoint = await repo.subscriptionByEndpointForUpdate(client, body.endpoint);
    const proven = body.push_subscription_id
      ? await repo.subscriptionForUpdate(client, body.push_subscription_id)
      : null;
    const provenOk = Boolean(proven && tokenMatches(proven.device_token_hash, body.device_token));
    if (provenOk && byEndpoint && proven.push_subscription_id !== byEndpoint.push_subscription_id)
      await repo.revoke(client, proven.push_subscription_id, "moved");
    const target = byEndpoint || (provenOk ? proven : null);
    const token = target && tokenMatches(target.device_token_hash, body.device_token) ? null : newToken();
    const fields = {
      userId: user.user_id,
      endpoint: body.endpoint,
      p256dh: body.p256dh,
      auth: body.auth,
      expiresAt: body.expires_at ?? null,
      tokenHash: token ? hashOf(token) : null,
      keyId: k.keyId,
      knownDeviceId: await repo.knownDeviceId(client, user.user_id, deviceCookie ? hashOf(deviceCookie) : null),
      label,
      platform,
    };
    let id;
    if (target) {
      id = target.push_subscription_id;
      await repo.updateSubscription(client, id, fields);
    } else {
      id = await repo.insertSubscription(client, fields);
    }
    const movedFrom = target && target.user_id !== user.user_id ? target.user_id : null;
    if (!target || target.revoked_at || movedFrom) {
      await emit(client, {
        key: EVENTS.PUSH_SUBSCRIPTION_SAVED,
        entity: { type: "push_subscription", id },
        actor: user,
        payload: { user_id: user.user_id, push_subscription_id: id, label, moved_from: movedFrom },
      });
    }
    return { ...(await repo.deviceById(client, id)), device_token: token };
  });
}

async function pushDevices(user, query) {
  return repo.devices(pool, user.user_id, query);
}

/** Turns push off for one of the caller's devices. */
async function removePushDevice(user, id) {
  await tx(async (client) => {
    const sub = await repo.subscriptionForUpdate(client, id);
    if (!sub || sub.user_id !== user.user_id)
      throw new AppError("NOT_FOUND", "There is no such device.", 404);
    if (sub.revoked_at) return;
    await repo.revoke(client, id, "turned_off");
    await emit(client, {
      key: EVENTS.PUSH_SUBSCRIPTION_REMOVED,
      entity: { type: "push_subscription", id },
      actor: user,
      payload: { user_id: user.user_id, push_subscription_ids: [id], reason: "turned_off" },
    });
  });
}

/** Sends a test to one of the caller's devices, or all of them, through the worker. */
async function sendTestPush(user, body) {
  const live = await repo.liveSubscriptions(pool, user.user_id);
  const targets = body.push_subscription_id
    ? live.filter((s) => s.push_subscription_id === body.push_subscription_id)
    : live;
  if (targets.length === 0)
    throw new AppError("NO_DEVICE", "Turn on notifications on this device first.", 422);
  await tx((client) =>
    emit(client, {
      key: EVENTS.PUSH_TEST_REQUESTED,
      entity: { type: "account", id: user.user_id },
      actor: user,
      payload: { user_id: user.user_id, push_subscription_id: body.push_subscription_id || null },
    }),
  );
  return { devices: targets.length };
}

/**
 * Turns push off on a person's devices after something that must stop it: suspension,
 * leaving, Sign Out Everywhere, Sign Out Others (all but the device kept). Outbox handlers
 * call it (notifications.events.js).
 */
async function revokeDevicesOf(userId, reason, { exceptKnownDeviceId } = {}) {
  if (!userId) return 0;
  return tx(async (client) => {
    const ids = await repo.revokeUser(client, userId, reason, { exceptKnownDeviceId });
    if (ids.length) {
      await emit(client, {
        key: EVENTS.PUSH_SUBSCRIPTION_REMOVED,
        entity: { type: "account", id: userId },
        actor: null,
        payload: { user_id: userId, push_subscription_ids: ids, reason },
      });
    }
    return ids.length;
  });
}

/* ------------------------------------------------------------------ *
 * Web push: what a service worker may do with its device token
 * ------------------------------------------------------------------ */

async function provenDevice(client, { push_subscription_id: id, device_token: token }) {
  const sub = await repo.subscriptionForUpdate(client, id);
  if (!sub || sub.revoked_at || !tokenMatches(sub.device_token_hash, token))
    throw new AppError("DEVICE_NOT_RECOGNISED", "This device is not recognised.", 403);
  return sub;
}

/** The browser replaced its subscription (pushsubscriptionchange): keep sending to the new one. */
async function renewFromDevice(body) {
  const k = await vapid.keys();
  await tx(async (client) => {
    const sub = await provenDevice(client, body);
    const other = await repo.subscriptionByEndpointForUpdate(client, body.endpoint);
    if (other && other.push_subscription_id !== sub.push_subscription_id)
      await repo.deleteSubscription(client, other.push_subscription_id);
    await repo.renewSubscription(client, sub.push_subscription_id, {
      endpoint: body.endpoint,
      p256dh: body.p256dh,
      auth: body.auth,
      expiresAt: body.expires_at ?? null,
      keyId: k.keyId,
    });
    await emit(client, {
      key: EVENTS.PUSH_SUBSCRIPTION_RENEWED,
      entity: { type: "push_subscription", id: sub.push_subscription_id },
      actor: null,
      payload: { user_id: sub.user_id, push_subscription_id: sub.push_subscription_id },
    });
  });
}

/** Mark Read on a notification the device shows: its owner's notices only. */
async function markReadFromDevice(body) {
  await tx(async (client) => {
    const sub = await provenDevice(client, body);
    const owner = { user_id: sub.user_id };
    for (const id of body.notification_ids) {
      const before = await repo.findOwnForUpdate(client, sub.user_id, id);
      if (!before || before.read_at) continue;
      const after = await repo.markRead(client, id);
      await emit(client, {
        key: EVENTS.NOTIFICATION_READ,
        entity: { type: "notification", id },
        actor: owner,
        before,
        after,
        payload: { user_id: sub.user_id, notification_id: id },
        metadata: { from_device: sub.push_subscription_id },
      });
    }
  });
}

module.exports = {
  list,
  unreadCount,
  badges,
  markRead,
  markAllRead,
  opener,
  present,
  readState,
  markReadForRecord,
  preferences,
  setPreference,
  pushConfig,
  savePushSubscription,
  pushDevices,
  removePushDevice,
  sendTestPush,
  revokeDevicesOf,
  renewFromDevice,
  markReadFromDevice,
  tokenMatches,
};
