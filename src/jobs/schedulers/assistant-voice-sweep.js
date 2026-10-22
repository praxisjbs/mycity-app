"use strict";
/**
 * A spoken question to Praxis AI is held in the vault only while it is transcribed, then removed
 * in the same request (docs/guides/praxis-ai.md §6.6). Every quarter of an hour, any recording
 * half an hour old is removed: one whose request never finished, gone within 45 minutes.
 */
const { defineSchedule } = require("../registry");

module.exports = defineSchedule({
  name: "assistant-voice-sweep",
  pattern: "*/15 * * * *",
  summary: "Removes spoken questions to the assistant whose request never finished",
  run: () => require("../../modules/assistant/assistant.service").purgeRecordings(),
});
