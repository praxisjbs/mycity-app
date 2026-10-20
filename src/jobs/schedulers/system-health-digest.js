"use strict";
/**
 * The System Health summary, at 08:00 Lagos: what is open, what is new, what came back,
 * and what nobody has touched. It goes to whoever holds System Health, on the bell and
 * their phones, whether or not there is anything wrong: a morning with nothing to do is
 * worth knowing too, and a digest that only arrives on bad days is one people learn to
 * dread rather than read.
 */
const { defineSchedule } = require("../registry");

module.exports = defineSchedule({
  name: "system-health-digest",
  pattern: "0 8 * * *",
  summary: "The daily System Health summary at 08:00",
  run: () => require("../../modules/system_health/system_health.rollup").digest(),
});
