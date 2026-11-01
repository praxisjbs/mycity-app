"use strict";
/**
 * Praxis AI's SQL (docs/guides/praxis-ai.md §4). Reads and writes ai_conversation, ai_message,
 * ai_message_citation, ai_message_read (each read of an answer, §6.12), ai_action_draft and
 * ai_action_run (a card and its press, §6.11); nothing else writes them. Every query of words is
 * pinned to the asking person's own user_id: History is theirs whatever their grant's scope
 * (§1.1 decision 7). The company's figures (summaryFigures with no user) are counts and naira
 * only, never a question.
 */
const { pageQuery, orderBy, TOTAL_COL } = require("../../shared/http/paged");
const { STEP_NGN } = require("../../services/ai/governance");

/** Praxis AI's two actions (services/ai/actions.js): a question, and a spoken question's words. */
const PRAXIS_ACTIONS = Object.freeze(["data-answers", "praxis-ai-voice"]);

const one = async (db, sql, params) => (await db.query(sql, params)).rows[0] || null;

const CONVERSATION = "c.ai_conversation_id, c.title, c.last_asked_at, c.questions";

/** The caller's conversation, or null: someone else's reads as missing. */
function conversationOf(db, id, userId) {
  return one(db, `SELECT ${CONVERSATION} FROM ai_conversation c WHERE c.ai_conversation_id = $1 AND c.user_id = $2`, [id, userId]);
}

function insertConversation(client, { userId, title, openedFrom = null }) {
  return one(
    client,
    `INSERT INTO ai_conversation (user_id, title, last_asked_at, questions, opened_from) VALUES ($1, $2, now(), 1, $3::jsonb)
     RETURNING ai_conversation_id, title, last_asked_at, questions`,
    [userId, title, openedFrom ? JSON.stringify(openedFrom) : null],
  );
}

/** One more question asked in it; null when it is gone (deleted in another tab). */
function touchConversation(client, id, userId) {
  return one(
    client,
    `UPDATE ai_conversation SET last_asked_at = now(), questions = questions + 1
      WHERE ai_conversation_id = $1 AND user_id = $2
     RETURNING ai_conversation_id, title, last_asked_at, questions`,
    [id, userId],
  );
}

function insertMessage(client, m) {
  return one(
    client,
    `INSERT INTO ai_message (ai_conversation_id, parent_message_id, role, content, ai_run_id, rows_read, module_key, metadata, context)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb)
     RETURNING ai_message_id, ai_conversation_id, parent_message_id, role, content, ai_run_id, rows_read, module_key,
               metadata, context, feedback, created_at`,
    [
      m.ai_conversation_id,
      m.parent_message_id || null,
      m.role,
      m.content,
      m.ai_run_id || null,
      m.rows_read || 0,
      m.module_key || null,
      JSON.stringify(m.metadata || {}),
      m.context ? JSON.stringify(m.context) : null,
    ],
  );
}

/** An answer's citations, keeping the order they were read in. */
async function insertCitations(client, messageId, citations) {
  if (!citations.length) return;
  await client.query(
    `INSERT INTO ai_message_citation (ai_message_id, entity_type, entity_id, read_key, label, position)
     SELECT $1, x.entity_type, x.entity_id, x.read_key, x.label, x.position
       FROM jsonb_to_recordset($2::jsonb) AS x(entity_type text, entity_id text, read_key text, label text, position int)`,
    [messageId, JSON.stringify(citations.map((c, i) => ({ ...c, position: i + 1 })))],
  );
}

/** Each read of an answer, with the parameters it ran with (§6.12), in the order they were made. */
async function insertReads(client, messageId, reads) {
  if (!reads.length) return;
  await client.query(
    `INSERT INTO ai_message_read (ai_message_id, n, read_key, kind, module_key, params, page, rows, total, outcome, masked)
     SELECT $1, x.n, x.key, x.kind, x.module_key, COALESCE(x.params, '{}'::jsonb), x.page, x.rows, x.total, x.outcome, COALESCE(x.masked, '{}'::text[])
       FROM jsonb_to_recordset($2::jsonb) AS x(n int, key text, kind text, module_key text, params jsonb, page int, rows int, total int, outcome text, masked text[])`,
    [messageId, JSON.stringify(reads.map((r) => ({ n: r.n, key: r.key, kind: r.kind, module_key: r.module_key, params: r.params || {}, page: r.first ? Math.floor((r.first - 1) / 25) + 1 : null, rows: r.rows, total: r.total, outcome: r.outcome, masked: r.masked || [] })))],
  );
}

