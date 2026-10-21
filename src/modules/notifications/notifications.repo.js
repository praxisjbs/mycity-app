"use strict";
/**
 * The caller's own notifications. Every statement here is pinned to one user_id, so
 * nothing reads or marks another person's inbox. Only rows that go to the bell count:
 * `in_app` in channels (a row the fan-out wrote for email alone is not in the bell).
 *
 * Tables (migrations 0060, 0460, 0470, 0480; BACKEND_STRUCTURE §11.1): notification,
 * notification_preference, push_subscription, push_delivery, notification_setting. A person's
 * devices, preferences and settings are pinned to their user_id the same way; the push job and
 * the urgent repeats read by id.
 *
 * Also the company's side (Settings · Notifications, behind `settings` in the routes):
 * notification_rule and its recipients, notification_reminder_rule; the reminder engine's
 * occurrences (reminder); and what the company's reminders read (pending approvals, probations).
 */
const { pageQuery, completeQuery, TOTAL_COL } = require("../../shared/http/paged");
const { personJson } = require("../../shared/db/person");

const COLUMNS = `n.notification_id, n.category, n.priority, n.urgency, n.acknowledge_required,
  n.acknowledged_at, n.repeat_count, n.title, n.body, n.entity_type, n.entity_id, n.read_at, n.created_at`;

/** An urgent notice still open: closed by Acknowledge when it needs one, else by reading it. */
const OPEN_URGENT = `n.urgency = 'urgent'
  AND CASE WHEN n.acknowledge_required THEN n.acknowledged_at IS NULL ELSE n.read_at IS NULL END`;

/** Remove a record's notices nobody has opened (or acknowledged, where Acknowledge closes them); returns who held them. */
async function withdrawForRecord(db, entityType, entityId) {
  const { rows } = await db.query(
    `DELETE FROM notification n
      WHERE n.entity_type = $1 AND n.entity_id = $2
        AND CASE WHEN n.acknowledge_required THEN n.acknowledged_at IS NULL ELSE n.read_at IS NULL END
      RETURNING n.notification_id, n.user_id`,
    [entityType, entityId],
  );
  return rows;
}

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
 * Urgent notices: the bar, Acknowledge and the repeats
 * ------------------------------------------------------------------ */

/** The caller's open urgent notices, newest first: the urgent bar. */
function urgentOpen(db, userId, query) {
  return pageQuery(
    db,
    `SELECT ${COLUMNS}, ${TOTAL_COL}
       FROM notification n
      WHERE n.user_id = $1 AND 'in_app' = ANY(n.channels) AND ${OPEN_URGENT}
      ORDER BY n.created_at DESC, n.notification_id DESC`,
    [userId],
    query,
  );
}

/** Acknowledges one row and reads it, each once; returns it as the bell shows it. */
async function acknowledge(db, notificationId) {
  const { rows } = await db.query(
    `UPDATE notification n
        SET acknowledged_at = COALESCE(n.acknowledged_at, now()), read_at = COALESCE(n.read_at, now()),
            updated_at = now()
      WHERE n.notification_id = $1
      RETURNING ${COLUMNS}`,
    [notificationId],
  );
  return rows[0];
}

/**
 * Closes the person's notices about one record: acknowledged where Acknowledge closes them, read
 * everywhere. Returns the ids changed (an urgent announcement acknowledged on its card).
 */
async function acknowledgeForRecord(db, userId, entityType, entityId) {
  const { rows } = await db.query(
    `UPDATE notification
        SET acknowledged_at = CASE WHEN acknowledge_required THEN COALESCE(acknowledged_at, now())
                                   ELSE acknowledged_at END,
            read_at = COALESCE(read_at, now()), updated_at = now()
      WHERE user_id = $1 AND entity_type = $2 AND entity_id = $3
        AND (read_at IS NULL OR (acknowledge_required AND acknowledged_at IS NULL))
      RETURNING notification_id`,
    [userId, entityType, String(entityId)],
  );
  return rows.map((r) => r.notification_id);
}

/**
 * Open urgent notices of active people whose last alert is `every` minutes old or more and that
 * have repeated fewer than `perDay` times on `day` (a Lagos date).
 */
