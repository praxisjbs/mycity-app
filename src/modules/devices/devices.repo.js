"use strict";
/**
 * Devices: the SQL. Writes only attendance_device; reads known_device for a device's
 * label and platform (identity owns it, and nothing here writes it). Never selects
 * known_device.fingerprint_hash: the device cookie's hash stays in identity. Never
 * emits (BACKEND_GUIDE §2).
 */
const { pageQuery, orderBy, TOTAL_COL } = require("../../shared/http/paged");
const { scopeClause } = require("../../shared/rbac/scope");
const { personJson } = require("../../shared/db/person");

const one = async (db, sql, params) => (await db.query(sql, params)).rows[0] || null;

/** What a person reads about one of their devices; `$this` is the session's known device. */
const MINE = `
  ad.attendance_device_id, ad.label, k.platform, ad.status, ad.first_seen_at, ad.last_punch_at,
  ad.registered_at, ad.removed_at`;

/** What People read: the device, its owner and who removed it. */
const ROWS = `
  SELECT ad.attendance_device_id,
         ${personJson("e", "d")} AS employee,
         ad.employee_id, ad.label, k.platform, ad.status, ad.first_seen_at, ad.last_punch_at,
         ad.registered_at, ad.removed_at,
         CASE WHEN rb.employee_id IS NULL THEN NULL ELSE btrim(rb.first_name || ' ' || rb.last_name) END AS removed_by_name,
         ad.removal_reason,
         search_fold(e.first_name || ' ' || e.last_name || ' ' || COALESCE(e.preferred_name, '') || ' ' || ad.label) AS haystack
    FROM attendance_device ad
    JOIN employee e ON e.employee_id = ad.employee_id
    LEFT JOIN department d ON d.department_id = e.department_id
    JOIN known_device k ON k.known_device_id = ad.known_device_id
    LEFT JOIN app_user ru ON ru.user_id = ad.removed_by
    LEFT JOIN employee rb ON rb.employee_id = ru.employee_id`;

const OUT = `v.attendance_device_id, v.employee, v.label, v.platform, v.status, v.first_seen_at,
  v.last_punch_at, v.registered_at, v.removed_at, v.removed_by_name, v.removal_reason`;

/** The list's sorts; the first, which no caller can name, is its default: newest seen first. */
const SORTS = {
  newest: "v.first_seen_at DESC",
  first_seen_at: "v.first_seen_at",
  last_punch_at: "v.last_punch_at",
};

/** Writes for one person's devices are made one after the other (the cap of three). */
async function lockEmployee(client, employeeId) {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('devices:' || $1::text, 0))", [employeeId]);
}

/** The attendance row for a known device, or null. */
function forKnownDevice(db, knownDeviceId) {
  return one(
    db,
    `SELECT ad.attendance_device_id, ad.employee_id, ad.label, ad.status, ad.first_seen_at, ad.last_punch_at,
            ad.registered_at, ad.removed_at
       FROM attendance_device ad WHERE ad.known_device_id = $1`,
    [knownDeviceId],
  );
}

/** A known device's label and owner, for a device attendance has not seen yet. */
function knownDevice(db, knownDeviceId) {
  return one(
    db,
    `SELECT k.known_device_id, COALESCE(k.label, 'Unknown device') AS label, k.platform, u.employee_id
       FROM known_device k JOIN app_user u ON u.user_id = k.user_id
      WHERE k.known_device_id = $1 AND k.revoked_at IS NULL`,
    [knownDeviceId],
  );
}

/**
 * Record a device the first time it punches. Returns the row and whether this call
 * made it (first_seen). An existing row is returned as it is.
 */
async function observe(client, { employeeId, knownDeviceId }) {
  const made = await one(
    client,
    `INSERT INTO attendance_device (employee_id, known_device_id, label)
     SELECT $1, k.known_device_id, COALESCE(k.label, 'Unknown device')
       FROM known_device k WHERE k.known_device_id = $2
     ON CONFLICT (known_device_id) DO NOTHING
     RETURNING attendance_device_id`,
    [employeeId, knownDeviceId],
  );
  const row = await forKnownDevice(client, knownDeviceId);
  return row ? { ...row, first_seen: Boolean(made) } : null;
}

