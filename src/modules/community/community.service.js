"use strict";
/**
 * Staff Community's rules (docs/guides/community.md §3, §6).
 *
 * - Membership is the boundary: a channel the caller is not in is a 404, whatever their
 *   grants, and nobody reads a direct conversation they are not part of.
 * - Who may post is the channel's post_policy, fixed at creation: everyone, its admins,
 *   or holders of the announcements.post capability (#announcements).
 * - A recognition always posts to #general (MILESTONES A19), wherever it was started.
 * - Files sent together share an album key; a caption rides on the first. A text's first
 *   link gets its card from community.links.js, at once when one is kept, else after commit.
 * - #general and #announcements are made the first time they are needed, and every
 *   active login is a member of both: from the moment the login is made, from an hourly
 *   sweep for any that slipped through, and again when they open Community.
 *
 * Every write runs in one transaction with emit(); realtime pushes and notifications are
 * outbox handlers in community.events.js.
 */
const crypto = require("node:crypto");
const { FORWARDABLE: FORWARDABLE_TYPES } = require("@mycity/contract").community;
const { pool } = require("../../config/db");
const { atomically } = require("../../shared/db/tx");
const { emit } = require("../../shared/events/emit");
const { AppError } = require("../../shared/errors");
const grantsCache = require("../../shared/rbac/grants-cache");
const vault = require("../../shared/documents/vault");
const storage = require("../../services/storage/storage.service");
const lagos = require("../../shared/time/lagos");
const transcription = require("../../services/ai/transcription");

const STUB_TRANSCRIPT = transcription.STUB_TEXT;
const repo = require("./community.repo");
const { EVENTS } = require("./community.events");
const { noteFor } = require("./community.recognition");
const links = require("./community.links");
const { wishFor } = require("./community.celebrations");

/** Mailbox's own service, asked for a mail attachment's file (loaded on use, so the two modules load apart). */
const mailbox = () => require("../mailbox/mailbox.service");

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

const notFound = () =>
  new AppError("NOT_FOUND", "There is no such conversation", 404);

/** Whether the caller holds announcements.post (People and the CEO). */
async function canAnnounce(db, user) {
  if (user.is_ceo === true) return true;
  const held = await grantsCache.getCapabilities(db, user.user_id);
  return held.includes("announcements.post");
}

function mayPost(channel) {
  // #announcements takes nothing posted straight in: announcements come from the tab (§6).
  if (channel.post_policy === "people_ceo") return false;
  if (channel.post_policy === "admins") return channel.member_role === "admin";
  return true;
}

/** The kinds of message that carry a file, and so may share an album key and a caption. */
const FILE_TYPES = new Set(["image", "video", "file"]);

/** One line for a list row, from a message's kind and body. */
function lineOf(type, body) {
  const caption = body ? String(body).replace(/\s+/g, " ").trim().slice(0, 120) : null;
  switch (type) {
    case "audio":
      return "Voice note";
    case "image":
      return caption ? `Photo: ${caption}` : "Photo";
    case "video":
      return caption ? `Video: ${caption}` : "Video";
    case "file":
      return caption ? `File: ${caption}` : "File";
    case "poll":
      return body ? `Poll: ${body}` : "Poll";
    case "recognition":
      return "Recognition";
    case "birthday":
      return "Birthday";
    case "anniversary":
      return "Work anniversary";
    default:
      return body ? String(body).replace(/\s+/g, " ").slice(0, 140) : null;
  }
}

/** Muted until a time still ahead; pg reads 'infinity' (muted for good) as Infinity, which new Date() cannot hold. */
const muted = (until) =>
  until === Infinity ||
  Boolean(until && new Date(until).getTime() > Date.now());
const iso = (v) => (v ? new Date(v).toISOString() : null);

/** Who moderates a channel: its admins; People and the CEO in #general and #announcements; nobody in a direct conversation. */
function isModerator(row, announcer) {
  if (row.channel_type === "direct") return false;
  if (row.system_key) return announcer;
  return row.member_role === "admin";
}

/** A poll follows Who Can Post, except in #general, where moderators alone start one (§3 step 15). */
function mayPoll(row, announcer) {
  if (!mayPost(row)) return false;
  return row.system_key === "general" ? announcer : true;
}

/** How long the author may still edit a text message. */
const EDIT_WINDOW_MS = 15 * 60 * 1000;

function channelView(row, announcer) {
  return {
    community_channel_id: row.community_channel_id,
    name: row.name,
    description: row.description ?? null,
    channel_type: row.channel_type,
    post_policy: row.post_policy,
    pinned: Boolean(row.pinned_for_me),
    pin_locked: Boolean(row.pinned),
    members: row.members,
    can_post: mayPost(row),
    is_admin: row.member_role === "admin",
    can_moderate: isModerator(row, announcer),
    can_poll: mayPoll(row, announcer),
    muted: muted(row.muted_until),
    unread: row.unread,
    last_text: lineOf(row.last_type, row.last_body),
    last_at: iso(row.last_at),
  };
}

function conversationView(row) {
  return {
    community_channel_id: row.community_channel_id,
    person: row.person,
    user_id: row.user_id,
    is_self: Boolean(row.is_self),
    pinned: Boolean(row.pinned),
    online: row.online,
    last_seen_at: iso(row.last_seen_at),
    muted: row.muted,
    unread: row.unread,
    last_text: lineOf(row.last_type, row.last_body),
    last_mine: Boolean(row.last_mine),
    last_at: iso(row.last_at),
  };
}

/** Make sure #general and #announcements exist and the caller is in both. */
async function joinCompany(db, user) {
  const general = await repo.systemChannel(db, "general");
  const announcements = await repo.systemChannel(db, "announcements");
  await repo.addMembers(db, general.community_channel_id, [user.user_id]);
  await repo.addMembers(db, announcements.community_channel_id, [user.user_id]);
  return { general, announcements };
}

