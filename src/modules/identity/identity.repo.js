"use strict";
/**
 * Identity's SQL: logins (app_user), sessions (user_session), devices
 * (known_device) and credential links (password_reset). Migrations 0010 and 0100.
 *
 * Every function takes the client it runs on, so a caller inside atomically()
 * keeps the work in its transaction. Nothing here emits or decides; the service does.
 */
const { pageQuery, orderBy, TOTAL_COL } = require("../../shared/http/paged");

const one = async (db, sql, params) => (await db.query(sql, params)).rows[0] || null;

/* ------------------------------------------------------------------ *
 * Logins
 * ------------------------------------------------------------------ */

const LOGIN_COLUMNS = `
  u.user_id, u.employee_id, u.email::text AS email, u.password_hash, u.status, u.is_ceo,
  u.failed_login_count, u.last_failed_login_at, u.password_changed_at, u.last_login_at,
  e.first_name, e.last_name, e.job_title, trim(e.first_name || ' ' || e.last_name) AS display_name`;

/** The login and its employee's name, by email (case-insensitive: citext). */
function findLoginByEmail(db, email) {
  return one(
    db,
    `SELECT ${LOGIN_COLUMNS}
       FROM app_user u JOIN employee e ON e.employee_id = u.employee_id
      WHERE u.email = $1`,
    [email],
  );
}

function findLoginById(db, userId) {
  return one(
    db,
    `SELECT ${LOGIN_COLUMNS}
       FROM app_user u JOIN employee e ON e.employee_id = u.employee_id
      WHERE u.user_id = $1`,
    [userId],
  );
}

function findLoginByEmployeeId(db, employeeId) {
  return one(
    db,
    `SELECT ${LOGIN_COLUMNS}
       FROM app_user u JOIN employee e ON e.employee_id = u.employee_id
      WHERE u.employee_id = $1`,
    [employeeId],
  );
}

function findCeo(db) {
  return one(
    db,
    `SELECT ${LOGIN_COLUMNS}
       FROM app_user u JOIN employee e ON e.employee_id = u.employee_id
      WHERE u.is_ceo`,
    [],
  );
}

/** A new login. `passwordHash` null means invited: a value no password can ever match. */
function insertLogin(db, { employeeId, email, passwordHash, isCeo }) {
  return one(
    db,
    `INSERT INTO app_user (employee_id, email, password_hash, is_ceo, password_changed_at)
     VALUES ($1, $2, COALESCE($3, '!invited'), $4, CASE WHEN $3::text IS NULL THEN NULL ELSE now() END)
     RETURNING user_id, employee_id, email::text AS email, status, is_ceo, password_changed_at, created_at`,
    [employeeId, email, passwordHash, Boolean(isCeo)],
  );
}

/** One more wrong password. Returns the new count. */
async function recordFailure(db, userId) {
  const row = await one(
    db,
    `UPDATE app_user
        SET failed_login_count = failed_login_count + 1, last_failed_login_at = now(), updated_at = now()
      WHERE user_id = $1
      RETURNING failed_login_count`,
    [userId],
  );
  return row ? row.failed_login_count : 0;
}

function recordSuccess(db, userId) {
  return db.query(
    `UPDATE app_user
        SET failed_login_count = 0, last_failed_login_at = NULL, last_login_at = now(), updated_at = now()
      WHERE user_id = $1`,
    [userId],
  );
}

function setPasswordHash(db, userId, hash) {
  return db.query(
    `UPDATE app_user
        SET password_hash = $2, password_changed_at = now(), failed_login_count = 0,
            last_failed_login_at = NULL, updated_at = now()
      WHERE user_id = $1`,
    [userId, hash],
  );
}

function setStatus(db, userId, status) {
  return one(
    db,
    `UPDATE app_user SET status = $2, updated_at = now() WHERE user_id = $1
     RETURNING user_id, status`,
    [userId, status],
  );
}

