"use strict";
/**
 * Announcements' events (community.md §7): a scheduled one is queued for its time, a
 * published one notifies its audience and appears in #announcements, and a reminder
 * reaches only those who have not read it.
 */
const { pool } = require("../../config/db");
const { defineEvents } = require("../../shared/events/catalogue");
const outbox = require("../../shared/events/outbox");
const { defineNotification } = require("../../shared/notifications/fanout");
const queues = require("../../jobs/queues");
const realtime = require("../../services/realtime/emitter");

const EVENTS = defineEvents("community", {
  "announcement.created": { summary: "An announcement was written, to go out now or later" },
  "announcement.updated": { summary: "A scheduled announcement was changed before it went out" },
  "announcement.cancelled": { summary: "A scheduled announcement was called off" },
  "announcement.published": { summary: "An announcement went out to its audience" },
  "announcement.reminded": { summary: "People who had not read an announcement were reminded" },
});

/** A scheduled announcement waits on the queue until its time. */
outbox.register(EVENTS.ANNOUNCEMENT_CREATED, "announcements.schedule_release", async (event) => {
  const at = event.payload.publish_at;
  if (!at) return;
  await queues.enqueue(
    "announcement-publish",
    "release",
    { announcement_id: event.payload.announcement_id },
    { delay: Math.max(0, new Date(at).getTime() - Date.now()), jobId: `announcement-publish-${event.payload.announcement_id}` },
  );
});

/*
 * An edit queues a release at the new time under its own job id (the first one may still
 * be waiting, and a queue keeps one job per id). Whichever runs first and finds it not yet
 * due, or no longer scheduled, does nothing.
 */
outbox.register(EVENTS.ANNOUNCEMENT_UPDATED, "announcements.reschedule_release", async (event) => {
  await queues.enqueue(
    "announcement-publish",
    "release",
    { announcement_id: event.payload.announcement_id },
    { delay: Math.max(0, new Date(event.payload.publish_at).getTime() - Date.now()), jobId: `announcement-publish-${event.payload.announcement_id}-${event.event_id}` },
  );
});

async function audience(event, client = pool) {
  const { rows } = await client.query(
    "SELECT user_id FROM announcement_read WHERE announcement_id = $1 ORDER BY user_id",
    [event.payload.announcement_id],
  );
  return rows.map((r) => r.user_id);
}

outbox.register(EVENTS.ANNOUNCEMENT_PUBLISHED, "announcements.push_message", async (event) => {
  for (const userId of await audience(event)) {
    realtime.toUser(userId, "community.message", {
      community_channel_id: event.payload.community_channel_id,
      community_message_id: event.payload.community_message_id,
    });
  }
});

defineNotification(EVENTS.ANNOUNCEMENT_PUBLISHED, {
  to: [{ users: (e, client) => audience(e, client) }],
  title: (e) => e.payload.title,
  body: "New in #announcements.",
  priority: "high",
});

defineNotification(EVENTS.ANNOUNCEMENT_REMINDED, {
  to: [{ users: (e) => e.payload.user_ids || [] }],
  title: (e) => `Reminder: ${e.payload.title}`,
  body: "Please read it in #announcements.",
});

module.exports = { EVENTS };
