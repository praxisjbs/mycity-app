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
const { uuid, text, money, isoDateTime, listQuery, Paged, PageMeta } = require("./common");

/** Why an answer did not give what was asked (§6.4): a read was refused, or a change was asked for. */
const AiDeclined = z.enum(["not_available", "change"]);

/** Helpful or Not Helpful on an answer. */
const AiFeedbackValue = z.enum(["up", "down"]);

/* ------------------------------------------------------------------ *
 * Asking (§6.1)
 * ------------------------------------------------------------------ */

/**
 * The screen a question is asked from (§1.2 decision 12): the module and tab the full-screen
 * Praxis AI was opened from, the record open there and the address's other values (filters, a
 * search), so "approve these" means that screen's records. Kept on the conversation and the question.
 */
const AiScreenContext = z
  .object({
    module: z.string().regex(/^[a-z][a-z0-9_]*$/),
    tab: z.string().regex(/^[a-z][a-z0-9-]*$/),
    id: uuid.optional(),
    q: z.string().trim().max(200).optional(),
    filters: z.record(z.string().regex(/^[a-z][a-z0-9_]*$/), z.string().max(200)).optional(),
  })
  .strict();

/** What the asking screen can draw: a card (an action to confirm) and the right pane (§6.11, §6.13). */
const AiShows = z.enum(["cards", "pane"]);

/** POST /ai/ask: a question, and after the first, the conversation it continues. */
const AiAsk = z
  .object({
    question: text(500),
    ai_conversation_id: uuid.optional(),
    context: AiScreenContext.optional(),
    /** A screen that cannot draw a card is offered no action; one with no pane gets no overview. */
    shows: z.array(AiShows).max(2).default([]),
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
    /** Which of the answer's reads it was drawn from (1 first): the Table pane pages that read again (§6.12); null on an answer kept before reads were numbered. */
    read: z.number().int().min(1).max(5).nullable().default(null),
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
    /** Which read of the question, 1 first: GET /ai/answers/:id/reads/:n pages it again (§6.12). */
    n: z.number().int().min(1).max(5),
    key: z.string(),
    kind: z.enum(["read", "summary"]),
    module_key: z.string().nullable(),
    /** The parameters it ran with, as the Sources tab shows them. */
    params: z.record(z.string(), z.unknown()),
    outcome: z.enum(["read", "refused", "invalid", "failed"]),
    rows: z.number().int().min(0).max(25),
    total: z.number().int().min(0).nullable(),
    first: z.number().int().min(1).nullable(),
    /** The restricted fields emptied for the person on this read (the field mask), as the Sources tab names them. */
    masked: z.array(z.string().max(64)).max(40).default([]),
  })
  .strict();

/* ------------------------------------------------------------------ *
 * Summaries and the pane (§6.13)
 * ------------------------------------------------------------------ */

const figureValue = z.union([z.string(), z.number()]);

const AiSummaryFigure = z
  .object({
    key: z.string().min(1).max(64),
    label: z.string().trim().min(1).max(60),
    value: figureValue,
    /** `count`, `ngn`, `days`, `minutes`, `percent` or null for a plain number. */
    unit: z.string().max(16).nullable(),
  })
  .strict();

const AiSummaryGroupRow = z
  .object({
    key: z.string().min(1).max(120),
    label: z.string().trim().min(1).max(120),
    value: figureValue,
    count: z.number().int().min(0).nullable(),
  })
  .strict();

/** One grouping of a summary: at most 20 groups (§1.2 decision 14). */
const AiSummaryGroup = z
  .object({
    by: z.string().min(1).max(64),
    label: z.string().trim().min(1).max(60),
    rows: z.array(AiSummaryGroupRow).max(20),
  })
  .strict();

const AiSummaryPoint = z
  .object({
    at: z.string().min(1).max(32),
    value: figureValue,
  })
  .strict();

/** One series of a summary, by day, week or month: at most 60 points. */
const AiSummarySeries = z
  .object({
    key: z.string().min(1).max(64),
    label: z.string().trim().min(1).max(60),
    points: z.array(AiSummaryPoint).max(60),
  })
  .strict();

/**
 * What a summary read returns (§6.13): figures the database computed with the person's scope,
 * never rows. `authorise.runSummary` parses every result with this and refuses rows.
 */
const AiSummaryResult = z
  .object({
    figures: z.array(AiSummaryFigure).max(12),
    groups: z.array(AiSummaryGroup).max(3),
    series: z.array(AiSummarySeries).max(6),
    total: z.number().int().min(0).nullable(),
  })
  .strict();

const AiChartKind = z.enum(["bar", "stacked_bar", "line", "donut"]);

/** A chart the server drew from a summary's own groups or series: labels and up to six series. */
const AiOverviewChart = z
  .object({
    kind: AiChartKind,
    title: z.string().trim().min(1).max(120),
    labels: z.array(z.string()).max(60),
    series: z.array(z.object({ label: z.string().max(60), values: z.array(z.number()).max(60) }).strict()).max(6),
  })
  .strict();