/** A new or reactivated login joins #general and #announcements at once (app_user.created). */
async function joinLogin(userId) {
  if (!userId) return;
  await tx((client) => joinCompany(client, { user_id: userId }));
}

/** Every active login in #general and #announcements; the hourly sweep. Returns how many joined. */
async function joinEveryone() {
  return tx(async (client) => {
    const general = await repo.systemChannel(client, "general");
    const announcements = await repo.systemChannel(client, "announcements");
    const joined = (await repo.addEveryone(client, general.community_channel_id)) + (await repo.addEveryone(client, announcements.community_channel_id));
    return { joined };
  });
}

/** The caller's membership of a channel, or a 404. */
async function member(db, channelId, user) {
  const m = await repo.membership(db, channelId, user.user_id);
  if (!m) throw notFound();
  return m;
}

/* ------------------------------------------------------------------ *
 * Channels
 * ------------------------------------------------------------------ */

async function listChannels(user, query) {
  await tx((client) => joinCompany(client, user));
  const announcer = await canAnnounce(pool, user);
  const page = await repo.listChannels(pool, user.user_id, query);
  return { ...page, data: page.data.map((r) => channelView(r, announcer)) };
}

async function getChannel(channelId, user) {
  const row = await repo.channelFor(pool, channelId, user.user_id);
  if (!row || row.channel_type === "direct") throw notFound();
  return channelView(row, await canAnnounce(pool, user));
}

async function createChannel(body, user) {
  const channel = await tx(async (client) => {
    if (await repo.nameTaken(client, body.name)) {
      throw new AppError("NAME_TAKEN", "A channel already has that name", 409, {
        name: ["Name already taken"],
      });
    }
    const made = await repo.insertChannel(client, {
      name: body.name,
      description: body.description,
      post_policy: body.post_policy,
      channel_type:
        body.department_ids.length && !body.member_ids.length
          ? "department"
          : "group",
      created_by: user.user_id,
    });
    await repo.addMembers(
      client,
      made.community_channel_id,
      [user.user_id],
      "admin",
    );
    const others = await repo.usersFor(client, {
      employeeIds: body.member_ids,
      departmentIds: body.department_ids,
    });
    await repo.addMembers(
      client,
      made.community_channel_id,
      others.filter((u) => u !== user.user_id),
    );
    await emit(client, {
      key: EVENTS.CHANNEL_CREATED,
      entity: { type: "channel", id: made.community_channel_id },
      actor: user,
      after: made,
      payload: { community_channel_id: made.community_channel_id },
    });
    return made;
  });
  return getChannel(channel.community_channel_id, user);
}

/** A channel's admins rename it and write its description; #general and #announcements stay as they are. */
async function updateChannel(channelId, body, user) {
  await tx(async (client) => {
    await assertAdmin(client, channelId, user);
    const before = await repo.channelRowForUpdate(client, channelId);
    if (await repo.nameTaken(client, body.name, channelId)) {
      throw new AppError("NAME_TAKEN", "A channel already has that name", 409, {
        name: ["Name already taken"],
      });
    }
    const after = await repo.updateChannel(client, channelId, body);
    await emit(client, {
      key: EVENTS.CHANNEL_UPDATED,
      entity: { type: "channel", id: channelId },
      actor: user,
      before,
      after,
      payload: { community_channel_id: channelId },
    });
  });
  return getChannel(channelId, user);
}

async function listMembers(channelId, user, query) {
  await member(pool, channelId, user);
  return repo.listMembers(pool, channelId, query);
}

async function assertAdmin(db, channelId, user) {
  const m = await member(db, channelId, user);
  if (m.system_key)
    throw new AppError(
      "SYSTEM_CHANNEL",
      "Everyone is a member of this channel",
      422,
    );
  if (m.member_role !== "admin")
    throw new AppError(
      "NOT_CHANNEL_ADMIN",
      "Only the channel's admins can do this",
      403,
    );
  return m;
}

async function addMembers(channelId, body, user) {
  await tx(async (client) => {
    await assertAdmin(client, channelId, user);
    const users = await repo.usersFor(client, {
      employeeIds: body.member_ids,
      departmentIds: body.department_ids,
    });
    const added = await repo.addMembers(client, channelId, users);
    await emit(client, {
      key: EVENTS.CHANNEL_MEMBERS_CHANGED,
      entity: { type: "channel", id: channelId },
      actor: user,
      payload: { community_channel_id: channelId, added: users, count: added },
    });
  });
  return getChannel(channelId, user);
}

async function removeMember(channelId, userId, user) {
  await tx(async (client) => {
    await assertAdmin(client, channelId, user);
    if (userId === user.user_id)
      throw new AppError(
        "LEAVE_NOT_REMOVE",
        "An admin cannot remove themselves",
        422,
      );
    await repo.removeMember(client, channelId, userId);
    await emit(client, {
      key: EVENTS.CHANNEL_MEMBERS_CHANGED,
      entity: { type: "channel", id: channelId },
      actor: user,
      payload: { community_channel_id: channelId, removed: [userId] },
    });
  });
}

/** Make a member an admin, or an admin a member. A channel always keeps one admin. */
async function setRole(channelId, userId, role, user) {
  await tx(async (client) => {
    await assertAdmin(client, channelId, user);
    const target = await repo.memberRow(client, channelId, userId);
    if (!target) throw notFound();
    if (target.member_role === role) return;
    const admins = await repo.adminsLocked(client, channelId);
    if (role === "member" && admins.length === 1 && admins[0] === userId) {
      throw new AppError(
        "LAST_ADMIN",
        "A channel needs at least one admin",
        422,
      );
    }
    await repo.setRole(client, channelId, userId, role);
    await emit(client, {
      key: EVENTS.CHANNEL_MEMBERS_CHANGED,
      entity: { type: "channel", id: channelId },
      actor: user,
      payload: {
        community_channel_id: channelId,
        member_role: role,
        user_id: userId,
      },
    });
  });
  const row = await repo.memberRow(pool, channelId, userId);
  return {
    person: row.person,
    user_id: row.user_id,
    member_role: row.member_role,
    joined_at: new Date(row.joined_at).toISOString(),
  };
}

