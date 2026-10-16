"use strict";
/**
 * The caller's own notifications. Every statement here is pinned to one user_id, so
 * nothing reads or marks another person's inbox. Only rows that go to the bell count:
 * `in_app` in channels (a row the fan-out wrote for email alone is not in the bell).
 *
 * Table (migration 0060; BACKEND_STRUCTURE §11.1): notification.
 */
const { pageQuery, completeQuery, TOTAL_COL } = require("../../shared/http/paged");

const COLUMNS = `n.notification_id, n.category, n.priority, n.title, n.body, n.entity_type,
  n.entity_id, n.read_at, n.created_at`;

/** Newest first; `status` narrows to unread or read. */
function list(db, userId, query) {
  return pageQuery(
    db,
    `SELECT ${COLUMNS}, ${TOTAL_COL}
       FROM notification n
      WHERE n.user_id = $1
        AND 'in_app' = ANY(n.channels)
        AND ($2::text IS NULL
             OR ($2 = 'unread' AND n.read_at IS NULL)
             OR ($2 = 'read' AND n.read_at IS NOT NULL))
      ORDER BY n.created_at DESC, n.notification_id DESC`,
    [userId, query.status ?? null],
    query,
  );
}

async function unreadCount(db, userId) {
  const { rows } = await db.query(
    `SELECT count(*)::int AS unread
       FROM notification
      WHERE user_id = $1 AND read_at IS NULL AND 'in_app' = ANY(channels)`,
    [userId],
  );
  return rows[0].unread;
}

/** Unread rows counted per record type: the badges sum them per module. */
async function unreadByEntityType(db, userId) {
  // pagination:complete one row per record type with something unread, a few dozen at most
  const { rows } = await completeQuery(
    db,
    `SELECT entity_type, count(*)::int AS unread
       FROM notification
      WHERE user_id = $1 AND read_at IS NULL AND 'in_app' = ANY(channels)
        AND entity_type IS NOT NULL
      GROUP BY entity_type
      ORDER BY entity_type`,
    [userId],
    { label: "unread notifications by record type" },
  );
  return rows;
}

/** One of the caller's own rows, locked for the read mark; null when it is not theirs. */
async function findOwnForUpdate(db, userId, notificationId) {
  const { rows } = await db.query(
    `SELECT ${COLUMNS}
       FROM notification n
      WHERE n.notification_id = $1 AND n.user_id = $2 AND 'in_app' = ANY(n.channels)
      FOR UPDATE`,
    [notificationId, userId],
  );
  return rows[0] || null;
}

async function markRead(db, notificationId) {
  const { rows } = await db.query(
    `UPDATE notification n
        SET read_at = now(), updated_at = now()
      WHERE n.notification_id = $1
      RETURNING ${COLUMNS}`,
    [notificationId],
  );
  return rows[0];
}

/** Marks every unread bell row of the caller; returns how many. */
async function markAllRead(db, userId) {
  const { rows } = await db.query(
    `WITH marked AS (
       UPDATE notification
          SET read_at = now(), updated_at = now()
        WHERE user_id = $1 AND read_at IS NULL AND 'in_app' = ANY(channels)
        RETURNING 1
     )
     SELECT count(*)::int AS marked FROM marked`,
    [userId],
  );
  return rows[0].marked;
}

module.exports = {
  list,
  unreadCount,
  unreadByEntityType,
  findOwnForUpdate,
  markRead,
  markAllRead,
};
