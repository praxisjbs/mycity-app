"use strict";
/**
 * Staff Community's SQL (migrations 1000, 1110, 1140 and 1147): channels and direct
 * conversations, their members, messages, reactions, poll votes, recognitions, presence and
 * link cards.
 *
 * Membership is the authorisation boundary (community.md §6): every read of a channel's
 * contents joins community_member on the caller, so a channel the caller is not in reads
 * as missing. Lists page at 25 through shared/http/paged.js; the latest message of a
 * channel is taken with an ordered aggregate rather than a sub-select with its own LIMIT.
 */
const { pageQuery, TOTAL_COL } = require("../../shared/http/paged");
const { personJson } = require("../../shared/db/person");
const { mediaJson } = require("../../shared/db/media");

const one = async (db, sql, params) =>
  (await db.query(sql, params)).rows[0] || null;

/** A person as the contract's PersonRef, with their photo, from employee `e` and department `d`. */
const PERSON = (e = "e", d = "d") => personJson(e, d);

/** Online is a socket touch inside the last 90 seconds (community.presence.js). */
const ONLINE = (p = "p") =>
  `COALESCE(${p}.last_seen_at > now() - interval '90 seconds', false)`;

/* ------------------------------------------------------------------ *
 * Channels and members
 * ------------------------------------------------------------------ */

/** #general or #announcements, made the first time it is needed. */
async function systemChannel(db, key) {
  const found = await one(
    db,
    "SELECT * FROM community_channel WHERE system_key = $1",
    [key],
  );
  if (found) return found;
  await db.query(
    `INSERT INTO community_channel (channel_type, name, description, post_policy, pinned, system_key)
     VALUES ('company', $1, NULL, $2, true, $1)
     ON CONFLICT (system_key) WHERE system_key IS NOT NULL DO NOTHING`,
    [key, key === "announcements" ? "people_ceo" : "everyone"],
  );
  return one(db, "SELECT * FROM community_channel WHERE system_key = $1", [
    key,
  ]);
}

function channelById(db, channelId) {
  return one(
    db,
    "SELECT * FROM community_channel WHERE community_channel_id = $1",
    [channelId],
  );
}

/** The caller's membership of a channel, with the channel, or null when they are not in it. */
function membership(db, channelId, userId) {
  return one(
    db,
    `SELECT c.*, m.member_role, m.muted_until, m.last_read_at, m.last_delivered_at
       FROM community_channel c
       JOIN community_member m ON m.community_channel_id = c.community_channel_id AND m.user_id = $2
      WHERE c.community_channel_id = $1 AND c.archived_at IS NULL`,
    [channelId, userId],
  );
}

async function addMembers(db, channelId, userIds, role = "member") {
  if (!userIds.length) return 0;
  const { rowCount } = await db.query(
    `INSERT INTO community_member (community_channel_id, user_id, member_role)
     SELECT $1, u, $3 FROM unnest($2::uuid[]) AS u
     ON CONFLICT (community_channel_id, user_id) DO NOTHING`,
    [channelId, userIds, role],
  );
  return rowCount;
}

/** One member with their person, as the members list shows them. */
function memberRow(db, channelId, userId) {
  return one(
    db,
    `SELECT m.user_id, m.member_role, m.joined_at, ${PERSON()} AS person
       FROM community_member m
       JOIN app_user u ON u.user_id = m.user_id
       JOIN employee e ON e.employee_id = u.employee_id
       LEFT JOIN department d ON d.department_id = e.department_id
      WHERE m.community_channel_id = $1 AND m.user_id = $2`,
    [channelId, userId],
  );
}

/** The channel's admins, its row locked so two admins stepping down at once cannot leave it with none. */
async function adminsLocked(db, channelId) {
  await db.query(
    "SELECT 1 FROM community_channel WHERE community_channel_id = $1 FOR UPDATE",
    [channelId],
  );
  const { rows } = await db.query(
    "SELECT user_id FROM community_member WHERE community_channel_id = $1 AND member_role = 'admin' ORDER BY user_id",
    [channelId],
  );
  return rows.map((r) => r.user_id);
}

function setRole(db, channelId, userId, role) {
  return db.query(
    "UPDATE community_member SET member_role = $3 WHERE community_channel_id = $1 AND user_id = $2",
    [channelId, userId, role],
  );
}

function removeMember(db, channelId, userId) {
  return db.query(
    "DELETE FROM community_member WHERE community_channel_id = $1 AND user_id = $2",
    [channelId, userId],
  );
}