/** The device made its punch at `at` (any result: the last attempt is what People look for). */
function notePunch(client, attendanceDeviceId, at) {
  return client.query(
    "UPDATE attendance_device SET last_punch_at = GREATEST(COALESCE(last_punch_at, $2), $2) WHERE attendance_device_id = $1",
    [attendanceDeviceId, at],
  );
}

async function countRegistered(db, employeeId) {
  const r = await one(
    db,
    "SELECT count(*)::int AS n FROM attendance_device WHERE employee_id = $1 AND status = 'registered'",
    [employeeId],
  );
  return r ? r.n : 0;
}

/** Register (or register again) a device: its label, and the time. */
function register(client, attendanceDeviceId, label) {
  return one(
    client,
    `UPDATE attendance_device
        SET status = 'registered', registered_at = now(), removed_at = NULL, removed_by = NULL,
            removal_reason = NULL, label = COALESCE($2, label)
      WHERE attendance_device_id = $1
      RETURNING attendance_device_id, employee_id, label, status, registered_at`,
    [attendanceDeviceId, label || null],
  );
}

/** Take a device off. Returns the row, or null when it was already removed. */
function remove(client, attendanceDeviceId, { by, reason }) {
  return one(
    client,
    `UPDATE attendance_device
        SET status = 'removed', removed_at = now(), removed_by = $2, removal_reason = $3
      WHERE attendance_device_id = $1 AND status <> 'removed'
      RETURNING attendance_device_id, employee_id, label, status, removed_at`,
    [attendanceDeviceId, by, reason || null],
  );
}

/** One device, with its owner. */
function get(db, attendanceDeviceId) {
  return one(db, `SELECT ${OUT}, v.employee_id FROM (${ROWS}) v WHERE v.attendance_device_id = $1`, [
    attendanceDeviceId,
  ]);
}

/** One of a person's own devices. */
function getMine(db, employeeId, attendanceDeviceId, thisKnownDeviceId) {
  return one(
    db,
    `SELECT ${MINE}, (ad.known_device_id = $3::uuid) AS this_device
       FROM attendance_device ad JOIN known_device k ON k.known_device_id = ad.known_device_id
      WHERE ad.attendance_device_id = $1 AND ad.employee_id = $2`,
    [attendanceDeviceId, employeeId, thisKnownDeviceId],
  );
}

/** A page of a person's own devices: registered first, then the newest seen. */
function listMine(db, employeeId, query, thisKnownDeviceId) {
  return pageQuery(
    db,
    `SELECT ${MINE}, COALESCE(ad.known_device_id = $2::uuid, false) AS this_device, ${TOTAL_COL}
       FROM attendance_device ad JOIN known_device k ON k.known_device_id = ad.known_device_id
      WHERE ad.employee_id = $1
      ORDER BY (ad.status = 'registered') DESC, ad.first_seen_at DESC, ad.attendance_device_id`,
    [employeeId, thisKnownDeviceId],
    query,
  );
}

/** A page of devices within the reader's `people` scope. */
function list(db, query, scope) {
  const params = [query.status || null, query.employee_id || null, query.q || null];
  const s = scopeClause(scope, { column: "v.employee_id" }, params);
  return pageQuery(
    db,
    `SELECT ${OUT}, ${TOTAL_COL}
       FROM (${ROWS}) v
      WHERE ($1::text IS NULL OR v.status = $1)
        AND ($2::uuid IS NULL OR v.employee_id = $2)
        AND ($3::text IS NULL OR v.haystack LIKE '%' || search_fold($3) || '%')
        ${s.and}
      ORDER BY ${orderBy(query, SORTS, "v.attendance_device_id")}`,
    params,
    query,
  );
}

module.exports = {
  lockEmployee,
  forKnownDevice,
  knownDevice,
  observe,
  notePunch,
  countRegistered,
  register,
  remove,
  get,
  getMine,
  listMine,
  list,
};
