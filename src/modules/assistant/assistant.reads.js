"use strict";
/**
 * A read run again (docs/guides/praxis-ai.md §6.12): GET /ai/answers/:id/reads/:n pages read `n`
 * of the caller's answer with the parameters it ran with and the caller's rights now, 25 a page,
 * as the Table pane shows it. The columns are the answer's table's when it was drawn from this
 * read, else the rows' first plain fields. A read that was refused, a summary, or someone else's
 * answer reads as missing.
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
 * @param {string} messageId
 * @param {number} n
 * @param {{page: number}} query
 * @param {object} actor
 * @returns {Promise<object>} AiReadRows
 */
async function rows(messageId, n, query, actor) {
  const read = await repo.readOf(pool, messageId, n, actor.user_id);
  if (!read || read.kind !== "read" || read.outcome !== "read") throw notFound();
  const spec = registry.read(read.read_key);
  if (!spec) throw notFound();
  const params = spec.list ? { ...(read.params || {}), page: query.page || 1 } : { ...(read.params || {}) };
  const res = await authorise.runRead(pool, actor, read.read_key, params);
  const list = res.list ? res.data : res.data ? [res.data] : [];
  const refs = refsFor(spec, list);
  const kept = await repo.answerOf(pool, messageId, actor.user_id);
  const table = kept && kept.metadata && kept.metadata.table && kept.metadata.table.read === n ? kept.metadata.table : null;
  const fields = table && Array.isArray(table.fields) && table.fields.length ? table.fields : answer.defaultFields(list);
  const drawn = answer.drawTable(list, refs, fields, table ? table.columns : []) || { columns: [], rows: [], numeric: [], refs: [] };
  const page = res.page || { number: 1, size: 25, total: list.length, pages: 1, has_next: false };
  return {
    n,
    key: read.read_key,
    label: spec.description,
    columns: drawn.columns.slice(0, answer.MAX_COLUMNS),
    rows: drawn.rows.map((r) => r.slice(0, answer.MAX_COLUMNS)),
    numeric: drawn.numeric.filter((i) => i < answer.MAX_COLUMNS),
    links: drawn.rows.map((_, i) => linkOfRef(drawn.refs[i])),
    page,
  };
}

module.exports = { rows };