/** One read of the caller's answer, or null. */
function readOf(db, messageId, n, userId) {
  return one(
    db,
    `SELECT r.ai_message_read_id, r.ai_message_id, r.n, r.read_key, r.kind, r.module_key, r.params, r.page, r.rows, r.total, r.outcome, r.masked
       FROM ai_message_read r
       JOIN ai_message a ON a.ai_message_id = r.ai_message_id
       JOIN ai_conversation c ON c.ai_conversation_id = a.ai_conversation_id
      WHERE r.ai_message_id = $1 AND r.n = $2 AND c.user_id = $3`,
    [messageId, n, userId],
  );
}

const DRAFT = `d.ai_action_draft_id, d.ai_message_id, d.user_id, d.action_key, d.module_key, d.risk, d."values", d.problems, d.records,
       d.suggested, d.status, d.expires_at, d.created_at`;

/** A card an answer drew (§6.11), in the answer's transaction. */
function insertDraft(client, d) {
  return one(
    client,
    `INSERT INTO ai_action_draft AS d (ai_message_id, user_id, action_key, module_key, risk, "values", problems, records, suggested, status, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9, $10, $11)
     RETURNING ${DRAFT}`,
    [d.ai_message_id, d.user_id, d.action_key, d.module_key, d.risk, JSON.stringify(d.values || {}), JSON.stringify(d.problems || {}), JSON.stringify(d.records || []), d.suggested === true, d.status || "shown", d.expires_at],
  );
}

/** The caller's card, or null; locked for the press when `lock` is set. */
function draftOf(db, id, userId, { lock = false } = {}) {
  return one(db, `SELECT ${DRAFT} FROM ai_action_draft d WHERE d.ai_action_draft_id = $1 AND d.user_id = $2${lock ? " FOR UPDATE" : ""}`, [id, userId]);
}

/** The cards of the answers named, by answer. */
async function draftsOfMessages(db, messageIds) {
  if (!messageIds.length) return new Map();
  const { rows } = await db.query(`SELECT ${DRAFT} FROM ai_action_draft d WHERE d.ai_message_id = ANY($1::uuid[])`, [messageIds]);
  return new Map(rows.map((r) => [r.ai_message_id, r]));
}

/** A card's status, and its values and problems when they changed. */
function setDraft(client, id, patch) {
  return one(
    client,
    `UPDATE ai_action_draft d
        SET status = COALESCE($2, d.status),
            "values" = COALESCE($3::jsonb, d."values"),
            problems = COALESCE($4::jsonb, d.problems),
            records = COALESCE($5::jsonb, d.records)
      WHERE d.ai_action_draft_id = $1
      RETURNING ${DRAFT}`,
    [id, patch.status || null, patch.values ? JSON.stringify(patch.values) : null, patch.problems ? JSON.stringify(patch.problems) : null, patch.records ? JSON.stringify(patch.records) : null],
  );
}

const RUN = `r.ai_action_run_id, r.ai_action_draft_id, r.user_id, r.confirmed_how, r.idempotency_key, r."values", r.result, r.status, r.error_code, r.started_at, r.finished_at`;

/** A press opened, running (§6.11 step 5). */
function insertRun(client, r) {
  return one(
    client,
    `INSERT INTO ai_action_run AS r (ai_action_draft_id, user_id, confirmed_how, idempotency_key, "values")
     VALUES ($1, $2, $3, $4, $5::jsonb)
     RETURNING ${RUN}`,
    [r.ai_action_draft_id, r.user_id, r.confirmed_how, r.idempotency_key || null, JSON.stringify(r.values || {})],
  );
}

/** A press closed: done with its lines, or failed with its code and words. */
function finishRun(client, id, { status, result, error_code: errorCode = null }) {
  return one(
    client,
    `UPDATE ai_action_run r SET status = $2, result = $3::jsonb, error_code = $4, finished_at = now()
      WHERE r.ai_action_run_id = $1 RETURNING ${RUN}`,
    [id, status, JSON.stringify(result || []), errorCode],
  );
}

/** A card's newest press, or null. */
function latestRunOf(db, draftId) {
  return one(db, `SELECT ${RUN} FROM ai_action_run r WHERE r.ai_action_draft_id = $1 ORDER BY r.started_at DESC, r.ai_action_run_id DESC LIMIT 1`, [draftId]);
}

/** The newest press of each card named, by card. */
async function latestRunsOf(db, draftIds) {
  if (!draftIds.length) return new Map();
  const { rows } = await db.query(
    `SELECT DISTINCT ON (r.ai_action_draft_id) ${RUN} FROM ai_action_run r
      WHERE r.ai_action_draft_id = ANY($1::uuid[]) ORDER BY r.ai_action_draft_id, r.started_at DESC, r.ai_action_run_id DESC`,
    [draftIds],
  );
  return new Map(rows.map((r) => [r.ai_action_draft_id, r]));
}

