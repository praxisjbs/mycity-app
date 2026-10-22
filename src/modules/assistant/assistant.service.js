"use strict";
/**
 * Praxis AI: asking (docs/guides/praxis-ai.md §3, §6). A question is answered by the engine
 * (services/ai/assistant) outside any transaction, then the question, the answer and its
 * citations are saved in one, with `assistant.answered` on the record. A question that fails is
 * not saved: the screen offers Try Again with the same words.
 *
 * Voice (§6.6): the recording is held in the vault only while it is transcribed, then removed;
 * one whose removal never ran is swept within the hour (purgeRecordings, the assistant-voice-sweep
 * scheduler).
 */
const { pool } = require("../../config/db");
const { logger } = require("../../config/logger");
const { atomically } = require("../../shared/db/tx");
const { emit } = require("../../shared/events/emit");
const { AppError } = require("../../shared/errors");
const authorise = require("../../shared/ai/authorise");
const grantsCache = require("../../shared/rbac/grants-cache");
const vault = require("../../shared/documents/vault");
const orchestrator = require("../../services/ai/assistant/orchestrator");
const answer = require("../../services/ai/assistant/answer");
const transcription = require("../../services/ai/transcription");
const repo = require("./assistant.repo");
const history = require("./assistant.history");
const suggestions = require("./assistant.suggestions");
const { EVENTS } = require("./assistant.events");

/** A recording older than this was left behind by a request that never finished. */
const RECORDING_KEPT_MINUTES = 60;

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

/** A conversation's title: its first question, cut at 120 characters on a word. */
function titleOf(question) {
  const q = String(question).replace(/\s+/g, " ").trim();
  if (q.length <= 120) return q;
  const cut = q.slice(0, 120);
  const space = cut.lastIndexOf(" ");
  return (space > 60 ? cut.slice(0, space) : cut).trim();
}

/**
 * POST /ai/ask.
 * @param {{question: string, ai_conversation_id?: string}} body
 * @param {object} actor  req.user (withActor)
 */
async function ask(body, actor) {
  let conversation = null;
  if (body.ai_conversation_id) {
    conversation = await repo.conversationOf(pool, body.ai_conversation_id, actor.user_id);
    if (!conversation) throw new AppError("NOT_FOUND", "Not found", 404);
  }
  const past = conversation ? await history.replay(conversation.ai_conversation_id, actor.user_id) : [];
  const out = await orchestrator.answer({ db: pool, actor, question: body.question, history: past });
  const shown = answer.build({ draft: out.draft, reads: out.reads, routes: out.routes, screens: out.screens });

  const saved = await tx(async (client) => {
    // Deleted in another tab meanwhile: the question opens a new conversation.
    let conv = conversation ? await repo.touchConversation(client, conversation.ai_conversation_id, actor.user_id) : null;
    if (!conv) conv = await repo.insertConversation(client, { userId: actor.user_id, title: titleOf(body.question) });
    const q = await repo.insertMessage(client, {
      ai_conversation_id: conv.ai_conversation_id,
      role: "user",
      content: body.question,
    });
    const a = await repo.insertMessage(client, {
      ai_conversation_id: conv.ai_conversation_id,
      parent_message_id: q.ai_message_id,
      role: "assistant",
      content: shown.content,
      ai_run_id: out.run_id,
      rows_read: shown.rows_read,
      module_key: shown.module_key,
      metadata: shown.metadata,
    });
    await repo.insertCitations(
      client,
      a.ai_message_id,
      shown.stored_citations.map((c) => ({ entity_type: c.entity_type, entity_id: c.entity_id, read_key: c.read_key, label: c.label })),
    );
    await emit(client, {
      key: EVENTS.ASSISTANT_ANSWERED,
      entity: { type: "ai_message", id: a.ai_message_id },
      actor,
      payload: {
        ai_conversation_id: conv.ai_conversation_id,
        ai_run_id: out.run_id,
        reads: shown.reads.map((r) => r.key),
        declined: shown.declined,
      },
    });
    return a;
  });

  return {
    ai_message_id: saved.ai_message_id,
    ai_conversation_id: saved.ai_conversation_id,
    question: body.question,
    content: shown.content,
    table: shown.table,
    link: shown.link,
    citations: shown.citations,
    citations_total: shown.citations_total,
    reads: shown.reads,
    declined: shown.declined,
    more: shown.more,
    feedback: null,
    created_at: new Date(saved.created_at).toISOString(),
    provisional: true,
  };
}

/** GET /ai/suggestions. */
async function suggestionsFor(actor) {
  const [reads, capabilities] = await Promise.all([authorise.allowedReads(actor), grantsCache.getCapabilities(pool, actor.user_id)]);
  return { questions: suggestions.forReads(reads, { capabilities, is_ceo: actor.is_ceo === true }) };
}

/** POST /ai/answers/:id/feedback: Helpful, Not Helpful, or neither again. */
async function feedback(messageId, body, actor) {
  await tx(async (client) => {
    const row = await repo.setFeedback(client, messageId, actor.user_id, body.feedback);
    if (!row) throw new AppError("NOT_FOUND", "Not found", 404);
    await emit(client, {
      key: EVENTS.ASSISTANT_FEEDBACK_GIVEN,
      entity: { type: "ai_message", id: messageId },
      actor,
      payload: { feedback: body.feedback },
    });
  });
}

/** Remove one recording: its row in the transaction, its bytes after commit. */
async function removeRecording(documentId, actor) {
  const keys = await tx((client) => vault.remove(client, documentId, { actor, reason: "a spoken question's words were read" }));
  if (keys) await vault.removeFiles(keys);
}

/**
 * POST /ai/transcribe: a spoken question to words, on the Voice Question action's chain (Groq's
 * Whisper, then Gemini, AI Control). The recording is removed whatever happens.
 * @param {{buffer: Buffer, originalname: string}} file  readUpload(req)
 * @param {object} actor
 */
async function transcribe(file, actor) {
  const doc = await tx((client) =>
    vault.store(client, {
      file,
      purpose: "voice_note",
      doc_type: "ai_voice_question",
      entity: { type: "app_user", id: actor.user_id },
      transient: true,
      actor,
    }),
  );
  try {
    const t = await transcription.transcribe({
      document_id: doc.document_id,
      module: "praxis_ai",
      purpose: "praxis-ai-voice",
      actor,
      db: pool,
    });
    return { document_id: doc.document_id, text: t.text, draft: t.draft };
  } finally {
    await removeRecording(doc.document_id, actor).catch((err) =>
      logger.warn({ err, document_id: doc.document_id }, "Praxis AI: a spoken question's recording was not removed; the sweep will"),
    );
  }
}

/** The assistant-voice-sweep scheduler: recordings left by a request that never finished. */
async function purgeRecordings() {
  let removed = 0;
  for (const id of await repo.staleRecordings(pool, RECORDING_KEPT_MINUTES)) {
    await removeRecording(id, null);
    removed += 1;
  }
  return { removed };
}

module.exports = { ask, suggestionsFor, feedback, transcribe, purgeRecordings, titleOf, RECORDING_KEPT_MINUTES };
