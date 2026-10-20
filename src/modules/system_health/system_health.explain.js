"use strict";
/**
 * What a fault probably means, in one sentence somebody who is not an engineer can act
 * on. Matched from the message first, because the message says far more than the
 * severity does, then from where it happened.
 *
 * It is a hint, never a diagnosis: the sentence shows on the fault sheet and goes into
 * the brief as "In plain words", where it gives the AI a starting hypothesis to confirm
 * or throw away. A fault no rule matches gets the severity's sentence, never an empty
 * line.
 */

/** Message patterns, most specific first. */
const RULES = [
  [/duplicate key value|unique constraint/i,
    "The database refused a second copy of something that must be unique. Usually two presses, or a number allocated twice."],
  [/violates foreign key constraint/i,
    "A record pointed at another record that is not there, often one deleted while this was in flight."],
  [/violates not-null constraint/i,
    "A column that must have a value was written empty. The code let something through that the table refuses."],
  [/column .* does not exist|relation .* does not exist/i,
    "The code asked for a column or table that is not there: almost always a migration that has not run on this server."],
  [/deadlock detected/i,
    "Two writes waited on each other and Postgres stopped one. It usually succeeds on a retry; frequent deadlocks mean two paths lock in different orders."],
  [/could not serialize access|serialization failure/i,
    "Two transactions changed the same rows at once. The loser is retried; if this is frequent the transaction is holding too much."],
  [/connection terminated|ECONNREFUSED|ETIMEDOUT|connection refused/i,
    "Something the app depends on did not answer: the database, Redis, the mail server or an outside service."],
  [/too many connections|remaining connection slots/i,
    "The database ran out of connections. Something is holding them open, or the pool is too large for the server."],
  [/timeout|timed out/i,
    "A step took longer than it is allowed. Find what it was waiting on before changing the limit."],
  [/permission denied|EACCES/i,
    "The server would not let the app read or write something. Check the folder the media or logs live in."],
  [/ENOSPC|no space left/i,
    "The disk is full. Nothing can be uploaded or written until space is freed."],
  [/JavaScript heap out of memory|ERR_WORKER_OUT_OF_MEMORY/i,
    "The process ran out of memory, usually a list or a file loaded whole instead of in pages."],
  [/Cannot read propert(y|ies) of (undefined|null)|is not a function|is not defined/i,
    "The code used something that was not there, often because a lookup found nothing and the code did not check."],
  [/Invalid time value|Invalid Date/i,
    "A date could not be read. Check what the wire sent against the ISO date the contract asks for."],
  [/ZodError|Check the highlighted fields/i,
    "What was sent did not match the contract. If people are hitting this, the screen is letting them send it."],
  [/SMTP|Mail command failed|getaddrinfo.*smtp/i,
    "An email could not be handed to the mail server."],
  [/push service|WebPushError|VAPID/i,
    "A notification could not be handed to the phone's push service."],
  [/chromium|puppeteer/i,
    "A PDF could not be drawn. Chromium is missing, or it ran out of memory."],
  [/clamd|ClamAV/i,
    "An upload could not be scanned, so it was not accepted."],
];

/** By severity, when nothing in the message matches. */
const BY_SEVERITY = {
  fatal: "The request stopped dead. The person saw an error instead of what they asked for.",
  error: "Something failed, and what the person was doing may not have happened.",
  warning: "Something unexpected happened and the request carried on. Worth a look if it is frequent.",
  notice: "A form was filled in a way the contract refuses. Counted so form trouble can be seen; it never alerts.",
};

/**
 * @param {{severity: string, origin: string, name: string, title: string, last_message?: string|null}} group
 * @returns {string}
 */
function explain(group) {
  const text = `${group.name || ""} ${group.title || ""} ${group.last_message || ""}`;
  for (const [pattern, sentence] of RULES) if (pattern.test(text)) return sentence;
  if (group.origin === "worker" || group.origin === "job")
    return "A background job failed. Whoever it was for may not have got what they should: mail, a PDF or a notification.";
  return BY_SEVERITY[group.severity] || BY_SEVERITY.error;
}

module.exports = { explain, RULES, BY_SEVERITY };
