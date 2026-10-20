"use strict";
/**
 * Settings · System Health, every five minutes: group what the error reporter wrote,
 * tell the IT team about a fault that is new, back or spiking, take a snapshot of every
 * readiness check, and escalate a fault that has sat open for a day.
 *
 * Five minutes is the pace the screen's chart is drawn at and the pace a check going
 * down is noticed at. Safe to run again: every step of the roll-up is idempotent
 * (system_health.rollup.js).
 */
const { defineSchedule } = require("../registry");

module.exports = defineSchedule({
  name: "system-health",
  every: 5 * 60 * 1000,
  summary: "Groups faults, snapshots the readiness checks, and escalates what nobody has touched",
  run: () => require("../../modules/system_health/system_health.rollup").rollup(),
});
