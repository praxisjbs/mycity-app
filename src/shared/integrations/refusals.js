"use strict";
/**
 * The addresses the mail server refused for good (docs/guides/integrations.md §6.16): a
 * mailbox that does not exist, a domain that takes no mail. System mail writes them as it
 * sends; the System Sender lists them on Settings · Integrations (Refused Addresses).
 *
 *   await refusals.record({ emails: ["ada@gheil.com"], template: "digest", smtp_code: 550, reply });
 *   await refusals.accepted(["ada@gmail.com"]);    // mail to it went through: off the list
 *
 * Telemetry, like integration_usage: no event, no audit row, and best effort, so a send never
 * fails because its bookkeeping did. One row per address: a refusal again counts and moves
 * its time. The nightly purge deletes a row untouched for 30 days.
 */
const { logger } = require("../../config/logger");

const pool = () => require("../../config/db").pool;

/** Undefined table: 9230 has not run here yet. */
const notMigrated = (err) => err && (err.code === "42P01" || err.code === "42703");

/**
 * Keep each refused address, counting it again when it is already listed.
 * @param {{emails: string[], template: string, smtp_code?: number|null, reply?: string|null}} refusal
 * @param {{db?: {query: Function}}} [opts]
 */
async function record({ emails, template, smtp_code = null, reply = null }, { db = pool() } = {}) {
  const list = [...new Set((emails || []).map((e) => String(e).trim().toLowerCase()).filter(Boolean))];
  if (list.length === 0) return;
  try {
    await db.query(
      `INSERT INTO mail_refusal (email, template, smtp_code, reply)
       SELECT unnest($1::citext[]), $2, $3, $4
       ON CONFLICT (email) DO UPDATE SET
         template = EXCLUDED.template,
         smtp_code = EXCLUDED.smtp_code,
         reply = EXCLUDED.reply,
         refusals = mail_refusal.refusals + 1,
         last_refused_at = now()`,
      [list, String(template || "unknown").slice(0, 100), smtp_code, reply ? String(reply).slice(0, 300) : null],
    );
  } catch (err) {
    if (!notMigrated(err)) logger.warn({ err }, "a refused address was not recorded");
  }
}

/**
 * Mail to these addresses was accepted: they leave the list.
 * @param {string[]} emails
 * @param {{db?: {query: Function}}} [opts]
 */
async function accepted(emails, { db = pool() } = {}) {
  const list = (emails || []).map(String).filter(Boolean);
  if (list.length === 0) return;
  try {
    await db.query("DELETE FROM mail_refusal WHERE email = ANY($1::citext[])", [list]);
  } catch (err) {
    if (!notMigrated(err)) logger.warn({ err }, "an accepted address was not taken off the refused list");
  }
}

module.exports = { record, accepted };
