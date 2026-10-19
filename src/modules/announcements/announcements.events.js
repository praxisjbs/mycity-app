"use strict";
/**
 * Announcements' events (community.md §7): a scheduled one is queued for its time, a
 * published one notifies its audience at its level and appears in #announcements, and a
 * reminder reaches only those who have not read it. An important one queues its own reminder
 * for 4 hours later; Acknowledge pressed on the urgent bar is recorded here as on the card.
 */
const { pool } = require("../../config/db");
const { defineEvents } = require("../../shared/events/catalogue");
const outbox = require("../../shared/events/outbox");
const { defineNotification } = require("../../shared/notifications/fanout");
const queues = require("../../jobs/queues");
const realtime = require("../../services/realtime/emitter");
const { EVENTS: NOTICE_EVENTS } = require("../notifications/notifications.events");

/** How long after an important announcement its unread are reminded (TB, 19/10/2026). */
const IMPORTANT_REMIND_MS = 4 * 60 * 60 * 1000;

const EVENTS = defineEvents("community", {
  "announcement.created": {
    summary: "An announcement was written, to go out now or later",
  },
  "announcement.updated": {
    summary: "A scheduled announcement was changed before it went out",
  },
  "announcement.cancelled": {
    summary: "A scheduled announcement was called off",
  },
  "announcement.published": {
    summary: "An announcement went out to its audience",
  },
  "announcement.reminded": {
    summary: "People who had not read an announcement were reminded",
  },
  "announcement.acknowledged": {
    summary: "Someone acknowledged an urgent announcement",
  },
});

/** A scheduled announcement waits on the queue until its time. */
outbox.register(
  EVENTS.ANNOUNCEMENT_CREATED,
  "announcements.schedule_release",
  async (event) => {
    const at = event.payload.publish_at;
    if (!at) return;
    await queues.enqueue(
      "announcement-publish",
      "release",
      { announcement_id: event.payload.announcement_id },
      {
        delay: Math.max(0, new Date(at).getTime() - Date.now()),
        jobId: `announcement-publish-${event.payload.announcement_id}`,
      },
    );
  },
);

/*
 * An edit queues a release at the new time under its own job id (the first one may still
 * be waiting, and a queue keeps one job per id). Whichever runs first and finds it not yet
 * due, or no longer scheduled, does nothing.
 */
outbox.register(
  EVENTS.ANNOUNCEMENT_UPDATED,
  "announcements.reschedule_release",
  async (event) => {
    await queues.enqueue(
      "announcement-publish",
      "release",
      { announcement_id: event.payload.announcement_id },
      {
        delay: Math.max(
          0,
          new Date(event.payload.publish_at).getTime() - Date.now(),
        ),
        jobId: `announcement-publish-${event.payload.announcement_id}-${event.event_id}`,
      },
    );
  },
);

async function audience(event, client = pool) {
  const { rows } = await client.query(
    "SELECT user_id FROM announcement_read WHERE announcement_id = $1 ORDER BY user_id",
    [event.payload.announcement_id],
  );
  return rows.map((r) => r.user_id);
}

outbox.register(
  EVENTS.ANNOUNCEMENT_PUBLISHED,
  "announcements.push_message",
  async (event) => {
    for (const userId of await audience(event)) {
      realtime.toUser(userId, "community.message", {
        community_channel_id: event.payload.community_channel_id,
        community_message_id: event.payload.community_message_id,
      });
    }
  },
);

const BODY = {
  urgent: "Urgent. Acknowledge it in #announcements.",
  important: "Important. New in #announcements.",
  normal: "New in #announcements.",
};

defineNotification(EVENTS.ANNOUNCEMENT_PUBLISHED, {
  to: [{ users: (e, client) => audience(e, client) }],
  title: (e) => e.payload.title,
  body: (e) => BODY[e.payload.urgency] || BODY.normal,
  priority: "high",
  // The level its poster chose; an urgent one closes only on Acknowledge (TB, 19/10/2026).
  urgency: (e) => e.payload.urgency || "normal",
  acknowledge: (e) => e.payload.urgency === "urgent",
});

/** An important announcement reminds whoever has not opened it, once, 4 hours later. */
outbox.register(
  EVENTS.ANNOUNCEMENT_PUBLISHED,
  "announcements.schedule_reminder",
  async (event) => {
    if (event.payload.urgency !== "important") return;
    await queues.enqueue(
      "announcement-publish",
      "remind",
      { announcement_id: event.payload.announcement_id },
      { delay: IMPORTANT_REMIND_MS, jobId: `announcement-remind-${event.payload.announcement_id}` },
    );
  },
);

/** Acknowledge on the urgent bar: recorded on the reads, as if pressed on the card. */
outbox.register(
  NOTICE_EVENTS.NOTIFICATION_ACKNOWLEDGED,
  "announcements.record_acknowledgement",
  async (event) => {
    const p = event.payload || {};
    if (p.entity_type !== "announcement" || !p.entity_id || !p.user_id) return;
    await require("./announcements.service").acknowledgeFromNotice(p.user_id, p.entity_id);
  },
);

defineNotification(EVENTS.ANNOUNCEMENT_REMINDED, {
  to: [{ users: (e) => e.payload.user_ids || [] }],
  title: (e) => `Reminder: ${e.payload.title}`,
  body: "Please read it in #announcements.",
});

module.exports = { EVENTS };