/** An answer with its question, as History and the replay read it. */
const ANSWER = `a.ai_message_id, a.ai_conversation_id, a.content, a.metadata, a.context, a.feedback, a.created_at,
       a.rows_read, a.module_key, q.content AS question,
       (SELECT count(*)::int FROM ai_message_citation x WHERE x.ai_message_id = a.ai_message_id) AS citations_total`;

/** A conversation's answers, newest first, 25 a page. */
function turns(db, conversationId, userId, query) {
  return pageQuery(
    db,
    `SELECT ${ANSWER}, ${TOTAL_COL}
       FROM ai_message a
       JOIN ai_conversation c ON c.ai_conversation_id = a.ai_conversation_id
       LEFT JOIN ai_message q ON q.ai_message_id = a.parent_message_id
      WHERE a.ai_conversation_id = $1 AND c.user_id = $2 AND a.role = 'assistant'
      ORDER BY a.created_at DESC, a.ai_message_id DESC`,
    [conversationId, userId],
    query,
  );
}

/** One answer of the caller's, or null. */
function answerOf(db, messageId, userId) {
  return one(
    db,
    `SELECT ${ANSWER}
       FROM ai_message a
       JOIN ai_conversation c ON c.ai_conversation_id = a.ai_conversation_id
       LEFT JOIN ai_message q ON q.ai_message_id = a.parent_message_id
      WHERE a.ai_message_id = $1 AND c.user_id = $2 AND a.role = 'assistant'`,
    [messageId, userId],
  );
}

/** The first 50 citations of each answer named, as the answers show them. */
async function citationsOf(db, messageIds) {
  if (!messageIds.length) return new Map();
  const { rows } = await db.query(
    `SELECT ai_message_id, entity_type, entity_id, read_key, label
       FROM (SELECT x.*, row_number() OVER (PARTITION BY x.ai_message_id ORDER BY x.position, x.ai_message_citation_id) AS n
               FROM ai_message_citation x
              WHERE x.ai_message_id = ANY($1::uuid[]) AND x.entity_type IS NOT NULL) t
      WHERE t.n <= 50
      ORDER BY ai_message_id, n`,
    [messageIds],
  );
  const out = new Map();
  for (const r of rows) {
    if (!out.has(r.ai_message_id)) out.set(r.ai_message_id, []);
    out.get(r.ai_message_id).push(r);
  }
  return out;
}

/** Each answer's citations by record type, in the order first cited: Map(id → [{entity_type, count}]). */
async function sourceGroups(db, messageIds) {
  if (!messageIds.length) return new Map();
  const { rows } = await db.query(
    `SELECT ai_message_id, entity_type, count(*)::int AS count, min(position) AS first
       FROM ai_message_citation
      WHERE ai_message_id = ANY($1::uuid[]) AND entity_type IS NOT NULL
      GROUP BY ai_message_id, entity_type
      ORDER BY ai_message_id, first, entity_type`,
    [messageIds],
  );
  const out = new Map();
  for (const r of rows) {
    if (!out.has(r.ai_message_id)) out.set(r.ai_message_id, []);
    out.get(r.ai_message_id).push({ entity_type: r.entity_type, count: r.count });
  }
  return out;
}

const QUESTION_SORTS = { asked_at: "a.created_at" };

/**
 * The caller's questions, one row per answer, newest first unless sorted; `q` searches the
 * questions. Tokens and naira come from the answer's run, priced as AI Control prices it.
 */
function questions(db, userId, query) {
  const sorted = query.sort ? orderBy(query, QUESTION_SORTS, "a.ai_message_id") : "a.created_at DESC, a.ai_message_id";
  return pageQuery(
    db,
    `SELECT a.ai_message_id, a.ai_conversation_id, q.content AS question, a.created_at AS asked_at,
            COALESCE(x.tokens, 0)::int AS tokens, round(COALESCE(x.cost, 0), 2)::text AS cost_ngn,
            ${TOTAL_COL}
       FROM ai_message a
       JOIN ai_conversation c ON c.ai_conversation_id = a.ai_conversation_id
       LEFT JOIN ai_message q ON q.ai_message_id = a.parent_message_id
       LEFT JOIN LATERAL (
         SELECT sum(s.input_tokens + s.output_tokens) AS tokens, sum(${STEP_NGN}) AS cost
           FROM ai_run_step s
          WHERE s.run_id = a.ai_run_id
       ) x ON true
      WHERE c.user_id = $1 AND a.role = 'assistant'
        AND ($2::text IS NULL OR search_fold(q.content) LIKE '%' || search_fold($2) || '%')
      ORDER BY ${sorted}`,
    [userId, query.q ?? null],
    query,
  );
}

const CONVERSATION_SORTS = { last_asked_at: "c.last_asked_at", title: "c.title" };