async function setMuted(channelId, muteOn, user) {
  await member(pool, channelId, user);
  await repo.setMuted(pool, channelId, user.user_id, muteOn);
}

/** The most conversations one person pins for themselves (§3 step 16). */
const PIN_LIMIT = 3;

/** The caller's own pin on a channel or a direct conversation. */
async function setPinned(channelId, on, user) {
  await tx(async (client) => {
    const m = await member(client, channelId, user);
    if (m.system_key)
      throw new AppError(
        "ALWAYS_PINNED",
        "This channel is pinned for everyone",
        422,
      );
    if (on && !(await repo.membershipPinned(client, channelId, user.user_id))) {
      if ((await repo.pinsLocked(client, user.user_id)) >= PIN_LIMIT) {
        throw new AppError("PIN_LIMIT", "Unpin one first", 409);
      }
    }
    await repo.setPinned(client, channelId, user.user_id, on);
  });
}

/*
 * A mark is always stored, but tells anyone only when it covered a message it had not covered
 * before (community.md §3 step 10): a receipt the other screen answers with a mark that changes
 * nothing must not send another receipt back.
 */
async function markRead(channelId, user) {
  const m = await member(pool, channelId, user);
  const covered = await repo.markRead(pool, channelId, user.user_id);
  if (m.channel_type === "direct" && covered) {
    await tx((client) =>
      emit(client, {
        key: EVENTS.DIRECT_THREAD_READ,
        entity: { type: "direct_thread", id: channelId },
        actor: user,
        payload: { community_channel_id: channelId, user_id: user.user_id },
      }),
    );
  }
}

async function markDelivered(channelId, upTo, user) {
  const m = await member(pool, channelId, user);
  if (m.channel_type !== "direct") return;
  if (!(await repo.markDelivered(pool, channelId, user.user_id, upTo))) return;
  await tx((client) =>
    emit(client, {
      key: EVENTS.DIRECT_THREAD_DELIVERED,
      entity: { type: "direct_thread", id: channelId },
      actor: user,
      payload: { community_channel_id: channelId, user_id: user.user_id },
    }),
  );
}

/* ------------------------------------------------------------------ *
 * Messages
 * ------------------------------------------------------------------ */

function statusOf(row, other) {
  if (!other) return "sent";
  const at = new Date(row.sent_at).getTime();
  if (other.last_read_at && new Date(other.last_read_at).getTime() >= at)
    return "read";
  if (
    other.last_delivered_at &&
    new Date(other.last_delivered_at).getTime() >= at
  )
    return "delivered";
  return "sent";
}

/** Rows from the repo, completed with people, fans and votes, in the contract's shape. */
async function present(
  db,
  rows,
  user,
  { direct = false, other = null, moderator = false } = {},
) {
  const meta = (r) => r.metadata || {};
  const subjects = rows
    .filter((r) => ["birthday", "anniversary"].includes(r.message_type))
    .map((r) => meta(r).subject_employee_id)
    .concat(rows.map((r) => r.recognised_employee_id))
    .filter(Boolean);
  const celebrationIds = rows
    .filter((r) => ["birthday", "anniversary"].includes(r.message_type))
    .map((r) => r.community_message_id);
  const pollIds = rows
    .filter((r) => r.message_type === "poll")
    .map((r) => r.community_message_id);
  const [persons, fanMap, voteMap] = await Promise.all([
    repo.people(db, [...new Set(subjects)]),
    repo.fans(db, celebrationIds),
    repo.votes(db, pollIds, user.user_id),
  ]);
  return rows.map((r) => {
    const mine = r.sender_user_id === user.user_id;
    const deleted = Boolean(r.deleted_at);
    const m = meta(r);
    const celebration =
      ["birthday", "anniversary"].includes(r.message_type) &&
      persons.get(m.subject_employee_id)
        ? {
            subject: persons.get(m.subject_employee_id),
            years: m.years ?? null,
            count: r.reactions,
            mine: r.reacted,
            fans: fanMap.get(r.community_message_id) || [],
          }
        : null;
    const recognition =
      r.message_type === "recognition" && persons.get(r.recognised_employee_id)
        ? {
            to: persons.get(r.recognised_employee_id),
            count: r.reactions,
            mine: r.reacted,
          }
        : null;
    const votesOf = voteMap.get(r.community_message_id)?.counts || {};
    const voted = Object.values(votesOf).reduce((n, v) => n + v, 0) > 0;
    const closed = Boolean(m.closed);
    const fresh = Date.now() - new Date(r.sent_at).getTime() < EDIT_WINDOW_MS;
    const poll =
      r.message_type === "poll"
        ? {
            question: r.body || "",
            options: (m.options || []).map((text, i) => ({
              text,
              votes:
                (voteMap.get(r.community_message_id)?.counts || {})[i] || 0,
            })),
            my_vote: voteMap.get(r.community_message_id)?.mine ?? null,
            closed,
          }
        : null;
    return {
      community_message_id: r.community_message_id,
      community_channel_id: r.community_channel_id,
      message_type: r.message_type,
      author: r.author,
      mine,
      sent_at: iso(r.sent_at),
      body: deleted ? null : r.body,
      document: deleted ? null : r.document,
      album_key: m.album_key ?? null,
      link: deleted ? null : (r.link ?? null),
      forwarded: m.forwarded === true,
      duration_s: r.message_type === "audio" ? (m.duration_s ?? null) : null,
      // The stub's placeholder, stored before transcripts became drafts, reads as none.
      transcript: deleted || r.transcript === STUB_TRANSCRIPT ? null : (r.transcript ?? null),
      celebration,
      recognition,
      poll,
      announcement: r.announcement_id
        ? {
            announcement_id: r.announcement_id,
            title: r.announcement_title,
            urgency: r.announcement_urgency || "normal",
            in_audience: Boolean(r.announcement_in_audience),
            acknowledged_at: r.announcement_acknowledged_at
              ? new Date(r.announcement_acknowledged_at).toISOString()
              : null,
          }
        : null,
      status: direct && mine && other ? statusOf(r, other) : null,
      deleted,
      edited_at: iso(r.edited_at),
      can_edit:
        !deleted &&
        mine &&
        ((r.message_type === "text" && fresh) ||
          (r.message_type === "poll" && !closed && !voted)),
      can_delete:
        !deleted && r.message_type !== "announcement" && (mine || moderator),
      can_close:
        !deleted && r.message_type === "poll" && !closed && (mine || moderator),
      pinned_until: deleted ? null : iso(r.pinned_until),
      can_pin: !deleted && (direct || moderator),
    };
  });
}

