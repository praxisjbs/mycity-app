"use strict";
/**
 * Keeps the User Guide's meaning index up to its chapters and the Guide Search model
 * (docs/guides/user-guide.md §6.8, §7): every quarter of an hour, and once at worker boot. A tick
 * with nothing new reads the index's hashes and spends nothing; with AI off or no OpenAI key it
 * does nothing at all.
 */
const { defineSchedule } = require("../registry");

module.exports = defineSchedule({
  name: "user-guide-index",
  every: 15 * 60_000,
  summary: "Indexes the User Guide's passages for search by meaning when a chapter or the model changed",
  run: async () => require("../../modules/user_guide/user_guide.meaning").sync(),
});
