"use strict";
/**
 * Praxis AI: asking (docs/guides/praxis-ai.md §3, §6). A question is answered by the engine
 * (services/ai/assistant) outside any transaction, then the question, the answer and its
 * citations are saved in one, with `assistant.answered` on the record. A question that fails is
 * not saved: the screen offers Try Again with the same words.
 *
 * Voice (§6.6): the recording is held in the vault only while it is transcribed, then removed;
 * its document type is transient, so one whose removal never ran goes with the vault's sweep
 * (vault.purgeTransient).
 *
 * A document attached to the question (§6.18) is read once by its kind's reader before the model is
 * asked (assistant.files.js): its reading is the question's read 1, its values laid over the model's
 * card before the ask guard, and it is kept on the answer so later questions in the conversation see
 * it again. A file that cannot be read is answered in one sentence, with no model asked.
 *
 * Progress (§1.2 decision 23): the answer arrives whole, never streamed; while the question runs,
 * each read is announced on the person's realtime room (`ai:progress`) before it runs, best
 * effort, so the screen can say "Reading leave requests" and "Reading 2 of 5". The event carries
 * the question's Idempotency-Key, so a screen showing another conversation ignores it.
 */
const { pool } = require("../../config/db");
const { logger } = require("../../config/logger");
const { atomically } = require("../../shared/db/tx");
const { emit } = require("../../shared/events/emit");
const { AppError } = require("../../shared/errors");
const authorise = require("../../shared/ai/authorise");
const grantsCache = require("../../shared/rbac/grants-cache");
const vault = require("../../shared/documents/vault");
const realtime = require("../../services/realtime/emitter");
const orchestrator = require("../../services/ai/assistant/orchestrator");
const answer = require("../../services/ai/assistant/answer");
const transcription = require("../../services/ai/transcription");
const repo = require("./assistant.repo");
const history = require("./assistant.history");
const suggestions = require("./assistant.suggestions");
const files = require("./assistant.files");
const { EVENTS, VOICE_QUESTION, PROGRESS_EVENT } = require("./assistant.events");

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

/** The words of a read for the progress line ("leave requests", "employees"): its key as words, "list" dropped. */
function readWords(key) {
  const words = String(key || "")
    .split(".")
    .map((s) => s.replace(/_/g, " ").trim())
    .filter((s, i) => s && s !== "list" && s !== "get" && !(i === 0 && s === "file"));
  return words.join(" ") || String(key || "");
}

/**
 * Progress over realtime (decision 23): told before each read, it pushes `ai:progress` to the
 * asking person's room. Best effort: nothing waits on it and a failure changes nothing.
 * @param {object} actor
 * @param {string|null} askKey  the question's Idempotency-Key, which the screen sent and matches on
 */
function progressFor(actor, askKey) {
  return ({ n, key, kind, of }) => {
    try {
      realtime.toUser(actor.user_id, PROGRESS_EVENT, { ask_key: askKey || null, n, of, read_key: key, kind, words: readWords(key) });
    } catch (err) {
      logger.debug({ err, ai_read: key }, "Praxis AI: progress not pushed");
    }
  };
}

/** An answer of words alone, with nothing read: a document that could not be read (§6.18 step 5). */
function plainAnswer(text) {
  const metadata = { table: null, link: null, reads: [], declined: null, more: false, overview: null, ask: null };
  return { content: text, table: null, link: null, citations: [], citations_total: 0, sources: [], reads: [], declined: null, more: false, overview: null, choices: [], rows_read: 0, module_key: null, metadata, stored_citations: [], stored_reads: [] };
}

/**
 * POST /ai/ask.
 * @param {{question: string, ai_conversation_id?: string, context?: object, shows?: string[], attachment?: {document_id: string, kind: string}}} body
 * @param {object} actor  req.user (withActor)
 * @param {string|null} [askKey]  the request's Idempotency-Key, carried on the progress events
 */
