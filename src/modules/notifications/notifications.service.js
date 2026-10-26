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
const viewsOf = require("../../shared/notifications/views");
const lagos = require("../../shared/time/lagos");
const vapid = require("../../services/push/vapid");
const realtime = require("../../services/realtime/emitter");
const queues = require("../../jobs/queues");
const { deviceLabel, platformOf } = require("../identity/identity.device-label");
const { EVENTS } = require("./notifications.events");
const reminders = require("./notifications.reminders");
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

/**
 * The screen a record of this type opens on for this reader, or null when nowhere. The bell's
 * links, the badges per module and tab, a list's unread marks and the read mark on opening a
 * record all follow it, so they always agree.
 */
async function screenTo(entityType, canOpen) {
  const screen = routeMap.screenOf(entityType);
  if (!screen) return null;
  // Who may open it is the route's own permission: System Health's tabs sit in Settings
  // but are held by system_health (shared/route-map.js).
  if (await canOpen(routeMap.moduleOf(entityType))) return { ...screen, self: false };
  // Someone who cannot open the staff screen opens their own instead, where the route names one
  // (a temporary site they are on opens on Work Location Requests); else the notice has no link.
  const own = routeMap.screenOf(entityType, { self: true });
  return own.module !== screen.module && (await canOpen(own.module)) ? { ...own, self: true } : null;
}

async function present(rows, canOpen) {
  const out = [];
  for (const row of rows) {
    const screen = await screenTo(row.entity_type, canOpen);
    const link = screen && routeMap.linkFor(row.entity_type, row.entity_id, { self: screen.self });
    const shown = link ? { module: link.module, tab: link.tab, path: link.path } : null;
    out.push({ ...row, body: row.body || null, link: shown });
  }
  return out;
}

/** The record types whose notices open on this screen for this reader. */
async function typesShownOn(user, moduleKey, tab) {
  const canOpen = opener(user);
  const types = [];
  for (const type of routeMap.typesOn(moduleKey, tab)) {
    const screen = await screenTo(type, canOpen);
    if (screen && screen.module === moduleKey && screen.tab === tab) types.push(type);
  }
  return types;
}

async function list(user, query) {
  const page = await repo.list(pool, user.user_id, query);
  return { ...page, data: await present(page.data, opener(user)) };
}

const iso = (v) => (v ? new Date(v).toISOString() : null);

/**
 * A row as a socket carries it to the bell, the banner and the urgent bar: the contract's
 * Notification, its link only when its person may open the record's module.
 */
async function asNotice(row) {
  const user = await grantsCache.getAuthUser(pool, row.user_id);
  const canOpen = user ? opener(user) : async () => false;
  const [shown] = await present([row], canOpen);
  return {
    notification_id: row.notification_id,
    category: row.category,
    priority: row.priority,
    urgency: row.urgency || "normal",
    acknowledge_required: Boolean(row.acknowledge_required),
    acknowledged_at: iso(row.acknowledged_at),
    repeat_count: Number(row.repeat_count || 0),
    title: row.title,
    body: row.body || null,
    entity_type: row.entity_type ?? null,
    entity_id: row.entity_id ?? null,
    link: shown.link,
    read_at: iso(row.read_at),
    created_at: iso(row.created_at || Date.now()),
  };
}

/** The caller's open urgent notices, newest first: the urgent bar. */
async function urgent(user, query) {
  const page = await repo.urgentOpen(pool, user.user_id, query);
  return { ...page, data: await present(page.data, opener(user)) };
}

async function unreadCount(user) {
  return { unread: await repo.unreadCount(pool, user.user_id) };
}

/**
 * Unread notifications counted where each opens for the caller: per module, and per tab within it,
 * so a module's tabs add up to its count. Screens with none, and notices that open nowhere the
 * caller may go, are left out.
 */
async function badges(user) {
  const canOpen = opener(user);
  const modules = {};
  const tabs = {};
  for (const { entity_type: type, unread } of await repo.unreadByEntityType(pool, user.user_id)) {
    const screen = await screenTo(type, canOpen);
    if (!screen) continue;
    modules[screen.module] = (modules[screen.module] || 0) + unread;
    tabs[screen.module] = tabs[screen.module] || {};
    tabs[screen.module][screen.tab] = (tabs[screen.module][screen.tab] || 0) + unread;
  }
  return { modules, tabs };
}

/** Which of the records a list shows on one screen carry an unread notice of the caller's that opens there. */
async function unreadRecords(user, query) {
  const types = await typesShownOn(user, query.module, query.tab);
  return { ids: types.length ? await repo.unreadRecordIds(pool, user.user_id, types, query.ids) : [] };
}

/**
 * Where on one screen the caller's unread notices wait (§6, Where it waits): by the inner view each
 * record sits in, as its module places it (shared/notifications/views.js), each view counting its
 * own and those below it. A screen whose records would be too many to place counts on its tab
 * alone rather than fail.
 */
