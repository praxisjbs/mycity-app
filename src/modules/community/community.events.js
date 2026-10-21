"use strict";
/**
 * Staff Community's events (community.md §7), what they tell people, and the realtime
 * pushes that follow them. Everything here runs in the worker after the change commits.
 *
 * Realtime goes to each member's own room (`user:<id>`), so a person sees a message in
 * every tab they have open whatever channel is on screen; the payload carries ids only
 * and the screen reads the message over HTTP, so nothing a member may not see travels.
 *
 * A text message whose first link had no card yet carries `link_url` in its event; the
 * link-preview job fetches the card after the commit and attaches it (community.links.js).
 * When the worker finishes a file's derived sizes (a PDF's first page, a video's poster),
 * the conversations holding it are told, so the card fills in where it is.
 */
const { pool } = require("../../config/db");
const { defineEvents } = require("../../shared/events/catalogue");
const outbox = require("../../shared/events/outbox");
const { defineNotification } = require("../../shared/notifications/fanout");
const { defineDocumentType } = require("../../shared/documents/types");
const vault = require("../../shared/documents/vault");
const queues = require("../../jobs/queues");
const realtime = require("../../services/realtime/emitter");

const EVENTS = defineEvents("community", {
  "channel.created": { summary: "A channel was created" },
  "channel.updated": { summary: "A channel was renamed or its description changed" },
  "channel.members_changed": {
    summary: "People were added to or removed from a channel",
  },
  "channel_message.posted": { summary: "A message was posted in a channel" },
  "channel_message.reacted": {
    summary: "Someone celebrated, thumbed up or voted on a message",
  },
  "channel_message.edited": {
    summary: "A message was edited, or a poll closed",
  },
  "channel_message.pinned": {
    summary: "A message was pinned at the top of its conversation, or unpinned",
  },
  "channel_message.deleted": {
    summary: "A message was deleted by its author or a moderator",
  },
  "channel_message.link_previewed": {
    summary: "A link's card was added to a message",
  },
  "link_preview.fetched": {
    summary: "A link's card was fetched from the web",
  },
  "direct_message.sent": { summary: "A direct message was sent" },
  "direct_thread.opened": { summary: "A direct conversation was started" },
  "direct_thread.read": { summary: "A direct conversation was read" },
  "direct_thread.delivered": {
    summary: "Direct messages reached the other person",
  },
  "recognition.posted": { summary: "A colleague was recognised in #general" },
  "celebration.posted": {
    summary: "A birthday or work anniversary card was posted",
  },
});

/**
 * Files posted in a conversation: read by its members, whoever they are, and by the members of
 * any other conversation holding a live message with the same file (a forwarded copy, §4).
 */
defineDocumentType("community_media", {
  label: "Chat file",
  module: "community",
});
vault.defineAccess("community_channel", async (client, user, doc) => {
  const { rows } = await client.query(
    `SELECT 1 FROM community_member WHERE community_channel_id = $1 AND user_id = $2
     UNION ALL
     SELECT 1 FROM community_message x
       JOIN community_member m ON m.community_channel_id = x.community_channel_id AND m.user_id = $2
      WHERE x.document_id = $3 AND x.deleted_at IS NULL
     LIMIT 1`,
    [doc.entity_id, user.user_id, doc.document_id],
  );
  return rows.length > 0;
});

/** A link card's picture: copied from a public page, so every signed-in member of staff reads it. */
defineDocumentType("link_preview_image", {
  label: "Link card picture",
  module: "community",
});
vault.defineAccess("community_link_preview", async () => true);

/** Members of the message's channel, but the sender. */
async function others(event, client = pool, { skipMuted = false } = {}) {
  const { rows } = await client.query(
    `SELECT user_id FROM community_member
      WHERE community_channel_id = $1 AND user_id IS DISTINCT FROM $2
        AND (NOT $3::boolean OR muted_until IS NULL OR muted_until <= now())`,
    [
      event.payload.community_channel_id,
      event.actor_user_id ?? null,
      skipMuted,
    ],
  );
  return rows.map((r) => r.user_id);
}

function pushTo(userIds, event, name) {
  for (const userId of userIds) {
    realtime.toUser(userId, name, {
      community_channel_id: event.payload.community_channel_id,
      community_message_id: event.payload.community_message_id ?? null,
    });
  }
}

async function pushToMembers(event, name) {
  const { rows } = await pool.query(
    "SELECT user_id FROM community_member WHERE community_channel_id = $1",
    [event.payload.community_channel_id],
  );
  pushTo(
    rows.map((r) => r.user_id),
    event,
    name,
  );
}

