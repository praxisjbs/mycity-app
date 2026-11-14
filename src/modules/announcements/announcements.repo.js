"use strict";
/**
 * Announcements' SQL (migrations 1000, 1010 and 1145): the announcement record, its audience
 * and who has read it. An announcement_read row is written for each person in the
 * audience when it is published, with read_at empty until they open it, so the read and
 * not-read lists and the counts come from one table. An urgent announcement counts as read
 * only once acknowledged (TB, 19/10/2026): DONE says which mark counts.
 */
const { pageQuery, TOTAL_COL } = require("../../shared/http/paged");
const { PERSON } = require("../community/community.repo");

const one = async (db, sql, params) =>
  (await db.query(sql, params)).rows[0] || null;

/** Whether the read row `r` of announcement `a` counts as read: acknowledged when urgent, else opened. */
const DONE = "(CASE WHEN a.urgency = 'urgent' THEN r.acknowledged_at IS NOT NULL ELSE r.read_at IS NOT NULL END)";

const ROW = `
  SELECT a.announcement_id, a.title, a.body, a.audience, a.status, a.urgency, a.publish_at, a.published_at,
         a.audience_size, a.community_message_id, a.last_reminded_at, a.published_by,
         ${PERSON("e", "d")} AS author,
         COALESCE((SELECT array_agg(dd.name ORDER BY dd.name) FROM department dd
                    WHERE dd.department_id::text IN (SELECT jsonb_array_elements_text(a.audience->'department_ids'))), '{}') AS departments,
         (SELECT count(*)::int FROM announcement_read r WHERE r.announcement_id = a.announcement_id AND ${DONE}) AS reads`;
const FROM = `
    FROM announcement a
    LEFT JOIN app_user u ON u.user_id = a.published_by
    LEFT JOIN employee e ON e.employee_id = u.employee_id
    LEFT JOIN department d ON d.department_id = e.department_id`;

function list(db, query) {
  return pageQuery(
    db,
    `${ROW}, ${TOTAL_COL} ${FROM}
      WHERE a.status IN ('scheduled', 'published')
        AND ($1::text IS NULL OR search_fold(a.title || ' ' || a.body) LIKE '%' || search_fold($1) || '%')
      ORDER BY (a.status = 'scheduled') DESC, COALESCE(a.published_at, a.publish_at) DESC, a.announcement_id`,
    [query.q ?? null],
    query,
  );
}

function get(db, id) {
  return one(db, `${ROW} ${FROM} WHERE a.announcement_id = $1`, [id]);
}

function lockForUpdate(db, id) {
  return one(
    db,
    "SELECT * FROM announcement WHERE announcement_id = $1 FOR UPDATE",
    [id],
  );
}

