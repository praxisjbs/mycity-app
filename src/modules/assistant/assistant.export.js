"use strict";
/**
 * Praxis AI · History's Export (docs/guides/praxis-ai.md §6.5): the person's own questions as a
 * workbook, reserved in the request and made by the worker after commit. Nothing is emailed; the
 * screen waits on the file and downloads it (shared/documents/exports.js).
 *
 *   requestExport(actor)          POST /ai/history/export (202, the file pending)
 *   buildExport(event, ctx)       assistant.export_requested, in the worker after commit
 */
const crypto = require("node:crypto");
const { config } = require("../../config/env");
const { pool } = require("../../config/db");
const { atomically } = require("../../shared/db/tx");
const { emit } = require("../../shared/events/emit");
const outbox = require("../../shared/events/outbox");
const exportFiles = require("../../shared/documents/exports");
const { exportFilename } = require("../../shared/spreadsheet/cells");
const { EVENTS, HISTORY_EXPORT } = require("./assistant.events");

/** The most questions one export holds, newest first. */
const EXPORT_CEILING = 2500;

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

module.exports = { EXPORT_CEILING, requestExport, gather, buildExport };
