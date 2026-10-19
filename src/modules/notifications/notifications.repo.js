"use strict";
/**
 * The caller's own notifications. Every statement here is pinned to one user_id, so
 * nothing reads or marks another person's inbox. Only rows that go to the bell count:
 * `in_app` in channels (a row the fan-out wrote for email alone is not in the bell).
 *
 * Tables (migrations 0060, 0460; BACKEND_STRUCTURE §11.1): notification,
 * notification_preference, push_subscription, push_delivery. A person's devices and
 * preferences are pinned to their user_id the same way; the push job reads by id.
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

/** Which of these ids, all the caller's own, are read. */
async function readIds(db, userId, ids) {
  const { rows } = await db.query(
    `SELECT notification_id FROM notification
      WHERE user_id = $1 AND notification_id = ANY($2::uuid[]) AND read_at IS NOT NULL
      ORDER BY notification_id`,
    [userId, ids],
  );
  return rows.map((r) => r.notification_id);
}

/** Marks the caller's unread notices about one record read; returns the rows marked. */
async function markReadForRecord(db, userId, entityType, entityId) {
  const { rows } = await db.query(
    `UPDATE notification
        SET read_at = now(), updated_at = now()
      WHERE user_id = $1 AND entity_type = $2 AND entity_id = $3 AND read_at IS NULL
      RETURNING notification_id`,
    [userId, entityType, String(entityId)],
  );
  return rows.map((r) => r.notification_id);
}

/* ------------------------------------------------------------------ *
 * Preferences
 * ------------------------------------------------------------------ */

/** The caller's stored switches: at most one per category and channel. */
async function preferenceRows(db, userId) {
  // pagination:complete a person's own switches, at most three per category
  const { rows } = await completeQuery(
    db,
    `SELECT category, channel, enabled FROM notification_preference
      WHERE user_id = $1
      ORDER BY category, channel`,
    [userId],
    { label: "a person's notification preferences" },
  );
  return rows;
}

async function savePreference(db, { userId, category, channel, enabled }) {
  const { rows } = await db.query(
    `INSERT INTO notification_preference (user_id, category, channel, enabled)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, category, channel)
     DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = now()
     RETURNING category, channel, enabled`,
    [userId, category, channel, enabled],
  );
  return rows[0];
}

/* ------------------------------------------------------------------ *
 * Devices (push_subscription)
 * ------------------------------------------------------------------ */

const DEVICE_COLUMNS = `s.push_subscription_id, s.label, s.platform, s.created_at, s.last_seen_at,
  s.last_success_at`;

const SUBSCRIPTION_COLUMNS = `s.push_subscription_id, s.user_id, s.endpoint, s.p256dh, s.auth,
  s.expires_at, s.revoked_at, s.revoked_reason, s.device_token_hash, s.vapid_key_id, s.known_device_id,
  s.label, s.platform, s.created_at, s.last_seen_at, s.last_success_at, s.failure_count`;

/** One subscription by its endpoint, locked; null when this browser was never saved. */
async function subscriptionByEndpointForUpdate(db, endpoint) {
  const { rows } = await db.query(
    `SELECT ${SUBSCRIPTION_COLUMNS} FROM push_subscription s WHERE s.endpoint = $1 FOR UPDATE`,
    [endpoint],
  );
  return rows[0] || null;
}

/** One subscription by its id, locked. */
async function subscriptionForUpdate(db, id) {
  const { rows } = await db.query(
    `SELECT ${SUBSCRIPTION_COLUMNS} FROM push_subscription s WHERE s.push_subscription_id = $1 FOR UPDATE`,
    [id],
  );
  return rows[0] || null;
}

/** The person's device in this browser, from its cookie's hash, unless revoked. */
async function knownDeviceId(db, userId, fingerprintHash) {
  if (!fingerprintHash) return null;
  const { rows } = await db.query(
    `SELECT known_device_id FROM known_device
      WHERE user_id = $1 AND fingerprint_hash = $2 AND revoked_at IS NULL`,
    [userId, fingerprintHash],
  );
  return rows[0] ? rows[0].known_device_id : null;
}

