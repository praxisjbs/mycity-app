"use strict";
/**
 * What Home's alert rules record, and the signals that re-read a rule between sweeps
 * (docs/guides/home.md §3 step 5, §7). Loaded by the API and the worker.
 *
 *   home.alert_rule_created   a rule was created on Home, Alerts
 *   home.alert_rule_updated   a rule was changed or switched on or off; switching it off also
 *                             dismissed its open alerts, each audited as `home.alert_cleared`
 *
 * Both are audit lines; nobody is told. An alert's own events (`home.alert_raised`,
 * `home.alert_cleared`, `home.alert_escalated`) are the shared engine's, declared in
 * shared/events/catalogue.js with their notifications in shared/notifications/fanout.js.
 *
 * SIGNALS. Time-based metrics are swept every morning (the `home-alert-sweeps` scheduler).
 * Two attendance events re-read one person's attendance rules at once instead:
 *
 *   attendance.punched      a clock-in may make today late: late arrivals
 *   attendance.day_closed   the day-close closed a day, late or with no clock-out: late
 *                           arrivals and missing clock-outs
 *
 * Each handler reads the switched-on rules of its metrics for the person on the event and
 * raises, refreshes or leaves their alerts through the same evaluation as the sweep. Running
 * one twice changes nothing: an open alert is refreshed, never doubled, and one a person has
 * closed is not raised again for the same evidence.
 */
const { defineEvents } = require("../../shared/events/catalogue");
const outbox = require("../../shared/events/outbox");

const EVENTS = defineEvents("home", {
  "home.alert_rule_created": { summary: "An alert rule was created" },
  "home.alert_rule_updated": { summary: "An alert rule was changed" },
});

/**
 * The events Home reads alerts on, as their owning modules declare them (a test holds each
 * spelling and module to the catalogue), and the metrics each re-reads for its person.
 */
const SIGNALS = Object.freeze({
  "attendance.punched": Object.freeze({ module: "people", metrics: Object.freeze(["late_arrivals"]) }),
  "attendance.day_closed": Object.freeze({
    module: "people",
    metrics: Object.freeze(["late_arrivals", "missing_clock_out"]),
  }),
});

/** The handler's name, stable across deploys: renaming it would run every pending row again. */
const SIGNAL_HANDLER = "alerts.person-signal";

/**
 * The sweep is required when the handler runs, not when this file loads: the service
 * requires this file for its event keys, and the worker loads this file on its own.
 */
function onSignal(key) {
  const { metrics } = SIGNALS[key];
  return (event) => {
    const employeeId = event.payload && event.payload.employee_id;
    if (!employeeId) return undefined;
    if (key === "attendance.punched" && event.payload.event_type !== "clock_in") return undefined;
    return require("./alerts.sweeps").evaluatePerson(employeeId, metrics);
  };
}

for (const key of Object.keys(SIGNALS)) outbox.register(key, SIGNAL_HANDLER, onSignal(key));

module.exports = { EVENTS, SIGNALS, SIGNAL_HANDLER, onSignal };
