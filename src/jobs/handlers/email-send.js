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
 * Retried on a transport failure (the SMTP server busy, a timeout). Not retried when
 * the message itself is wrong (a template's data missing, a bad address): that fails
 * the job at once, because sending it again cannot succeed.
 */
const { UnrecoverableError } = require("bullmq");
const { AppError } = require("../../shared/errors");
const systemMail = require("../../services/mail/system-mail.service");

const PERMANENT =
  /is not an email address|no recipient|at most \d+ recipients|has no declared variables/;

module.exports = async function emailSend(job) {
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
    if (err instanceof AppError || PERMANENT.test(String(err && err.message))) {
      throw new UnrecoverableError(`email-send ${template}: ${err.message}`);
    }
    throw err;
  }
};
