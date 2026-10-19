"use strict";
/**
 * Mailbox's events (mailbox.md §7) and what follows them in the worker: a sync when a
 * mailbox is connected or Refresh is pressed, a delivery when a message's time comes,
 * the owner told of new mail, a refused password and a message that could not go.
 * Files on mail are read by the mailbox's owner only; a signature's pictures by anyone
 * signed in, since every recipient receives them.
 */
const { pool } = require("../../config/db");
const { defineEvents } = require("../../shared/events/catalogue");
const outbox = require("../../shared/events/outbox");
const { defineNotification } = require("../../shared/notifications/fanout");
const { defineDocumentType } = require("../../shared/documents/types");
const vault = require("../../shared/documents/vault");
const queues = require("../../jobs/queues");
const realtime = require("../../services/realtime/emitter");

const EVENTS = defineEvents("mailbox", {
  "mail_account.connected": {
    summary: "A mailbox was connected with its address and password",
    sensitive: true,
  },
  "mail_account.disconnected": {
    summary: "A mailbox was disconnected and its password deleted",
    sensitive: true,
  },
  "mail_account.sync_requested": {
    summary: "Refresh was pressed on a mailbox",
  },
  "mail_account.needs_reconnect": {
    summary: "The mail server refused a mailbox's saved password",
  },
  "mail_message.received": { summary: "New mail arrived in an inbox" },
  "mail_message.queued": { summary: "A message was put on the send queue" },
  "mail_message.sent": {
    summary: "A message was delivered to the mail server",
  },
  "mail_thread.moved": {
    summary: "A conversation was moved to another folder",
  },
  "mail_folder.emptied": { summary: "Spam or Trash was emptied" },
  "mail_account.images_trusted": { summary: "A mailbox owner chose to always show, or stop showing, a sender's images" },
  "mail_send.failed": { summary: "A message could not be sent" },
  "mail_signature.changed": {
    summary: "A person changed the numbers or switches on their email signature",
  },
  "mail_signature.config_changed": {
    summary: "The company's email signature links or switches were changed",
  },
});

defineDocumentType("mail_attachment", {
  label: "Mail attachment",
  module: "mailbox",
  sensitivity: "personal",
});

defineDocumentType("mail_signature_image", {
  label: "Signature picture",
  module: "mailbox",
  sensitivity: "normal",
});

/** A file on mail, or one waiting in the composer: the mailbox's owner reads it, nobody else. */
const owner = (sql) => async (client, user, doc) => {
  const { rows } = await client.query(sql, [doc.entity_id, user.user_id]);
  return rows.length > 0;
};
vault.defineAccess(
  "mail_message",
  owner(`SELECT 1 FROM mail_message m JOIN mail_account a ON a.mail_account_id = m.mail_account_id
          WHERE m.mail_message_id = $1 AND a.user_id = $2`),
);
vault.defineAccess(
  "mail_account",
  owner(
    "SELECT 1 FROM mail_account WHERE mail_account_id = $1 AND user_id = $2",
  ),
);
/** A signature's picture (a logo, an icon) goes to every recipient: anyone signed in may read it. */
vault.defineAccess("mail_signature_image", async () => true);

const syncNow = (event) =>
  queues.enqueue(
    "mail-sync",
    "sync",
    { mail_account_id: event.payload.mail_account_id },
    { jobId: `mail-sync-${event.event_id}` },
  );
outbox.register(EVENTS.MAIL_ACCOUNT_CONNECTED, "mailbox.first_sync", syncNow);
outbox.register(
  EVENTS.MAIL_ACCOUNT_SYNC_REQUESTED,
  "mailbox.sync_now",
  syncNow,
);

/** A queued message waits until its time on the queue; the scheduler is the safety net. */
outbox.register(EVENTS.MAIL_MESSAGE_QUEUED, "mailbox.deliver_later", (event) =>
  queues.enqueue(
    "mail-send",
    "send",
    { mail_send_queue_id: event.payload.mail_send_queue_id },
    {
      delay: Math.max(
        0,
        new Date(event.payload.release_at).getTime() - Date.now(),
      ),
      jobId: `mail-send-${event.payload.mail_send_queue_id}`,
    },
  ),
);

/** The owner's open tabs reload their folder. */
async function tellOwner(event) {
  let userId = event.payload.user_id;
  if (!userId && event.payload.mail_account_id) {
    const { rows } = await pool.query(
      "SELECT user_id FROM mail_account WHERE mail_account_id = $1",
      [event.payload.mail_account_id],
    );
    userId = rows[0] && rows[0].user_id;
  }
  if (userId)
    realtime.toUser(userId, "mailbox.updated", {
      mail_thread_id: event.payload.mail_thread_id ?? null,
    });
}
for (const key of [
  EVENTS.MAIL_MESSAGE_RECEIVED,
  EVENTS.MAIL_MESSAGE_SENT,
  EVENTS.MAIL_SEND_FAILED,
  EVENTS.MAIL_ACCOUNT_NEEDS_RECONNECT,
]) {
  outbox.register(
    key,
    `mailbox.tell_owner.${key.replace(".", "_")}`,
    tellOwner,
  );
}

const ownerOf = (e) => [e.payload.user_id].filter(Boolean);

defineNotification(EVENTS.MAIL_MESSAGE_RECEIVED, {
  to: [{ users: ownerOf }],
  title: (e) => e.payload.from || "New mail",
  body: (e) => e.payload.subject,
});

defineNotification(EVENTS.MAIL_ACCOUNT_NEEDS_RECONNECT, {
  to: [{ users: ownerOf }],
  title: "Reconnect your mailbox",
  body: "The mail server refused the saved password.",
  priority: "high",
});

defineNotification(EVENTS.MAIL_SEND_FAILED, {
  to: [{ users: ownerOf }],
  title: (e) => `Not sent: ${e.payload.subject}`,
  body: (e) => e.payload.reason,
  priority: "high",
});

module.exports = { EVENTS };
