"use strict";
/**
 * Praxis AI · History (docs/guides/praxis-ai.md §6.5): the person's own conversations, questions
 * and answers, History's figures (the company's for a person who holds AI Control, §1.1 decision 7),
 * and the two ways to remove the words (one conversation, or all of them). The runs stay, holding
 * no words, so the spend and the caps are untouched.
 */
const { pool } = require("../../config/db");
const { atomically } = require("../../shared/db/tx");
const { emit } = require("../../shared/events/emit");
const { AppError } = require("../../shared/errors");
const catalog = require("../../shared/access/access.catalog");
const routeMap = require("../../shared/route-map");
const lagos = require("../../shared/time/lagos");
const idempotency = require("../../middleware/idempotency");
const { scopeFor } = require("../../middleware/rbac");
const governance = require("../../services/ai/governance");
const { presentTable } = require("../../services/ai/assistant/answer");
const { sourcesOf, typeLabel } = require("../../shared/ai/cite");
const money = require("../../shared/money/money");
const repo = require("./assistant.repo");
const cards = require("./assistant.cards");
const { EVENTS } = require("./assistant.events");

/** The route whose replies the idempotency layer keeps for a repeated press. */
const ASK = Object.freeze({ method: "POST", path: "/api/v1/ai/ask" });

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

const iso = (v) => (v ? new Date(v).toISOString() : null);

/** A citation as an answer shows it: its link worked out now, never stored. */
function citationOf(c) {
  const link = routeMap.linkFor(c.entity_type, c.entity_id);
  return { entity_type: c.entity_type, entity_id: String(c.entity_id), label: c.label, link: link ? link.path : null, read_key: c.read_key || "" };
}

/**
 * An answer as the screen shows it (AiAnswer), from its row, its first citations and its citations
 * by record type (repo.sourceGroups).
 * @param {object} row  repo.turns / repo.answerOf
 * @param {object[]} citations
 * @param {Array<{entity_type: string, count: number}>} groups
 */
/** A read as the wire carries it (AiReadMade), from what was kept; an answer kept before §6.12 lacks the newer fields. */
function readMade(r, i) {
  return {
    n: r.n || i + 1,
    key: r.key,
    kind: r.kind === "summary" ? "summary" : "read",
    module_key: r.module_key === undefined ? null : r.module_key,
    params: r.params && typeof r.params === "object" ? r.params : {},
    outcome: r.outcome || (r.total === null && !r.rows ? "refused" : "read"),
    rows: r.rows || 0,
    total: r.total === undefined ? null : r.total,
    first: r.first || null,
    masked: Array.isArray(r.masked) ? r.masked : [],
  };
}

/**
 * @param {object} row  repo.turns / repo.answerOf
 * @param {object[]} citations
 * @param {Array<{entity_type: string, count: number}>} groups
 * @param {{draft?: object|null, run?: object|null}} [card]  the answer's card and its newest press
 */
function present(row, citations = [], groups = [], card = {}) {
  const md = row.metadata || {};
  const shown = citations.map(citationOf);
  return {
    ai_message_id: row.ai_message_id,
    ai_conversation_id: row.ai_conversation_id,
    question: row.question || "",
    content: row.content,
    table: presentTable(md.table || null),
    link: md.link || null,
    citations: shown,
    citations_total: Number(row.citations_total) || 0,
    sources: sourcesOf(groups, shown.length === 1 ? shown[0] : null),
    reads: (md.reads || []).map(readMade),
    declined: md.declined || null,
    more: Boolean(md.more),
    card: card && card.draft ? cards.present(card.draft, card.run || null) : null,
    overview: md.overview || null,
    context: row.context || null,
    feedback: row.feedback || null,
    created_at: iso(row.created_at),
    provisional: true,
  };
}

/** GET /ai/conversations. */
async function conversations(query, actor) {
  const page = await repo.conversations(pool, actor.user_id, query);
  return {
    ...page,
    data: page.data.map((r) => ({
      ai_conversation_id: r.ai_conversation_id,
      title: r.title,
      last_asked_at: iso(r.last_asked_at),
      questions: r.questions,
      rows_read: r.rows_read,
    })),
  };
}

/** GET /ai/conversations/:id/turns: newest page first. Someone else's conversation reads as missing. */
async function turns(id, query, actor) {
  if (!(await repo.conversationOf(pool, id, actor.user_id))) throw new AppError("NOT_FOUND", "Not found", 404);
  const page = await repo.turns(pool, id, actor.user_id, query);
  const ids = page.data.map((r) => r.ai_message_id);
  const [cites, groups, drafts] = await Promise.all([repo.citationsOf(pool, ids), repo.sourceGroups(pool, ids), repo.draftsOfMessages(pool, ids)]);
  const runs = await repo.latestRunsOf(pool, [...drafts.values()].map((d) => d.ai_action_draft_id));
  return {
    ...page,
    data: page.data.map((r) => {
      const draft = drafts.get(r.ai_message_id) || null;
      return present(r, cites.get(r.ai_message_id) || [], groups.get(r.ai_message_id) || [], { draft, run: draft ? runs.get(draft.ai_action_draft_id) || null : null });
    }),
  };
}