/** The caller's conversations, newest first unless sorted; `q` searches titles. */
function conversations(db, userId, query) {
  const sorted = query.sort ? orderBy(query, CONVERSATION_SORTS, "c.ai_conversation_id") : "c.last_asked_at DESC NULLS LAST, c.ai_conversation_id";
  return pageQuery(
    db,
    `SELECT ${CONVERSATION},
            (SELECT COALESCE(sum(m.rows_read), 0)::int FROM ai_message m WHERE m.ai_conversation_id = c.ai_conversation_id) AS rows_read,
            ${TOTAL_COL}
       FROM ai_conversation c
      WHERE c.user_id = $1
        AND ($2::text IS NULL OR search_fold(c.title) LIKE '%' || search_fold($2) || '%')
      ORDER BY ${sorted}`,
    [userId, query.q ?? null],
    query,
  );
}

function deleteConversation(client, id, userId) {
  return one(client, "DELETE FROM ai_conversation WHERE ai_conversation_id = $1 AND user_id = $2 RETURNING ai_conversation_id, questions", [
    id,
    userId,
  ]);
}

/** Every conversation of the caller; the runs stay, holding no words, for the spend. */
async function clearHistory(client, userId) {
  const { rowCount } = await client.query("DELETE FROM ai_conversation WHERE user_id = $1", [userId]);
  return rowCount;
}

function setFeedback(client, messageId, userId, feedback) {
  return one(
    client,
    `UPDATE ai_message a SET feedback = $3
       FROM ai_conversation c
      WHERE a.ai_message_id = $1 AND c.ai_conversation_id = a.ai_conversation_id AND c.user_id = $2 AND a.role = 'assistant'
     RETURNING a.ai_message_id, a.feedback`,
    [messageId, userId, feedback],
  );
}

/**
 * History's figures (§6.5): the person's own counts always; spend and questions by module are the
 * person's own, or with `company` everyone's (Praxis AI's runs, and the answers still kept). The
 * company's answered questions come from the runs, which a cleared History keeps. Spend is grouped
 * by Lagos month from `since` to `to`.
 * @param {{userId: string, company: boolean, from: string, to: string, since: string}} w
 */
async function summaryFigures(db, { userId, company, from, to, since }) {
  const mine = company ? null : userId;
  const counts = await one(
    db,
    `SELECT
       (SELECT count(*)::int FROM ai_message a JOIN ai_conversation c ON c.ai_conversation_id = a.ai_conversation_id
         WHERE c.user_id = $1 AND a.role = 'assistant' AND a.created_at >= $2 AND a.created_at < $3) AS own_month,
       (SELECT count(*)::int FROM ai_message a JOIN ai_conversation c ON c.ai_conversation_id = a.ai_conversation_id
         WHERE c.user_id = $1 AND a.role = 'assistant') AS own_all,
       (SELECT count(*)::int FROM ai_run r
         WHERE r.purpose = 'data-answers' AND r.status = 'ok' AND r.created_at >= $2 AND r.created_at < $3) AS company_month`,
    [userId, from, to],
  );
  const { rows: spend } = await db.query(
    `SELECT to_char(s.created_at AT TIME ZONE 'Africa/Lagos', 'YYYY-MM') AS month, round(sum(${STEP_NGN}), 2)::text AS spend
       FROM ai_run_step s JOIN ai_run r ON r.run_id = s.run_id
      WHERE r.purpose = ANY($1::text[]) AND ($2::uuid IS NULL OR r.actor_user_id = $2)
        AND s.created_at >= $3 AND s.created_at < $4
      GROUP BY 1`,
    [PRAXIS_ACTIONS, mine, since, to],
  );
  const { rows: byModule } = await db.query(
    `SELECT a.module_key, count(*)::int AS questions
       FROM ai_message a JOIN ai_conversation c ON c.ai_conversation_id = a.ai_conversation_id
      WHERE ($1::uuid IS NULL OR c.user_id = $1) AND a.role = 'assistant' AND a.created_at >= $2 AND a.created_at < $3
      GROUP BY a.module_key
      ORDER BY questions DESC, a.module_key NULLS LAST`,
    [mine, from, to],
  );
  return { ...counts, spend, by_module: byModule };
}

module.exports = {
  conversationOf,
  insertConversation,
  touchConversation,
  insertMessage,
  insertCitations,
  turns,
  answerOf,
  citationsOf,
  conversations,
  deleteConversation,
  clearHistory,
  setFeedback,
  sourceGroups,
  questions,
  summaryFigures,
  insertReads,
  readOf,
  insertDraft,
  draftOf,
  draftsOfMessages,
  setDraft,
  insertRun,
  finishRun,
  latestRunOf,
  latestRunsOf,
  PRAXIS_ACTIONS,
};
