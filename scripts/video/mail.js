"use strict";
/**
 * The mail a person was sent, as a scene shows it (docs/runbooks/training-videos.md §4.5): filming
 * runs with no mail server, so nothing leaves the machine, but each message the app sent is still
 * its `email-send` job, with its template and data. This finds the newest one to an address and
 * renders it with the app's own template, so the email on screen, and any link in it (an
 * assessment's, an invitation's), is the one the worker sent. Nothing is made up.
 */
const { guard } = require("./people");

/** The newest `email-send` job to `email` (and of `template`, and whose data `match` accepts, when given), or null. */
async function lastTo(email, template, match) {
  const { config } = require("../../src/config/env");
  guard(config);
  const { Queue } = require("bullmq");
  const { initRedis, REDIS_PREFIX } = require("../../src/config/redis");
  const queue = new Queue("email-send", { connection: await initRedis(), prefix: REDIS_PREFIX });
  try {
    const jobs = await queue.getJobs(["completed", "active", "waiting", "delayed", "failed"], 0, 2000);
    const to = (j) => [].concat(j.data && j.data.to).map((t) => String((t && t.email) || t || "").toLowerCase());
    const mine = jobs.filter((j) => j && to(j).includes(email.toLowerCase()) && (!template || j.data.template === template) && (!match || match(j.data.data || {})));
    mine.sort((a, b) => b.timestamp - a.timestamp);
    return mine[0] ? mine[0].data : null;
  } finally {
    await queue.close();
  }
}

/** Each module's events file declares its emails' variables; load them all, as the worker does. */
let loaded = false;
function declare() {
  if (loaded) return;
  const fs = require("node:fs");
  const path = require("node:path");
  const root = path.join(__dirname, "../../src/modules");
  for (const name of fs.readdirSync(root)) {
    const file = path.join(root, name, `${name}.events.js`);
    if (fs.existsSync(file)) require(file);
  }
  loaded = true;
}

/**
 * Wait up to `seconds` for a message to `email`, then render it: { template, subject, html, data }.
 * `match(data)` picks one of several of a kind (one assessment's invitation of two).
 */
async function message(email, template, { seconds = 30, match } = {}) {
  const { pool } = require("../../src/config/db");
  const { renderEmail } = require("../../src/services/mail/system-mail.service");
  declare();
  const until = Date.now() + seconds * 1000;
  let job = await lastTo(email, template, match);
  while (!job && Date.now() < until) {
    await new Promise((r) => setTimeout(r, 1000));
    job = await lastTo(email, template, match);
  }
  if (!job) throw new Error(`No ${template || "mail"} to ${email} in the queue: was it sent on this database?`);
  const rendered = await renderEmail(pool, job.template, job.data || {}, { recipient: job.recipient || null });
  return { template: job.template, subject: rendered.subject, html: rendered.html, data: job.data };
}

/**
 * The newest email to `email` the mail catcher kept (scripts/video/mail-catcher.js), newer than
 * `after` (milliseconds since the epoch), waiting up to `seconds`: { subject, html }. For the mail
 * whose job is dropped once sent: an invitation and a password reset.
 */
async function caught(email, { after = 0, seconds = 30, subject } = {}) {
  const fs = require("node:fs");
  const path = require("node:path");
  const dir = process.env.VIDEO_MAIL_CAUGHT;
  if (!dir) throw new Error("Set VIDEO_MAIL_CAUGHT, and preload scripts/video/mail-catcher.js into the worker (runbook §4.5).");
  const to = (m) => [].concat(m.to || []).map((t) => String((t && t.address) || t || "").toLowerCase());
  const until = Date.now() + seconds * 1000;
  for (;;) {
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => Number(f.split("-")[0]) > after).sort().reverse() : [];
    for (const f of files) {
      const m = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
      if (to(m).includes(email.toLowerCase()) && (!subject || subject.test(m.subject || ""))) return { subject: m.subject, html: m.html };
    }
    if (Date.now() > until) throw new Error(`No mail to ${email} was caught: is the worker running with the mail catcher?`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

/** The first link in a message that starts with `origin` (go.mycityapp.io's, for a candidate). */
function linkIn(html, origin) {
  const found = String(html).match(new RegExp(`href="(${origin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^"]+)"`));
  return found ? found[1].replace(/&amp;/g, "&") : null;
}

module.exports = { lastTo, message, caught, linkIn };
