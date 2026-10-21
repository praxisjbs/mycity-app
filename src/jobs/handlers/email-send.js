"use strict";
/**
 * Queue `email-send`: one system mail message (services/mail/system-mail.service.js).
 *
 *   await queues.enqueue("email-send", "user-invite", {
 *     to: { name: "Ada Obi", email: "ada@mycityapp.io" },
 *     template: "user-invite",
 *     data: { ... },                                   // the template's declared variables
 *     attachments: [{ document_id }],                  // by id: a job carries no bytes
 *   });
 *
 * Paced (services/mail/pace.js): over the hourly limit the job is put back in the queue until
 * a slot frees, without using up an attempt.
 *
 * Held: on a server with no system sender set up (Settings, Integrations, or the server
 * file), the job is put back for 15 minutes the same way, until one is (A4: nothing is faked
 * or lost; docs/guides/integrations.md §6.8). Saving a sender releases what waits at once.
 * While system mail is paused (§6.15) it waits the same way, and Resume releases it.
 *
 * An invitation or a password reset is sent only while its link still works: one replaced by
 * a newer link, or expired while it waited, is dropped (§6.15).
 *
 * Retried on a transport failure (the SMTP server busy, a timeout). Not retried when
 * the message itself is wrong (a template's data missing, a bad address): that fails
 * the job at once, because sending it again cannot succeed. An address the mail server
 * refuses for good finishes the job: it is on the System Sender's Refused Addresses (§6.16).
 */
const { UnrecoverableError } = require("bullmq");
const { AppError } = require("../../shared/errors");
const systemMail = require("../../services/mail/system-mail.service");
const pace = require("../../services/mail/pace");

const PERMANENT =
  /is not an email address|no recipient|at most \d+ recipients|has no declared variables|more than the hourly sending limit/;

/** How long held mail waits before it asks again whether a sender is set up, or mail resumed. */
const HOLD_MS = 15 * 60 * 1000;

/** The messages that carry a sign-in link, which may have stopped working while they waited. */
const LINKS = new Set(["user-invite", "password-reset"]);

/** Hold the job for `reason`, tagged so the change that ends it releases the job at once. */
async function hold(job, token, reason, why) {
  if (job.data.held_for !== reason) await job.updateData({ ...job.data, held_for: reason }).catch(() => undefined);
  return pace.postpone(job, token, HOLD_MS, why);
}

module.exports = async function emailSend(job, token) {
  const {
    to,
    cc,
    template,
    data,
    recipient,
    attachments,
    reply_to: replyTo,
  } = job.data || {};
  if (!to || !template)
    throw new UnrecoverableError(
      "email-send: the job needs `to` and `template`",
    );
  if (LINKS.has(template) && data && data.link_url) {
    const identity = require("../../modules/identity/identity.service");
    if (!(await identity.linkStillOpen(data.link_url))) return { template, skipped: "link_closed" };
  }
  try {
    const sent = await systemMail.send({
      to,
      cc,
      template,
      data,
      recipient,
      attachments,
      reply_to: replyTo,
    });
    return {
      template,
      message_id: sent.message_id,
      accepted: sent.accepted.length,
      rejected: sent.rejected.length,
    };
  } catch (err) {
    if (err && err.code === "MAIL_PACED")
      throw await pace.postpone(job, token, err.retryAfterMs);
    // Tagged, so saving a sender releases this job at once (integrations.events.js).
    if (err && err.code === "MAIL_NOT_SET_UP") throw await hold(job, token, "sender", "no system sender set up");
    // Tagged, so Resume releases this job at once (integrations.events.js).
    if (err && err.code === "MAIL_PAUSED") throw await hold(job, token, "pause", "system mail paused");
    if (err && err.code === "MAIL_REFUSED") {
      systemMail.reportRefused(err, { queue: "email-send", template });
      return { template, refused: err.rejected.length };
    }
    if (err instanceof AppError || PERMANENT.test(String(err && err.message))) {
      throw new UnrecoverableError(`email-send ${template}: ${err.message}`);
    }
    throw err;
  }
};