async function listMessages(channelId, user, query) {
  const m = await member(pool, channelId, user);
  const page = await repo.listMessages(pool, channelId, user.user_id, query);
  const direct = m.channel_type === "direct";
  const other = direct
    ? await repo.otherPointers(pool, channelId, user.user_id)
    : null;
  const moderator = isModerator(m, await canAnnounce(pool, user));
  const data = await present(pool, page.data, user, {
    direct,
    other,
    moderator,
  });
  if (m.system_key === "announcements") {
    const seen = data
      .filter((x) => x.message_type === "announcement")
      .map((x) => x.community_message_id);
    await require("../announcements/announcements.service").markReadByMessages(
      user.user_id,
      seen,
    );
  }
  // Newest page first, each page read top to bottom.
  return { ...page, data: data.reverse() };
}

async function messageView(db, messageId, user) {
  const row = await repo.messageFor(db, messageId, user.user_id);
  if (!row) throw notFound();
  const ch = await repo.membership(db, row.community_channel_id, user.user_id);
  if (!ch) throw notFound();
  const direct = ch.channel_type === "direct";
  const other = direct
    ? await repo.otherPointers(db, row.community_channel_id, user.user_id)
    : null;
  const moderator = isModerator(ch, await canAnnounce(db, user));
  return (await present(db, [row], user, { direct, other, moderator }))[0];
}

