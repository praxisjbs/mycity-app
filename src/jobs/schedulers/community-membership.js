"use strict";
/**
 * Every hour: every active login in #general and #announcements (docs/guides/community.md
 * §3 step 1). A new login joins at once through app_user.created; this catches any login
 * made another way, and everyone who existed before that handler did.
 */
const { defineSchedule } = require("../registry");

module.exports = defineSchedule({
  name: "community-membership",
  pattern: "7 * * * *",
  summary: "Every active login added to #general and #announcements",
  run: () => require("../../modules/community/community.service").joinEveryone(),
});