async function views(user, query) {
  const types = await typesShownOn(user, query.module, query.tab);
  const out = {};
  if (!types.length) return { views: out };
  let rows;
  try {
    rows = await repo.waitingByRecord(pool, user.user_id, types);
  } catch (err) {
    if (err.code !== "RESULT_SET_TOO_LARGE") throw err;
    logger.warn({ module: query.module, tab: query.tab }, "too many records with unread notices to place on one screen");
    return { views: out };
  }
  for (const type of types) {
    const mine = rows.filter((r) => r.entity_type === type);
    if (!mine.length) continue;
    const where = await viewsOf.placeAll(pool, { module: query.module, tab: query.tab, type, ids: mine.map((r) => r.entity_id) });
    for (const r of mine) {
      if (!where.has(r.entity_id)) continue;
      for (const p of viewsOf.pathsOf(where.get(r.entity_id))) {
        const v = (out[p] = out[p] || { unread: 0, urgent: false });
        v.unread += r.unread;
        v.urgent = v.urgent || Boolean(r.urgent);
      }
    }
  }
  return { views: out };
}

/**
 * A record opened on a screen: the caller's unread notices about it that open there are read, and
 * their other tabs and devices are told (`notification_read`, as for any read mark).
 */
async function readRecord(user, body) {
  const types = await typesShownOn(user, body.module, body.tab);
  if (!types.length) return;
  await tx(async (client) => {
    for (const type of types) await markReadForRecord(client, user, type, body.entity_id);
  });
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

/**
 * A record taken down (an archived announcement): every notice about it that nobody has opened,
 * or acknowledged when it needs Acknowledge, is withdrawn, so its urgent bar and repeats stop.
 * Notices already read or acknowledged stay, as history.
 */
async function withdrawForRecord(entityType, entityId) {
  return tx(async (client) => {
    const rows = await repo.withdrawForRecord(client, entityType, entityId);
    for (const r of rows) {
      await emit(client, {
        key: EVENTS.NOTIFICATION_WITHDRAWN,
        entity: { type: "notification", id: r.notification_id },
        actor: null,
        payload: { user_id: r.user_id, notification_id: r.notification_id },
        metadata: { by_record: `${entityType}:${entityId}` },
      });
    }
    return rows.length;
  });
}

/* ------------------------------------------------------------------ *
 * Acknowledge and the urgent repeats
 * ------------------------------------------------------------------ */

/**
 * Acknowledge on the urgent bar: one of the caller's notices that only Acknowledge closes,
 * acknowledged and read. Already acknowledged is a quiet no-op. The record's module hears
 * `notification.acknowledged` (an announcement records who acknowledged it).
 */
async function acknowledge(user, notificationId) {
  const row = await tx(async (client) => {
    const before = await repo.findOwnForUpdate(client, user.user_id, notificationId);
    if (!before) throw new AppError("NOT_FOUND", "There is no such notification.", 404);
    if (!before.acknowledge_required)
      throw new AppError("NOT_ACKNOWLEDGEABLE", "This notice needs no acknowledgement.", 422);
    if (before.acknowledged_at) return before;
    const after = await repo.acknowledge(client, notificationId);
    await emit(client, {
      key: EVENTS.NOTIFICATION_ACKNOWLEDGED,
      entity: { type: "notification", id: notificationId },
      actor: user,
      before,
      after,
      payload: {
        user_id: user.user_id,
        notification_id: notificationId,
        entity_type: before.entity_type,
        entity_id: before.entity_id,
      },
    });
    return after;
  });
  const [shown] = await present([row], opener(user));
  return shown;
}

/**
 * Closes the person's notices about one record inside the caller's transaction: acknowledged
 * where Acknowledge closes them, read everywhere (an urgent announcement acknowledged on its
 * card, announcements.service acknowledge). Their other tabs and devices are told.
 */
async function acknowledgeForRecord(client, user, entityType, entityId) {
  const ids = await repo.acknowledgeForRecord(client, user.user_id, entityType, entityId);
  for (const id of ids) {
    await emit(client, {
      key: EVENTS.NOTIFICATION_READ,
      entity: { type: "notification", id },
      actor: user,
      payload: { user_id: user.user_id, notification_id: id },
      metadata: { by_record: `${entityType}:${entityId}`, acknowledged: true },
    });
  }
  return ids.length;
}

/** The urgent repeats' pace (TB, 19/10/2026; docs/guides/notifications.md §6). */
const REPEAT = Object.freeze({ every: 30, perDay: 8, from: "08:00", until: "18:00" });
/** A push job retries for about 20 minutes: 10 s, doubling, eight tries. */
const PUSH_RETRY = Object.freeze({ attempts: 8, backoff: { type: "exponential", delay: 10_000 } });

/**
 * The `urgent-repeats` sweep: each open urgent notice whose last alert is 30 minutes old, between
 * 08:00 and 18:00 Lagos time and fewer than 8 times that day, alerted again: the banner and the
 * bar over the person's sockets, and a push to every device as the next round.
 * @param {Date} [now]
 * @returns {Promise<{repeated: number, outside_hours?: boolean}>}
 */
async function repeatUrgent(now = new Date()) {
  const time = lagos.timeOf(now);
  if (time < REPEAT.from || time >= REPEAT.until) return { repeated: 0, outside_hours: true };
  const pace = { day: lagos.today(now), every: REPEAT.every, perDay: REPEAT.perDay };
  let repeated = 0;
  for (const id of await repo.dueRepeats(pool, pace)) {
    const row = await repo.markRepeated(pool, id, pace);
    if (!row) continue;
    repeated += 1;
    realtime.toUser(row.user_id, "notification", await asNotice(row));
    if ((row.channels || []).includes("push")) {
      await queues.enqueue(
        "notification-push",
        "send",
        { notification_id: id, push: null, round: row.repeat_count },
        { ...PUSH_RETRY, jobId: `push-${id}-r${row.repeat_count}` },
      );
    }
  }
  return { repeated };
}

/* ------------------------------------------------------------------ *
 * Preferences
 * ------------------------------------------------------------------ */

/** Quiet hours as they first read when a person turns them on. */
const QUIET = Object.freeze({ from: "21:00", to: "07:00" });

/** The person's quiet hours and digest switch, defaults applied, with the company's digest. */
async function settingsOf(userId) {
  const [mine, company] = await Promise.all([repo.settingOf(pool, userId), reminders.rules(pool)]);
  return {
    quiet_enabled: mine ? mine.quiet_enabled : false,
    quiet_from: mine ? mine.quiet_from : QUIET.from,
    quiet_to: mine ? mine.quiet_to : QUIET.to,
    digest: mine ? mine.digest : true,
    digest_offered: company.digest.enabled,
    digest_at: company.digest.at_time,
  };
}

/** Every category with its channels as they are for this person, defaults applied, and their settings. */
async function preferences(user) {
  const stored = new Map();
  for (const r of await repo.preferenceRows(pool, user.user_id)) {
    if (!stored.has(r.category)) stored.set(r.category, {});
    stored.get(r.category)[r.channel] = r.enabled;
  }
  const three = (fn) => ({ in_app: fn("in_app"), email: fn("email"), push: fn("push") });
  return {
    settings: await settingsOf(user.user_id),
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

/** Quiet hours on or off, and when (docs/guides/notifications.md §6). */
async function setQuietHours(user, body) {
  await tx(async (client) => {
    const after = await repo.saveQuietHours(client, user.user_id, body);
    await emit(client, {
      key: EVENTS.NOTIFICATION_SETTING_CHANGED,
      entity: { type: "account", id: user.user_id },
      actor: user,
      after,
      payload: { user_id: user.user_id, quiet_enabled: after.quiet_enabled, quiet_from: after.quiet_from, quiet_to: after.quiet_to },
    });
  });
  return preferences(user);
}

/** The person's own daily digest on or off. */
async function setDigest(user, body) {
  await tx(async (client) => {
    const after = await repo.saveDigest(client, user.user_id, body.digest);
    await emit(client, {
      key: EVENTS.NOTIFICATION_SETTING_CHANGED,
      entity: { type: "account", id: user.user_id },
      actor: user,
      after,
      payload: { user_id: user.user_id, digest: after.digest },
    });
  });
  return preferences(user);
}

/**
 * When quiet hours that hold `now` end, or null when `now` is outside them. Lagos time; a window
 * whose end is before its start runs across midnight (21:00 to 07:00).
 */
function quietEnd(now, from, to) {
  const time = lagos.timeOf(now);
  const day = lagos.dateOf(now);
  if (from < to) return time >= from && time < to ? lagos.instant(day, to) : null;
  if (time >= from) return lagos.instant(lagos.addDays(day, 1), to);
  if (time < to) return lagos.instant(day, to);
  return null;
}

/** Per person in quiet hours now, when their pushes may go. */
async function quietUntil(userIds, now = new Date()) {
  const out = new Map();
  for (const r of await repo.quietHoursOf(pool, [...new Set(userIds)])) {
    const end = quietEnd(now, r.quiet_from, r.quiet_to);
    if (end) out.set(r.user_id, end);
  }
  return out;
}

/** Urgent notices and Security come through quiet hours (assumption A). */
const passesQuiet = (row) => row.urgency === "urgent" || row.category === "security";

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
  withdrawForRecord,
  list,
  asNotice,
  urgent,
  unreadCount,
  badges,
  unreadRecords,
  views,
  readRecord,
  markRead,
  markAllRead,
  opener,
  present,
  readState,
  markReadForRecord,
  acknowledge,
  acknowledgeForRecord,
  repeatUrgent,
  REPEAT,
  PUSH_RETRY,
  preferences,
  setPreference,
  setQuietHours,
  setDigest,
  quietEnd,
  quietUntil,
  passesQuiet,
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
