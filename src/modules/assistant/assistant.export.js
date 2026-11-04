"use strict";
/**
 * Praxis AI's two exports, each reserved in the request and made by the worker after commit. Nothing
 * is emailed; the screen waits on the file and downloads it (shared/documents/exports.js).
 *
 *   History's Export (docs/guides/praxis-ai.md §6.5): the person's own questions as a workbook.
 *   requestExport(actor)          POST /ai/history/export (202, the file pending)
 *   buildExport(event, ctx)       assistant.export_requested, in the worker after commit
 *
 *   Download Excel on an answer's Table (§6.16; decision 15): every row of one read of the answer,
 *   replayed page by page with the person's rights and masks as they stand when the file is made,
 *   at most READ_EXPORT_CEILING rows, with a second sheet, About This File, saying who exported it,
 *   when, the question, the read and its filters, the rows and the total, and the masks applied.
 *   requestReadExport(id, n, actor)   POST /ai/answers/:id/reads/:n/export (202, the file pending)
 *   buildReadExport(event, ctx)       assistant.read_export_requested, in the worker after commit
 */
const crypto = require("node:crypto");
const { config } = require("../../config/env");
const { pool } = require("../../config/db");
const { atomically } = require("../../shared/db/tx");
const { emit } = require("../../shared/events/emit");
const outbox = require("../../shared/events/outbox");
const exportFiles = require("../../shared/documents/exports");
const { exportFilename } = require("../../shared/spreadsheet/cells");
const { EVENTS, HISTORY_EXPORT, ANSWER_EXPORT } = require("./assistant.events");

/** The most questions one export holds, newest first. */
const EXPORT_CEILING = 2500;
/** The most rows one answer's read export holds (decision 15): more than a year of attendance. */
const READ_EXPORT_CEILING = 25_000;

/** POST /ai/history/export: reserve the file for the person asking; the worker fills it. */
async function requestExport(actor) {
  const client = await pool.connect();
  try {
    return await atomically(client, async () => {
      const doc = await exportFiles.reserve(client, {
        doc_type: HISTORY_EXPORT,
        entity: { type: HISTORY_EXPORT, id: crypto.randomUUID() },
        file_name: exportFilename({ base: "praxis-ai-questions", env: config.APP_ENV, extension: "xlsx" }),
        title: "Praxis AI history export",
        actor,
      });
      await emit(client, {
        key: EVENTS.ASSISTANT_EXPORT_REQUESTED,
        entity: { type: doc.entity_type, id: doc.entity_id },
        actor,
        payload: { requested_by: actor.user_id, document_id: doc.document_id },
      });
      return exportFiles.present(doc);
    });
  } finally {
    client.release();
  }
}

/** The person's questions, a page of 25 at a time, newest first, up to the ceiling. */
async function gather(userId) {
  const history = require("./assistant.history");
  const rows = [];
  let page = await history.questions({ page: 1 }, { user_id: userId });
  rows.push(...page.data);
  while (page.page.has_next && rows.length < EXPORT_CEILING) {
    page = await history.questions({ page: page.page.number + 1 }, { user_id: userId });
    rows.push(...page.data);
  }
  return { rows: rows.slice(0, EXPORT_CEILING), total: page.page.total };
}

const COLUMNS = [
  { key: "question", header: "Question", width: 60 },
  { key: "asked_at", header: "Asked", format: "datetime", width: 18 },
  { key: "sources", header: "Sources Read", width: 36 },
  { key: "tokens", header: "Tokens", format: "int", width: 12 },
  { key: "cost_ngn", header: "Cost", format: "money", width: 14, total: true },
];

/**
 * The outbox handler: the person's questions made into the file the request reserved. A person
 * no longer active gets a failed file instead.
 * @param {object} event  assistant.export_requested
 * @param {{attempt: number, max_attempts: number}} ctx  the outbox's
 */