async function insertSubscription(db, d) {
  const { rows } = await db.query(
    `INSERT INTO push_subscription
       (user_id, endpoint, p256dh, auth, expires_at, device_token_hash, vapid_key_id, known_device_id,
        label, platform, last_seen_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
     RETURNING push_subscription_id`,
    [d.userId, d.endpoint, d.p256dh, d.auth, d.expiresAt, d.tokenHash, d.keyId, d.knownDeviceId, d.label, d.platform],
  );
  return rows[0].push_subscription_id;
}

/** Saves this browser's subscription onto an existing row: active again, owned by userId. */
async function updateSubscription(db, id, d) {
  await db.query(
    `UPDATE push_subscription
        SET user_id = $2, endpoint = $3, p256dh = $4, auth = $5, expires_at = $6,
            device_token_hash = COALESCE($7, device_token_hash), vapid_key_id = $8,
            known_device_id = COALESCE($9, known_device_id), label = $10, platform = $11,
            last_seen_at = now(), revoked_at = NULL, revoked_reason = NULL,
            failure_count = 0, last_error = NULL, updated_at = now()
      WHERE push_subscription_id = $1`,
    [id, d.userId, d.endpoint, d.p256dh, d.auth, d.expiresAt, d.tokenHash, d.keyId, d.knownDeviceId, d.label, d.platform],
  );
}

/** A renewed subscription's new endpoint and keys, from its service worker. */
async function renewSubscription(db, id, { endpoint, p256dh, auth, expiresAt, keyId }) {
  await db.query(
    `UPDATE push_subscription
        SET endpoint = $2, p256dh = $3, auth = $4, expires_at = $5, vapid_key_id = $6,
            last_seen_at = now(), failure_count = 0, last_error = NULL, updated_at = now()
      WHERE push_subscription_id = $1`,
    [id, endpoint, p256dh, auth, expiresAt, keyId],
  );
}

/** Deletes a stale row of the same browser whose endpoint a renewal takes over. */
async function deleteSubscription(db, id) {
  await db.query("DELETE FROM push_subscription WHERE push_subscription_id = $1", [id]);
}

async function deviceById(db, id) {
  const { rows } = await db.query(
    `SELECT ${DEVICE_COLUMNS} FROM push_subscription s WHERE s.push_subscription_id = $1`,
    [id],
  );
  return rows[0] || null;
}

/** The caller's devices with push on, most recently seen first. */
function devices(db, userId, query) {
  return pageQuery(
    db,
    `SELECT ${DEVICE_COLUMNS}, ${TOTAL_COL}
       FROM push_subscription s
      WHERE s.user_id = $1 AND s.revoked_at IS NULL
      ORDER BY s.last_seen_at DESC NULLS LAST, s.push_subscription_id`,
    [userId],
    query,
  );
}

/** Every live subscription of one person, to send a notice to. */
async function liveSubscriptions(db, userId) {
  // pagination:complete one person's own browsers with push on, a handful
  const { rows } = await completeQuery(
    db,
    `SELECT ${SUBSCRIPTION_COLUMNS}
       FROM push_subscription s
      WHERE s.user_id = $1 AND s.revoked_at IS NULL
      ORDER BY s.push_subscription_id`,
    [userId],
    { label: "a person's devices with push on" },
  );
  return rows;
}

/** Revokes one subscription; returns it, or null when it was already off. */
async function revoke(db, id, reason) {
  const { rows } = await db.query(
    `UPDATE push_subscription
        SET revoked_at = now(), revoked_reason = $2, updated_at = now()
      WHERE push_subscription_id = $1 AND revoked_at IS NULL
      RETURNING push_subscription_id, user_id`,
    [id, reason],
  );
  return rows[0] || null;
}

/**
 * Revokes a person's live subscriptions; with `exceptKnownDeviceId`, all but the ones on
 * that device (Sign Out Others keeps the device it was pressed on). Returns the ids.
 */
async function revokeUser(db, userId, reason, { exceptKnownDeviceId } = {}) {
  const { rows } = await db.query(
    `UPDATE push_subscription
        SET revoked_at = now(), revoked_reason = $2, updated_at = now()
      WHERE user_id = $1 AND revoked_at IS NULL
        AND ($3::uuid IS NULL OR known_device_id IS DISTINCT FROM $3::uuid)
      RETURNING push_subscription_id`,
    [userId, reason, exceptKnownDeviceId || null],
  );
  return rows.map((r) => r.push_subscription_id);
}