/** Whole years since an employee started, on a Lagos date; null with no start date or under a year. */
async function yearsServed(db, employeeId, onDate) {
  const row = await one(
    db,
    `SELECT (extract(year FROM age($2::date, start_date)))::int AS years FROM employee WHERE employee_id = $1 AND start_date IS NOT NULL`,
    [employeeId, onDate],
  );
  return row && row.years >= 1 ? row.years : null;
}

/** Active logins for employees and for whole departments, deduplicated. */
async function usersFor(db, { employeeIds = [], departmentIds = [] }) {
  if (!employeeIds.length && !departmentIds.length) return [];
  const { rows } = await db.query(
    `SELECT DISTINCT u.user_id
       FROM app_user u JOIN employee e ON e.employee_id = u.employee_id
      WHERE u.status = 'active'
        AND (e.employee_id = ANY($1::uuid[]) OR e.department_id = ANY($2::uuid[]))`,
    [employeeIds, departmentIds],
  );
  return rows.map((r) => r.user_id);
}

async function userOfEmployee(db, employeeId) {
  const row = await one(
    db,
    "SELECT user_id FROM app_user WHERE employee_id = $1 AND status = 'active'",
    [employeeId],
  );
  return row ? row.user_id : null;
}

function nameTaken(db, name) {
  return one(
    db,
    "SELECT 1 FROM community_channel WHERE name = $1 AND channel_type <> 'direct' AND archived_at IS NULL",
    [name],
  );
}

