"use strict";
/**
 * Praxis AI (docs/guides/praxis-ai.md): questions answered from the modules' reads with the
 * asking person's own grant, scope and field masking. Served by the `assistant` module under
 * /api/v1/ai, behind the `praxis_ai` permission.
 *
 *   conversation   one thread of questions, always the asker's own (ai_conversation)
 *   message        a question (role `user`) or its answer (role `assistant`, its parent the
 *                  question), with the run that produced it (ai_message)
 *   citation       a record an answer was read from, worked out from the rows the reads
 *                  returned, never from the answer's words (ai_message_citation)
 *
 * An answer is provisional: its words are the model's; a table's cells are the records' (§6.4).
 */
const { z } = require("zod");
const { uuid, text, isoDateTime, listQuery, Paged } = require("./common");

/** Why an answer did not give what was asked (§6.4): a read was refused, or a change was asked for. */
const AiDeclined = z.enum(["not_available", "change"]);

/** Helpful or Not Helpful on an answer. */
const AiFeedbackValue = z.enum(["up", "down"]);

/* ------------------------------------------------------------------ *
 * Asking (§6.1)
 * ------------------------------------------------------------------ */

/** POST /ai/ask: a question, and after the first, the conversation it continues. */
const AiAsk = z
  .object({
    question: text(500),
    ai_conversation_id: uuid.optional(),
  })
  .strict();

/** A record an answer was read from; `link` is worked out from the route map when shown. */
const AiCitation = z
  .object({
    entity_type: z.string(),
    entity_id: z.string(),
    label: z.string(),
    link: z.string().nullable(),
    read_key: z.string(),
  })
  .strict();

/** An answer's table: drawn by the server from one read's rows (§6.4), formatted for a person. */
const AiAnswerTable = z
  .object({
    columns: z.array(z.string()).min(1).max(6),
    rows: z.array(z.array(z.string())).max(25),
    /** Columns to right-align: amounts and counts. */
    numeric: z.array(z.number().int().min(0)),
  })
  .strict();

/** The screen where the person makes a change Praxis AI will not make (A23). */
const AiAnswerLink = z
  .object({
    label: z.string(),
    path: z.string(),
  })
  .strict();

/** A read an answer made: which, how many rows it returned and how many there are in all. */
const AiReadMade = z
  .object({
    key: z.string(),
    rows: z.number().int().min(0).max(25),
    total: z.number().int().min(0).nullable(),
  })
  .strict();

/** One answer, with the question it answers. */
const AiAnswer = z
  .object({
    ai_message_id: uuid,
    ai_conversation_id: uuid,
    question: z.string(),
    content: z.string(),
    table: AiAnswerTable.nullable(),
    link: AiAnswerLink.nullable(),
    citations: z.array(AiCitation).max(50),
    citations_total: z.number().int().min(0),
    reads: z.array(AiReadMade).max(5),
    declined: AiDeclined.nullable(),
    /** A read had another page: Show Next 25 asks for it. */
    more: z.boolean(),
    feedback: AiFeedbackValue.nullable(),
    created_at: isoDateTime,
    provisional: z.literal(true),
  })
  .strict();

/**
 * What the model returns as its answer (§6.4); the server turns it into AiAnswer. Never sent
 * over HTTP: it is the output schema of the assistant's last round.
 */
const AiAnswerDraft = z
  .object({
    text: z.string().trim().min(1).max(4000),
    /** Which of this question's reads (1 for the first) and which of its row's fields to show. */
    table: z
      .object({
        read: z.number().int().min(1).max(5),
        fields: z.array(z.string().min(1).max(64)).min(1).max(6),
        labels: z.array(z.string().trim().min(1).max(40)).min(1).max(6),
      })
      .strict()
      .nullable(),
    /** One of the routes offered this turn, by its intent; null when no change was asked for. */
    route: z.string().max(200).nullable(),
    /** Values for the route's prefill, checked against its schema before they reach the link. */
    prefill: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).nullable(),
    /** A read had another page worth offering. */
    more: z.boolean(),
  })
  .strict();

/** GET /ai/suggestions: up to six questions this person's reads can answer (§6.8). */
const AiSuggestions = z
  .object({
    questions: z.array(z.string()).max(6),
  })
  .strict();

/* ------------------------------------------------------------------ *
 * Conversations and history (§6.5)
 * ------------------------------------------------------------------ */