async function ask(body, actor, askKey = null) {
  let conversation = null;
  if (body.ai_conversation_id) {
    conversation = await repo.conversationOf(pool, body.ai_conversation_id, actor.user_id);
    if (!conversation) throw new AppError("NOT_FOUND", "Not found", 404);
  }
  const context = body.context || null;
  const shows = Array.isArray(body.shows) ? body.shows : [];
  const past = conversation ? await history.replay(conversation.ai_conversation_id, actor.user_id) : [];
  const onRead = progressFor(actor, askKey);
  // A document attached to this question is read once, before the model is asked (§6.18 steps 1 to 3).
  let attached = null;
  if (body.attachment) {
    onRead({ n: 1, key: `file.${body.attachment.kind}`, kind: "read", of: orchestrator.MAX_READS });
    attached = await files.read(actor, body.attachment);
  }
  const typed = String(body.question || "").trim();
  const question = typed || (attached ? attached.question : "");
  // The conversation's document: this question's, else the newest an earlier question carried (step 6).
  const file = attached ? { ...files.kept(attached), fresh: true } : files.latestOf(past);

  let out = { run_id: null };
  let shown;
  let card = null;
  if (attached && attached.outcome !== "read") {
    // Unreadable, off or out of budget: one sentence, no model asked, nothing more spent (step 5).
    shown = plainAnswer(attached.said);
  } else {
    out = await orchestrator.answer({ db: pool, actor, question, history: past, context, shows, file, onRead });
    // The reader's values over the model's (decision 44), before the ask guard, so a field the file gave is never asked.
    const read = answer.withReading(out.draft, file, { fresh: Boolean(attached), own: !attached || !typed || typed === attached.question });
    // A card the action cannot be drawn without asks for what it lacks first (§1.3 decision 29; every
    // field it needs, decision 34), the screen's own record filling its field, with answers read from
    // the person's own records where the ask reads them (decisions 32 and 34), or the document's own.
    const drafted = (read && read.action && read.action.values) || {};
    const asked = await answer.withOptions(answer.readingChoices(answer.askFirst({ draft: read, actions: out.actions, history: past, shows, context }), file), out.actions, { actor, db: pool, values: drafted });
    shown = answer.build({ draft: asked, reads: out.reads, routes: out.routes, screens: out.screens, shows });
    // The server's own sentences about the document (paid in full, a possible duplicate), one each.
    // Before a question the server asks ("Which request was paid?"), after the model's own words otherwise.
    if (attached && attached.notes.length) shown.content = asked && asked.ask ? `${attached.notes.join(" ")} ${shown.content.trim()}` : `${shown.content.trim()} ${attached.notes.join(" ")}`;
    // The card (§6.11 step 2): only for a screen that draws one, checked against the person's rights now.
    card = shows.includes("cards") ? await answer.draftCard({ draft: asked, actions: out.actions, actor, context, db: pool, file }) : null;
  }
  // The file the question carried, kept for its bubble and for the questions after it (step 6).
  if (attached) shown.metadata = { ...shown.metadata, attachment: files.kept(attached) };

  const saved = await tx(async (client) => {
    // Deleted in another tab meanwhile: the question opens a new conversation.
    let conv = conversation ? await repo.touchConversation(client, conversation.ai_conversation_id, actor.user_id) : null;
    if (!conv) conv = await repo.insertConversation(client, { userId: actor.user_id, title: titleOf(question), openedFrom: context });
    const q = await repo.insertMessage(client, {
      ai_conversation_id: conv.ai_conversation_id,
      role: "user",
      content: question,
      context,
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
      context,
    });
    await repo.insertCitations(
      client,
      a.ai_message_id,
      shown.stored_citations.map((c) => ({ entity_type: c.entity_type, entity_id: c.entity_id, read_key: c.read_key, label: c.label })),
    );
    await repo.insertReads(client, a.ai_message_id, shown.stored_reads);
    let draft = null;
    if (card) {
      draft = await repo.insertDraft(client, { ...card.row, ai_message_id: a.ai_message_id, user_id: actor.user_id });
      await emit(client, {
        key: EVENTS.ASSISTANT_CARD_DRAFTED,
        entity: { type: "ai_action_draft", id: draft.ai_action_draft_id },
        actor,
        payload: { ai_message_id: a.ai_message_id, action_key: card.row.action_key, risk: card.row.risk, suggested: card.row.suggested, records: card.row.records.map((r) => ({ type: r.type, id: r.id })) },
      });
    }
    await emit(client, {
      key: EVENTS.ASSISTANT_ANSWERED,
      entity: { type: "ai_message", id: a.ai_message_id },
      actor,
      payload: {
        ai_conversation_id: conv.ai_conversation_id,
        ai_run_id: out.run_id,
        reads: shown.reads.map((r) => r.key),
        declined: shown.declined,
        card: draft ? draft.action_key : null,
        attachment: attached ? { kind: attached.kind, document_id: attached.document.document_id, outcome: attached.outcome } : null,
      },
    });
    return { a, draft };
  });

  return {
    ai_message_id: saved.a.ai_message_id,
    ai_conversation_id: saved.a.ai_conversation_id,
    question,
    content: shown.content,
    table: shown.table,
    link: shown.link,
    citations: shown.citations,
    citations_total: shown.citations_total,
    sources: shown.sources,
    reads: shown.reads,
    declined: shown.declined,
    more: shown.more,
    card: saved.draft ? cardsService().present(saved.draft, null) : null,
    choices: shown.choices,
    overview: shown.overview,
    context,
    attachment: attached ? { document: attached.document, kind: attached.kind, record: attached.record } : null,
    feedback: null,
    created_at: new Date(saved.a.created_at).toISOString(),
    provisional: true,
  };
}

/** The cards service, required late: it requires this module's events, which require the export, which requires nothing here. */
const cardsService = () => require("./assistant.cards");

/** GET /ai/suggestions. */
async function suggestionsFor(actor) {
  const [reads, summaries, capabilities] = await Promise.all([
    authorise.allowedReads(actor),
    authorise.allowedSummaries(actor),
    grantsCache.getCapabilities(pool, actor.user_id),
  ]);
  return { questions: suggestions.forReads(reads, { capabilities, is_ceo: actor.is_ceo === true }, summaries) };
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
      doc_type: VOICE_QUESTION,
      entity: { type: VOICE_QUESTION, id: actor.user_id },
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
      logger.warn({ err, document_id: doc.document_id }, "Praxis AI: a spoken question's recording was not removed; the vault's sweep will"),
    );
  }
}

/** GET /ai/attachment-kinds. */
const attachmentKinds = (actor) => files.kinds(actor);

module.exports = { ask, suggestionsFor, attachmentKinds, feedback, transcribe, titleOf, readWords, progressFor, plainAnswer };
