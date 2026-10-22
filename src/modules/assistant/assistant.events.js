"use strict";
/**
 * What Praxis AI records (docs/guides/praxis-ai.md §7). Every event is audit only and names no
 * words: the question and the answer stay in the person's own History, never on the Audit Log.
 * Nobody is told anything.
 *
 * A spoken question is held in the vault only until its words come back (§6.6), under its own
 * document type, read by the praxis_ai grant.
 */
const { defineEvents } = require("../../shared/events/catalogue");
const { defineDocumentType } = require("../../shared/documents/types");

const EVENTS = defineEvents("praxis_ai", {
  "assistant.answered": { summary: "A question to Praxis AI was answered, from the reads named" },
  "assistant.conversation_deleted": { summary: "A person deleted one of their Praxis AI conversations" },
  "assistant.history_cleared": { summary: "A person cleared their Praxis AI history" },
  "assistant.feedback_given": { summary: "A person marked a Praxis AI answer Helpful or Not Helpful" },
});

defineDocumentType("ai_voice_question", {
  label: "Voice question",
  module: "praxis_ai",
  sensitivity: "personal",
});

module.exports = { EVENTS };
