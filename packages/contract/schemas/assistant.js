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
const { uuid, text, money, isoDateTime, listQuery, Paged } = require("./common");

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
    /** Each row's record, as a path worked out when shown; null where a row has no screen. */
    links: z.array(z.string().nullable()).max(25),
  })
  .strict();

/**
 * What an answer's From shows (§1.1 decision 9): a kind of record and how many of it were read,
 * or, when the answer rests on one record, that record, named and linked.
 */
const AiSource = z
  .object({
    kind: z.enum(["type", "record"]),
    entity_type: z.string(),
    label: z.string(),
    count: z.number().int().min(1),
    link: z.string().nullable(),
  })
  .strict();

/** The screen where the person makes a change Praxis AI will not make (A23). */
const AiAnswerLink = z
  .object({
    label: z.string(),
    path: z.string(),
  })
  .strict();

/**
 * A read an answer made: which, how many rows it returned, how many there are in all, and where
 * its rows start in the whole list (26 for page 2; null for a read of one record, or one that
 * returned nothing), so the screen can say Showing 26 to 50 of 312 without a page size of its own.
 */
const AiReadMade = z
  .object({
    key: z.string(),
    rows: z.number().int().min(0).max(25),
    total: z.number().int().min(0).nullable(),
    first: z.number().int().min(1).nullable(),
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
    /** From: the kinds of record read, or the one record (§6.4). */
    sources: z.array(AiSource).max(25),
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

const month = z.string().regex(/^\d{4}-\d{2}$/);

/**
 * GET /ai/history/summary (§6.5). `company` for a person who holds AI Control `view`: questions
 * this month are everyone's, spend is Praxis AI's, the cap is AI Control's; `your_questions` is the
 * person's own this month. `own` for everyone else: every figure is the person's, `your_questions`
 * counts all their questions, and there is no cap.
 */
const AiHistorySummary = z
  .object({
    month,
    view: z.enum(["company", "own"]),
    questions_this_month: z.number().int().min(0),
    your_questions: z.number().int().min(0),
    spend_ngn: money,
    cap_ngn: money.nullable(),
    /** The last six Lagos months, oldest first, this one last. */
    spend_by_month: z
      .array(z.object({ month, spend_ngn: money }).strict())
      .max(6),
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

/** One of the person's questions on History: its answer, what it was read from, and what it cost. */
const AiQuestion = z
  .object({
    /** The answer's message: the row History keeps per question. */
    ai_message_id: uuid,
    ai_conversation_id: uuid,
    question: z.string(),
    asked_at: isoDateTime,
    /** The kinds of record its answer was read from, as From names them. */
    sources: z.array(z.string()).max(25),
    tokens: z.number().int().min(0),
    cost_ngn: money,
  })
  .strict();

/** GET /ai/history/questions: newest first unless sorted; `q` searches the questions. */
const AiQuestionListQuery = listQuery({}, ["asked_at"]);
const AiQuestionPage = Paged(AiQuestion);

/** POST /ai/answers/:id/feedback: Helpful, Not Helpful, or neither again. */
const AiFeedback = z
  .object({
    feedback: AiFeedbackValue.nullable(),
  })
  .strict();

/* ------------------------------------------------------------------ *
 * Voice (§6.6)
 * ------------------------------------------------------------------ */

/**
 * POST /ai/transcribe takes the recording itself, through the upload engine (multipart, body
 * `documents.DocumentUpload`); it is kept only until its words come back. This is the answer:
 * the recording's id (already removed; the upload engine resolves on a document id, as an import's
 * batch does), the words, and whether they are a placeholder rather than a model's.
 */
const AiTranscript = z
  .object({
    document_id: uuid,
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
  AiSource: { table: null, reason: "an answer's citations grouped by record type, worked out when shown" },
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
      sources: "the answer's ai_message_citation rows grouped by entity_type",
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
  AiHistorySummary: { table: null, reason: "counts over ai_message and ai_run rows, and spend over ai_run_step, by Lagos month" },
  AiQuestion: {
    table: "ai_message",
    virtual: {
      question: "the content of the question message, the answer's parent",
      asked_at: "the answer's created_at",
      sources: "the entity_type of the answer's ai_message_citation rows",
      tokens: "the sum of input_tokens and output_tokens over the answer's ai_run_step rows",
      cost_ngn: "the answer's ai_run_step rows priced as governance.STEP_NGN prices them",
    },
  },
  AiQuestionListQuery: { table: null, reason: "list controls" },
  AiQuestionPage: { table: null, reason: "a page of the caller's questions" },
  AiFeedback: { table: "ai_message" },
  AiTranscript: { table: null, reason: "the words of a recording, not kept" },
};

module.exports = {
  TABLES,
  AiDeclined,
  AiFeedbackValue,
  AiAsk,
  AiCitation,
  AiAnswerTable,
  AiSource,
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
  AiQuestion,
  AiQuestionListQuery,
  AiQuestionPage,
  AiFeedback,
  AiTranscript,
};
