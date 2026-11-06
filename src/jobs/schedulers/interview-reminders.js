"use strict";
/**
 * The daily reminder to a panelist whose card is not in (docs/guides/recruitment.md §3 step 9, §7):
 * once a day from the interview's end, while its round is open. The notice names the application and
 * the role, never the candidate.
 */
const { defineSchedule } = require("../registry");

module.exports = defineSchedule({
  name: "interview-reminders",
  pattern: "17 9 * * *",
  summary: "Reminds panelists whose interview cards are not submitted",
  run: async () => require("../../modules/interviews/interviews.reminders").remind(),
});