/**
 * The turns the model is reminded of, oldest first: the newest page's last ten (orchestrator's
 * HISTORY_TURNS), with the reads each made, so "show the next 25" knows which read to page.
 */
async function replay(id, userId, limit = 10) {
  const page = await repo.turns(pool, id, userId, { page: 1 });
  return page.data
    .slice(0, limit)
    .reverse()
    .map((r) => ({ question: r.question || "", answer: r.content, reads: (r.metadata && r.metadata.reads) || [] }));
}

/** DELETE /ai/conversations/:id. */
async function deleteConversation(id, actor) {
  await tx(async (client) => {
    const gone = await repo.deleteConversation(client, id, actor.user_id);
    if (!gone) throw new AppError("NOT_FOUND", "Not found", 404);
    // The replies kept for a repeated press hold the answers' words too (§6.5).
    await idempotency.forget(client, { userId: actor.user_id, ...ASK, field: "ai_conversation_id", value: id });
    await emit(client, {
      key: EVENTS.ASSISTANT_CONVERSATION_DELETED,
      entity: { type: "ai_conversation", id },
      actor,
      payload: { questions: gone.questions },
    });
  });
}

/** DELETE /ai/history: every conversation of the caller. */
async function clearHistory(actor) {
  await tx(async (client) => {
    const removed = await repo.clearHistory(client, actor.user_id);
    await idempotency.forget(client, { userId: actor.user_id, ...ASK });
    if (!removed) return;
    await emit(client, {
      key: EVENTS.ASSISTANT_HISTORY_CLEARED,
      entity: { type: "app_user", id: actor.user_id },
      actor,
      payload: { conversations: removed },
    });
  });
}

/** How many Lagos months Spend per Month covers, this one included. */
const SPEND_MONTHS = 6;

/**
 * GET /ai/history/summary (§6.5). A person who holds AI Control `view` sees the company's figures
 * (decision 7 as amended): everyone's questions, Praxis AI's spend, the cap. Everyone else sees
 * their own, with all their questions beside this month's.
 */
async function summary(actor, now = new Date()) {
  const company = Boolean(await scopeFor(actor, "ai_control", "view"));
  const { first } = lagos.monthBounds(lagos.today(now));
  const months = Array.from({ length: SPEND_MONTHS }, (_, i) => lagos.addMonths(first, i - SPEND_MONTHS + 1));
  const f = await repo.summaryFigures(pool, {
    userId: actor.user_id,
    company,
    from: lagos.instant(first),
    to: lagos.instant(lagos.addMonths(first, 1)),
    since: lagos.instant(months[0]),
  });
  const spent = new Map(f.spend.map((r) => [r.month, r.spend]));
  const byMonth = months.map((m) => ({ month: m.slice(0, 7), spend_ngn: money.toWire(spent.get(m.slice(0, 7)) || "0") }));
  const labels = new Map(catalog.MODULE_CATALOG.map((m) => [m.key, m.label]));
  return {
    month: first.slice(0, 7),
    view: company ? "company" : "own",
    questions_this_month: company ? f.company_month : f.own_month,
    your_questions: company ? f.own_month : f.own_all,
    spend_ngn: byMonth[byMonth.length - 1].spend_ngn,
    cap_ngn: company ? (await governance.settings(pool)).monthly_cap_ngn : null,
    spend_by_month: byMonth,
    by_module: f.by_module.slice(0, 25).map((r) => ({
      module_key: r.module_key,
      label: r.module_key ? labels.get(r.module_key) || r.module_key : "Other",
      questions: r.questions,
    })),
  };
}

/** GET /ai/history/questions: the caller's questions, each with its sources, tokens and cost. */
async function questions(query, actor) {
  const page = await repo.questions(pool, actor.user_id, query);
  const groups = await repo.sourceGroups(pool, page.data.map((r) => r.ai_message_id));
  return {
    ...page,
    data: page.data.map((r) => ({
      ai_message_id: r.ai_message_id,
      ai_conversation_id: r.ai_conversation_id,
      question: r.question || "",
      asked_at: iso(r.asked_at),
      sources: (groups.get(r.ai_message_id) || []).map((g) => typeLabel(g.entity_type)),
      tokens: r.tokens,
      cost_ngn: money.toWire(r.cost_ngn),
    })),
  };
}

module.exports = { present, citationOf, conversations, turns, questions, replay, deleteConversation, clearHistory, summary, SPEND_MONTHS };
