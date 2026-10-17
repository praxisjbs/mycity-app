"use strict";
/**
 * Every five minutes: release scheduled announcements whose time has passed. The safety
 * net behind the delayed announcement-publish job, for a job lost with Redis.
 */
const { defineSchedule } = require("../registry");

module.exports = defineSchedule({
  name: "announcement-release",
  every: 5 * 60 * 1000,
  summary: "Scheduled announcements whose time has passed, released",
  run: () => require("../../modules/announcements/announcements.service").releaseDue(),
});
