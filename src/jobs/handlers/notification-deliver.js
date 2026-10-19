"use strict";
/**
 * Queue `notification-deliver`: notifications the fan-out wrote, sent out
 * (SYSTEM_ARCHITECTURE §6). One job per event, queued by the worker's onDelivery hook
 * (jobs/registry.registerDelivery) with the rows already decided: who, what it says,
 * which channels. Nothing is re-derived here, so a retry sends what the person already
 * sees in their inbox.
 *
 * Channels, per row (`channels` from the person's preferences):
 *   in_app  pushed to the person's sockets as `notification` (the contract's Notification,
 *           its link only when they may open the record's module), so the bell updates and
 *           the open app shows the banner. Best effort: the inbox is the record.
 *   email   system mail with templates/email/notification.html, linking to the record
 *           (shared/route-map). Sent only to active users.
 *   push    one `notification-push` job per row (jobs/handlers/notification-push.js). When
 *           the person is in front of the app on any device, it waits a minute and goes only
 *           if the notice is still unread (TB, 19/10/2026); Security never waits.
 *
 * Paced like all system mail (services/mail/pace.js): when the hourly limit is reached, the
 * emails already sent are recorded and the job is put back in the queue for the rest.
 *
 * Retries do not repeat what already went out: each email sent is recorded on the job
 * (job.updateData), and a retry skips it. A bell push may repeat; the client keys on
 * notification_id.
 */
const { UnrecoverableError } = require("bullmq");
const { config } = require("../../config/env");
const { logger } = require("../../config/logger");
const { pool } = require("../../config/db");
const c = require("@mycity/contract");
const routeMap = require("../../shared/route-map");
const variables = require("../../shared/templates/variables");
const systemMail = require("../../services/mail/system-mail.service");
const pace = require("../../services/mail/pace");
const realtime = require("../../services/realtime/emitter");
const active = require("../../services/realtime/active");
const grantsCache = require("../../shared/rbac/grants-cache");
const notifications = require("../../modules/notifications/notifications.service");
const queues = require("../queues");

/** How long a push waits while its person is in front of the app. */
const HOLD_MS = 60_000;
/** A push job retries for about 20 minutes: 10 s, doubling, eight tries. */
const PUSH_RETRY = { attempts: 8, backoff: { type: "exponential", delay: 10_000 } };

const TEMPLATE = "notification";
variables.defineVariables(
  "email",
  TEMPLATE,
  c.notifications.NotificationEmailVars,
);

function linkOf(row) {
  const link = routeMap.linkFor(row.entity_type, row.entity_id);
  return link ? new URL(link.path, config.STAFF_ORIGIN).href : null;
}

/** A new notice as the bell and the banner read it: the contract's Notification. */
async function bell(row) {
  const user = await grantsCache.getAuthUser(pool, row.user_id);
  const canOpen = user ? notifications.opener(user) : async () => false;
  const [shown] = await notifications.present([row], canOpen);
  return {
    notification_id: row.notification_id,
    category: row.category,
    priority: row.priority,
    title: row.title,
    body: row.body || null,
    entity_type: row.entity_type ?? null,
    entity_id: row.entity_id ?? null,
    link: shown.link,
    read_at: null,
    created_at: new Date(row.created_at || Date.now()).toISOString(),
  };
}

async function recipients(userIds) {
  if (userIds.length === 0) return new Map();
  const { rows } = await pool.query(
    `SELECT u.user_id, u.email, e.first_name, e.last_name
       FROM app_user u JOIN employee e ON e.employee_id = u.employee_id
      WHERE u.user_id = ANY($1::uuid[]) AND u.status = 'active'`,
    [userIds],
  );
  return new Map(rows.map((r) => [r.user_id, r]));
}

module.exports = async function notificationDeliver(job, token) {
  const { notifications: rows, event } = job.data || {};
  if (!Array.isArray(rows))
    throw new UnrecoverableError(
      "notification-deliver: the job needs notifications",
    );
  const out = { in_app: 0, email: 0, email_skipped: 0, push_queued: 0, push_held: 0 };
  const has = (row, ch) =>
    Array.isArray(row.channels) && row.channels.includes(ch);

  for (const row of rows) {
    if (has(row, "in_app") && realtime.toUser(row.user_id, "notification", await bell(row)))
      out.in_app += 1;
    if (has(row, "push")) {
      const hold = row.category !== "security" && (await active.isActive(row.user_id));
      await queues.enqueue(
        "notification-push",
        "send",
        { notification_id: row.notification_id, push: job.data.push || null },
        { ...PUSH_RETRY, jobId: `push-${row.notification_id}`, delay: hold ? HOLD_MS : 0 },
      );
      out.push_queued += 1;
      if (hold) out.push_held += 1;
    }
  }

  const done = new Set((job.data.sent_email || []).map(String));
  const mailRows = rows.filter(
    (r) => has(r, "email") && !done.has(String(r.notification_id)),
  );
  const people = await recipients([...new Set(mailRows.map((r) => r.user_id))]);
  let firstErr = null;
  for (const row of mailRows) {
    const person = people.get(row.user_id);
    if (!person || !person.email) {
      out.email_skipped += 1;
      continue;
    }
    try {
      await systemMail.send({
        to: {
          name: `${person.first_name} ${person.last_name}`.trim(),
          email: person.email,
        },
        recipient: {
          first_name: person.first_name,
          last_name: person.last_name,
          email: person.email,
        },
        template: TEMPLATE,
        data: { title: row.title, body: row.body || "", link_url: linkOf(row) },
      });
      done.add(String(row.notification_id));
      out.email += 1;
      await job.updateData({ ...job.data, sent_email: [...done] });
    } catch (err) {
      if (err && err.code === "MAIL_PACED")
        throw await pace.postpone(job, token, err.retryAfterMs);
      if (!firstErr) firstErr = err;
      logger.warn(
        {
          err,
          notification_id: row.notification_id,
          event_key: event && event.key,
        },
        "notification email not sent",
      );
    }
  }
  if (firstErr) throw firstErr;
  return out;
};