/** The pane's Overview (§6.13): the summary it rests on, up to three figures and one chart. */
const AiOverview = z
  .object({
    summary: z.string(),
    title: z.string().max(120).nullable(),
    figures: z.array(AiSummaryFigure).max(3),
    chart: AiOverviewChart.nullable(),
  })
  .strict();

/* ------------------------------------------------------------------ *
 * Actions and cards (§6.11)
 * ------------------------------------------------------------------ */

/** An action's risk class (§1.2 decision 11): the four sensitive ones need Confirm It's You. */
const AiRisk = z.enum(["standard", "approval", "money", "payroll", "delete"]);

/** How a card is confirmed: one press, or a fresh sign-in within the last five minutes first. */
const AiConfirm = z.enum(["press", "fresh_sign_in"]);

const AiCardStatus = z.enum(["shown", "confirmed", "done", "failed", "cancelled", "expired"]);

/** A record a card touches, named and linked when shown. */
const AiCardRecord = z
  .object({
    type: z.string(),
    id: z.string(),
    label: z.string(),
    link: z.string().nullable(),
  })
  .strict();

/** One field of a card, as the action's schema takes it; the screen draws it with the form system. */
const AiCardField = z
  .object({
    name: z.string().min(1).max(64),
    label: z.string().min(1).max(60),
    kind: z.enum(["text", "number", "boolean", "date", "datetime", "money", "choice", "list", "id", "other"]),
    required: z.boolean(),
    options: z.array(z.string()).max(50).nullable(),
  })
  .strict();

/** What happened to one record when a card was pressed. */
const AiActionLine = z
  .object({
    type: z.string(),
    id: z.string().nullable(),
    label: z.string(),
    ok: z.boolean(),
    message: z.string().nullable(),
    link: z.string().nullable(),
  })
  .strict();

/** POST /ai/cards/:id/confirm's answer: the run, done or failed, with a line per record. */
const AiActionResult = z
  .object({
    ai_action_run_id: uuid,
    status: z.enum(["done", "failed"]),
    lines: z.array(AiActionLine).max(25),
    error_code: z.string().nullable(),
    message: z.string().nullable(),
    finished_at: isoDateTime,
  })
  .strict();

/**
 * A card: an action the model drafted and the person may confirm (§6.11). Nothing has happened
 * until its status is `done`. Always the asking person's own.
 */
const AiActionCard = z
  .object({
    ai_action_draft_id: uuid,
    ai_message_id: uuid,
    action_key: z.string(),
    module_key: z.string(),
    label: z.string(),
    description: z.string(),
    /** The input schema's name in packages/contract ("tasks.TaskCreate"): the screen validates with it. */
    schema: z.string(),
    risk: AiRisk,
    confirm: AiConfirm,
    bulk: z.number().int().min(1).max(25),
    values: z.record(z.string(), z.unknown()),
    /** Problems the person must fix, by field, as the form system shows them. */
    problems: z.record(z.string(), z.array(z.string())),
    records: z.array(AiCardRecord).max(25),
    fields: z.array(AiCardField).max(40),
    suggested: z.boolean(),
    status: AiCardStatus,
    expires_at: isoDateTime,
    result: AiActionResult.nullable(),
    created_at: isoDateTime,
  })
  .strict();

/** PUT /ai/cards/:id: the person's edits to a card's values. */
const AiActionEdit = z
  .object({
    values: z.record(z.string(), z.unknown()),
  })
  .strict();

