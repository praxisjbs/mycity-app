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
 * Paced (services/mail/pace.js): over the hourly sending limit the job is put back in the
 * queue until a slot frees, without using up an attempt.
 *
 * Held: on a server with no system sender set up (Settings, Integrations, or the server
 * file), the job is put back for 15 minutes the same way, until one is (A4: nothing is faked
 * or lost; docs/guides/integrations.md §6.8). Saving a sender releases what waits at once.
 *
 * Retried on a transport failure (the SMTP server busy, a timeout). Not retried when
 * the message itself is wrong (a template's data missing, a bad address): that fails
 * the job at once, because sending it again cannot succeed.
 */
const { UnrecoverableError } = require("bullmq");
const { AppError } = require("../../shared/errors");
const systemMail = require("../../services/mail/system-mail.service");
const pace = require("../../services/mail/pace");

const PERMANENT =
  /is not an email address|no recipient|at most \d+ recipients|has no declared variables|more than the hourly sending limit/;

/** How long held mail waits before it asks again whether a sender is set up. */
const HOLD_MS = 15 * 60 * 1000;

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
    if (err && err.code === "MAIL_NOT_SET_UP") {
      // Tagged, so saving a sender releases this job at once (integrations.events.js).
      if (job.data.held_for !== "sender") await job.updateData({ ...job.data, held_for: "sender" }).catch(() => undefined);
      throw await pace.postpone(job, token, HOLD_MS, "no system sender set up");
    }
    if (err instanceof AppError || PERMANENT.test(String(err && err.message))) {
      throw new UnrecoverableError(`email-send ${template}: ${err.message}`);
    }
    throw err;
  }
};