function insert(db, a) {
  return one(
    db,
    `INSERT INTO announcement (title, body, audience, status, published_by, publish_at, urgency)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [
      a.title,
      a.body,
      a.audience,
      a.status,
      a.published_by,
      a.publish_at ?? null,
      a.urgency || "normal",
    ],
  );
}

/** A scheduled announcement changed; without `urgency` its level stays. */
function updateScheduled(db, id, a) {
  return one(
    db,
    `UPDATE announcement SET title = $2, body = $3, audience = $4, publish_at = $5,
            urgency = COALESCE($6, urgency)
      WHERE announcement_id = $1 AND status = 'scheduled' RETURNING *`,
    [id, a.title, a.body, a.audience, a.publish_at, a.urgency ?? null],
  );
}

/** Take a published announcement down; it keeps its reads for the record. */
function archivePublished(db, id) {
  return one(
    db,
    "UPDATE announcement SET status = 'archived' WHERE announcement_id = $1 AND status = 'published' RETURNING *",
    [id],
  );
}

function cancelScheduled(db, id) {
  return one(
    db,
    "UPDATE announcement SET status = 'cancelled' WHERE announcement_id = $1 AND status = 'scheduled' RETURNING *",
    [id],
  );
}

function markPublished(db, id, { messageId, audienceSize }) {
  return one(
    db,
    `UPDATE announcement SET status = 'published', published_at = now(), community_message_id = $2, audience_size = $3
      WHERE announcement_id = $1 RETURNING *`,
    [id, messageId, audienceSize],
  );
}

/** Active logins of the audience: everyone, or the people of the chosen departments. */
/** The tab's figures, over every announcement; the audience is who an all-staff one reaches now. */
function stats(db) {
  return one(
    db,
    `SELECT count(*) FILTER (WHERE a.status = 'published')::int AS published,
            count(*) FILTER (WHERE a.status = 'scheduled')::int AS scheduled,
            COALESCE(round(avg(r.reads * 100.0 / a.audience_size) FILTER (WHERE a.status = 'published' AND a.audience_size > 0)), 0)::int AS average_read,
            count(*) FILTER (WHERE a.status = 'published'
                               AND a.published_at >= (date_trunc('month', now() AT TIME ZONE 'Africa/Lagos') AT TIME ZONE 'Africa/Lagos'))::int AS this_month,
            (SELECT count(*)::int FROM app_user u JOIN employee e ON e.employee_id = u.employee_id
              WHERE u.status = 'active' AND e.status <> 'left') AS audience
       FROM announcement a
       LEFT JOIN LATERAL (SELECT count(*) AS reads FROM announcement_read x
                           WHERE x.announcement_id = a.announcement_id
                             AND CASE WHEN a.urgency = 'urgent' THEN x.acknowledged_at IS NOT NULL
                                      ELSE x.read_at IS NOT NULL END) r ON true`,
  );
}

async function audienceUsers(db, audience) {
  const all = !audience || audience.kind !== "departments";
  const { rows } = await db.query(
    `SELECT u.user_id FROM app_user u JOIN employee e ON e.employee_id = u.employee_id
      WHERE u.status = 'active' AND e.status <> 'left'
        AND ($1::boolean OR e.department_id = ANY($2::uuid[]))
      ORDER BY u.user_id`,
    [all, all ? [] : audience.department_ids],
  );
  return rows.map((r) => r.user_id);
}

function addAudience(db, id, userIds) {
  return db.query(
    `INSERT INTO announcement_read (announcement_id, user_id)
     SELECT $1, x FROM unnest($2::uuid[]) AS x
     ON CONFLICT (announcement_id, user_id) DO NOTHING`,
    [id, userIds],
  );
}

/**
 * The audience with their read marks; `read` narrows to those who have or have not read it
 * (acknowledged it, when urgent), most recent first.
 */
function readers(db, id, query) {
  return pageQuery(
    db,
    `SELECT r.read_at, r.acknowledged_at, ${PERSON()} AS person, ${TOTAL_COL}
       FROM announcement_read r
       JOIN announcement a ON a.announcement_id = r.announcement_id
       JOIN app_user u ON u.user_id = r.user_id
       JOIN employee e ON e.employee_id = u.employee_id
       LEFT JOIN department d ON d.department_id = e.department_id
      WHERE r.announcement_id = $1
        AND ($2::text IS NULL OR ($2 = 'read') = ${DONE})
        AND ($3::text IS NULL OR search_fold(e.first_name || ' ' || e.last_name) LIKE '%' || search_fold($3) || '%')
      ORDER BY (CASE WHEN a.urgency = 'urgent' THEN r.acknowledged_at ELSE r.read_at END) DESC NULLS LAST,
               e.first_name, e.last_name, r.announcement_read_id`,
    [id, query.read ?? null, query.q ?? null],
    query,
  );
}

/** Who has not read it yet (not acknowledged it, when urgent). */
async function unreadUsers(db, id) {
  const { rows } = await db.query(
    `SELECT r.user_id FROM announcement_read r JOIN announcement a ON a.announcement_id = r.announcement_id
      WHERE r.announcement_id = $1 AND NOT ${DONE}
      ORDER BY r.user_id`,
    [id],
  );
  return rows.map((r) => r.user_id);
}

/** One person's read row, locked; null when they are not in the audience. */
function readRowForUpdate(db, id, userId) {
  return one(
    db,
    "SELECT * FROM announcement_read WHERE announcement_id = $1 AND user_id = $2 FOR UPDATE",
    [id, userId],
  );
}

/** Acknowledge: acknowledged and read, each once. Returns the row. */
function acknowledge(db, id, userId) {
  return one(
    db,
    `UPDATE announcement_read
        SET acknowledged_at = COALESCE(acknowledged_at, now()), read_at = COALESCE(read_at, now())
      WHERE announcement_id = $1 AND user_id = $2
      RETURNING *`,
    [id, userId],
  );
}

/** The poster has read what they posted, and acknowledged it when it is urgent. */
function markPosterRead(db, id, userId, urgent) {
  return db.query(
    `UPDATE announcement_read
        SET read_at = COALESCE(read_at, now()),
            acknowledged_at = CASE WHEN $3::boolean THEN COALESCE(acknowledged_at, now()) ELSE acknowledged_at END
      WHERE announcement_id = $1 AND user_id = $2`,
    [id, userId, urgent],
  );
}

function setReminded(db, id) {
  return db.query(
    "UPDATE announcement SET last_reminded_at = now() WHERE announcement_id = $1",
    [id],
  );
}

/** The caller opened #announcements: the announcements behind these messages are read. */
function markReadByMessages(db, userId, messageIds) {
  if (!messageIds.length) return Promise.resolve();
  return db.query(
    `UPDATE announcement_read r SET read_at = now()
       FROM announcement a
      WHERE a.announcement_id = r.announcement_id AND r.user_id = $1 AND r.read_at IS NULL
        AND a.community_message_id = ANY($2::uuid[])`,
    [userId, messageIds],
  );
}

/** Scheduled announcements whose time has come: the safety net behind the delayed job. */
async function due(db) {
  const { rows } = await db.query(
    `SELECT announcement_id FROM announcement
      WHERE status = 'scheduled' AND publish_at <= now()
      ORDER BY publish_at
      LIMIT 50 -- pagination:batch the scheduler releases what is due in batches`,
  );
  return rows.map((r) => r.announcement_id);
}

/**
 * The announcements in figures for the assistant (docs/guides/praxis-ai.md §6.13, Workspace, Knowledge
 * Hub, Community, Home and Settings), in one statement. With no `userId`, every announcement as the
 * Announcements tab tracks it: published and scheduled, the people each reached and how many read it
 * (DONE: acknowledged when urgent), the tab's Average Read. With `userId`, only the published ones that
 * person received (their own read row) and whether they read each, never anyone else's reading. The ten
 * newest published with read and not read for a stacked bar, by urgency, published by Lagos month. A
 * period (the Lagos day published, or due) narrows it only when given. Figures, never a row: never a message.
 * @param {{urgency?, from?, to?}} q
 * @param {{userId?: string|null}} reader
 */
async function aiSummary(db, q, { userId = null } = {}) {
  const { rows } = await db.query(
    `WITH x AS (
       SELECT a.announcement_id, a.title, a.status, a.urgency, a.published_at,
              CASE WHEN $1::uuid IS NULL THEN a.audience_size ELSE 1 END AS audience,
              (SELECT count(*)::int FROM announcement_read r
                WHERE r.announcement_id = a.announcement_id AND ($1::uuid IS NULL OR r.user_id = $1) AND ${DONE}) AS reads
         FROM announcement a
        WHERE a.status IN ('scheduled', 'published')
          AND ($1::uuid IS NULL OR (a.status = 'published' AND EXISTS (
                SELECT 1 FROM announcement_read m WHERE m.announcement_id = a.announcement_id AND m.user_id = $1)))
          AND ($2::text IS NULL OR a.urgency = $2)
          AND ($3::date IS NULL OR (COALESCE(a.published_at, a.publish_at) AT TIME ZONE 'Africa/Lagos')::date BETWEEN $3::date AND $4::date)
     ), p AS (SELECT * FROM x WHERE status = 'published'),
     newest AS (
       SELECT announcement_id, title, reads, GREATEST(audience - reads, 0) AS not_read,
              row_number() OVER (ORDER BY published_at DESC, announcement_id) AS rank
         FROM p
     )
     SELECT (SELECT json_build_object(
               'published', (SELECT count(*) FROM p), 'scheduled', count(*) FILTER (WHERE status = 'scheduled'),
               'urgent', (SELECT count(*) FROM p WHERE urgency = 'urgent'),
               'reached', (SELECT COALESCE(sum(audience), 0) FROM p),
               'read', (SELECT COALESCE(sum(reads), 0) FROM p),
               'urgent_waiting', (SELECT count(*) FROM p WHERE urgency = 'urgent' AND reads = 0),
               'average_read', (SELECT round(avg(reads * 100.0 / audience) FILTER (WHERE audience > 0), 1) FROM p)) FROM x) AS figures,
            (SELECT json_agg(json_build_object('key', urgency, 'value', n)) FROM (SELECT urgency, count(*)::int AS n FROM p GROUP BY urgency) u) AS by_urgency,
            (SELECT json_agg(json_build_object('key', announcement_id, 'label', title, 'read', reads, 'not_read', not_read) ORDER BY rank)
               FROM newest WHERE rank <= 10) AS newest,
            (SELECT json_agg(json_build_object('at', at, 'value', n) ORDER BY at)
               FROM (SELECT to_char(published_at AT TIME ZONE 'Africa/Lagos', 'YYYY-MM') AS at, count(*)::int AS n FROM p GROUP BY 1) m) AS by_month`,
    [userId, q.urgency || null, q.from || null, q.to || null],
  );
  const r = rows[0] || {};
  return { figures: r.figures || {}, by_urgency: r.by_urgency || [], newest: r.newest || [], by_month: r.by_month || [] };
}

module.exports = {
  aiSummary,
  archivePublished,
  stats,
  updateScheduled,
  cancelScheduled,
  list,
  get,
  lockForUpdate,
  insert,
  markPublished,
  audienceUsers,
  addAudience,
  readers,
  unreadUsers,
  readRowForUpdate,
  acknowledge,
  markPosterRead,
  setReminded,
  markReadByMessages,
  due,
};