function insertChannel(
  db,
  {
    name,
    description,
    post_policy: postPolicy,
    channel_type: type,
    created_by: by,
  },
) {
  return one(
    db,
    `INSERT INTO community_channel (channel_type, name, description, post_policy, created_by)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [type, name, description ?? null, postPolicy, by],
  );
}

/** The latest message of channel `c`, without a LIMIT inside the paged query. */
const LAST = `LEFT JOIN LATERAL (
    SELECT (array_agg(x.body ORDER BY x.sent_at DESC))[1] AS last_body,
           (array_agg(x.message_type ORDER BY x.sent_at DESC))[1] AS last_type,
           (array_agg(x.sender_user_id ORDER BY x.sent_at DESC))[1] AS last_sender,
           max(x.sent_at) AS last_at
      FROM community_message x
     WHERE x.community_channel_id = c.community_channel_id AND x.deleted_at IS NULL) lm ON true`;

const UNREAD = `(SELECT count(*)::int FROM community_message x
    WHERE x.community_channel_id = c.community_channel_id AND x.deleted_at IS NULL
      AND (x.sender_user_id IS NULL OR x.sender_user_id <> $1)
      AND (m.last_read_at IS NULL OR x.sent_at > m.last_read_at))`;

/** The caller's channels: pinned first, then the latest activity. */
function listChannels(db, userId, query) {
  return pageQuery(
    db,
    `SELECT c.community_channel_id, c.name, c.description, c.channel_type, c.post_policy, c.pinned, c.system_key,
            m.member_role, m.muted_until, (c.pinned OR m.pinned_at IS NOT NULL) AS pinned_for_me,
            (SELECT count(*)::int FROM community_member mm WHERE mm.community_channel_id = c.community_channel_id) AS members,
            ${UNREAD} AS unread, lm.last_body, lm.last_type, lm.last_at, ${TOTAL_COL}
       FROM community_channel c
       JOIN community_member m ON m.community_channel_id = c.community_channel_id AND m.user_id = $1
       ${LAST}
      WHERE c.channel_type <> 'direct' AND c.archived_at IS NULL
        AND ($2::text IS NULL OR search_fold(c.name) LIKE '%' || search_fold($2) || '%')
      ORDER BY c.pinned DESC, m.pinned_at DESC NULLS LAST, COALESCE(lm.last_at, c.created_at) DESC, c.community_channel_id`,
    [userId, query.q ?? null],
    query,
  );
}

/** One channel for the caller, in the list's shape. */
function channelFor(db, channelId, userId) {
  return one(
    db,
    `SELECT c.community_channel_id, c.name, c.description, c.channel_type, c.post_policy, c.pinned, c.system_key,
            m.member_role, m.muted_until, (c.pinned OR m.pinned_at IS NOT NULL) AS pinned_for_me,
            (SELECT count(*)::int FROM community_member mm WHERE mm.community_channel_id = c.community_channel_id) AS members,
            ${UNREAD} AS unread, lm.last_body, lm.last_type, lm.last_at
       FROM community_channel c
       JOIN community_member m ON m.community_channel_id = c.community_channel_id AND m.user_id = $1
       ${LAST}
      WHERE c.community_channel_id = $2`,
    [userId, channelId],
  );
}

function listMembers(db, channelId, query) {
  return pageQuery(
    db,
    `SELECT m.user_id, m.member_role, m.joined_at, ${PERSON()} AS person, ${TOTAL_COL}
       FROM community_member m
       JOIN app_user u ON u.user_id = m.user_id
       JOIN employee e ON e.employee_id = u.employee_id
       LEFT JOIN department d ON d.department_id = e.department_id
      WHERE m.community_channel_id = $1
        AND ($2::text IS NULL OR search_fold(e.first_name || ' ' || e.last_name) LIKE '%' || search_fold($2) || '%')
      ORDER BY (m.member_role = 'admin') DESC, e.first_name, e.last_name, m.user_id`,
    [channelId, query.q ?? null],
    query,
  );
}

/** Everyone in a channel but `exceptUserId`, and whether each muted it: the fan-out's audience. */
async function audienceOf(db, channelId, exceptUserId) {
  const { rows } = await db.query(
    `SELECT user_id, (muted_until IS NOT NULL AND muted_until > now()) AS muted
       FROM community_member WHERE community_channel_id = $1 AND user_id IS DISTINCT FROM $2`,
    [channelId, exceptUserId ?? null],
  );
  return rows;
}

function setMuted(db, channelId, userId, muted) {
  return db.query(
    `UPDATE community_member SET muted_until = CASE WHEN $3 THEN 'infinity'::timestamptz ELSE NULL END
      WHERE community_channel_id = $1 AND user_id = $2`,
    [channelId, userId, muted],
  );
}

async function membershipPinned(db, channelId, userId) {
  const row = await one(
    db,
    "SELECT pinned_at FROM community_member WHERE community_channel_id = $1 AND user_id = $2",
    [channelId, userId],
  );
  return Boolean(row && row.pinned_at);
}

/** The caller's pins, their row locked so two pins at once cannot pass the limit. */
async function pinsLocked(db, userId) {
  await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
    `community:pins:${userId}`,
  ]);
  const row = await one(
    db,
    "SELECT count(*)::int AS n FROM community_member WHERE user_id = $1 AND pinned_at IS NOT NULL",
    [userId],
  );
  return row.n;
}

function setPinned(db, channelId, userId, on) {
  return db.query(
    "UPDATE community_member SET pinned_at = CASE WHEN $3 THEN COALESCE(pinned_at, now()) ELSE NULL END WHERE community_channel_id = $1 AND user_id = $2",
    [channelId, userId, on],
  );
}

function markRead(db, channelId, userId) {
  return db.query(
    `UPDATE community_member SET last_read_at = now(),
            last_delivered_at = GREATEST(COALESCE(last_delivered_at, now()), now())
      WHERE community_channel_id = $1 AND user_id = $2`,
    [channelId, userId],
  );
}

function markDelivered(db, channelId, userId, upTo) {
  return db.query(
    `UPDATE community_member SET last_delivered_at = GREATEST(COALESCE(last_delivered_at, $3), LEAST($3, now()))
      WHERE community_channel_id = $1 AND user_id = $2`,
    [channelId, userId, upTo],
  );
}

/* ------------------------------------------------------------------ *
 * Direct conversations
 * ------------------------------------------------------------------ */

/** The one direct channel between two users, if there is one. */
async function findDirect(db, userA, userB) {
  return one(
    db,
    `SELECT c.community_channel_id
       FROM community_channel c
       JOIN community_member a ON a.community_channel_id = c.community_channel_id AND a.user_id = $1
       JOIN community_member b ON b.community_channel_id = c.community_channel_id AND b.user_id = $2
      WHERE c.channel_type = 'direct'
        AND (SELECT count(*) FROM community_member z WHERE z.community_channel_id = c.community_channel_id) = CASE WHEN $1 = $2 THEN 1 ELSE 2 END
      LIMIT 1`,
    [userA, userB],
  );
}

/** Serialises the creation of one pair's conversation, so two first messages make one channel. */
function lockPair(db, userA, userB) {
  const key = [userA, userB].sort().join(":");
  return db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
    `community:direct:${key}`,
  ]);
}

const CONVERSATION = `
  SELECT c.community_channel_id, other.user_id, (other.user_id = $1) AS is_self, ${PERSON("e", "d")} AS person,
         ${ONLINE()} AS online, p.last_seen_at,
         (m.muted_until IS NOT NULL AND m.muted_until > now()) AS muted, (m.pinned_at IS NOT NULL) AS pinned,
         ${UNREAD} AS unread, lm.last_body, lm.last_type, lm.last_at, (lm.last_sender = $1) AS last_mine`;
const CONVERSATION_FROM = `
    FROM community_channel c
    JOIN community_member m ON m.community_channel_id = c.community_channel_id AND m.user_id = $1
    -- The other member; in a conversation with oneself, the caller.
    JOIN LATERAL (SELECT (array_agg(mm.user_id ORDER BY (mm.user_id = $1), mm.user_id))[1] AS user_id
                    FROM community_member mm WHERE mm.community_channel_id = c.community_channel_id) other ON true
    JOIN app_user u ON u.user_id = other.user_id
    JOIN employee e ON e.employee_id = u.employee_id
    LEFT JOIN department d ON d.department_id = e.department_id
    LEFT JOIN community_presence p ON p.user_id = other.user_id
    ${LAST}`;

function listConversations(db, userId, query) {
  return pageQuery(
    db,
    `${CONVERSATION}, ${TOTAL_COL} ${CONVERSATION_FROM}
      WHERE c.channel_type = 'direct'
        AND ($2::text IS NULL OR search_fold(e.first_name || ' ' || e.last_name) LIKE '%' || search_fold($2) || '%')
        AND (NOT $3::boolean OR ${UNREAD} > 0)
        AND (lm.last_at IS NOT NULL OR c.created_by = $1)
      ORDER BY m.pinned_at DESC NULLS LAST, COALESCE(lm.last_at, c.created_at) DESC, c.community_channel_id`,
    [userId, query.q ?? null, Boolean(query.unread)],
    query,
  );
}

function conversationFor(db, channelId, userId) {
  return one(
    db,
    `${CONVERSATION} ${CONVERSATION_FROM} WHERE c.community_channel_id = $2`,
    [userId, channelId],
  );
}

/** Every direct channel the user is in: receiving a message there marks it delivered. */
async function directChannelsOf(db, userId) {
  const { rows } = await db.query(
    `SELECT m.community_channel_id FROM community_member m
       JOIN community_channel c ON c.community_channel_id = m.community_channel_id
      WHERE m.user_id = $1 AND c.channel_type = 'direct'`,
    [userId],
  );
  return rows.map((r) => r.community_channel_id);
}

/** The other member's pointers in a direct channel: the ticks on the caller's messages. */
function otherPointers(db, channelId, userId) {
  return one(
    db,
    `SELECT last_read_at, last_delivered_at FROM community_member
      WHERE community_channel_id = $1 AND user_id <> $2 LIMIT 1`,
    [channelId, userId],
  );
}

/* ------------------------------------------------------------------ *
 * Messages
 * ------------------------------------------------------------------ */

/** A ready link card as the contract's LinkPreview, from card `lp` and its picture `lpd`; null otherwise. */
const LINK_PREVIEW = (lp = "lp", lpd = "lpd") => `
  CASE WHEN ${lp}.community_link_preview_id IS NULL OR ${lp}.status <> 'ready' THEN NULL ELSE json_build_object(
    'community_link_preview_id', ${lp}.community_link_preview_id,
    'url', ${lp}.url,
    'site_name', ${lp}.site_name,
    'title', ${lp}.title,
    'description', ${lp}.description,
    'image', ${mediaJson(lpd)}) END`;

const MESSAGE = `
  SELECT x.community_message_id, x.community_channel_id, x.message_type, x.sender_user_id, x.sent_at,
         x.body, x.metadata, x.transcript, x.deleted_at, x.edited_at, x.document_id,
         x.community_link_preview_id,
         ${PERSON("e", "d")} AS author,
         ${mediaJson("doc")} AS document,
         ${LINK_PREVIEW("lp", "lpd")} AS link,
         (SELECT count(*)::int FROM community_reaction r WHERE r.community_message_id = x.community_message_id) AS reactions,
         EXISTS (SELECT 1 FROM community_reaction r WHERE r.community_message_id = x.community_message_id AND r.user_id = $1) AS reacted,
         pr.to_employee_id AS recognised_employee_id,
         a.announcement_id, a.title AS announcement_title, a.urgency AS announcement_urgency,
         (ar.user_id IS NOT NULL) AS announcement_in_audience,
         ar.acknowledged_at AS announcement_acknowledged_at`;
/** $1 is the reader: their own reads row of an announcement says whether they acknowledged it. */
const MESSAGE_FROM = `
    FROM community_message x
    LEFT JOIN app_user u ON u.user_id = x.sender_user_id
    LEFT JOIN employee e ON e.employee_id = u.employee_id
    LEFT JOIN department d ON d.department_id = e.department_id
    LEFT JOIN document doc ON doc.document_id = x.document_id
    LEFT JOIN community_link_preview lp ON lp.community_link_preview_id = x.community_link_preview_id
    LEFT JOIN document lpd ON lpd.document_id = lp.image_document_id
    LEFT JOIN peer_recognition pr ON pr.community_message_id = x.community_message_id
    LEFT JOIN announcement a ON a.community_message_id = x.community_message_id
    LEFT JOIN announcement_read ar ON ar.announcement_id = a.announcement_id AND ar.user_id = $1`;

/** A page of a channel's messages, newest first; with `q`, only those that match. */
function listMessages(db, channelId, userId, query) {
  return pageQuery(
    db,
    `${MESSAGE}, ${TOTAL_COL} ${MESSAGE_FROM}
      WHERE x.community_channel_id = $2
        AND ($3::text IS NULL OR (x.deleted_at IS NULL AND
             (search_fold(COALESCE(x.body, '')) LIKE '%' || search_fold($3) || '%'
              OR search_fold(COALESCE(x.transcript, '')) LIKE '%' || search_fold($3) || '%')))
      ORDER BY x.sent_at DESC, x.community_message_id DESC`,
    [userId, channelId, query.q ?? null],
    query,
  );
}

function messageFor(db, messageId, userId) {
  return one(
    db,
    `${MESSAGE} ${MESSAGE_FROM} WHERE x.community_message_id = $2`,
    [userId, messageId],
  );
}

/** The message row itself, locked for an edit, a delete or a close. */
function lockMessage(db, messageId) {
  return one(
    db,
    "SELECT * FROM community_message WHERE community_message_id = $1 FOR UPDATE",
    [messageId],
  );
}

function editMessage(db, messageId, { body, metadata, community_link_preview_id = null }) {
  return one(
    db,
    `UPDATE community_message SET body = $2, metadata = $3, community_link_preview_id = $4, edited_at = now()
      WHERE community_message_id = $1 RETURNING *`,
    [messageId, body, metadata, community_link_preview_id],
  );
}

function setMetadata(db, messageId, metadata) {
  return one(
    db,
    "UPDATE community_message SET metadata = $2 WHERE community_message_id = $1 RETURNING *",
    [messageId, metadata],
  );
}

function deleteMessage(db, messageId) {
  return one(
    db,
    "UPDATE community_message SET deleted_at = now() WHERE community_message_id = $1 AND deleted_at IS NULL RETURNING *",
    [messageId],
  );
}

/** A deleted recognition leaves the counts Home and M2 read. */
function deleteRecognitionOf(db, messageId) {
  return db.query(
    "DELETE FROM peer_recognition WHERE community_message_id = $1",
    [messageId],
  );
}

async function voteCount(db, messageId) {
  const row = await one(
    db,
    "SELECT count(*)::int AS n FROM community_poll_vote WHERE community_message_id = $1",
    [messageId],
  );
  return row.n;
}

function insertMessage(db, m) {
  return one(
    db,
    `INSERT INTO community_message (community_channel_id, sender_user_id, message_type, body, document_id, metadata,
                                    community_link_preview_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [
      m.community_channel_id,
      m.sender_user_id ?? null,
      m.message_type,
      m.body ?? null,
      m.document_id ?? null,
      m.metadata ?? {},
      m.community_link_preview_id ?? null,
    ],
  );
}

/** A stored file as the contract's MediaRef: its shape, pages, length and the sizes it has. */
async function mediaRef(db, documentId) {
  const row = await one(db, `SELECT ${mediaJson("doc")} AS media FROM document doc WHERE doc.document_id = $1`, [documentId]);
  return row ? row.media : null;
}

/* ------------------------------------------------------------------ *
 * Link cards (community.links.js)
 * ------------------------------------------------------------------ */

/** The card kept for an address, if any; `lock` holds it for the rest of the transaction. */
function linkPreviewByUrl(db, url, { lock = false } = {}) {
  return one(
    db,
    `SELECT * FROM community_link_preview WHERE url = $1${lock ? " FOR UPDATE" : ""}`,
    [url],
  );
}

function linkPreviewById(db, previewId, { lock = false } = {}) {
  return one(
    db,
    `SELECT * FROM community_link_preview WHERE community_link_preview_id = $1${lock ? " FOR UPDATE" : ""}`,
    [previewId],
  );
}

/** Keep what a page said about itself, replacing what was kept for that address before. */
function saveLinkPreview(db, card) {
  return one(
    db,
    `INSERT INTO community_link_preview (url, status, site_name, title, description, image_document_id, fetched_at)
     VALUES ($1, $2, $3, $4, $5, NULL, now())
     ON CONFLICT (url) DO UPDATE
       SET status = EXCLUDED.status, site_name = EXCLUDED.site_name, title = EXCLUDED.title,
           description = EXCLUDED.description, image_document_id = NULL, fetched_at = now()
     RETURNING *`,
    [card.url, card.status, card.site_name ?? null, card.title ?? null, card.description ?? null],
  );
}

function setLinkPreviewImage(db, previewId, documentId) {
  return one(
    db,
    "UPDATE community_link_preview SET image_document_id = $2 WHERE community_link_preview_id = $1 RETURNING *",
    [previewId, documentId],
  );
}

/** A card as the contract's LinkPreview; null when it is not ready. */
async function linkPreviewView(db, previewId) {
  const row = await one(
    db,
    `SELECT ${LINK_PREVIEW("lp", "lpd")} AS preview
       FROM community_link_preview lp
       LEFT JOIN document lpd ON lpd.document_id = lp.image_document_id
      WHERE lp.community_link_preview_id = $1`,
    [previewId],
  );
  return row ? row.preview : null;
}

/** Attach a card to a text message that still shows that link and has none yet. */
function attachLinkPreview(db, messageId, previewId) {
  return one(
    db,
    `UPDATE community_message SET community_link_preview_id = $2
      WHERE community_message_id = $1 AND message_type = 'text' AND deleted_at IS NULL
        AND community_link_preview_id IS DISTINCT FROM $2
      RETURNING community_message_id, community_channel_id`,
    [messageId, previewId],
  );
}

/** What the link-preview job needs to know about a message. */
function messageForCard(db, messageId) {
  return one(
    db,
    `SELECT community_message_id, community_channel_id, sender_user_id, message_type, body, metadata,
            deleted_at, community_link_preview_id
       FROM community_message WHERE community_message_id = $1`,
    [messageId],
  );
}

function setTranscript(db, messageId, transcript) {
  return db.query(
    "UPDATE community_message SET transcript = $2 WHERE community_message_id = $1",
    [messageId, transcript],
  );
}

/** People who are the subject of celebration cards and who are recognised, by employee id. */
async function people(db, employeeIds) {
  if (!employeeIds.length) return new Map();
  const { rows } = await db.query(
    `SELECT e.employee_id, ${PERSON()} AS person
       FROM employee e LEFT JOIN department d ON d.department_id = e.department_id
      WHERE e.employee_id = ANY($1::uuid[])`,
    [employeeIds],
  );
  return new Map(rows.map((r) => [r.employee_id, r.person]));
}

/** The first three people who reacted to each message, oldest first. */
async function fans(db, messageIds) {
  if (!messageIds.length) return new Map();
  const { rows } = await db.query(
    `SELECT f.community_message_id, json_agg(f.person ORDER BY f.created_at) AS fans
       FROM (SELECT r.community_message_id, r.created_at, ${PERSON()} AS person,
                    row_number() OVER (PARTITION BY r.community_message_id ORDER BY r.created_at) AS n
               FROM community_reaction r
               JOIN app_user u ON u.user_id = r.user_id
               JOIN employee e ON e.employee_id = u.employee_id
               LEFT JOIN department d ON d.department_id = e.department_id
              WHERE r.community_message_id = ANY($1::uuid[])) f
      WHERE f.n <= 3
      GROUP BY f.community_message_id`,
    [messageIds],
  );
  return new Map(rows.map((r) => [r.community_message_id, r.fans]));
}

/** Votes per option for polls, and the caller's own vote. */
async function votes(db, messageIds, userId) {
  if (!messageIds.length) return new Map();
  const { rows } = await db.query(
    `SELECT community_message_id, option_index, count(*)::int AS votes,
            bool_or(user_id = $2) AS mine
       FROM community_poll_vote WHERE community_message_id = ANY($1::uuid[])
      GROUP BY community_message_id, option_index`,
    [messageIds, userId],
  );
  const out = new Map();
  for (const r of rows) {
    if (!out.has(r.community_message_id))
      out.set(r.community_message_id, { counts: {}, mine: null });
    const v = out.get(r.community_message_id);
    v.counts[r.option_index] = r.votes;
    if (r.mine) v.mine = r.option_index;
  }
  return out;
}

/** Toggle the caller's one reaction on a message. Returns true when it is now on. */
async function toggleReaction(db, messageId, userId, reaction) {
  const { rowCount } = await db.query(
    "DELETE FROM community_reaction WHERE community_message_id = $1 AND user_id = $2 AND reaction = $3",
    [messageId, userId, reaction],
  );
  if (rowCount) return false;
  await db.query(
    `INSERT INTO community_reaction (community_message_id, user_id, reaction) VALUES ($1, $2, $3)
     ON CONFLICT (community_message_id, user_id, reaction) DO NOTHING`,
    [messageId, userId, reaction],
  );
  return true;
}

/** One vote per person; voting again moves it, and voting for the same option takes it back. */
async function vote(db, messageId, userId, optionIndex) {
  const { rowCount } = await db.query(
    "DELETE FROM community_poll_vote WHERE community_message_id = $1 AND user_id = $2 AND option_index = $3",
    [messageId, userId, optionIndex],
  );
  if (rowCount) return;
  await db.query(
    `INSERT INTO community_poll_vote (community_message_id, user_id, option_index) VALUES ($1, $2, $3)
     ON CONFLICT (community_message_id, user_id) DO UPDATE SET option_index = EXCLUDED.option_index`,
    [messageId, userId, optionIndex],
  );
}

function insertRecognition(db, r) {
  return one(
    db,
    `INSERT INTO peer_recognition (from_employee_id, to_employee_id, message, community_message_id, note_written_by_system)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [
      r.from_employee_id,
      r.to_employee_id,
      r.message,
      r.community_message_id,
      r.note_written_by_system,
    ],
  );
}

/* ------------------------------------------------------------------ *
 * Presence and the profile card
 * ------------------------------------------------------------------ */

function touchPresence(db, userId) {
  return db.query(
    `INSERT INTO community_presence (user_id, last_seen_at) VALUES ($1, now())
     ON CONFLICT (user_id) DO UPDATE SET last_seen_at = now()`,
    [userId],
  );
}

/** Active colleagues with a login, by name, for the picker: public work fields only. */
/** Colleagues for the pickers; the caller only when asked (New Message: a conversation with oneself). */
function listColleagues(db, query, userId) {
  return pageQuery(
    db,
    `SELECT ${PERSON()} AS person, ${TOTAL_COL}
       FROM employee e
       JOIN app_user u ON u.employee_id = e.employee_id AND u.status = 'active'
       LEFT JOIN department d ON d.department_id = e.department_id
      WHERE e.status = 'active' AND e.archived_at IS NULL AND ($3::boolean OR u.user_id <> $2)
        AND ($1::text IS NULL OR search_fold(e.first_name || ' ' || e.last_name || ' ' || COALESCE(d.name, '') || ' ' || e.job_title)
                                 LIKE '%' || search_fold($1) || '%')
      ORDER BY e.first_name, e.last_name, e.employee_id`,
    [query.q ?? null, userId, Boolean(query.with_self)],
    query,
  );
}

/** A colleague's public work details (no restricted field): the profile panel. */
function profile(db, employeeId) {
  return one(
    db,
    `SELECT ${PERSON()} AS person, u.user_id, e.work_email::text AS work_email, e.phone,
            w.name AS worksite, ${ONLINE()} AS online, p.last_seen_at
       FROM employee e
       LEFT JOIN department d ON d.department_id = e.department_id
       LEFT JOIN worksite w ON w.worksite_id = e.worksite_id
       LEFT JOIN app_user u ON u.employee_id = e.employee_id AND u.status = 'active'
       LEFT JOIN community_presence p ON p.user_id = u.user_id
      WHERE e.employee_id = $1 AND e.status <> 'left'`,
    [employeeId],
  );
}

/** Files and voice notes in the conversation between two users, newest first. */
async function shared(db, userA, userB) {
  const direct = await findDirect(db, userA, userB);
  if (!direct) return { files: [], voice_notes: 0 };
  const { rows } = await db.query(
    `SELECT x.message_type, ${mediaJson("doc")} AS document
       FROM community_message x JOIN document doc ON doc.document_id = x.document_id
      WHERE x.community_channel_id = $1 AND x.deleted_at IS NULL
      ORDER BY x.sent_at DESC
      LIMIT 50 -- pagination:batch the profile shows the latest files of one conversation, not a list`,
    [direct.community_channel_id],
  );
  return {
    files: rows
      .filter((r) => r.message_type !== "audio")
      .slice(0, 25)
      .map((r) => r.document),
    voice_notes: rows.filter((r) => r.message_type === "audio").length,
  };
}

/** Names of channels two users are both in. */
async function channelsInCommon(db, userA, userB) {
  const { rows } = await db.query(
    `SELECT c.name FROM community_channel c
       JOIN community_member a ON a.community_channel_id = c.community_channel_id AND a.user_id = $1
       JOIN community_member b ON b.community_channel_id = c.community_channel_id AND b.user_id = $2
      WHERE c.channel_type <> 'direct' AND c.archived_at IS NULL
      ORDER BY c.pinned DESC, c.name
      LIMIT 25 -- pagination:batch the profile names at most 25 channels in common`,
    [userA, userB],
  );
  return rows.map((r) => r.name);
}

/* ------------------------------------------------------------------ *
 * Celebrations (A20)
 * ------------------------------------------------------------------ */

/**
 * Active employees whose birthday (day and month) or start-date anniversary falls on
 * `date`, with how many years. 29 February falls on 28 February in other years.
 */
async function celebrationsOn(db, date) {
  const { rows } = await db.query(
    `WITH day AS (SELECT $1::date AS d)
     SELECT e.employee_id, 'birthday' AS occasion, NULL::int AS years
       FROM employee e, day
      WHERE e.status = 'active' AND e.archived_at IS NULL AND e.date_of_birth IS NOT NULL
        AND (to_char(e.date_of_birth, 'MM-DD') = to_char(day.d, 'MM-DD')
             OR (to_char(e.date_of_birth, 'MM-DD') = '02-29' AND to_char(day.d, 'MM-DD') = '02-28'
                 AND NOT (extract(year FROM day.d)::int % 4 = 0 AND (extract(year FROM day.d)::int % 100 <> 0 OR extract(year FROM day.d)::int % 400 = 0))))
     UNION ALL
     SELECT e.employee_id, 'anniversary', (extract(year FROM day.d) - extract(year FROM e.start_date))::int
       FROM employee e, day
      WHERE e.status = 'active' AND e.archived_at IS NULL
        AND e.start_date < day.d
        AND to_char(e.start_date, 'MM-DD') = to_char(day.d, 'MM-DD')
      ORDER BY 1, 2`,
    [date],
  );
  return rows;
}

/** Whether a card for this person and occasion was already posted on `date` (Lagos). */
function celebrationPosted(db, channelId, employeeId, occasion, date) {
  return one(
    db,
    `SELECT 1 FROM community_message
      WHERE community_channel_id = $1 AND message_type = $3
        AND metadata->>'subject_employee_id' = $2::text
        AND (sent_at AT TIME ZONE 'Africa/Lagos')::date = $4::date
      LIMIT 1`,
    [channelId, employeeId, occasion, date],
  );
}

module.exports = {
  yearsServed,
  membershipPinned,
  pinsLocked,
  setPinned,
  lockMessage,
  editMessage,
  setMetadata,
  deleteMessage,
  deleteRecognitionOf,
  voteCount,
  memberRow,
  adminsLocked,
  setRole,
  PERSON,
  systemChannel,
  channelById,
  membership,
  addMembers,
  removeMember,
  usersFor,
  userOfEmployee,
  nameTaken,
  insertChannel,
  listChannels,
  channelFor,
  listMembers,
  audienceOf,
  setMuted,
  markRead,
  markDelivered,
  findDirect,
  lockPair,
  listConversations,
  conversationFor,
  directChannelsOf,
  otherPointers,
  listMessages,
  messageFor,
  insertMessage,
  mediaRef,
  linkPreviewByUrl,
  linkPreviewById,
  saveLinkPreview,
  setLinkPreviewImage,
  linkPreviewView,
  attachLinkPreview,
  messageForCard,
  setTranscript,
  people,
  fans,
  votes,
  toggleReaction,
  vote,
  insertRecognition,
  touchPresence,
  listColleagues,
  profile,
  shared,
  channelsInCommon,
  celebrationsOn,
  celebrationPosted,
};
