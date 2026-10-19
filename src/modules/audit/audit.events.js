"use strict";
/**
 * Audit events and the export's work (loaded by the API and the worker).
 *
 * An Audit Log export is asked for in the request, which reserves its file
 * (shared/documents/exports.js), and built here, after commit, in the worker: the whole
 * filtered log, masked for the person who asked, as a branded workbook in the restricted
 * file their Audit Log is waiting on, which it downloads on the device that asked. Nothing is
 * emailed. A retried handler leaves a file already made alone.
 */
const { pool } = require("../../config/db");
const { defineEvents } = require("../../shared/events/catalogue");
const outbox = require("../../shared/events/outbox");
const { defineDocumentType } = require("../../shared/documents/types");

const EVENTS = defineEvents("settings", {
  "audit.export_requested": { summary: "An Audit Log export was requested" },
});

/** The document type an export's file is kept under, and the record it belongs to. */
const EXPORT_DOC_TYPE = "audit_export";

defineDocumentType(EXPORT_DOC_TYPE, {
  label: "Audit Log export",
  module: "settings",
  sensitivity: "restricted",
  export: true,
});

/** The filters as the cover sheet says them: "module = settings, from = 2026-10-01". */
function filtersText(filters) {
  const parts = Object.entries(filters || {})
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${k.replace(/_/g, " ")} = ${v}`);
  return parts.length ? parts.join(", ") : "none, the whole log";
}

const COLUMNS = [
  { key: "occurred_at", header: "When", format: "datetime", width: 20 },
  { key: "actor_name", header: "Who", width: 24 },
  { key: "actor_email", header: "Email", width: 28 },
  { key: "summary", header: "What", width: 40 },
  { key: "action", header: "Action", width: 28 },
  { key: "module_key", header: "Module", width: 14 },
  { key: "entity_type", header: "Record Type", width: 18 },
  { key: "entity_id", header: "Record", width: 38 },
  { key: "changed_fields", header: "Changed", width: 30 },
  { key: "before", header: "Before", width: 50 },
  { key: "after", header: "After", width: 50 },
  { key: "masked", header: "Restricted", width: 24 },
  { key: "actor_ip", header: "Address", width: 16 },
];

const asText = (v) =>
  v === null || v === undefined
    ? ""
    : typeof v === "string"
      ? v
      : JSON.stringify(v);

/**
 * The outbox handler: the workbook made into the file the request reserved, masked for the
 * person who asked. One no longer active gets a failed file instead.
 * @param {object} event  audit.export_requested
 * @param {{attempt: number, max_attempts: number}} ctx  the outbox's
 */
async function buildExport(event, ctx) {
  const exportFiles = require("../../shared/documents/exports");
  const { buildWorkbook } = require("../../shared/spreadsheet/build");
  const { workbookContext } = require("../../shared/spreadsheet/context");
  const grantsCache = require("../../shared/rbac/grants-cache");
  const service = require("./audit.service");

  const p = event.payload || {};
  // Asked for before exports were downloaded: that one went by email, and has no file here.
  if (!p.document_id) return;
  const reader = await grantsCache.getAuthUser(pool, p.requested_by || event.actor_user_id);
  if (!reader || reader.status !== "active")
    return exportFiles.fail(p.document_id, "The person who asked is no longer active.");
  const filters = p.filters || {};

  await exportFiles.make(p.document_id, ctx, async () => {
    const { rows, total, capped } = await service.gather(pool, filters, reader);
    return buildWorkbook({
      sheets: [
        {
          name: "Audit Log",
          columns: COLUMNS,
          rows: rows.map((r) => ({
            ...r,
            changed_fields: (r.changed_fields || []).join(", "),
            before: asText(r.before),
            after: asText(r.after),
            masked: (r.masked || []).join(", "),
          })),
          freeze: { y: 1 },
        },
      ],
      context: workbookContext({
        actor: { name: reader.display_name },
        title: "Audit Log",
        lines: [
          ["Filters", filtersText(filters)],
          ["Entries", capped ? `The newest ${rows.length} of ${total}. Narrow the dates to export the rest.` : String(rows.length)],
          ["Restricted", "Values your role may not see are left out and named in the Restricted column."],
        ],
      }),
      cover: true,
    });
  });
}

outbox.register(EVENTS.AUDIT_EXPORT_REQUESTED, "audit.build_export", (event, ctx) =>
  buildExport(event, ctx),
);

module.exports = { EVENTS, EXPORT_DOC_TYPE, buildExport, filtersText };