/* ------------------------------------------------------------------ *
 * The signed-in person (/me)
 * ------------------------------------------------------------------ */

function meOf(db, userId) {
  return one(
    db,
    `SELECT u.user_id, u.employee_id, u.email::text AS email, u.is_ceo, u.status,
            e.first_name, trim(e.first_name || ' ' || e.last_name) AS display_name,
            e.job_title, d.name AS department,
            EXISTS (SELECT 1 FROM employee r
                     WHERE r.line_manager_id = e.employee_id AND r.status = 'active') AS manages_people
       FROM app_user u
       JOIN employee e ON e.employee_id = u.employee_id
       JOIN department d ON d.department_id = e.department_id
      WHERE u.user_id = $1`,
    [userId],
  );
}

/** The person's active roles, most senior first (one person holds a handful at most). */
async function rolesOf(db, userId) {
  const { rows } = await db.query(
    `SELECT r.role_id, r.code::text AS code, r.name, r.home_view, r.rank
       FROM user_role ur JOIN role r ON r.role_id = ur.role_id
      WHERE ur.user_id = $1 AND r.active
        AND ur.effective_from <= CURRENT_DATE
        AND (ur.effective_to IS NULL OR ur.effective_to > CURRENT_DATE)
      ORDER BY r.rank DESC, r.name`,
    [userId],
  );
  return rows;
}

/** What a set of roles allows, one row per module (fifteen modules at most). */
async function grantsOf(db, roleIds) {
  if (!roleIds.length) return [];
  const { rows } = await db.query(
    `SELECT module_key,
            bool_or(can_view) AS can_view, bool_or(can_create) AS can_create,
            bool_or(can_edit) AS can_edit, bool_or(can_delete) AS can_delete,
            bool_or(can_approve) AS can_approve, bool_or(can_export) AS can_export
       FROM permission
      WHERE role_id = ANY($1::uuid[])
      GROUP BY module_key
      ORDER BY module_key`,
    [roleIds],
  );
  return rows;
}

/* ------------------------------------------------------------------ *
 * Sessions
 * ------------------------------------------------------------------ */

function insertSession(
  db,
  { sessionId, userId, refreshHash, ip, userAgent, deviceLabel, knownDeviceId, method, seconds },
) {
  return one(
    db,
    `INSERT INTO user_session
       (session_id, user_id, refresh_token_hash, ip_address, user_agent, device_label,
        known_device_id, method, expires_at)
     VALUES ($1, $2, $3, $4::inet, $5, $6, $7, $8, now() + make_interval(secs => $9))
     RETURNING session_id, issued_at, expires_at`,
    [sessionId, userId, refreshHash, ip || null, userAgent || null, deviceLabel, knownDeviceId || null, method, seconds],
  );
}

/**
 * The session a refresh names, locked for the rest of the transaction so two
 * refreshes of one session are taken one after the other: the second then sees the
 * rotated token and is treated as a replay.
 */
function lockSession(db, sessionId) {
  return one(
    db,
    `SELECT s.session_id, s.user_id, s.refresh_token_hash, s.killed_at, s.expires_at,
            EXTRACT(EPOCH FROM (now() - s.issued_at)) AS age_seconds,
            EXTRACT(EPOCH FROM (now() - s.last_seen_at)) AS idle_seconds,
            u.status
       FROM user_session s JOIN app_user u ON u.user_id = s.user_id
      WHERE s.session_id = $1
      FOR UPDATE OF s`,
    [sessionId],
  );
}

function rotateSession(db, sessionId, refreshHash) {
  return db.query(
    `UPDATE user_session SET refresh_token_hash = $2, last_seen_at = now(), updated_at = now()
      WHERE session_id = $1`,
    [sessionId, refreshHash],
  );
}