async function buildExport(event, ctx) {
  const { buildWorkbook } = require("../../shared/spreadsheet/build");
  const { workbookContext } = require("../../shared/spreadsheet/context");
  const grantsCache = require("../../shared/rbac/grants-cache");

  const p = event.payload || {};
  if (!p.document_id) return;
  const reader = await grantsCache.getAuthUser(pool, p.requested_by || event.actor_user_id);
  if (!reader || reader.status !== "active") return exportFiles.fail(p.document_id, "The person who asked is no longer active.");

  await exportFiles.make(p.document_id, ctx, async () => {
    const { rows, total } = await gather(reader.user_id);
    return buildWorkbook({
      sheets: [
        {
          name: "Questions",
          columns: COLUMNS,
          rows: rows.map((r) => ({
            question: r.question,
            asked_at: r.asked_at,
            sources: r.sources.join(", "),
            tokens: r.tokens,
            cost_ngn: r.cost_ngn,
          })),
          freeze: { y: 1 },
        },
      ],
      context: workbookContext({
        actor: { name: reader.display_name },
        title: "Praxis AI questions",
        lines: [["Questions", rows.length < total ? `The newest ${rows.length} of ${total}.` : String(rows.length)]],
      }),
      cover: true,
    });
  });
}

outbox.register(EVENTS.ASSISTANT_EXPORT_REQUESTED, "assistant.export_history", (event, ctx) => buildExport(event, ctx));

/* ------------------------------------------------------------------ *
 * Download Excel on an answer's Table (§6.16)
 * ------------------------------------------------------------------ */

/**
 * POST /ai/answers/:id/reads/:n/export: the read must be the caller's and one that may be run again
 * (assistant.reads.replayable); the file is reserved for them and the worker fills it.
 * @returns {Promise<object>} the ExportFile, pending
 */
async function requestReadExport(messageId, n, actor) {
  const reads = require("./assistant.reads");
  const { read } = await reads.replayable(messageId, n, actor);
  const client = await pool.connect();
  try {
    return await atomically(client, async () => {
      const doc = await exportFiles.reserve(client, {
        doc_type: ANSWER_EXPORT,
        entity: { type: ANSWER_EXPORT, id: crypto.randomUUID() },
        file_name: exportFilename({ base: `praxis-ai-${read.read_key.replace(/\./g, "-")}`, env: config.APP_ENV, extension: "xlsx" }),
        title: "Praxis AI answer export",
        actor,
      });
      await emit(client, {
        key: EVENTS.ASSISTANT_READ_EXPORT_REQUESTED,
        entity: { type: doc.entity_type, id: doc.entity_id },
        actor,
        payload: { requested_by: actor.user_id, document_id: doc.document_id, ai_message_id: messageId, n, read_key: read.read_key },
      });
      return exportFiles.present(doc);
    });
  } finally {
    client.release();
  }
}

