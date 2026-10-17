"use strict";
/**
 * What a mail server's refusal means, and what the person should do (mailbox.md §11).
 * One ladder, in this order: authentication, sender, recipient, temporary, other 5xx,
 * anything else. The send queue retries on the verdict's code, so a permanent refusal
 * is never retried and a deferral is.
 */
const { AppError } = require("../../shared/errors");

const SENDER = /sender verif|valid sender|not allowed to send|relay(ing)? denied|relay access denied|from address must|sender address rejected|mail from.*(denied|rejected)/i;
const RECIPIENT = /user unknown|unknown user|no such user|mailbox (unavailable|not found)|recipient.*(reject|unknown|not found)|invalid recipient|5\.1\.1/i;
const AUTH = /eauth|\b535\b|auth(entication)? (failed|invalid|denied|required)|must be authenticated|invalid (login|credentials|password)|username and password not accepted/i;
const TRANSIENT = /\b(421|451|452)\b|try again|greylist|temporarily deferred|please try later/i;
const IMAP_AUTH = /authenticationfailed|invalid credentials|login failed|\[auth\]|authentication failed/i;

/** Codes that a retry cannot fix. */
const PERMANENT = new Set(["MAIL_AUTH_FAILED", "SENDER_REFUSED", "RECIPIENT_REFUSED", "MESSAGE_REFUSED"]);

const replyCode = (err) => Number(err && err.responseCode) || null;
const replyText = (err) => String((err && err.response) || (err && err.message) || err || "");

function mapSmtpError(err) {
  if (err instanceof AppError) return err;
  const code = replyCode(err);
  const raw = replyText(err);
  const details = { smtp_code: code, smtp_response: raw.slice(0, 300) };
  if ((err && err.code === "EAUTH") || code === 535 || AUTH.test(raw)) {
    return new AppError("MAIL_AUTH_FAILED", "The mail server refused the password", 422, { password: ["Password refused"] });
  }
  if (SENDER.test(raw) || ((code === 550 || code === 553) && /verif/i.test(raw))) {
    return new AppError("SENDER_REFUSED", "The mail server refused the sender address", 422, details);
  }
  if (RECIPIENT.test(raw) || ((code === 551 || code === 553) && /recipient|user|mailbox/i.test(raw))) {
    return new AppError("RECIPIENT_REFUSED", "The mail server refused a recipient", 422, details);
  }
  if (code === 421 || code === 451 || code === 452 || TRANSIENT.test(raw)) {
    return new AppError("MAIL_DEFERRED", "The mail server deferred it; it will be tried again", 502, details);
  }
  if (code >= 500 || (err && err.code === "EENVELOPE")) {
    return new AppError("MESSAGE_REFUSED", `The mail server refused the message${code ? ` (${code})` : ""}`, 502, details);
  }
  return new AppError("MAIL_SEND_FAILED", "Could not reach the mail server", 502, { reason: raw.slice(0, 300) });
}

/** An IMAP failure: a refused password is MAIL_AUTH_FAILED, anything else is unreachable. */
function mapImapError(err) {
  if (err instanceof AppError) return err;
  const raw = String((err && (err.responseText || err.message)) || err || "");
  if ((err && err.authenticationFailed) || IMAP_AUTH.test(raw)) {
    return new AppError("MAIL_AUTH_FAILED", "The mail server refused the password", 422, { password: ["Password refused"] });
  }
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(raw) || (err && /ENOTFOUND|EAI_AGAIN/.test(String(err.code)))) {
    return new AppError("MAIL_SERVER_NOT_FOUND", "No mail server answers for that address", 422, { email: ["Mail server not found"] });
  }
  return new AppError("MAIL_SERVER_UNREACHABLE", "Could not reach the mail server", 502, { reason: raw.slice(0, 300) });
}

/** Retry in 30 seconds, 2 minutes, then 8 minutes; never for a permanent refusal. */
function retryPlan(err, attempts, now = Date.now()) {
  const code = (err && err.code) || null;
  if (PERMANENT.has(code) || (err && err.status === 422) || attempts >= 3) return { retryAt: null, code };
  return { retryAt: new Date(now + [30, 120, 480][Math.min(attempts, 2)] * 1000), code };
}

module.exports = { PERMANENT, mapSmtpError, mapImapError, retryPlan };