/** End one session. With `userId`, only if it is that person's. Returns whether it ended. */
async function endSession(db, sessionId, { reason, by = null, userId = null }) {
  const row = await one(
    db,
    `UPDATE user_session
        SET killed_at = now(), killed_by = $2, end_reason = $3, updated_at = now()
      WHERE session_id = $1 AND killed_at IS NULL AND ($4::uuid IS NULL OR user_id = $4)
      RETURNING session_id`,
    [sessionId, by, reason, userId],
  );
  return Boolean(row);
}

/** End every live session of a person, except one. Returns the ids ended. */
async function endUserSessions(db, userId, { reason, by = null, except = null }) {
  const { rows } = await db.query(
    `UPDATE user_session
        SET killed_at = now(), killed_by = $2, end_reason = $3, updated_at = now()
      WHERE user_id = $1 AND killed_at IS NULL AND expires_at > now()
        AND ($4::uuid IS NULL OR session_id <> $4)
      RETURNING session_id`,
    [userId, by, reason, except],
  );
  return rows.map((r) => r.session_id);
}

/** Live: not ended, not past its ceiling, not idle past the limit. */
const LIVE = (idleSeconds) =>
  `(s.killed_at IS NULL AND s.expires_at > now() AND s.last_seen_at > now() - make_interval(secs => ${Number(idleSeconds)}))`;

const SESSION_SORTS = { issued_at: "s.issued_at" };

/**
 * The person's sign-ins, newest first by default.
 * @param {{status?: "active"|"ended", page?: number, sort?: object}} query
 */
function listSessions(db, userId, query, { currentSessionId, idleSeconds }) {
  const live = LIVE(idleSeconds);
  const sort = query.sort || { field: "issued_at", dir: "desc" };
  return pageQuery(
    db,
    `SELECT s.session_id,
            COALESCE(s.device_label, 'Unknown device') AS device_label,
            host(s.ip_address) AS ip_address, s.method, s.issued_at,
            s.last_seen_at,
            CASE WHEN ${live} THEN 'active' ELSE 'ended' END AS status,
            CASE
              WHEN s.end_reason IS NOT NULL THEN s.end_reason
              WHEN ${live} THEN NULL
              WHEN s.expires_at <= now() THEN 'session_max_age'
              ELSE 'inactivity_timeout'
            END AS end_reason,
            (s.session_id = $2::uuid) AS current,
            ${TOTAL_COL}
       FROM user_session s
      WHERE s.user_id = $1
        AND ($3::text IS NULL OR ($3 = 'active') = ${live})
      ORDER BY ${orderBy({ sort }, SESSION_SORTS, "s.session_id")}`,
    [userId, currentSessionId || null, query.status || null],
    query,
  );
}

async function countLiveSessions(db, userId, idleSeconds) {
  const row = await one(
    db,
    `SELECT count(*)::int AS n FROM user_session s WHERE s.user_id = $1 AND ${LIVE(idleSeconds)}`,
    [userId],
  );
  return row ? row.n : 0;
}

/* ------------------------------------------------------------------ *
 * Devices
 * ------------------------------------------------------------------ */

/** Has this person signed in from any device before? */
async function hasDevices(db, userId) {
  return Boolean(
    await one(db, "SELECT 1 AS x FROM known_device WHERE user_id = $1 LIMIT 1", [userId]),
  );
}

/**
 * Remember (person, device). Returns the row and whether it is new for this person.
 * xmax = 0 on the returned row means the INSERT branch ran.
 */
function rememberDevice(db, { userId, hash, label, platform, ip }) {
  return one(
    db,
    `INSERT INTO known_device (user_id, fingerprint_hash, label, platform, last_seen_at, last_ip)
     VALUES ($1, $2, $3, $4, now(), $5::inet)
     ON CONFLICT (user_id, fingerprint_hash) DO UPDATE
        SET label = EXCLUDED.label, platform = EXCLUDED.platform, last_seen_at = now(),
            last_ip = EXCLUDED.last_ip, updated_at = now()
     RETURNING known_device_id, revoked_at, (xmax = 0) AS is_new`,
    [userId, hash, label, platform, ip || null],
  );
}