/** The kind of message a stored file makes, from its type. */
function kindOfFile(mime) {
  if (/^image\//.test(mime)) return "image";
  if (/^audio\//.test(mime)) return "audio";
  if (/^video\//.test(mime)) return "video";
  return "file";
}

/** A file uploaded for a channel, held in the vault against it; only its members read it. Answers its MediaRef. */
async function storeMedia(channelId, upload, user) {
  return tx(async (client) => {
    const m = await member(client, channelId, user);
    if (!mayPost(m)) {
      throw new AppError("CANNOT_POST", "You cannot post in this channel", 403);
    }
    const doc = await vault.store(client, {
      file: upload,
      purpose: "attachment",
      doc_type: "community_media",
      entity: { type: "community_channel", id: channelId },
      actor: user,
    });
    // With its shape and the sizes made at upload, so Send Files draws it at once.
    return repo.mediaRef(client, doc.document_id);
  });
}

async function postMessage(channelId, body, user) {
  const posted = await tx(async (client) => {
    const m = await member(client, channelId, user);
    const announcer = await canAnnounce(client, user);
    if (!mayPost(m))
      throw new AppError("CANNOT_POST", "You cannot post in this channel", 403);
    if (body.message_type === "poll" && !mayPoll(m, announcer)) {
      throw new AppError(
        "CANNOT_POLL",
        "Only moderators start a poll here",
        403,
      );
    }
    if (
      (body.message_type === "birthday" ||
        body.message_type === "anniversary") &&
      !isModerator(m, announcer)
    ) {
      throw new AppError(
        "CANNOT_CELEBRATE",
        "Only moderators post a celebration here",
        403,
      );
    }

    let type = body.message_type;
    const metadata = {};
    if (body.document_id) {
      const doc = await vault.get(client, body.document_id);
      if (
        !doc ||
        doc.entity_type !== "community_channel" ||
        doc.entity_id !== channelId ||
        doc.uploaded_by !== user.user_id
      ) {
        throw new AppError(
          "NOT_YOUR_FILE",
          "Attach a file to this conversation first",
          422,
          { document_id: ["Attach the file again"] },
        );
      }
      if (type !== "audio") type = kindOfFile(doc.mime);
      if (type === "audio") metadata.duration_s = body.duration_s ?? 1;
      if (type === "audio" && body.captions) metadata.captions = body.captions;
      if (body.album_key && FILE_TYPES.has(type)) metadata.album_key = body.album_key;
    }
    if (type === "text" && body.no_link_preview) metadata.no_link_preview = true;
    const card =
      type === "text"
        ? await links.linkFor(client, body.body, metadata)
        : { community_link_preview_id: null, fetch: null };
    if (type === "poll") metadata.options = body.options;
    if (type === "birthday" || type === "anniversary") {
      const persons = await repo.people(client, [body.subject_employee_id]);
      if (!persons.has(body.subject_employee_id))
        throw new AppError("NOT_FOUND", "There is no such colleague", 404);
      metadata.subject_employee_id = body.subject_employee_id;
      // A hand-posted anniversary carries its years, as the 08:00 ones do.
      if (type === "anniversary")
        metadata.years = await repo.yearsServed(
          client,
          body.subject_employee_id,
          lagos.today(),
        );
    }
    const message = await repo.insertMessage(client, {
      community_channel_id: channelId,
      sender_user_id: user.user_id,
      message_type: type,
      body:
        type === "birthday" || type === "anniversary"
          ? wishFor(body.subject_employee_id, type)
          : body.body,
      document_id: body.document_id,
      metadata,
      community_link_preview_id: card.community_link_preview_id,
    });
    // Sending is reading: the sender's own pointer moves past what they sent.
    await repo.markRead(client, channelId, user.user_id);
    await emit(client, {
      key:
        m.channel_type === "direct"
          ? EVENTS.DIRECT_MESSAGE_SENT
          : EVENTS.CHANNEL_MESSAGE_POSTED,
      entity: {
        type:
          m.channel_type === "direct" ? "direct_message" : "channel_message",
        id: message.community_message_id,
      },
      actor: user,
      payload: {
        community_channel_id: channelId,
        community_message_id: message.community_message_id,
        message_type: type,
        sender_name: user.display_name || null,
        channel_name: m.channel_type === "direct" ? null : m.name || null,
        preview: lineOf(type, message.body),
        ...(card.fetch ? { link_url: card.fetch } : {}),
      },
    });
    return message;
  });
  return messageView(pool, posted.community_message_id, user);
}

/** The composer's card for one link (§3 step 18): kept, else fetched now; null when there is none. */
async function linkPreview(body, user) {
  return { preview: await links.cardFor(body.url, user) };
}

/** A thumbs up for a colleague, posted to #general whatever channel it came from (A19). */
async function recognise(body, user) {
  const posted = await tx(async (client) => {
    if (!user.employee_id)
      throw new AppError(
        "NO_EMPLOYEE",
        "Your login has no employee record",
        422,
      );
    if (body.to_employee_id === user.employee_id) {
      throw new AppError(
        "SELF_RECOGNITION",
        "Recognise a colleague, not yourself",
        422,
        { to_employee_id: ["Choose a colleague"] },
      );
    }
    const persons = await repo.people(client, [body.to_employee_id]);
    if (!persons.has(body.to_employee_id))
      throw new AppError("NOT_FOUND", "There is no such colleague", 404);
    const { general } = await joinCompany(client, user);
    const note = body.message || noteFor(body.to_employee_id);
    const message = await repo.insertMessage(client, {
      community_channel_id: general.community_channel_id,
      sender_user_id: user.user_id,
      message_type: "recognition",
      body: note,
    });
    const recognition = await repo.insertRecognition(client, {
      from_employee_id: user.employee_id,
      to_employee_id: body.to_employee_id,
      message: note,
      community_message_id: message.community_message_id,
      note_written_by_system: !body.message,
    });
    await emit(client, {
      key: EVENTS.RECOGNITION_POSTED,
      entity: { type: "recognition", id: message.community_message_id },
      actor: user,
      after: recognition,
      payload: {
        community_channel_id: general.community_channel_id,
        community_message_id: message.community_message_id,
        peer_recognition_id: recognition.peer_recognition_id,
        to_employee_id: body.to_employee_id,
        subject_employee_id: body.to_employee_id,
        from_name: user.display_name || null,
      },
    });
    return message;
  });
  return messageView(pool, posted.community_message_id, user);
}

/** Celebrate a card, or thumbs-up a recognition: one reaction per person, toggled. */
async function react(messageId, user) {
  await tx(async (client) => {
    const row = await repo.messageFor(client, messageId, user.user_id);
    if (
      !row ||
      !(await repo.membership(client, row.community_channel_id, user.user_id))
    )
      throw notFound();
    const reaction =
      row.message_type === "birthday"
        ? "🎉"
        : row.message_type === "anniversary"
          ? "👏"
          : "👍";
    const on = await repo.toggleReaction(
      client,
      messageId,
      user.user_id,
      reaction,
    );
    await emit(client, {
      key: EVENTS.CHANNEL_MESSAGE_REACTED,
      entity: { type: "channel_message", id: messageId },
      actor: user,
      payload: {
        community_channel_id: row.community_channel_id,
        community_message_id: messageId,
        on,
      },
    });
  });
  return messageView(pool, messageId, user);
}

async function vote(messageId, optionIndex, user) {
  await tx(async (client) => {
    const row = await repo.messageFor(client, messageId, user.user_id);
    if (
      !row ||
      !(await repo.membership(client, row.community_channel_id, user.user_id))
    )
      throw notFound();
    if (row.message_type !== "poll")
      throw new AppError("NOT_A_POLL", "This message is not a poll", 422);
    if (row.deleted_at) throw notFound();
    if (row.metadata && row.metadata.closed)
      throw new AppError("POLL_CLOSED", "This poll is closed", 409);
    const options = (row.metadata && row.metadata.options) || [];
    if (optionIndex >= options.length) {
      throw new AppError(
        "NO_SUCH_OPTION",
        "That option is not on the poll",
        422,
        { option_index: ["Not an option"] },
      );
    }
    await repo.vote(client, messageId, user.user_id, optionIndex);
    await emit(client, {
      key: EVENTS.CHANNEL_MESSAGE_REACTED,
      entity: { type: "channel_message", id: messageId },
      actor: user,
      payload: {
        community_channel_id: row.community_channel_id,
        community_message_id: messageId,
        vote: optionIndex,
      },
    });
  });
  return messageView(pool, messageId, user);
}

/** A message the caller may act on, locked, with their membership and whether they moderate it. */
async function lockedForChange(client, messageId, user) {
  const row = await repo.lockMessage(client, messageId);
  if (!row || row.deleted_at) throw notFound();
  const ch = await repo.membership(
    client,
    row.community_channel_id,
    user.user_id,
  );
  if (!ch) throw notFound();
  const moderator = isModerator(ch, await canAnnounce(client, user));
  return { row, ch, mine: row.sender_user_id === user.user_id, moderator };
}

async function changed(client, key, row, user, extra = {}) {
  await emit(client, {
    key,
    entity: { type: "channel_message", id: row.community_message_id },
    actor: user,
    payload: {
      community_channel_id: row.community_channel_id,
      community_message_id: row.community_message_id,
      ...extra,
    },
  });
}

/** The author's text within 15 minutes, or their poll before its first vote (§3 step 14). */
async function editMessage(messageId, body, user) {
  await tx(async (client) => {
    const { row, mine } = await lockedForChange(client, messageId, user);
    if (!mine)
      throw new AppError("NOT_YOURS", "Only its author edits a message", 403);
    const metadata = { ...(row.metadata || {}) };
    if (row.message_type === "text") {
      if (Date.now() - new Date(row.sent_at).getTime() >= EDIT_WINDOW_MS) {
        throw new AppError(
          "EDIT_WINDOW_PASSED",
          "Too late to edit this message",
          409,
          { body: ["Too late to edit"] },
        );
      }
    } else if (row.message_type === "poll") {
      if (metadata.closed)
        throw new AppError("POLL_CLOSED", "This poll is closed", 409);
      if ((await repo.voteCount(client, messageId)) > 0) {
        throw new AppError(
          "POLL_HAS_VOTES",
          "People have voted on this poll",
          409,
          { body: ["Already has votes"] },
        );
      }
      if (body.options) metadata.options = body.options;
    } else {
      throw new AppError(
        "NOT_EDITABLE",
        "This kind of message is not edited",
        422,
      );
    }
    // An edited text follows its new first link; a poll carries no card.
    const card =
      row.message_type === "text"
        ? await links.linkFor(client, body.body, metadata)
        : { community_link_preview_id: null, fetch: null };
    const after = await repo.editMessage(client, messageId, {
      body: body.body,
      metadata,
      community_link_preview_id: card.community_link_preview_id,
    });
    await changed(
      client,
      EVENTS.CHANNEL_MESSAGE_EDITED,
      after,
      user,
      card.fetch ? { link_url: card.fetch } : {},
    );
  });
  return messageView(pool, messageId, user);
}

/** By its author, or a moderator; an announcement's post is managed from Announcements. */
async function deleteMessage(messageId, user) {
  await tx(async (client) => {
    const { row, mine, moderator } = await lockedForChange(
      client,
      messageId,
      user,
    );
    if (row.message_type === "announcement") {
      throw new AppError(
        "ANNOUNCEMENT_POST",
        "Announcements are managed from the Announcements tab",
        422,
      );
    }
    if (!mine && !moderator)
      throw new AppError(
        "NOT_YOURS",
        "Only its author or a moderator deletes a message",
        403,
      );
    const after = await repo.deleteMessage(client, messageId);
    if (row.message_type === "recognition")
      await repo.deleteRecognitionOf(client, messageId);
    await changed(client, EVENTS.CHANNEL_MESSAGE_DELETED, after, user, {
      message_type: row.message_type,
    });
  });
}

/** Stop a poll taking votes; its result stays. */
async function closePoll(messageId, user) {
  await tx(async (client) => {
    const { row, mine, moderator } = await lockedForChange(
      client,
      messageId,
      user,
    );
    if (row.message_type !== "poll")
      throw new AppError("NOT_A_POLL", "This message is not a poll", 422);
    if (!mine && !moderator)
      throw new AppError(
        "NOT_YOURS",
        "Only its author or a moderator closes a poll",
        403,
      );
    if (row.metadata && row.metadata.closed) return;
    const after = await repo.setMetadata(client, messageId, {
      ...(row.metadata || {}),
      closed: true,
    });
    await changed(client, EVENTS.CHANNEL_MESSAGE_EDITED, after, user, {
      closed: true,
    });
  });
  return messageView(pool, messageId, user);
}

/** How long each pin period lasts. */
const PIN_MS = { "24h": 24 * 3600 * 1000, "7d": 7 * 24 * 3600 * 1000, "30d": 30 * 24 * 3600 * 1000 };

/** At most this many messages are pinned at once in a conversation. */
const MAX_PINS = 3;

/** A moderator in a channel, either person in a direct conversation (§3 step 16). */
function assertMayPin({ ch, moderator }) {
  if (ch.channel_type !== "direct" && !moderator)
    throw new AppError("NOT_MODERATOR", "Only the channel's moderators pin messages", 403);
}

/**
 * Pin a message at the top of its conversation for a period; pinning it again starts the
 * period again. A fourth pin takes the place of the oldest, as each person's own pins do.
 */
async function pinMessage(messageId, body, user) {
  await tx(async (client) => {
    const found = await lockedForChange(client, messageId, user);
    assertMayPin(found);
    const until = new Date(Date.now() + PIN_MS[body.period]).toISOString();
    const after = await repo.setPin(client, messageId, until, user.user_id);
    for (const old of await repo.pinsBeyond(client, found.row.community_channel_id, MAX_PINS)) {
      const off = await repo.setPin(client, old, null, null);
      await changed(client, EVENTS.CHANNEL_MESSAGE_PINNED, off, user, { pinned_until: null });
    }
    await changed(client, EVENTS.CHANNEL_MESSAGE_PINNED, after, user, { pinned_until: until, period: body.period });
  });
  return messageView(pool, messageId, user);
}

async function unpinMessage(messageId, user) {
  await tx(async (client) => {
    const found = await lockedForChange(client, messageId, user);
    assertMayPin(found);
    if (!found.row.pinned_until) return;
    const after = await repo.setPin(client, messageId, null, null);
    await changed(client, EVENTS.CHANNEL_MESSAGE_PINNED, after, user, { pinned_until: null });
  });
  return messageView(pool, messageId, user);
}

/** What is pinned in a conversation now, for the bar above its messages. */
async function listPins(channelId, user, query) {
  const m = await member(pool, channelId, user);
  const page = await repo.listPins(pool, channelId, user.user_id, query);
  const direct = m.channel_type === "direct";
  const other = direct ? await repo.otherPointers(pool, channelId, user.user_id) : null;
  const moderator = isModerator(m, await canAnnounce(pool, user));
  return { ...page, data: await present(pool, page.data, user, { direct, other, moderator }) };
}

/**
 * A voice note's transcript, asked for once and stored for everyone after (§3 step 11). Groq,
 * then Gemini (services/ai/transcription.js); when neither answers, the captions the sender's
 * browser wrote while recording, as a draft that is never stored, so the next request asks them
 * again. The stub's placeholder, stored before that rule, is treated as no transcript.
 */
async function transcript(messageId, user) {
  const row = await repo.messageFor(pool, messageId, user.user_id);
  if (
    !row ||
    !(await repo.membership(pool, row.community_channel_id, user.user_id))
  )
    throw notFound();
  if (row.message_type !== "audio" || !row.document_id) {
    throw new AppError(
      "NOT_A_VOICE_NOTE",
      "Only a voice note has a transcript",
      422,
    );
  }
  if (row.transcript && row.transcript !== STUB_TRANSCRIPT) return { transcript: row.transcript, draft: false };
  const t = await transcription.transcribe({
    document_id: row.document_id,
    module: "community",
    actor: user,
    captions: (row.metadata && row.metadata.captions) || null,
  });
  if (t.draft) return { transcript: t.text, draft: true };
  await repo.setTranscript(pool, messageId, t.text);
  return { transcript: t.text, draft: false };
}

/* ------------------------------------------------------------------ *
 * Direct messages
 * ------------------------------------------------------------------ */

async function listConversations(user, query) {
  const page = await repo.listConversations(pool, user.user_id, query);
  return { ...page, data: page.data.map(conversationView) };
}

/** Open the conversation with a colleague, making it the first time (one per pair). */
/** The caller's conversation with a colleague, started if there is none; inside the caller's transaction. */
async function directWith(client, employeeId, user) {
  const other = await repo.userOfEmployee(client, employeeId);
  if (!other)
    throw new AppError("NO_LOGIN", "That colleague has no login yet", 422, {
      employee_id: ["No login yet"],
    });
  // A conversation with oneself is allowed: notes, drafts, files to keep (one member).
  await repo.lockPair(client, user.user_id, other);
  const found = await repo.findDirect(client, user.user_id, other);
  if (found) return found.community_channel_id;
  const made = await repo.insertChannel(client, {
    name: null,
    description: null,
    post_policy: "everyone",
    channel_type: "direct",
    created_by: user.user_id,
  });
  await repo.addMembers(client, made.community_channel_id, [
    ...new Set([user.user_id, other]),
  ]);
  await emit(client, {
    key: EVENTS.DIRECT_THREAD_OPENED,
    entity: { type: "direct_thread", id: made.community_channel_id },
    actor: user,
    payload: { community_channel_id: made.community_channel_id },
  });
  return made.community_channel_id;
}

async function openDirect(employeeId, user) {
  const channelId = await tx((client) => directWith(client, employeeId, user));
  const row = await repo.conversationFor(pool, channelId, user.user_id);
  return conversationView(row);
}

/* ------------------------------------------------------------------ *
 * Forwarding (§3 step 19)
 * ------------------------------------------------------------------ */

const FORWARDABLE = new Set(FORWARDABLE_TYPES);

async function listForwardTargets(user, query) {
  return repo.forwardTargets(pool, user.user_id, query);
}

/** The messages to forward, each in a conversation the caller is in, each of a kind that travels. */
async function forwardSources(client, messageIds, user) {
  const ids = [...new Set(messageIds)];
  const rows = await repo.messagesForForward(client, ids);
  if (rows.length !== ids.length) throw new AppError("MESSAGE_GONE", "A message was deleted", 404);
  for (const channelId of new Set(rows.map((r) => r.community_channel_id))) await member(client, channelId, user);
  if (rows.some((r) => !FORWARDABLE.has(r.message_type)))
    throw new AppError("NOT_FORWARDABLE", "Polls, cards and announcements are not forwarded", 422);
  return rows;
}

/**
 * A mail's attachment as a chat file: the mailbox owner's own, scanned clean, copied into
 * Community once against the first chat (the upload rules for chats decide its type).
 */
async function mailSource(client, mailAttachmentId, channelId, user) {
  const doc = await mailbox().attachmentFile(client, mailAttachmentId, user);
  if (!doc) throw notFound();
  if (doc.scan_status === "pending")
    throw new AppError("DOCUMENT_SCANNING", "This file is still being checked. Try again in a minute.", 409);
  if (doc.scan_status === "infected")
    throw new AppError("DOCUMENT_INFECTED", "This file failed its virus check and cannot be sent.", 422);
  const copy = await vault.store(client, {
    file: { buffer: await storage.get(doc.storage_key), originalname: doc.original_name },
    purpose: "attachment",
    doc_type: "community_media",
    entity: { type: "community_channel", id: channelId },
    actor: user,
  });
  const type = kindOfFile(copy.mime);
  return {
    community_message_id: null,
    sender_user_id: null,
    message_type: type === "audio" ? "file" : type,
    body: null,
    document_id: copy.document_id,
    metadata: {},
    transcript: null,
    mail_attachment_id: mailAttachmentId,
  };
}

/**
 * Forward (§3 step 19, TB 19/10/2026): messages, or a mail's attachment, to up to 5 chats, all
 * or nothing. A colleague named by employee id gets their conversation, started if new. Each
 * copy is a new message from the caller, marked forwarded and carrying the same file, which the
 * vault lets every conversation holding a live message with it read; who first sent it rides
 * in the event's payload for the audit, never on screen.
 */
async function forward(body, user) {
  return tx(async (client) => {
    const chats = [];
    const add = async (channelId) => {
      if (chats.some((m) => m.community_channel_id === channelId)) return;
      const m = await member(client, channelId, user);
      if (!mayPost(m))
        throw new AppError("CANNOT_POST", m.name ? `You cannot post in #${m.name}` : "You cannot post in this conversation", 403);
      chats.push(m);
    };
    for (const id of body.channel_ids ?? []) await add(id);
    for (const employeeId of body.employee_ids ?? []) await add(await directWith(client, employeeId, user));

    const items = body.message_ids
      ? await forwardSources(client, body.message_ids, user)
      : [await mailSource(client, body.mail_attachment_id, chats[0].community_channel_id, user)];

    let sent = 0;
    for (const chat of chats) {
      // Photos sent together stay one album in each chat, under a key of its own.
      const albums = new Map();
      for (const it of items) {
        const was = it.metadata || {};
        const metadata = { forwarded: true };
        if (it.community_message_id) metadata.forwarded_from = it.community_message_id;
        if (was.duration_s) metadata.duration_s = was.duration_s;
        if (was.captions) metadata.captions = was.captions;
        if (was.no_link_preview) metadata.no_link_preview = true;
        if (was.album_key) {
          if (!albums.has(was.album_key)) albums.set(was.album_key, crypto.randomUUID());
          metadata.album_key = albums.get(was.album_key);
        }
        const card =
          it.message_type === "text"
            ? await links.linkFor(client, it.body, metadata)
            : { community_link_preview_id: null, fetch: null };
        const message = await repo.insertMessage(client, {
          community_channel_id: chat.community_channel_id,
          sender_user_id: user.user_id,
          message_type: it.message_type,
          body: it.body,
          document_id: it.document_id,
          metadata,
          community_link_preview_id: card.community_link_preview_id,
          transcript: it.transcript,
          in_order: true,
        });
        const direct = chat.channel_type === "direct";
        await emit(client, {
          key: direct ? EVENTS.DIRECT_MESSAGE_SENT : EVENTS.CHANNEL_MESSAGE_POSTED,
          entity: { type: direct ? "direct_message" : "channel_message", id: message.community_message_id },
          actor: user,
          payload: {
            community_channel_id: chat.community_channel_id,
            community_message_id: message.community_message_id,
            message_type: it.message_type,
            sender_name: user.display_name || null,
            channel_name: direct ? null : chat.name || null,
            preview: lineOf(it.message_type, message.body),
            forwarded_from: it.community_message_id
              ? { community_message_id: it.community_message_id, sender_user_id: it.sender_user_id }
              : { mail_attachment_id: it.mail_attachment_id },
            ...(card.fetch ? { link_url: card.fetch } : {}),
          },
        });
        sent += 1;
      }
      // Sending is reading, as when posting.
      await repo.markRead(client, chat.community_channel_id, user.user_id);
    }
    return { sent, community_channel_ids: chats.map((m) => m.community_channel_id) };
  });
}

async function listColleagues(query, user) {
  const page = await repo.listColleagues(pool, query, user.user_id);
  return { ...page, data: page.data.map((r) => r.person) };
}

async function profileCard(employeeId, user) {
  const p = await repo.profile(pool, employeeId);
  if (!p) throw new AppError("NOT_FOUND", "There is no such colleague", 404);
  const other = p.user_id;
  const [sharedItems, common] =
    other && other !== user.user_id
      ? await Promise.all([
          repo.shared(pool, user.user_id, other),
          repo.channelsInCommon(pool, user.user_id, other),
        ])
      : [{ files: [], voice_notes: 0 }, []];
  return {
    person: p.person,
    user_id: other ?? null,
    work_email: p.work_email ?? null,
    phone: p.phone ?? null,
    worksite: p.worksite ?? null,
    online: p.online,
    last_seen_at: iso(p.last_seen_at),
    shared_files: sharedItems.files,
    voice_notes: sharedItems.voice_notes,
    shared_channels: common,
  };
}

/* ------------------------------------------------------------------ *
 * Celebrations (A20), the 08:00 job
 * ------------------------------------------------------------------ */

/**
 * Post today's birthday and work anniversary cards to #general, as the system. Safe to
 * run twice on one day: a card already posted for a person and occasion is skipped.
 */
async function postCelebrations(date = lagos.today()) {
  const due = await repo.celebrationsOn(pool, date);
  let posted = 0;
  for (const c of due) {
    posted += await tx(async (client) => {
      const general = await repo.systemChannel(client, "general");
      if (
        await repo.celebrationPosted(
          client,
          general.community_channel_id,
          c.employee_id,
          c.occasion,
          date,
        )
      )
        return 0;
      const message = await repo.insertMessage(client, {
        community_channel_id: general.community_channel_id,
        sender_user_id: null,
        message_type: c.occasion,
        body: wishFor(c.employee_id, c.occasion),
        metadata: { subject_employee_id: c.employee_id, years: c.years },
      });
      await emit(client, {
        key: EVENTS.CELEBRATION_POSTED,
        entity: { type: "channel_message", id: message.community_message_id },
        actor: null,
        payload: {
          community_channel_id: general.community_channel_id,
          community_message_id: message.community_message_id,
          occasion: c.occasion,
          subject_employee_id: c.employee_id,
        },
        dedup_key: `celebration:${c.occasion}:${c.employee_id}:${date}`,
      });
      return 1;
    });
  }
  return { date, due: due.length, posted };
}

/** Called by the socket while a person is connected (realtime/socket.js). */
function touchPresence(userId) {
  return repo.touchPresence(pool, userId);
}

module.exports = {
  joinLogin,
  joinEveryone,
  setPinned,
  isModerator,
  mayPoll,
  editMessage,
  deleteMessage,
  closePoll,
  lineOf,
  mayPost,
  kindOfFile,
  statusOf,
  listChannels,
  getChannel,
  createChannel,
  pinMessage,
  unpinMessage,
  listPins,
  updateChannel,
  listMembers,
  addMembers,
  removeMember,
  setRole,
  setMuted,
  markRead,
  markDelivered,
  listMessages,
  storeMedia,
  postMessage,
  linkPreview,
  recognise,
  react,
  vote,
  transcript,
  listConversations,
  openDirect,
  listColleagues,
  listForwardTargets,
  forward,
  profileCard,
  postCelebrations,
  touchPresence,
};