/** The parameters a read ran with, as the sheet says them: "status = submitted, from = 01/10/2026". */
function paramsText(params) {
  const { formatDate } = require("../../shared/time/day-first");
  const parts = Object.entries(params || {})
    .filter(([k, v]) => k !== "page" && v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${k.replace(/_/g, " ")} = ${/^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? formatDate(String(v)) : Array.isArray(v) ? v.join(", ") : String(v)}`);
  return parts.length ? parts.join(", ") : "none";
}

/**
 * Every row of the read, a page of 25 at a time with the reader's rights now, up to the ceiling, each
 * page drawn as the Table shows it.
 * @returns {Promise<{columns: string[], rows: string[][], total: number, capped: boolean, masked: string[]}>}
 */
async function gatherRead(found, n, reader, { ceiling = READ_EXPORT_CEILING } = {}) {
  const reads = require("./assistant.reads");
  const rows = [];
  let columns = [];
  let masked = [];
  let got = await reads.page(found, 1, reader);
  let total;
  for (;;) {
    const t = reads.drawn(found, n, got.list);
    if (!columns.length) columns = t.columns;
    masked = got.masked || masked;
    rows.push(...t.rows);
    total = got.page.total;
    if (!got.page.has_next || rows.length >= ceiling || !found.spec.list) break;
    got = await reads.page(found, got.page.number + 1, reader);
  }
  return { columns, rows: rows.slice(0, ceiling), total, capped: total > ceiling, masked };
}

/**
 * The outbox handler: one read of an answer made into the file the request reserved, as the person
 * who asked may see it now. A person no longer active, or an answer or read that is gone, gets a
 * failed file instead.
 * @param {object} event  assistant.read_export_requested
 * @param {{attempt: number, max_attempts: number}} ctx  the outbox's
 * @param {{ceiling?: number}} [opts]  tests lower the row ceiling
 */
async function buildReadExport(event, ctx, { ceiling = READ_EXPORT_CEILING } = {}) {
  const { buildWorkbook } = require("../../shared/spreadsheet/build");
  const { workbookContext } = require("../../shared/spreadsheet/context");
  const { formatInstant } = require("../../shared/spreadsheet/cells");
  const { FIELDS } = require("../../shared/rbac/field-mask");
  const grantsCache = require("../../shared/rbac/grants-cache");
  const reads = require("./assistant.reads");
  const registry = require("../../shared/ai/registry");

  const p = event.payload || {};
  if (!p.document_id) return;
  const reader = await grantsCache.getAuthUser(pool, p.requested_by || event.actor_user_id);
  if (!reader || reader.status !== "active") return exportFiles.fail(p.document_id, "The person who asked is no longer active.");
  let found;
  try {
    found = await reads.replayable(p.ai_message_id, p.n, reader);
  } catch (err) {
    if (err && err.status === 404) return exportFiles.fail(p.document_id, "That answer, or its read, is no longer there.");
    throw err;
  }

  await exportFiles.make(p.document_id, ctx, async () => {
    const got = await gatherRead(found, p.n, reader, { ceiling });
    const now = new Date();
    const tool = registry.read(found.read.read_key);
    const label = tool ? tool.description : found.read.read_key;
    const masks = (got.masked || []).map((k) => (FIELDS[k] ? FIELDS[k].label : k));
    const about = [
      ["Exported by", reader.display_name],
      ["Exported at", `${formatInstant(now)} (Lagos)`],
      ["Question", found.kept ? found.kept.question : ""],
      ["Asked on", found.kept && found.kept.created_at ? `${formatInstant(found.kept.created_at)} (Lagos)` : ""],
      ["Read", `${label} (${found.read.read_key})`],
      ["Filters", paramsText(found.read.params)],
      ["Rows in this file", String(got.rows.length)],
      ["Rows the read has now", String(got.total)],
      ["Cut at", got.capped ? `The first ${ceiling.toLocaleString("en-NG")} rows: narrow the question for the rest.` : "Not cut: every row is here."],
      ["Masked fields", masks.length ? masks.join(", ") : "None: every field your role may see is here."],
      ["Environment", config.APP_ENV === "staging" ? "Staging: not live data" : "Live"],
    ];
    const columns = (got.columns.length ? got.columns : ["Row"]).map((header, i) => ({ key: `c${i}`, header, width: Math.min(60, Math.max(14, header.length + 6)) }));
    return buildWorkbook({
      sheets: [
        {
          name: label.slice(0, 31),
          columns,
          rows: got.rows.map((r) => Object.fromEntries(r.map((v, i) => [`c${i}`, v]))),
          freeze: { y: 1 },
        },
        {
          name: "About This File",
          columns: [
            { key: "item", header: "Item", width: 24 },
            { key: "value", header: "Value", width: 90, wrap: true },
          ],
          rows: about.map(([item, value]) => ({ item, value })),
          freeze: { y: 1 },
        },
      ],
      context: workbookContext({ actor: { name: reader.display_name }, title: "Praxis AI answer", generatedAt: now }),
    });
  });
}

outbox.register(EVENTS.ASSISTANT_READ_EXPORT_REQUESTED, "assistant.export_read", (event, ctx) => buildReadExport(event, ctx));

module.exports = { EXPORT_CEILING, READ_EXPORT_CEILING, requestExport, gather, buildExport, requestReadExport, gatherRead, buildReadExport, paramsText };