/** One conversation in History and on Ask's Recent. */
const AiConversation = z
  .object({
    ai_conversation_id: uuid,
    title: z.string().nullable(),
    last_asked_at: isoDateTime.nullable(),
    questions: z.number().int().min(0),
    rows_read: z.number().int().min(0),
  })
  .strict();

/** GET /ai/conversations: newest first unless sorted; `q` searches titles. */
const AiConversationListQuery = listQuery({}, ["last_asked_at", "title"]);
const AiConversationPage = Paged(AiConversation);

/** GET /ai/conversations/:id/turns: the answers, newest page first. */
const AiTurnListQuery = listQuery();
const AiTurnPage = Paged(AiAnswer);

/** GET /ai/history/summary: this Lagos month, the person's own. */
const AiHistorySummary = z
  .object({
    month: z.string().regex(/^\d{4}-\d{2}$/),
    questions_this_month: z.number().int().min(0),
    conversations: z.number().int().min(0),
    rows_read_this_month: z.number().int().min(0),
    by_module: z
      .array(
        z
          .object({
            module_key: z.string().nullable(),
            label: z.string(),
            questions: z.number().int().min(0),
          })
          .strict(),
      )
      .max(25),
  })
  .strict();

/** POST /ai/answers/:id/feedback: Helpful, Not Helpful, or neither again. */
const AiFeedback = z
  .object({
    feedback: AiFeedbackValue.nullable(),
  })
  .strict();

/* ------------------------------------------------------------------ *
 * Voice (§6.6)
 * ------------------------------------------------------------------ */

/** POST /ai/transcribe: a recording just uploaded through the upload engine. */
const AiTranscribe = z
  .object({
    document_id: uuid,
  })
  .strict();

/** The words, and whether they are the browser's captions rather than a model's. */
const AiTranscript = z
  .object({
    text: z.string(),
    draft: z.boolean(),
  })
  .strict();

/** Gate 6 (check/contract-columns.js). */
const TABLES = {
  AiAsk: {
    table: "ai_message",
    virtual: { question: "becomes the content of the question message" },
  },
  AiCitation: {
    table: "ai_message_citation",
    virtual: { link: "worked out from shared/route-map when shown, never stored" },
  },
  AiAnswerTable: { table: null, reason: "an answer's table, kept in ai_message.metadata" },
  AiAnswerLink: { table: null, reason: "an answer's screen button, kept in ai_message.metadata" },
  AiReadMade: { table: null, reason: "a read an answer made, kept in ai_message.metadata" },
  AiAnswer: {
    table: "ai_message",
    virtual: {
      question: "the content of the question message, the answer's parent",
      table: "from ai_message.metadata",
      link: "from ai_message.metadata",
      citations: "the answer's ai_message_citation rows, the first 50",
      citations_total: "how many ai_message_citation rows the answer has",
      reads: "from ai_message.metadata",
      declined: "from ai_message.metadata",
      more: "from ai_message.metadata",
      provisional: "every answer is provisional (BACKEND_STRUCTURE §14.2)",
    },
  },
  AiAnswerDraft: { table: null, reason: "the model's answer before the server checks it; never on the wire" },
  AiSuggestions: { table: null, reason: "example questions for the reads the person may run, from code" },
  AiConversation: {
    table: "ai_conversation",
    virtual: { rows_read: "the sum of its answers' ai_message.rows_read" },
  },
  AiConversationListQuery: { table: null, reason: "list controls" },
  AiConversationPage: { table: null, reason: "a page of the caller's conversations" },
  AiTurnListQuery: { table: null, reason: "list controls" },
  AiTurnPage: { table: null, reason: "a page of a conversation's answers" },
  AiHistorySummary: { table: null, reason: "counts over the caller's ai_conversation and ai_message rows this Lagos month" },
  AiFeedback: { table: "ai_message" },
  AiTranscribe: { table: null, reason: "a recording in the vault, by its document" },
  AiTranscript: { table: null, reason: "the words of a recording, not kept" },
};

module.exports = {
  TABLES,
  AiDeclined,
  AiFeedbackValue,
  AiAsk,
  AiCitation,
  AiAnswerTable,
  AiAnswerLink,
  AiReadMade,
  AiAnswer,
  AiAnswerDraft,
  AiSuggestions,
  AiConversation,
  AiConversationListQuery,
  AiConversationPage,
  AiTurnListQuery,
  AiTurnPage,
  AiHistorySummary,
  AiFeedback,
  AiTranscribe,
  AiTranscript,
};
