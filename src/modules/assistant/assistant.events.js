"use strict";
/**
 * What Praxis AI records (docs/guides/praxis-ai.md §7). Every event is audit only and names no
 * words: the question and the answer stay in the person's own History, never on the Audit Log.
 * Nobody is told anything.
 *
 * A spoken question is held in the vault only until its words come back (§6.6), under its own
 * document type and record type, and only the person who spoke it may read it: History is one's
 * own whatever the grant (§1.1 decision 7), the CEO's included.
 */
const { defineEvents } = require("../../shared/events/catalogue");
const { defineDocumentType } = require("../../shared/documents/types");
const vault = require("../../shared/documents/vault");

/** The document type and the record type a spoken question is stored under (its id: the speaker's login). */
const VOICE_QUESTION = "ai_voice_question";
/** History's Export (§6.5): the person's questions as a workbook, read by the person who asked. */
const HISTORY_EXPORT = "ai_history_export";
/**
 * Progress over realtime (§1.2 decision 23): pushed to the asking person's room before each read
 * of a question runs, with the question's Idempotency-Key, which read it is of the five and its
 * words. Not an outbox event: nothing is recorded, and a lost push changes nothing.
 */
const PROGRESS_EVENT = "ai:progress";

const EVENTS = defineEvents("praxis_ai", {
  "assistant.answered": { summary: "A question to the assistant was answered, from the reads named" },
  "assistant.conversation_deleted": { summary: "A person deleted one of their conversations with the assistant" },
  "assistant.history_cleared": { summary: "A person cleared their history with the assistant" },
  "assistant.feedback_given": { summary: "A person marked an answer of the assistant Helpful or Not Helpful" },
  "assistant.export_requested": { summary: "A person asked for their questions to the assistant as a workbook" },
  // Cards (docs/guides/praxis-ai.md §6.11, §7): the card, how it was confirmed and the result; never the words.
  "assistant.card_drafted": { summary: "An answer of the assistant drew an action card for the person to confirm" },
  "assistant.action_confirmed": { summary: "A person pressed an assistant's card and its action ran with their rights" },
  "assistant.action_failed": { summary: "A person pressed an assistant's card and its action refused or failed" },
  "assistant.card_cancelled": { summary: "A person declined an assistant's card" },
});

/** A spoken question (praxis-ai.md §6.6): kept only while it is transcribed, never played. */
defineDocumentType(VOICE_QUESTION, {
  label: "Voice question",
  module: "praxis_ai",
  sensitivity: "personal",
  transient: true,
});

vault.defineAccess(VOICE_QUESTION, async (_client, user, doc) => doc.entity_id === user.user_id);

defineDocumentType(HISTORY_EXPORT, {
  label: "Praxis AI history export",
  module: "praxis_ai",
  sensitivity: "personal",
  export: true,
});

module.exports = { EVENTS, VOICE_QUESTION, HISTORY_EXPORT, PROGRESS_EVENT };

// History's Export, registered with the worker's outbox here because the worker loads each module's
// events file (src/worker.js).
require("./assistant.export");
