"use strict";
/**
 * Settings' SQL (migrations 0050, 0055; the working week seeded by 0099 and 0199):
 * setting rows, the working week, public holidays, numbering schemes, and the
 * counts Settings · Security shows. Failed sign-ins are read from the audit ledger,
 * where identity records them (auth.sign_in_failed).
 */
const { pageQuery, orderBy, TOTAL_COL } = require("../../shared/http/paged");

const one = async (db, sql, params) => (await db.query(sql, params)).rows[0] || null;

/** "09:00:00" from a time column → "09:00". */
const hhmm = (t) => (t === null || t === undefined ? null : String(t).slice(0, 5));

/* ------------------------------------------------------------------ *
 * Setting rows
 * ------------------------------------------------------------------ */

/** key → value for the keys asked for that exist. */
async function settingsByKey(db, keys) {
  const { rows } = await db.query("SELECT key, value FROM setting WHERE key = ANY($1::text[])", [keys]);
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

/** Write one setting; a null value removes it, so "not set" reads as absent. */
async function putSetting(db, key, value, userId) {
  if (value === null || value === undefined) {
    await db.query("DELETE FROM setting WHERE key = $1", [key]);
    return;
  }
  await db.query(
    `INSERT INTO setting (key, value, updated_by) VALUES ($1, $2::jsonb, $3)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [key, JSON.stringify(value), userId || null],
  );
}

/* ------------------------------------------------------------------ *
 * The working week
 * ------------------------------------------------------------------ */

/** Monday to Sunday, as stored. Seven rows at most. */
async function workingWeek(db, { lock = false } = {}) {
  const { rows } = await db.query(
    `SELECT weekday, is_working_day, starts_at, ends_at FROM working_week ORDER BY weekday ${lock ? "FOR UPDATE" : ""}`,
  );
  return rows.map((r) => ({
    weekday: Number(r.weekday),
    is_working_day: r.is_working_day,
    starts_at: r.is_working_day ? hhmm(r.starts_at) : null,
    ends_at: r.is_working_day ? hhmm(r.ends_at) : null,
  }));
}

function putDay(db, d) {
  return db.query(
    `INSERT INTO working_week (weekday, is_working_day, starts_at, ends_at) VALUES ($1, $2, $3, $4)
     ON CONFLICT (weekday) DO UPDATE SET is_working_day = EXCLUDED.is_working_day,
       starts_at = EXCLUDED.starts_at, ends_at = EXCLUDED.ends_at, updated_at = now()`,
    [d.weekday, d.is_working_day, d.is_working_day ? d.starts_at : null, d.is_working_day ? d.ends_at : null],
  );
}

/* ------------------------------------------------------------------ *
 * Public holidays
 * ------------------------------------------------------------------ */

const HOLIDAY = "h.public_holiday_id, to_char(h.holiday_date, 'YYYY-MM-DD') AS holiday_date, h.name, h.created_at";
const HOLIDAY_SORTS = { holiday_date: "h.holiday_date", name: "h.name" };

function holidayPage(db, query) {
  return pageQuery(
    db,
    `SELECT ${HOLIDAY}, ${TOTAL_COL}
       FROM public_holiday h
      WHERE ($1::int IS NULL OR extract(year FROM h.holiday_date)::int = $1)
        AND ($2::text IS NULL OR search_fold(h.name) LIKE '%' || search_fold($2) || '%')
      ORDER BY ${orderBy(query, HOLIDAY_SORTS, "h.public_holiday_id")}`,
    [query.year || null, query.q || null],
    query,
  );
}

function findHoliday(db, id, { lock = false } = {}) {
  return one(db, `SELECT ${HOLIDAY} FROM public_holiday h WHERE h.public_holiday_id = $1 ${lock ? "FOR UPDATE" : ""}`, [
    id,
  ]);
}

/** Another holiday on this date, other than `exceptId`. */
function holidayOn(db, date, exceptId = null) {
  return one(
    db,
    `SELECT ${HOLIDAY} FROM public_holiday h
      WHERE h.holiday_date = $1::date AND ($2::uuid IS NULL OR h.public_holiday_id <> $2::uuid)`,
    [date, exceptId],
  );
}

function insertHoliday(db, { holiday_date, name }) {
  return one(
    db,
    `INSERT INTO public_holiday AS h (holiday_date, name) VALUES ($1, $2)
     ON CONFLICT (holiday_date) DO NOTHING
     RETURNING ${HOLIDAY}`,
    [holiday_date, name],
  );
}

function updateHoliday(db, id, { holiday_date, name }) {
  return one(
    db,
    `UPDATE public_holiday h SET holiday_date = $2, name = $3, updated_at = now()
      WHERE h.public_holiday_id = $1
      RETURNING ${HOLIDAY}`,
    [id, holiday_date, name],
  );
}

function deleteHoliday(db, id) {
  return db.query("DELETE FROM public_holiday WHERE public_holiday_id = $1", [id]);
}

/* ------------------------------------------------------------------ *
 * Numbering schemes
 * ------------------------------------------------------------------ */

const SCHEME = `s.doc_type, s.prefix, s.padding::int AS padding, s.separator, s.reset, s.include_period, s.updated_at,
  COALESCE(nc.last_value, 0)::int AS last_value`;

/** The counter row of the scheme's current period: "all", the year, or the year and month. */
const COUNTER_JOIN = `LEFT JOIN numbering_counter nc ON nc.doc_type = s.doc_type
   AND nc.period = CASE s.reset WHEN 'never' THEN 'all' WHEN 'yearly' THEN $1 ELSE $2 END`;

const NUMBERING_SORTS = { doc_type: "s.doc_type", prefix: "s.prefix" };

/**
 * The schemes of the document types the code numbers, one page.
 * @param {{year: string, month: string}} period  "2026", "2026-10"
 * @param {string[]} docTypes   the types the code knows
 * @param {string[]} labelled   types whose label matches the search
 */
function numberingPage(db, query, period, docTypes, labelled) {
  return pageQuery(
    db,
    `SELECT ${SCHEME}, ${TOTAL_COL}
       FROM numbering_scheme s
       ${COUNTER_JOIN}
      WHERE s.doc_type = ANY($3::text[])
        AND ($4::text IS NULL
             OR search_fold(s.doc_type || ' ' || s.prefix) LIKE '%' || search_fold($4) || '%'
             OR s.doc_type = ANY($5::text[]))
      ORDER BY ${orderBy(query, NUMBERING_SORTS, "s.doc_type")}`,
    [period.year, period.month, docTypes, query.q || null, labelled],
    query,
  );
}

function findScheme(db, docType, period, { lock = false } = {}) {
  return one(
    db,
    `SELECT ${SCHEME} FROM numbering_scheme s ${COUNTER_JOIN}
      WHERE s.doc_type = $3 ${lock ? "FOR UPDATE OF s" : ""}`,
    [period.year, period.month, docType],
  );
}

function updateScheme(db, docType, s) {
  return db.query(
    `UPDATE numbering_scheme
        SET prefix = $2, padding = $3, separator = $4, reset = $5, include_period = $6, updated_at = now()
      WHERE doc_type = $1`,
    [docType, s.prefix, s.padding, s.separator, s.reset, s.include_period],
  );
}

async function numberingSummary(db, docTypes) {
  return one(
    db,
    `SELECT count(*)::int AS types,
            COALESCE((SELECT sum(nc.last_value) FROM numbering_counter nc WHERE nc.doc_type = ANY($1::text[])), 0)::int
              AS issued,
            count(*) FILTER (WHERE s.reset <> 'never')::int AS resetting
       FROM numbering_scheme s
      WHERE s.doc_type = ANY($1::text[])`,
    [docTypes],
  );
}

/* ------------------------------------------------------------------ *
 * Settings · Security: counts and failed sign-ins
 * ------------------------------------------------------------------ */

/** Live sessions, active logins, how many have two-step on, failed sign-ins in seven days. */
function securityCounts(db, idleSeconds) {
  return one(
    db,
    `SELECT (SELECT count(*)::int FROM user_session s
              WHERE s.killed_at IS NULL AND s.expires_at > now()
                AND s.last_seen_at > now() - make_interval(secs => $1)) AS active_sessions,
            (SELECT count(*)::int FROM app_user u WHERE u.status = 'active') AS users,
            (SELECT count(*)::int FROM app_user u
              WHERE u.status = 'active' AND u.mfa_enrolled_at IS NOT NULL) AS two_step_on,
            (SELECT count(*)::int FROM audit_ledger a
              WHERE a.action = 'auth.sign_in_failed' AND a.occurred_at > now() - interval '7 days') AS failed_7d`,
    [idleSeconds],
  );
}

const FAILED_SORTS = { occurred_at: "a.occurred_at" };

/** Failed sign-ins, newest first unless sorted otherwise. */
function failedSignIns(db, query) {
  const sort = query.sort || { field: "occurred_at", dir: "desc" };
  return pageQuery(
    db,
    `SELECT a.audit_ledger_id, a.occurred_at, host(a.actor_ip) AS ip_address,
            COALESCE(u.email::text, el.payload->>'email') AS email,
            CASE WHEN e.employee_id IS NULL THEN NULL ELSE trim(e.first_name || ' ' || e.last_name) END
              AS display_name,
            el.payload->>'reason' AS reason,
            ${TOTAL_COL}
       FROM audit_ledger a
       JOIN event_log el ON el.event_id = a.event_id
       LEFT JOIN app_user u ON a.entity_type = 'account' AND u.user_id::text = a.entity_id
       LEFT JOIN employee e ON e.employee_id = u.employee_id
      WHERE a.action = 'auth.sign_in_failed'
        AND ($1::int IS NULL OR a.occurred_at > now() - make_interval(days => $1))
        AND ($2::text IS NULL OR search_fold(
              COALESCE(u.email::text, el.payload->>'email', '') || ' ' || COALESCE(e.first_name, '') || ' ' ||
              COALESCE(e.last_name, '') || ' ' || COALESCE(host(a.actor_ip), '')
            ) LIKE '%' || search_fold($2) || '%')
      ORDER BY ${orderBy({ sort }, FAILED_SORTS, "a.audit_ledger_id")}`,
    [query.days || null, query.q || null],
    query,
  );
}

module.exports = {
  settingsByKey,
  putSetting,
  workingWeek,
  putDay,
  holidayPage,
  findHoliday,
  holidayOn,
  insertHoliday,
  updateHoliday,
  deleteHoliday,
  numberingPage,
  findScheme,
  updateScheme,
  numberingSummary,
  securityCounts,
  failedSignIns,
};
