"use strict";
/**
 * Reading the metrics for the switched-on rules and raising what breaches (docs/guides/home.md
 * §3 step 5, §7):
 *
 *   sweep()            every morning at 06:00 Lagos (the `home-alert-sweeps` scheduler): every
 *                      switched-on rule, every subject its metric finds at or past the threshold.
 *                      The rules the system keeps for the Attendance policy are never read here:
 *                      attendance raises their alerts as each breach commits (home.md §6)
 *
 * A rule's metric is read a batch at a time (alerts.metrics.js), and each breach is raised in a
 * transaction of its own through the shared engine, which raises a new alert, refreshes the
 * open one or leaves one a person already closed for the same evidence. Nothing here clears an
 * alert: a person does (home.md §6). A rule whose metric the registry does not know (one kept
 * from before it) is skipped.
 *
 * The sweep carries on past a rule it cannot read or a breach it cannot raise, logs it and
 * counts it, as the workflow timeout sweep does: tomorrow's run is the retry.
 */
const { pool } = require("../../config/db");
const { logger } = require("../../config/logger");
const { atomically } = require("../../shared/db/tx");
const alerts = require("../../shared/alerts/alerts");
const lagos = require("../../shared/time/lagos");
const metrics = require("./alerts.metrics");
const repo = require("./alerts.repo");

/** Raise one reading for a rule, in its own transaction. */
async function raiseOne(db, rule, metric, reading) {
  const client = await db.connect();
  try {
    return await atomically(client, () => alerts.raise(client, { ...reading, rule, kind: metric.kind }));
  } finally {
    client.release();
  }
}

/**
 * Read one rule's metric on a Lagos day, batch by batch, and raise each breach.
 * @param {import("pg").Pool} db
 * @param {object} rule  a switched-on home_alert_rule row
 * @param {{today: string}} opts
 * @param {{raised: number, refreshed: number, failed: number}} tally  added to
 */
async function runRule(db, rule, { today }, tally) {
  const metric = metrics.metricOf(rule.metric);
  let after = null;
  do {
    const { readings, next } = await metric.evaluate(db, rule, { today, after });
    for (const reading of readings) {
      try {
        const out = await raiseOne(db, rule, metric, reading);
        if (out.created) tally.raised += 1;
        else if (out.raised) tally.refreshed += 1;
      } catch (err) {
        tally.failed += 1;
        logger.error({ err, rule: rule.key, subject: reading.subject }, "an alert could not be raised");
      }
    }
    after = next;
  } while (after);
}

/**
 * The daily sweep: every switched-on rule on today's Lagos date.
 * @param {{now?: Date, db?: import("pg").Pool}} [opts]
 * @returns {Promise<{rules: number, raised: number, refreshed: number, skipped: number, failed: number}>}
 *   raised: new alerts; refreshed: open ones seen again; skipped: rules on a metric the registry
 *   lacks; failed: rules that could not be read, and breaches that could not be raised
 */
async function sweep({ now = new Date(), db = pool } = {}) {
  const today = lagos.today(now);
  const rules = await repo.enabledRules(db);
  const tally = { rules: rules.length, raised: 0, refreshed: 0, skipped: 0, failed: 0 };
  for (const rule of rules) {
    if (!metrics.metricOf(rule.metric)) {
      tally.skipped += 1;
      logger.warn({ rule: rule.key, metric: rule.metric }, "an alert rule watches a metric the registry does not have");
      continue;
    }
    try {
      await runRule(db, rule, { today }, tally);
    } catch (err) {
      tally.failed += 1;
      logger.error({ err, rule: rule.key }, "an alert rule could not be read");
    }
  }
  return tally;
}

module.exports = { sweep };
