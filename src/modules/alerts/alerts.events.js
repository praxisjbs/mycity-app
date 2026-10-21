"use strict";
/**
 * What Home's alert rules record (docs/guides/home.md §3 step 5, §7). Loaded by the API and the
 * worker.
 *
 *   home.alert_rule_created   a rule was created on Home, Alerts
 *   home.alert_rule_updated   a rule was changed or switched on or off; switching it off also
 *                             dismissed its open alerts, each audited as `home.alert_cleared`
 *
 * Both are audit lines; nobody is told. An alert's own events (`home.alert_raised`,
 * `home.alert_cleared`, `home.alert_escalated`) are the shared engine's, declared in
 * shared/events/catalogue.js with their notifications in shared/notifications/fanout.js.
 *
 * Metrics are swept every morning (the `home-alert-sweeps` scheduler). Attendance's alerts are
 * the Attendance policy's breaches, raised by the attendance module after each breach commits
 * (its `attendance.raise_breach_alert` handler, through alerts.service raisePolicyBreach), so
 * Home reads no attendance event of its own.
 */
const { defineEvents } = require("../../shared/events/catalogue");

const EVENTS = defineEvents("home", {
  "home.alert_rule_created": { summary: "An alert rule was created" },
  "home.alert_rule_updated": { summary: "An alert rule was changed" },
});

module.exports = { EVENTS };
