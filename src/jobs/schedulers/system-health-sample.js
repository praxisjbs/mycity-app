"use strict";
/**
 * Settings · Performance, every minute: read the whole server (processor, memory, disk,
 * disk activity, network and each service's share), ask the API on loopback whether it is
 * ready, and write one perf_sample row (docs/guides/system-health.md §6, §7).
 *
 * A minute is the pace the Hour window is drawn at and the unit availability is counted
 * in. Safe to run again: a minute already written is left as it is.
 */
const { defineSchedule } = require("../registry");

module.exports = defineSchedule({
  name: "system-health-sample",
  every: 60 * 1000,
  summary: "Samples the server's processor, memory, disk and network, and whether the API answers",
  run: () => require("../../modules/system_health/system_health.sample").sample(),
});
