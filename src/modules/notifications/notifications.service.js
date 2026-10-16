"use strict";
/**
 * The bell: the caller's own notifications, their unread count, the badges per module,
 * and the read mark.
 *
 * A notification's link is derived when it is read (shared/route-map.js), and only kept
 * when the reader may open that module: a notice about a record they cannot open still
 * says what happened, without a button that lands on a refusal.
 */
const { pool } = require("../../config/db");
const { atomically } = require("../../shared/db/tx");
const { emit } = require("../../shared/events/emit");
const { AppError } = require("../../shared/errors");
const routeMap = require("../../shared/route-map");
const grantsCache = require("../../shared/rbac/grants-cache");
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

module.exports = { list, unreadCount, badges, markRead, markAllRead };