/** Who last signed in on this device (an active account only), for the sign-in screen. */
function deviceAccount(db, hash) {
  return one(
    db,
    `SELECT u.email::text AS email, e.first_name,
            trim(e.first_name || ' ' || e.last_name) AS display_name
       FROM known_device k
       JOIN app_user u ON u.user_id = k.user_id
       JOIN employee e ON e.employee_id = u.employee_id
      WHERE k.fingerprint_hash = $1 AND k.revoked_at IS NULL AND u.status = 'active'
      ORDER BY k.last_seen_at DESC NULLS LAST
      LIMIT 1`,
    [hash],
  );
}

/* ------------------------------------------------------------------ *
 * Credential links
 * ------------------------------------------------------------------ */

/** Was a link of this purpose issued to this person in the last `seconds`? */
async function recentLink(db, userId, purpose, seconds) {
  return Boolean(
    await one(
      db,
      `SELECT 1 AS x FROM password_reset
        WHERE user_id = $1 AND purpose = $2 AND created_at > now() - make_interval(secs => $3)
        LIMIT 1`,
      [userId, purpose, seconds],
    ),
  );
}

/** Spend every open link of a person (one live link at a time). */
function closeOpenLinks(db, userId, { except = null } = {}) {
  return db.query(
    `UPDATE password_reset SET used_at = now(), updated_at = now()
      WHERE user_id = $1 AND used_at IS NULL AND ($2::uuid IS NULL OR password_reset_id <> $2)`,
    [userId, except],
  );
}

/**
 * The link for an event, created or, on a retry, given a fresh token: only the hash
 * is kept, so a retried handler cannot resend the token it minted the first time.
 */
function upsertLink(db, { userId, hash, purpose, seconds, requestedBy, ip, eventId }) {
  return one(
    db,
    `INSERT INTO password_reset
       (user_id, token_hash, purpose, expires_at, requested_by, requested_ip, source_event_id)
     VALUES ($1, $2, $3, now() + make_interval(secs => $4), $5, $6::inet, $7)
     ON CONFLICT (source_event_id) DO UPDATE
        SET token_hash = EXCLUDED.token_hash, expires_at = EXCLUDED.expires_at,
            used_at = NULL, updated_at = now()
     RETURNING password_reset_id, expires_at`,
    [userId, hash, purpose, seconds, requestedBy || null, ip || null, eventId],
  );
}

/** A link that is still good: unused, unexpired, for an active login. */
function findOpenLink(db, hash, { lock = false } = {}) {
  return one(
    db,
    `SELECT p.password_reset_id, p.user_id, p.purpose, p.expires_at,
            u.email::text AS email, e.first_name
       FROM password_reset p
       JOIN app_user u ON u.user_id = p.user_id
       JOIN employee e ON e.employee_id = u.employee_id
      WHERE p.token_hash = $1 AND p.used_at IS NULL AND p.expires_at > now()
        AND u.status = 'active'
      ${lock ? "FOR UPDATE OF p" : ""}`,
    [hash],
  );
}

function spendLink(db, linkId) {
  return db.query(
    "UPDATE password_reset SET used_at = now(), updated_at = now() WHERE password_reset_id = $1",
    [linkId],
  );
}

module.exports = {
  findLoginByEmail,
  findLoginById,
  findLoginByEmployeeId,
  findCeo,
  insertLogin,
  recordFailure,
  recordSuccess,
  setPasswordHash,
  setStatus,
  meOf,
  rolesOf,
  grantsOf,
  insertSession,
  lockSession,
  rotateSession,
  endSession,
  endUserSessions,
  listSessions,
  countLiveSessions,
  hasDevices,
  rememberDevice,
  deviceAccount,
  recentLink,
  closeOpenLinks,
  upsertLink,
  findOpenLink,
  spendLink,
};
