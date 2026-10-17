"use strict";
/**
 * Announcements (community.md §3 step 2, §3 step 12, §6).
 *
 * Publishing writes the announcement, one message in #announcements and a read row for
 * each person in the audience, in one transaction. A scheduled announcement is stored
 * with publish_at and released by the announcement-publish job at that instant (and by
 * the scheduler's safety net if a job is lost), through the same publish().
 *
 * Read counts and the read lists are for the poster and holders of announcements.post;
 * the routes check the capability.
 */
const { pool } = require("../../config/db");
const { atomically } = require("../../shared/db/tx");
const { emit } = require("../../shared/events/emit");
const { AppError } = require("../../shared/errors");
const lagos = require("../../shared/time/lagos");
const communityRepo = require("../community/community.repo");
const repo = require("./announcements.repo");
const { EVENTS } = require("./announcements.events");

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

const iso = (v) => (v ? new Date(v).toISOString() : null);

function view(row) {
  const audience = row.audience && row.audience.kind ? row.audience : { kind: "all", department_ids: [] };
  return {
    announcement_id: row.announcement_id,
    title: row.title,
    body: row.body,
    audience: { kind: audience.kind, department_ids: audience.department_ids || [] },
    departments: row.departments || [],
    status: row.status,
    author: row.author,
    publish_at: iso(row.publish_at),
    published_at: iso(row.published_at),
    reads: row.reads,
    audience_size: row.audience_size,
  };
}

async function list(query) {
  const page = await repo.list(pool, query);
  return { ...page, data: page.data.map(view) };
}

async function get(id) {
  const row = await repo.get(pool, id);
  if (!row) throw new AppError("NOT_FOUND", "There is no such announcement", 404);
  return view(row);
}

/** Publish inside the caller's transaction: message, audience, event. Idempotent. */
async function publish(client, id) {
  const a = await repo.lockForUpdate(client, id);
  if (!a || a.status === "published") return a;
  const channel = await communityRepo.systemChannel(client, "announcements");
  const users = await repo.audienceUsers(client, a.audience);
  await communityRepo.addMembers(client, channel.community_channel_id, users);
  const message = await communityRepo.insertMessage(client, {
    community_channel_id: channel.community_channel_id,
    sender_user_id: a.published_by,
    message_type: "announcement",
    body: a.body,
  });
  await repo.addAudience(client, id, users);
  const published = await repo.markPublished(client, id, {
    messageId: message.community_message_id,
    audienceSize: users.length,
  });
  await emit(client, {
    key: EVENTS.ANNOUNCEMENT_PUBLISHED,
    entity: { type: "announcement", id },
    actor: a.published_by,
    after: published,
    payload: {
      announcement_id: id,
      title: a.title,
      community_channel_id: channel.community_channel_id,
      community_message_id: message.community_message_id,
    },
    dedup_key: `announcement:published:${id}`,
  });
  return published;
}

async function create(body, user) {
  const when = body.publish_at ? new Date(body.publish_at) : null;
  if (when && when.getTime() <= Date.now()) {
    throw new AppError("PUBLISH_AT_PASSED", "That time has already passed", 422, { publish_at: ["Time already passed"] });
  }
  const id = await tx(async (client) => {
    const made = await repo.insert(client, {
      title: body.title,
      body: body.body,
      audience: body.audience,
      status: when ? "scheduled" : "draft",
      published_by: user.user_id,
      publish_at: when ? when.toISOString() : null,
    });
    await emit(client, {
      key: EVENTS.ANNOUNCEMENT_CREATED,
      entity: { type: "announcement", id: made.announcement_id },
      actor: user,
      after: made,
      payload: { announcement_id: made.announcement_id, publish_at: made.publish_at ? iso(made.publish_at) : null },
    });
    if (!when) await publish(client, made.announcement_id);
    return made.announcement_id;
  });
  return get(id);
}

/** The delayed job and the scheduler's safety net call this. */
async function release(id) {
  return tx((client) => publish(client, id));
}

async function releaseDue() {
  const ids = await repo.due(pool);
  for (const id of ids) await release(id);
  return { released: ids.length };
}

async function readers(id, query) {
  await get(id);
  return repo.readers(pool, id, query);
}

/** Remind those who have not read it, once a day per announcement (§5). */
async function remind(id, user) {
  return tx(async (client) => {
    const a = await repo.lockForUpdate(client, id);
    if (!a) throw new AppError("NOT_FOUND", "There is no such announcement", 404);
    if (a.status !== "published") throw new AppError("NOT_PUBLISHED", "It has not gone out yet", 422);
    if (a.last_reminded_at && lagos.dateOf(a.last_reminded_at) === lagos.today()) {
      throw new AppError("ALREADY_REMINDED", "Already reminded today", 429);
    }
    const users = await repo.unreadUsers(client, id);
    await repo.setReminded(client, id);
    await emit(client, {
      key: EVENTS.ANNOUNCEMENT_REMINDED,
      entity: { type: "announcement", id },
      actor: user,
      payload: { announcement_id: id, title: a.title, user_ids: users },
    });
    return { reminded: users.length };
  });
}

/** The caller read these messages in #announcements. */
function markReadByMessages(userId, messageIds) {
  return repo.markReadByMessages(pool, userId, messageIds);
}

module.exports = { view, list, get, create, publish, release, releaseDue, readers, remind, markReadByMessages };