async function dueRepeats(db, { day, every, perDay }) {
  // pagination:complete the open urgent notices due a repeat, a few at a time across the company
  const { rows } = await completeQuery(
    db,
    `SELECT n.notification_id
       FROM notification n JOIN app_user u ON u.user_id = n.user_id AND u.status = 'active'
      WHERE ${OPEN_URGENT}
        AND COALESCE(n.last_alert_at, n.created_at) <= now() - make_interval(mins => $2::int)
        AND (n.repeat_day IS DISTINCT FROM $1::date OR n.repeats_on_day < $3::int)
      ORDER BY n.created_at, n.notification_id`,
    [day, every, perDay],
    { label: "urgent notices due a repeat" },
  );
  return rows.map((r) => r.notification_id);
}

/**
 * Counts one repeat of a notice still open and due, once: null when it closed meanwhile or
 * another sweep already counted it. Returns the row as the bell shows it, with its person.
 */
async function markRepeated(db, notificationId, { day, every, perDay }) {
  const { rows } = await db.query(
    `UPDATE notification n
        SET repeat_count = n.repeat_count + 1, last_alert_at = now(),
            repeats_on_day = CASE WHEN n.repeat_day = $2::date THEN n.repeats_on_day + 1 ELSE 1 END,
            repeat_day = $2::date, updated_at = now()
      WHERE n.notification_id = $1 AND ${OPEN_URGENT}
        AND COALESCE(n.last_alert_at, n.created_at) <= now() - make_interval(mins => $3::int)
        AND (n.repeat_day IS DISTINCT FROM $2::date OR n.repeats_on_day < $4::int)
      RETURNING ${COLUMNS}, n.user_id, n.channels`,
    [notificationId, day, every, perDay],
  );
  return rows[0] || null;
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
    `SELECT n.notification_id, n.user_id, n.category, n.priority, n.urgency, n.acknowledge_required,
            n.acknowledged_at, n.title, n.body, n.entity_type, n.entity_id, n.channels, n.read_at,
            n.created_at, (u.status = 'active') AS reachable
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
    `SELECT push_subscription_id, status, attempts, round FROM push_delivery
      WHERE notification_id = $1
      ORDER BY push_subscription_id`,
    [notificationId],
    { label: "one notice's pushes" },
  );
  return new Map(rows.map((r) => [r.push_subscription_id, r]));
}

/**
 * Records what happened to one send (a test push has no notice). A notice keeps one row per
 * device: a later round (an urgent repeat) starts it again, and a late retry of an earlier
 * round changes nothing.
 */
async function recordDelivery(db, { notificationId, subscriptionId, status, httpStatus, error, round = 0 }) {
  if (!notificationId) {
    await db.query(
      `INSERT INTO push_delivery (notification_id, push_subscription_id, status, http_status, error, attempts, sent_at)
       VALUES (NULL, $1, $2, $3, $4, 1, CASE WHEN $2 = 'sent' THEN now() END)`,
      [subscriptionId, status, httpStatus ?? null, error ?? null],
    );
    return;
  }
  await db.query(
    `INSERT INTO push_delivery (notification_id, push_subscription_id, status, http_status, error, attempts, sent_at, round)
     VALUES ($1, $2, $3, $4, $5, 1, CASE WHEN $3 = 'sent' THEN now() END, $6)
     ON CONFLICT (notification_id, push_subscription_id) WHERE notification_id IS NOT NULL
     DO UPDATE SET status = EXCLUDED.status, http_status = EXCLUDED.http_status, error = EXCLUDED.error,
                   attempts = CASE WHEN EXCLUDED.round > push_delivery.round THEN 1
                                   ELSE push_delivery.attempts + 1 END,
                   sent_at = CASE WHEN EXCLUDED.round > push_delivery.round THEN EXCLUDED.sent_at
                                  ELSE COALESCE(push_delivery.sent_at, EXCLUDED.sent_at) END,
                   round = EXCLUDED.round, updated_at = now()
     WHERE EXCLUDED.round >= push_delivery.round`,
    [notificationId, subscriptionId, status, httpStatus ?? null, error ?? null, round],
  );
}

/* ------------------------------------------------------------------ *
 * A person's settings: quiet hours and the digest (notification_setting)
 * ------------------------------------------------------------------ */

const SETTING_COLUMNS = `s.quiet_enabled, to_char(s.quiet_from, 'HH24:MI') AS quiet_from,
  to_char(s.quiet_to, 'HH24:MI') AS quiet_to, s.digest`;

/** The person's row, or null before they changed anything. */
async function settingOf(db, userId) {
  const { rows } = await db.query(
    `SELECT ${SETTING_COLUMNS} FROM notification_setting s WHERE s.user_id = $1`,
    [userId],
  );
  return rows[0] || null;
}

async function saveQuietHours(db, userId, { quiet_enabled: on, quiet_from: from, quiet_to: to }) {
  const { rows } = await db.query(
    `INSERT INTO notification_setting AS s (user_id, quiet_enabled, quiet_from, quiet_to)
     VALUES ($1, $2, $3::time, $4::time)
     ON CONFLICT (user_id) DO UPDATE
       SET quiet_enabled = EXCLUDED.quiet_enabled, quiet_from = EXCLUDED.quiet_from, quiet_to = EXCLUDED.quiet_to
     RETURNING ${SETTING_COLUMNS}`,
    [userId, on, from, to],
  );
  return rows[0];
}

async function saveDigest(db, userId, digest) {
  const { rows } = await db.query(
    `INSERT INTO notification_setting AS s (user_id, digest) VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET digest = EXCLUDED.digest
     RETURNING ${SETTING_COLUMNS}`,
    [userId, digest],
  );
  return rows[0];
}

/** Quiet hours of those of these people who turned them on. */
async function quietHoursOf(db, userIds) {
  if (userIds.length === 0) return [];
  // pagination:complete one row per person of one event's notices, each a person told of it
  const { rows } = await completeQuery(
    db,
    `SELECT s.user_id, to_char(s.quiet_from, 'HH24:MI') AS quiet_from, to_char(s.quiet_to, 'HH24:MI') AS quiet_to
       FROM notification_setting s
      WHERE s.user_id = ANY($1::uuid[]) AND s.quiet_enabled
      ORDER BY s.user_id`,
    [userIds],
    { label: "quiet hours of one event's people" },
  );
  return rows;
}

/* ------------------------------------------------------------------ *
 * Settings · Notifications: the company's rule per notice
 * ------------------------------------------------------------------ */

const RULE_COLUMNS = `r.notification_rule_id, r.enabled, r.urgency, r.in_app, r.email, r.push, r.updated_at`;

/**
 * One page of notices with their rules. The catalogue is the code's (fanout.notices()), passed
 * in as arrays in its order, so the page, the category filter and the search are the
 * database's, as for every other list.
 */
function rulePage(db, notices, query) {
  return pageQuery(
    db,
    `SELECT n.event_key, ${RULE_COLUMNS}, ${TOTAL_COL}
       FROM unnest($1::text[], $2::text[], $3::text[], $4::int[]) AS n(event_key, name, category, position)
       LEFT JOIN notification_rule r ON r.event_key = n.event_key
      WHERE ($5::text IS NULL OR n.category = $5)
        AND ($6::text IS NULL OR search_fold(n.name) LIKE '%' || search_fold($6) || '%')
      ORDER BY n.position, n.event_key`,
    [
      notices.map((n) => n.event_key),
      notices.map((n) => n.name),
      notices.map((n) => n.category),
      notices.map((_, i) => i),
      query.category ?? null,
      query.q ?? null,
    ],
    query,
  );
}

async function ruleOf(db, eventKey, { lock = false } = {}) {
  const { rows } = await db.query(
    `SELECT ${RULE_COLUMNS} FROM notification_rule r WHERE r.event_key = $1${lock ? " FOR UPDATE" : ""}`,
    [eventKey],
  );
  return rows[0] || null;
}

/** The roles each of these rules copies to, as the role picker names them. */
async function copiedRoles(db, ruleIds) {
  if (ruleIds.length === 0) return [];
  // pagination:complete the copies of one page of rules, at most 25 roles each
  const { rows } = await completeQuery(
    db,
    `SELECT rr.notification_rule_id, ro.code::text AS code, ro.name
       FROM notification_rule_recipient rr JOIN role ro ON ro.role_id = rr.role_id
      WHERE rr.notification_rule_id = ANY($1::uuid[])
      ORDER BY rr.notification_rule_id, ro.name, ro.role_id`,
    [ruleIds],
    { label: "roles a page of notices is copied to" },
  );
  return rows;
}

/** The people each of these rules copies to, as PersonRef. */
async function copiedPeople(db, ruleIds) {
  if (ruleIds.length === 0) return [];
  // pagination:complete the copies of one page of rules, at most 25 people each
  const { rows } = await completeQuery(
    db,
    `SELECT rr.notification_rule_id, ${personJson("e", "d")} AS person
       FROM notification_rule_recipient rr
       JOIN employee e ON e.employee_id = rr.employee_id
       LEFT JOIN department d ON d.department_id = e.department_id
      WHERE rr.notification_rule_id = ANY($1::uuid[])
      ORDER BY rr.notification_rule_id, e.last_name, e.first_name, e.employee_id`,
    [ruleIds],
    { label: "people a page of notices is copied to" },
  );
  return rows;
}

async function saveRule(db, { eventKey, enabled, urgency, in_app: inApp, email, push, updatedBy }) {
  const { rows } = await db.query(
    `INSERT INTO notification_rule AS r (event_key, enabled, urgency, in_app, email, push, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (event_key) DO UPDATE
       SET enabled = EXCLUDED.enabled, urgency = EXCLUDED.urgency, in_app = EXCLUDED.in_app,
           email = EXCLUDED.email, push = EXCLUDED.push, updated_by = EXCLUDED.updated_by
     RETURNING ${RULE_COLUMNS}`,
    [eventKey, enabled, urgency, inApp, email, push, updatedBy],
  );
  return rows[0];
}

/** A rule's copies replaced by these roles and people. */
async function replaceCopies(db, ruleId, { roleIds, employeeIds }) {
  await db.query("DELETE FROM notification_rule_recipient WHERE notification_rule_id = $1", [ruleId]);
  await db.query(
    `INSERT INTO notification_rule_recipient (notification_rule_id, role_id)
     SELECT $1, unnest($2::uuid[])
     ON CONFLICT DO NOTHING`,
    [ruleId, roleIds],
  );
  await db.query(
    `INSERT INTO notification_rule_recipient (notification_rule_id, employee_id)
     SELECT $1, unnest($2::uuid[])
     ON CONFLICT DO NOTHING`,
    [ruleId, employeeIds],
  );
}

/** Reset to Default: the rule and its copies go. */
async function deleteRule(db, eventKey) {
  const { rowCount } = await db.query("DELETE FROM notification_rule WHERE event_key = $1", [eventKey]);
  return rowCount > 0;
}

/** Active roles by code (citext), for copies. */
async function rolesByCode(db, codes) {
  if (codes.length === 0) return [];
  // pagination:complete the roles one notice is copied to, at most 25
  const { rows } = await completeQuery(
    db,
    "SELECT role_id, code::text AS code, name FROM role WHERE code = ANY($1::citext[]) ORDER BY code",
    [codes],
    { label: "roles named for one notice's copies" },
  );
  return rows;
}

/** Which of these employees are on the staff (not archived), for copies. */
async function currentEmployees(db, ids) {
  if (ids.length === 0) return [];
  // pagination:complete the people one notice is copied to, at most 25
  const { rows } = await completeQuery(
    db,
    "SELECT employee_id FROM employee WHERE employee_id = ANY($1::uuid[]) AND status <> 'archived' ORDER BY employee_id",
    [ids],
    { label: "people named for one notice's copies" },
  );
  return rows.map((r) => r.employee_id);
}

/* ------------------------------------------------------------------ *
 * Settings · Notifications: the company's reminders
 * ------------------------------------------------------------------ */

/** The saved reminder rules: at most one per reminder. */
async function reminderRules(db) {
  // pagination:complete the company's three reminder rules
  const { rows } = await completeQuery(
    db,
    `SELECT reminder_key, enabled, every_hours, days_ahead, to_char(at_time, 'HH24:MI') AS at_time
       FROM notification_reminder_rule ORDER BY reminder_key`,
    [],
    { label: "the company's reminder rules" },
  );
  return rows;
}

async function saveReminderRule(db, { key, enabled, every_hours: everyHours = null, days_ahead: daysAhead = null, at_time: atTime = null, updatedBy }) {
  await db.query(
    `INSERT INTO notification_reminder_rule (reminder_key, enabled, every_hours, days_ahead, at_time, updated_by)
     VALUES ($1, $2, $3, $4, $5::time, $6)
     ON CONFLICT (reminder_key) DO UPDATE
       SET enabled = EXCLUDED.enabled, every_hours = EXCLUDED.every_hours, days_ahead = EXCLUDED.days_ahead,
           at_time = EXCLUDED.at_time, updated_by = EXCLUDED.updated_by`,
    [key, enabled, everyHours, daysAhead, atTime, updatedBy],
  );
}

/* ------------------------------------------------------------------ *
 * The reminder engine (reminder)
 * ------------------------------------------------------------------ */

const REMINDER_COLUMNS = `reminder_id, reminder_key, entity_type, entity_id, occurrence, due_at, every_minutes,
  work_hours, payload, fired_count, last_fired_at, state`;

/** Add an occurrence unless it is already there (found). True when added. */
async function addReminder(db, r) {
  const { rowCount } = await db.query(
    `INSERT INTO reminder (reminder_key, entity_type, entity_id, occurrence, due_at, every_minutes, work_hours, payload)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
     ON CONFLICT (reminder_key, entity_type, entity_id, occurrence) DO NOTHING`,
    [r.key, r.entity_type, String(r.entity_id), r.occurrence || "", r.due_at, r.every_minutes ?? null, Boolean(r.work_hours), JSON.stringify(r.payload || {})],
  );
  return rowCount > 0;
}

/** Schedule an occurrence, or move it and start its count again. */
async function scheduleReminder(db, r) {
  const { rows } = await db.query(
    `INSERT INTO reminder (reminder_key, entity_type, entity_id, occurrence, due_at, every_minutes, work_hours, payload)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
     ON CONFLICT (reminder_key, entity_type, entity_id, occurrence) DO UPDATE
       SET due_at = EXCLUDED.due_at, every_minutes = EXCLUDED.every_minutes, work_hours = EXCLUDED.work_hours,
           payload = EXCLUDED.payload, fired_count = 0, last_fired_at = NULL, state = 'pending'
     RETURNING reminder_id`,
    [r.key, r.entity_type, String(r.entity_id), r.occurrence || "", r.due_at, r.every_minutes ?? null, Boolean(r.work_hours), JSON.stringify(r.payload || {})],
  );
  return rows[0].reminder_id;
}

/** Cancel a record's pending occurrences of a reminder (one occurrence when named). */
async function cancelReminders(db, { key, entityType, entityId, occurrence = null }) {
  const { rowCount } = await db.query(
    `UPDATE reminder SET state = 'cancelled'
      WHERE reminder_key = $1 AND entity_type = $2 AND entity_id = $3
        AND ($4::text IS NULL OR occurrence = $4) AND state = 'pending'`,
    [key, entityType, String(entityId), occurrence],
  );
  return rowCount;
}

/** Occurrences due now, oldest first. */
async function dueReminders(db, now, keys) {
  const { rows } = await db.query(
    `SELECT reminder_id, reminder_key FROM reminder
      WHERE state = 'pending' AND due_at <= $1 AND reminder_key = ANY($2::text[])
      ORDER BY due_at, reminder_id
      LIMIT 200 -- pagination:batch occurrences one reminders tick fires`,
    [now, keys],
  );
  return rows;
}

/** One due occurrence, locked for its firing; null when another worker has it or it moved. */
async function reminderForFiring(db, id, now) {
  const { rows } = await db.query(
    `SELECT ${REMINDER_COLUMNS} FROM reminder
      WHERE reminder_id = $1 AND state = 'pending' AND due_at <= $2
      FOR UPDATE SKIP LOCKED`,
    [id, now],
  );
  return rows[0] || null;
}

/** Move an occurrence on without firing it. */
async function moveReminder(db, id, { dueAt, payload = null, everyMinutes = null }) {
  await db.query(
    `UPDATE reminder SET due_at = $2, payload = COALESCE($3::jsonb, payload),
            every_minutes = COALESCE($4, every_minutes)
      WHERE reminder_id = $1`,
    [id, dueAt, payload === null ? null : JSON.stringify(payload), everyMinutes],
  );
}

/** Record a firing: the next one at `next`, or finished when there is none. */
async function reminderFired(db, id, { now, next, everyMinutes = null }) {
  await db.query(
    `UPDATE reminder
        SET fired_count = fired_count + 1, last_fired_at = $2,
            due_at = COALESCE($3, due_at), every_minutes = COALESCE($4, every_minutes),
            state = CASE WHEN $3::timestamptz IS NULL THEN 'done' ELSE state END
      WHERE reminder_id = $1`,
    [id, now, next, everyMinutes],
  );
}

async function finishReminder(db, id) {
  await db.query("UPDATE reminder SET state = 'done' WHERE reminder_id = $1", [id]);
}

/**
 * A new approval interval for every approval already waiting: each next reminder counts from
 * its last one (or from when its stage started), and never falls before now.
 */
async function repaceReminders(db, key, everyMinutes, now) {
  const { rowCount } = await db.query(
    `UPDATE reminder
        SET every_minutes = $2,
            due_at = GREATEST($3::timestamptz,
                              COALESCE(last_fired_at, (payload->>'since')::timestamptz, created_at)
                                + make_interval(mins => $2))
      WHERE reminder_key = $1 AND state = 'pending'`,
    [key, everyMinutes, now],
  );
  return rowCount;
}

/* ------------------------------------------------------------------ *
 * What the company's reminders read
 * ------------------------------------------------------------------ */

/** Pending approvals with no Approvals Waiting occurrence yet. */
async function approvalsToRemind(db) {
  const { rows } = await db.query(
    `SELECT wi.workflow_instance_id, wi.current_stage, wi.stage_entered_at
       FROM workflow_instance wi
      WHERE wi.state = 'pending'
        AND NOT EXISTS (SELECT 1 FROM reminder r
                         WHERE r.reminder_key = 'approval_waiting' AND r.entity_type = 'workflow_instance'
                           AND r.entity_id = wi.workflow_instance_id::text)
      ORDER BY wi.stage_entered_at, wi.workflow_instance_id
      LIMIT 200 -- pagination:batch approvals one reminders tick starts counting`,
  );
  return rows;
}

/** One approval as its reminder needs it. */
async function approvalOf(db, instanceId) {
  const { rows } = await db.query(
    `SELECT workflow_instance_id, workflow_definition_id, definition_key, entity_type, entity_id, state,
            current_stage, stage_entered_at, stage_approvers, subject_employee_id, opened_by, excluded_employee_ids
       FROM workflow_instance WHERE workflow_instance_id = $1`,
    [instanceId],
  );
  return rows[0] || null;
}

/** Unconfirmed people whose confirmation falls between two days, not yet reminded for that date. */
async function probationsToRemind(db, { from, until }) {
  const { rows } = await db.query(
    `SELECT e.employee_id, e.confirmation_due_on::text AS due_on
       FROM employee e
      WHERE e.confirmation_due_on BETWEEN $1::date AND $2::date
        AND e.confirmed_on IS NULL AND e.status <> 'archived'
        AND NOT EXISTS (SELECT 1 FROM reminder r
                         WHERE r.reminder_key = 'probation_ending' AND r.entity_type = 'employee'
                           AND r.entity_id = e.employee_id::text AND r.occurrence = e.confirmation_due_on::text)
      ORDER BY e.confirmation_due_on, e.employee_id
      LIMIT 200 -- pagination:batch probations one reminders tick finds`,
    [from, until],
  );
  return rows;
}

/** One person as the probation reminder needs them. */
async function probationOf(db, employeeId) {
  const { rows } = await db.query(
    `SELECT e.employee_id, btrim(e.first_name || ' ' || e.last_name) AS display_name,
            e.confirmation_due_on::text AS due_on, e.confirmed_on, e.status
       FROM employee e WHERE e.employee_id = $1`,
    [employeeId],
  );
  return rows[0] || null;
}

/* ------------------------------------------------------------------ *
 * The daily digest
 * ------------------------------------------------------------------ */

/** Active people with the digest on whose digest for this Lagos day is not decided yet. */
async function digestsDue(db, day) {
  const { rows } = await db.query(
    `SELECT u.user_id
       FROM app_user u
       LEFT JOIN notification_setting s ON s.user_id = u.user_id
      WHERE u.status = 'active' AND COALESCE(s.digest, true)
        -- Only once they have signed in: an invitation still open is no reader of a digest.
        AND u.password_changed_at IS NOT NULL
        AND (s.digest_sent_on IS NULL OR s.digest_sent_on < $1::date)
      ORDER BY u.user_id
      LIMIT 200 -- pagination:batch people one tick queues a digest for`,
    [day],
  );
  return rows.map((r) => r.user_id);
}

/** Note today's digest as decided. False when another tick already did. */
async function markDigest(db, userId, day) {
  const { rows } = await db.query(
    `INSERT INTO notification_setting AS s (user_id, digest_sent_on) VALUES ($1, $2::date)
     ON CONFLICT (user_id) DO UPDATE SET digest_sent_on = EXCLUDED.digest_sent_on
      WHERE s.digest_sent_on IS NULL OR s.digest_sent_on < EXCLUDED.digest_sent_on
     RETURNING user_id`,
    [userId, day],
  );
  return rows.length > 0;
}

/** Who a digest goes to, and whether they still want it. */
async function digestPerson(db, userId) {
  const { rows } = await db.query(
    `SELECT u.user_id, u.email, e.first_name, e.last_name, COALESCE(s.digest, true) AS digest,
            (u.password_changed_at IS NOT NULL) AS signed_in
       FROM app_user u
       JOIN employee e ON e.employee_id = u.employee_id
       LEFT JOIN notification_setting s ON s.user_id = u.user_id
      WHERE u.user_id = $1 AND u.status = 'active'`,
    [userId],
  );
  return rows[0] || null;
}

/** The first page of a person's bell notices that arrived in a window and are still unread. */
function digestPage(db, userId, { from, until }) {
  return pageQuery(
    db,
    `SELECT n.notification_id, n.title, n.body, n.entity_type, n.entity_id, n.created_at, ${TOTAL_COL}
       FROM notification n
      WHERE n.user_id = $1 AND 'in_app' = ANY(n.channels) AND n.read_at IS NULL
        AND n.created_at >= $2 AND n.created_at < $3
      ORDER BY n.created_at DESC, n.notification_id DESC`,
    [userId, from, until],
    { page: 1 },
  );
}

module.exports = {
  withdrawForRecord,
  list,
  unreadCount,
  unreadByEntityType,
  findOwnForUpdate,
  markRead,
  markAllRead,
  readIds,
  markReadForRecord,
  urgentOpen,
  acknowledge,
  acknowledgeForRecord,
  dueRepeats,
  markRepeated,
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
  settingOf,
  saveQuietHours,
  saveDigest,
  quietHoursOf,
  rulePage,
  ruleOf,
  copiedRoles,
  copiedPeople,
  saveRule,
  replaceCopies,
  deleteRule,
  rolesByCode,
  currentEmployees,
  reminderRules,
  saveReminderRule,
  addReminder,
  scheduleReminder,
  cancelReminders,
  dueReminders,
  reminderForFiring,
  moveReminder,
  reminderFired,
  finishReminder,
  repaceReminders,
  approvalsToRemind,
  approvalOf,
  probationsToRemind,
  probationOf,
  digestsDue,
  markDigest,
  digestPerson,
  digestPage,
};
