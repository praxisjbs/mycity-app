"use strict";
/**
 * Praxis AI · History (docs/guides/praxis-ai.md §6.5): the person's own conversations and their
 * answers, this month's counts, and the two ways to remove the words (one conversation, or all
 * of them). The runs stay, holding no words, so the spend and the caps are untouched.
 */
const { pool } = require("../../config/db");
const { atomically } = require("../../shared/db/tx");
const { emit } = require("../../shared/events/emit");
const { AppError } = require("../../shared/errors");
const catalog = require("../../shared/access/access.catalog");
const routeMap = require("../../shared/route-map");
const lagos = require("../../shared/time/lagos");
const idempotency = require("../../middleware/idempotency");
const repo = require("./assistant.repo");
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
 * An answer as the screen shows it (AiAnswer), from its row and its first citations.
 * @param {object} row  repo.turns / repo.answerOf
 * @param {object[]} citations
 */
function present(row, citations = []) {
  const md = row.metadata || {};
  return {
    ai_message_id: row.ai_message_id,
    ai_conversation_id: row.ai_conversation_id,
    question: row.question || "",
    content: row.content,
    table: md.table || null,
    link: md.link || null,
    citations: citations.map(citationOf),
    citations_total: Number(row.citations_total) || 0,
    reads: (md.reads || []).map((r) => ({ key: r.key, rows: r.rows, total: r.total === undefined ? null : r.total, page: r.page || null })),
    declined: md.declined || null,
    more: Boolean(md.more),
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
  const cites = await repo.citationsOf(pool, page.data.map((r) => r.ai_message_id));
  return { ...page, data: page.data.map((r) => present(r, cites.get(r.ai_message_id) || [])) };
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

/** GET /ai/history/summary: this Lagos month, the caller's own. */
async function summary(actor, now = new Date()) {
  const today = lagos.today(now);
  const { first } = lagos.monthBounds(today);
  const from = lagos.instant(first);
  const to = lagos.instant(lagos.addMonths(first, 1));
  const s = await repo.summary(pool, actor.user_id, from, to);
  const labels = new Map(catalog.MODULE_CATALOG.map((m) => [m.key, m.label]));
  return {
    month: first.slice(0, 7),
    questions_this_month: s.questions,
    conversations: s.conversations,
    rows_read_this_month: s.rows_read,
    by_module: s.by_module.slice(0, 25).map((r) => ({
      module_key: r.module_key,
      label: r.module_key ? labels.get(r.module_key) || r.module_key : "Other",
      questions: r.questions,
    })),
  };
}

module.exports = { present, citationOf, conversations, turns, replay, deleteConversation, clearHistory, summary };
