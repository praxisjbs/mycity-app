"use strict";
/**
 * Staff Community's events (community.md §7), what they tell people, and the realtime
 * pushes that follow them. Everything here runs in the worker after the change commits.
 *
 * Realtime goes to each member's own room (`user:<id>`), so a person sees a message in
 * every tab they have open whatever channel is on screen; the payload carries ids only
 * and the screen reads the message over HTTP, so nothing a member may not see travels.
 */
const { pool } = require("../../config/db");
const { defineEvents } = require("../../shared/events/catalogue");
const outbox = require("../../shared/events/outbox");
const { defineNotification } = require("../../shared/notifications/fanout");
const { defineDocumentType } = require("../../shared/documents/types");
const vault = require("../../shared/documents/vault");
const realtime = require("../../services/realtime/emitter");

const EVENTS = defineEvents("community", {
  "channel.created": { summary: "A channel was created" },
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
  "channel_message.deleted": {
    summary: "A message was deleted by its author or a moderator",
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

/** Files posted in a conversation: read by its members only, whoever they are. */
defineDocumentType("community_media", {
  label: "Chat file",
  module: "community",
});
vault.defineAccess("community_channel", async (client, user, doc) => {
  const { rows } = await client.query(
    "SELECT 1 FROM community_member WHERE community_channel_id = $1 AND user_id = $2",
    [doc.entity_id, user.user_id],
  );
  return rows.length > 0;
});

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

async function pushToMembers(event, name) {
  const { rows } = await pool.query(
    "SELECT user_id FROM community_member WHERE community_channel_id = $1",
    [event.payload.community_channel_id],
  );
  for (const r of rows) {
    realtime.toUser(r.user_id, name, {
      community_channel_id: event.payload.community_channel_id,
      community_message_id: event.payload.community_message_id ?? null,
    });
  }
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
]) {
  outbox.register(key, `community.push_update.${key.split(".")[1]}`, (event) =>
    pushToMembers(event, "community.message_updated"),
  );
}
for (const key of [EVENTS.DIRECT_THREAD_READ, EVENTS.DIRECT_THREAD_DELIVERED]) {
  outbox.register(key, `community.push_receipt.${key.split(".")[1]}`, (event) =>
    pushToMembers(event, "community.receipt"),
  );
}
for (const key of [
  EVENTS.CHANNEL_CREATED,
  EVENTS.CHANNEL_MEMBERS_CHANGED,
  EVENTS.DIRECT_THREAD_OPENED,
]) {
  outbox.register(
    key,
    `community.push_channels.${key.replace(".", "_")}`,
    (event) => pushToMembers(event, "community.channels"),
  );
}

const firstLine = (e) => e.payload.preview || "New message";

defineNotification(EVENTS.DIRECT_MESSAGE_SENT, {
  to: [{ users: (e, client) => others(e, client, { skipMuted: true }) }],
  title: (e) => e.payload.sender_name || "New message",
  body: firstLine,
  priority: "high",
});

defineNotification(EVENTS.CHANNEL_MESSAGE_POSTED, {
  to: [{ users: (e, client) => others(e, client, { skipMuted: true }) }],
  title: (e) =>
    e.payload.sender_name ? `${e.payload.sender_name} posted` : "New post",
  body: firstLine,
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
