"use strict";
/**
 * Announcements' SQL (migrations 1000 and 1010): the announcement record, its audience
 * and who has read it. An announcement_read row is written for each person in the
 * audience when it is published, with read_at empty until they open it, so the read and
 * not-read lists and the counts come from one table.
 */
const { pageQuery, TOTAL_COL } = require("../../shared/http/paged");
const { PERSON } = require("../community/community.repo");

const one = async (db, sql, params) => (await db.query(sql, params)).rows[0] || null;

const ROW = `
  SELECT a.announcement_id, a.title, a.body, a.audience, a.status, a.publish_at, a.published_at,
         a.audience_size, a.community_message_id, a.last_reminded_at, a.published_by,
         ${PERSON("e", "d")} AS author,
         COALESCE((SELECT array_agg(dd.name ORDER BY dd.name) FROM department dd
                    WHERE dd.department_id::text IN (SELECT jsonb_array_elements_text(a.audience->'department_ids'))), '{}') AS departments,
         (SELECT count(*)::int FROM announcement_read r WHERE r.announcement_id = a.announcement_id AND r.read_at IS NOT NULL) AS reads`;
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
  return one(db, "SELECT * FROM announcement WHERE announcement_id = $1 FOR UPDATE", [id]);
}

function insert(db, a) {
  return one(
    db,
    `INSERT INTO announcement (title, body, audience, status, published_by, publish_at)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [a.title, a.body, a.audience, a.status, a.published_by, a.publish_at ?? null],
  );
}

function updateScheduled(db, id, a) {
  return one(
    db,
    `UPDATE announcement SET title = $2, body = $3, audience = $4, publish_at = $5
      WHERE announcement_id = $1 AND status = 'scheduled' RETURNING *`,
    [id, a.title, a.body, a.audience, a.publish_at],
  );
}

function cancelScheduled(db, id) {
  return one(db, "UPDATE announcement SET status = 'cancelled' WHERE announcement_id = $1 AND status = 'scheduled' RETURNING *", [id]);
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
                           WHERE x.announcement_id = a.announcement_id AND x.read_at IS NOT NULL) r ON true`,
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

/** The audience with their read marks; `read` narrows to those who have or have not read it. */
function readers(db, id, query) {
  return pageQuery(
    db,
    `SELECT r.read_at, ${PERSON()} AS person, ${TOTAL_COL}
       FROM announcement_read r
       JOIN app_user u ON u.user_id = r.user_id
       JOIN employee e ON e.employee_id = u.employee_id
       LEFT JOIN department d ON d.department_id = e.department_id
      WHERE r.announcement_id = $1
        AND ($2::text IS NULL OR ($2 = 'read') = (r.read_at IS NOT NULL))
        AND ($3::text IS NULL OR search_fold(e.first_name || ' ' || e.last_name) LIKE '%' || search_fold($3) || '%')
      ORDER BY r.read_at DESC NULLS LAST, e.first_name, e.last_name, r.announcement_read_id`,
    [id, query.read ?? null, query.q ?? null],
    query,
  );
}

async function unreadUsers(db, id) {
  const { rows } = await db.query(
    "SELECT user_id FROM announcement_read WHERE announcement_id = $1 AND read_at IS NULL ORDER BY user_id",
    [id],
  );
  return rows.map((r) => r.user_id);
}

function setReminded(db, id) {
  return db.query("UPDATE announcement SET last_reminded_at = now() WHERE announcement_id = $1", [id]);
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

module.exports = {
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
  setReminded,
  markReadByMessages,
  due,
};