/** POST /ai/cards/:id/confirm: the press, with the values as edited on screen when they were. */
const AiActionConfirm = z
  .object({
    values: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

/** GET /ai/answers/:id/reads/:n: the answer and which of its reads (1 to 5). */
const AiReadParams = z
  .object({
    id: uuid,
    n: z.coerce.number().int().min(1).max(5),
  })
  .strict();

/**
 * GET /ai/answers/:id/reads/:n (§6.12): read `n` of an answer run again with its stored parameters
 * and the person's rights now, 25 a page, as the Table shows it.
 */
const AiReadRows = z
  .object({
    n: z.number().int().min(1).max(5),
    key: z.string(),
    label: z.string(),
    columns: z.array(z.string()).max(12),
    rows: z.array(z.array(z.string())).max(25),
    numeric: z.array(z.number().int().min(0)),
    links: z.array(z.string().nullable()).max(25),
    page: PageMeta,
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
    /** The action drafted for the person to confirm (§6.11); null when none was, or the screen shows no cards. */
    card: AiActionCard.nullable(),
    /** The pane's Overview (§6.13); null without a summary, or when the screen shows no pane. */
    overview: AiOverview.nullable(),
    /** The screen the question was asked from (§1.2 decision 12). */
    context: AiScreenContext.nullable(),
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
    /**
     * One of the actions offered this turn, with its values (§6.11); `suggested` when the person did
     * not ask for a change and the model offers one (§1.2 decision 20). The server validates every
     * value against the action's schema and re-checks the person's rights before a card is shown.
     */
    action: z
      .object({
        key: z.string().max(80),
        values: z.record(z.string(), z.unknown()),
        suggested: z.boolean().default(false),
      })
      .strict()
      .nullable()
      .default(null),
    /**
     * The Overview the pane draws (§6.13): which of this turn's summaries (by key), up to three of its
     * figures by key, and one chart over one of its groups (`group`) or series (`series`).
     */
    overview: z
      .object({
        summary: z.string().max(80),
        figures: z.array(z.string().max(64)).max(3).default([]),
        chart: z
          .object({
            kind: AiChartKind,
            title: z.string().trim().min(1).max(120),
            group: z.string().max(64).nullable().default(null),
            series: z.array(z.string().max(64)).max(6).nullable().default(null),
          })
          .strict()
          .nullable()
          .default(null),
      })
      .strict()
      .nullable()
      .default(null),
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
    virtual: {
      question: "becomes the content of the question message",
      shows: "what the asking screen can draw (cards, the pane); decides what is offered, never stored",
    },
  },
  AiCitation: {
    table: "ai_message_citation",
    virtual: { link: "worked out from shared/route-map when shown, never stored" },
  },
  AiAnswerTable: { table: null, reason: "an answer's table, kept in ai_message.metadata" },
  AiSource: { table: null, reason: "an answer's citations grouped by record type, worked out when shown" },
  AiAnswerLink: { table: null, reason: "an answer's screen button, kept in ai_message.metadata" },
  AiReadMade: {
    table: "ai_message_read",
    virtual: {
      key: "ai_message_read.read_key",
      first: "where the page's rows start in the whole list, worked out from page and rows",
    },
  },
  AiScreenContext: { table: null, reason: "the screen a question was asked from, kept in ai_message.context and ai_conversation.opened_from" },
  AiSummaryFigure: { table: null, reason: "a figure a summary read computed; never stored" },
  AiSummaryGroupRow: { table: null, reason: "one group of a summary read; never stored" },
  AiSummaryGroup: { table: null, reason: "a grouping of a summary read; never stored" },
  AiSummaryPoint: { table: null, reason: "a point of a summary's series; never stored" },
  AiSummarySeries: { table: null, reason: "a series of a summary read; never stored" },
  AiSummaryResult: { table: null, reason: "what a summary read returns: figures, never rows" },
  AiOverviewChart: { table: null, reason: "a chart drawn from a summary, kept in ai_message.metadata" },
  AiOverview: { table: null, reason: "the pane's Overview, kept in ai_message.metadata" },
  AiCardRecord: { table: null, reason: "a record a card touches, kept in ai_action_draft.records" },
  AiCardField: { table: null, reason: "a card's field as the action's schema takes it, from the schema itself" },
  AiActionLine: { table: null, reason: "one record's outcome of a press, kept in ai_action_run.result" },
  AiActionResult: {
    table: "ai_action_run",
    virtual: {
      lines: "ai_action_run.result, one line per record",
      message: "the error's words, kept beside error_code in ai_action_run.result",
    },
  },
  AiActionCard: {
    table: "ai_action_draft",
    virtual: {
      label: "the action's label, from its manifest",
      description: "the action's description, from its manifest",
      schema: "the input schema's name in packages/contract, from the manifest",
      confirm: "worked out from risk (the four sensitive classes need a fresh sign-in)",
      bulk: "the action's record limit, from its manifest",
      fields: "the input schema's fields, from the schema itself",
      result: "the card's ai_action_run, when it was pressed",
    },
  },
  AiActionEdit: { table: "ai_action_draft" },
  AiActionConfirm: { table: "ai_action_draft" },
  AiReadParams: { table: null, reason: "path parameters: the answer and which of its reads" },
  AiReadRows: { table: null, reason: "a page of a read run again for the Table, from the records" },
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
      card: "the answer's ai_action_draft, when it drew one",
      overview: "from ai_message.metadata",
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
  AiScreenContext,
  AiShows,
  AiAsk,
  AiCitation,
  AiAnswerTable,
  AiSource,
  AiAnswerLink,
  AiReadMade,
  AiSummaryFigure,
  AiSummaryGroupRow,
  AiSummaryGroup,
  AiSummaryPoint,
  AiSummarySeries,
  AiSummaryResult,
  AiChartKind,
  AiOverviewChart,
  AiOverview,
  AiRisk,
  AiConfirm,
  AiCardStatus,
  AiCardRecord,
  AiCardField,
  AiActionLine,
  AiActionResult,
  AiActionCard,
  AiActionEdit,
  AiActionConfirm,
  AiReadParams,
  AiReadRows,
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
