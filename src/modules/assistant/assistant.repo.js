"use strict";
/**
 * Praxis AI's SQL (docs/guides/praxis-ai.md §4). Reads and writes ai_conversation, ai_message and
 * ai_message_citation; nothing else writes them. Every query is pinned to the asking person's own
 * user_id: History is theirs whatever their grant's scope (§1.1 decision 7).
 */
const { pageQuery, orderBy, TOTAL_COL } = require("../../shared/http/paged");

const one = async (db, sql, params) => (await db.query(sql, params)).rows[0] || null;

const CONVERSATION = "c.ai_conversation_id, c.title, c.last_asked_at, c.questions";

/** The caller's conversation, or null: someone else's reads as missing. */
function conversationOf(db, id, userId) {
  return one(db, `SELECT ${CONVERSATION} FROM ai_conversation c WHERE c.ai_conversation_id = $1 AND c.user_id = $2`, [id, userId]);
}

function insertConversation(client, { userId, title }) {
  return one(
    client,
    `INSERT INTO ai_conversation (user_id, title, last_asked_at, questions) VALUES ($1, $2, now(), 1)
     RETURNING ai_conversation_id, title, last_asked_at, questions`,
    [userId, title],
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
    `INSERT INTO ai_message (ai_conversation_id, parent_message_id, role, content, ai_run_id, rows_read, module_key, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
     RETURNING ai_message_id, ai_conversation_id, parent_message_id, role, content, ai_run_id, rows_read, module_key,
               metadata, feedback, created_at`,
    [
      m.ai_conversation_id,
      m.parent_message_id || null,
      m.role,
      m.content,
      m.ai_run_id || null,
      m.rows_read || 0,
      m.module_key || null,
      JSON.stringify(m.metadata || {}),
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

/** An answer with its question, as History and the replay read it. */
const ANSWER = `a.ai_message_id, a.ai_conversation_id, a.content, a.metadata, a.feedback, a.created_at,
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

/** This Lagos month's questions, conversations and rows read, and questions by module. */
async function summary(db, userId, from, to) {
  const counts = await one(
    db,
    `SELECT
       (SELECT count(*)::int FROM ai_message a JOIN ai_conversation c ON c.ai_conversation_id = a.ai_conversation_id
         WHERE c.user_id = $1 AND a.role = 'assistant' AND a.created_at >= $2 AND a.created_at < $3) AS questions,
       (SELECT count(*)::int FROM ai_conversation c
         WHERE c.user_id = $1 AND c.last_asked_at >= $2 AND c.last_asked_at < $3) AS conversations,
       (SELECT COALESCE(sum(a.rows_read), 0)::int FROM ai_message a JOIN ai_conversation c ON c.ai_conversation_id = a.ai_conversation_id
         WHERE c.user_id = $1 AND a.role = 'assistant' AND a.created_at >= $2 AND a.created_at < $3) AS rows_read`,
    [userId, from, to],
  );
  const { rows: byModule } = await db.query(
    `SELECT a.module_key, count(*)::int AS questions
       FROM ai_message a JOIN ai_conversation c ON c.ai_conversation_id = a.ai_conversation_id
      WHERE c.user_id = $1 AND a.role = 'assistant' AND a.created_at >= $2 AND a.created_at < $3
      GROUP BY a.module_key
      ORDER BY questions DESC, a.module_key NULLS LAST`,
    [userId, from, to],
  );
  return { ...counts, by_module: byModule };
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
  summary,
};
