"use strict";
/**
 * ⌘K for Praxis AI: the caller's own conversations, by their title (the first question). `owner`
 * pins every query to the caller, so no grant, the CEO's included, finds anyone else's questions
 * (docs/guides/praxis-ai.md §9). A result opens the conversation on Ask.
 */
const { recordProvider } = require("../../shared/search/provider");

module.exports = recordProvider({
  type: "ai_conversation",
  module: "praxis_ai",
  label: "Conversations",
  words: ["conversation", "question", "chat", "asked"],
  from: "ai_conversation c",
  key: "c.ai_conversation_id",
  columns: ["c.title"],
  select: "c.ai_conversation_id AS id, c.title AS title, NULL::text AS sub",
  owner: { column: "c.user_id" },
  order: "c.last_asked_at DESC NULLS LAST",
});