for (const key of [
  EVENTS.CHANNEL_MESSAGE_POSTED,
  EVENTS.DIRECT_MESSAGE_SENT,
  EVENTS.RECOGNITION_POSTED,
  EVENTS.CELEBRATION_POSTED,
]) {
  outbox.register(key, `community.push_message.${key.split(".")[0]}`, (event) =>
    pushToMembers(event, "community.message"),
  );
}
for (const key of [
  EVENTS.CHANNEL_MESSAGE_REACTED,
  EVENTS.CHANNEL_MESSAGE_EDITED,
  EVENTS.CHANNEL_MESSAGE_DELETED,
  EVENTS.CHANNEL_MESSAGE_PINNED,
  EVENTS.CHANNEL_MESSAGE_LINK_PREVIEWED,
]) {
  outbox.register(key, `community.push_update.${key.split(".")[1]}`, (event) =>
    pushToMembers(event, "community.message_updated"),
  );
}
/*
 * Receipts (community.md §3 step 10): a read one goes to both, so the reader's other devices
 * clear the count; a delivered one only to the other person, whose tick it is.
 */
outbox.register(EVENTS.DIRECT_THREAD_READ, "community.push_receipt.read", (event) =>
  pushToMembers(event, "community.receipt"),
);
outbox.register(
  EVENTS.DIRECT_THREAD_DELIVERED,
  "community.push_receipt.delivered",
  async (event) => pushTo(await others(event), event, "community.receipt"),
);
for (const key of [
  EVENTS.CHANNEL_CREATED,
  EVENTS.CHANNEL_UPDATED,
  EVENTS.CHANNEL_MEMBERS_CHANGED,
  EVENTS.DIRECT_THREAD_OPENED,
]) {
  outbox.register(
    key,
    `community.push_channels.${key.replace(".", "_")}`,
    (event) => pushToMembers(event, "community.channels"),
  );
}

/* A text message posted or edited before its first link had a card: fetched after the commit. */
for (const key of [
  EVENTS.CHANNEL_MESSAGE_POSTED,
  EVENTS.DIRECT_MESSAGE_SENT,
  EVENTS.CHANNEL_MESSAGE_EDITED,
]) {
  outbox.register(key, "community.link_preview", async (event) => {
    const url = event.payload.link_url;
    if (!url) return;
    await queues.enqueue(
      "link-preview",
      "card",
      { community_message_id: event.payload.community_message_id, url },
      { jobId: `link-preview-${event.event_id}` },
    );
  });
}

/* Everyone is in #general and #announcements from the moment their login exists, not from their first visit. */
const joinLogin = (event) => require("./community.service").joinLogin(event.entity && event.entity.id);
outbox.register("app_user.created", "community.join_company", joinLogin);
outbox.register("app_user.reactivated", "community.join_company_again", joinLogin);

/*
 * A PDF's first page or a video's poster is ready: every conversation holding the file redraws
 * it, the one it was posted in and any it was forwarded to.
 */
outbox.register(vault.EVENTS.DOCUMENT_DERIVED, "community.push_derived", async (event) => {
  if (event.payload.entity_type !== "community_channel") return;
  const { rows } = await pool.query(
    `SELECT community_channel_id, community_message_id FROM community_message
      WHERE document_id = $1 AND deleted_at IS NULL`,
    [event.payload.document_id],
  );
  for (const r of rows) {
    await pushToMembers(
      {
        payload: {
          community_channel_id: r.community_channel_id,
          community_message_id: r.community_message_id,
        },
      },
      "community.message_updated",
    );
  }
});

const firstLine = (e) => e.payload.preview || "New message";

/** On a phone, a conversation's notices share one notification (docs/guides/notifications.md §6). */
const conversation = (e) => `community_channel:${e.payload.community_channel_id}`;

defineNotification(EVENTS.DIRECT_MESSAGE_SENT, {
  to: [{ users: (e, client) => others(e, client, { skipMuted: true }) }],
  title: (e) => e.payload.sender_name || "New message",
  body: firstLine,
  priority: "high",
  // Every direct message alerts, replacing the one before from the same conversation.
  push: { tag: conversation, mode: "alert" },
  who: "The conversation's other members",
});

defineNotification(EVENTS.CHANNEL_MESSAGE_POSTED, {
  to: [{ users: (e, client) => others(e, client, { skipMuted: true }) }],
  title: (e) =>
    e.payload.channel_name
      ? `#${e.payload.channel_name}`
      : e.payload.sender_name
        ? `${e.payload.sender_name} posted`
        : "New post",
  body: (e) =>
    e.payload.channel_name && e.payload.sender_name
      ? `${e.payload.sender_name}: ${firstLine(e)}`
      : firstLine(e),
  // Every post alerts each device, replacing the channel's notification, which counts them (TB, 19/10/2026).
  push: { tag: conversation, mode: "alert" },
  who: "The channel's members",
});

defineNotification(EVENTS.RECOGNITION_POSTED, {
  to: [{ subject: true }],
  title: (e) =>
    e.payload.from_name
      ? `${e.payload.from_name} recognised you`
      : "You were recognised",
  body: "See it in #general.",
});

module.exports = { EVENTS };