/** The device a session was signed in on (Sign Out Others keeps that one). */
async function sessionDevice(db, sessionId) {
  if (!sessionId) return null;
  const { rows } = await db.query("SELECT known_device_id FROM user_session WHERE session_id = $1", [sessionId]);
  return rows[0] ? rows[0].known_device_id : null;
}

async function noteSuccess(db, id) {
  await db.query(
    `UPDATE push_subscription
        SET last_success_at = now(), failure_count = 0, last_error = NULL, updated_at = now()
      WHERE push_subscription_id = $1`,
    [id],
  );
}

async function noteFailure(db, id, error) {
  await db.query(
    `UPDATE push_subscription
        SET last_failure_at = now(), failure_count = failure_count + 1, last_error = $2, updated_at = now()
      WHERE push_subscription_id = $1`,
    [id, String(error || "").slice(0, 300)],
  );
}

/* ------------------------------------------------------------------ *
 * Sending
 * ------------------------------------------------------------------ */

/** A notice as the push job needs it, with whether its person can still be reached. */
async function forPush(db, notificationId) {
  const { rows } = await db.query(
    `SELECT n.notification_id, n.user_id, n.category, n.priority, n.title, n.body, n.entity_type,
            n.entity_id, n.channels, n.read_at, n.created_at, (u.status = 'active') AS reachable
       FROM notification n JOIN app_user u ON u.user_id = n.user_id
      WHERE n.notification_id = $1`,
    [notificationId],
  );
  return rows[0] || null;
}

/** The sends of one notice already made, by subscription. */
async function deliveriesOf(db, notificationId) {
  // pagination:complete one notice's sends, one per device of one person
  const { rows } = await completeQuery(
    db,
    `SELECT push_subscription_id, status, attempts FROM push_delivery
      WHERE notification_id = $1
      ORDER BY push_subscription_id`,
    [notificationId],
    { label: "one notice's pushes" },
  );
  return new Map(rows.map((r) => [r.push_subscription_id, r]));
}

/** Records what happened to one send (a test push has no notice). */
async function recordDelivery(db, { notificationId, subscriptionId, status, httpStatus, error }) {
  if (!notificationId) {
    await db.query(
      `INSERT INTO push_delivery (notification_id, push_subscription_id, status, http_status, error, attempts, sent_at)
       VALUES (NULL, $1, $2, $3, $4, 1, CASE WHEN $2 = 'sent' THEN now() END)`,
      [subscriptionId, status, httpStatus ?? null, error ?? null],
    );
    return;
  }
  await db.query(
    `INSERT INTO push_delivery (notification_id, push_subscription_id, status, http_status, error, attempts, sent_at)
     VALUES ($1, $2, $3, $4, $5, 1, CASE WHEN $3 = 'sent' THEN now() END)
     ON CONFLICT (notification_id, push_subscription_id) WHERE notification_id IS NOT NULL
     DO UPDATE SET status = EXCLUDED.status, http_status = EXCLUDED.http_status, error = EXCLUDED.error,
                   attempts = push_delivery.attempts + 1,
                   sent_at = COALESCE(push_delivery.sent_at, EXCLUDED.sent_at), updated_at = now()`,
    [notificationId, subscriptionId, status, httpStatus ?? null, error ?? null],
  );
}

module.exports = {
  list,
  unreadCount,
  unreadByEntityType,
  findOwnForUpdate,
  markRead,
  markAllRead,
  readIds,
  markReadForRecord,
  preferenceRows,
  savePreference,
  subscriptionByEndpointForUpdate,
  subscriptionForUpdate,
  knownDeviceId,
  insertSubscription,
  updateSubscription,
  renewSubscription,
  deleteSubscription,
  deviceById,
  devices,
  liveSubscriptions,
  revoke,
  revokeUser,
  sessionDevice,
  noteSuccess,
  noteFailure,
  forPush,
  deliveriesOf,
  recordDelivery,
};
