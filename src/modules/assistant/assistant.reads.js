"use strict";
/**
 * A read run again (docs/guides/praxis-ai.md §6.12): GET /ai/answers/:id/reads/:n pages read `n`
 * of the caller's answer with the parameters it ran with and the caller's rights now, 25 a page,
 * as the Table pane shows it. The columns are the answer's table's when it was drawn from this
 * read, else the rows' first plain fields. A read that was refused, timed out, a summary, or
 * someone else's answer reads as missing. Download Excel (§6.16, assistant.export.js) replays
 * the same read page by page through `page()` and draws each page with `drawn()`.
 */
const { pool } = require("../../config/db");
const { AppError } = require("../../shared/errors");
const authorise = require("../../shared/ai/authorise");
const registry = require("../../shared/ai/registry");
const { refsFor, linkOfRef } = require("../../shared/ai/cite");
const answer = require("../../services/ai/assistant/answer");
const repo = require("./assistant.repo");

const notFound = () => new AppError("NOT_FOUND", "Not found", 404);

/**
 * The read `n` of the caller's answer that may be run again, with its manifest entry and the answer
 * it belongs to; 404 for a summary, a read that did not return, or someone else's answer.
 * @returns {Promise<{read: object, spec: object, kept: object|null}>}
 */
async function replayable(messageId, n, actor, db = pool) {
  const read = await repo.readOf(db, messageId, n, actor.user_id);
  if (!read || read.kind !== "read" || read.outcome !== "read") throw notFound();
  const spec = registry.read(read.read_key);
  if (!spec) throw notFound();
  const kept = await repo.answerOf(db, messageId, actor.user_id);
  return { read, spec, kept };
}

/** One page of the read, run again with the stored parameters and the caller's rights now. */
async function page({ read, spec }, pageNumber, actor, db = pool) {
  const params = spec.list ? { ...(read.params || {}), page: pageNumber || 1 } : { ...(read.params || {}) };
  const res = await authorise.runRead(db, actor, read.read_key, params);
  const list = res.list ? res.data : res.data ? [res.data] : [];
  return { list, page: res.page || { number: 1, size: 25, total: list.length, pages: 1, has_next: false }, masked: res.masked };
}

/**
 * A page's rows drawn as the Table shows them: the answer's own columns when its table came from this
 * read, else the rows' first plain fields.
 */
function drawn({ spec, kept }, n, list) {
  const refs = refsFor(spec, list);
  const table = kept && kept.metadata && kept.metadata.table && kept.metadata.table.read === n ? kept.metadata.table : null;
  const fields = table && Array.isArray(table.fields) && table.fields.length ? table.fields : answer.defaultFields(list);
  const t = answer.drawTable(list, refs, fields, table ? table.columns : []) || { columns: [], rows: [], numeric: [], refs: [] };
  return {
    columns: t.columns.slice(0, answer.MAX_COLUMNS),
    rows: t.rows.map((r) => r.slice(0, answer.MAX_COLUMNS)),
    numeric: t.numeric.filter((i) => i < answer.MAX_COLUMNS),
    refs: t.refs,
  };
}

/**
 * @param {string} messageId
 * @param {number} n
 * @param {{page: number}} query
 * @param {object} actor
 * @returns {Promise<object>} AiReadRows
 */
async function rows(messageId, n, query, actor) {
  const found = await replayable(messageId, n, actor);
  const got = await page(found, query.page || 1, actor);
  const t = drawn(found, n, got.list);
  return {
    n,
    key: found.read.read_key,
    label: found.spec.description,
    columns: t.columns,
    rows: t.rows,
    numeric: t.numeric,
    links: t.rows.map((_, i) => linkOfRef(t.refs[i])),
    page: got.page,
  };
}

module.exports = { rows, replayable, page, drawn };
