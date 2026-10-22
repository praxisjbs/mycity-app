"use strict";
/**
 * A spoken question to Praxis AI is held in the vault only while it is transcribed, then removed
 * in the same request (docs/guides/praxis-ai.md §6.6). Every hour at twenty-five past, any
 * recording an hour old is removed: one whose request never finished.
 */
const { defineSchedule } = require("../registry");

module.exports = defineSchedule({
  name: "assistant-voice-sweep",
  pattern: "25 * * * *",
  summary: "Removes spoken questions to Praxis AI whose request never finished",
  run: () => require("../../modules/assistant/assistant.service").purgeRecordings(),
});
