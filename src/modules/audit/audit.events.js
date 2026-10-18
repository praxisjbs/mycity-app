"use strict";
/**
 * Audit events and the export's work (loaded by the API and the worker).
 *
 * An Audit Log export is asked for in the request and built here, after commit, in
 * the worker: the whole filtered log, masked for the person who asked, as a branded
 * workbook kept in the vault (restricted) and emailed to them, so it arrives in their
 * Mailbox. A retried handler builds the same file again and sends it once more,
 * which is the right failure: an export that never arrives is worse than two.
 */
const c = require("@mycity/contract");
const { pool } = require("../../config/db");
const { atomically } = require("../../shared/db/tx");
const { defineEvents } = require("../../shared/events/catalogue");
const outbox = require("../../shared/events/outbox");
const { defineDocumentType } = require("../../shared/documents/types");
const { defineVariables } = require("../../shared/templates/variables");

const EVENTS = defineEvents("settings", {
  "audit.export_requested": { summary: "An Audit Log export was requested" },
});

defineDocumentType("audit_export", {
  label: "Audit Log export",
  module: "settings",
  sensitivity: "restricted",
});

defineVariables("email", "audit-export", c.audit.AuditExportEmailVars);

/** The filters as the email and the cover sheet say them: "module = settings, from = 2026-10-01". */
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

/** The outbox handler: build, keep and send the export. */
async function sendExport(event) {
  const queues = require("../../jobs/queues");
  const vault = require("../../shared/documents/vault");
  const { buildWorkbook } = require("../../shared/spreadsheet/build");
  const { workbookContext } = require("../../shared/spreadsheet/context");
  const { exportFilename } = require("../../shared/spreadsheet/cells");
  const { config } = require("../../config/env");
  const grantsCache = require("../../shared/rbac/grants-cache");
  const service = require("./audit.service");

  const reader = await grantsCache.getAuthUser(
    pool,
    event.payload.requested_by || event.actor_user_id,
  );
  if (!reader || reader.status !== "active") return;
  const filters = event.payload.filters || {};
  const { rows, total, capped } = await service.gather(pool, filters, reader);

  const buffer = await buildWorkbook({
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
      filters,
    }),
    cover: true,
  });
  const filename = `${exportFilename({ base: "audit-log", env: config.APP_ENV, extension: "xlsx" })}`;

  const client = await pool.connect();
  let doc;
  try {
    doc = await atomically(client, () =>
      vault.store(client, {
        file: { buffer, originalname: filename },
        purpose: "document",
        doc_type: "audit_export",
        entity: { type: event.entity.type, id: event.entity.id },
        sensitivity: "restricted",
        source: "generated",
        title: "Audit Log export",
        actor: reader.user_id,
      }),
    );
  } finally {
    client.release();
  }

  await queues.enqueue(
    "email-send",
    "audit-export",
    {
      to: { name: reader.display_name, email: reader.email },
      template: "audit-export",
      data: {
        entries: Math.min(total, rows.length),
        filters: filtersText(filters),
        capped,
      },
      attachments: [{ document_id: doc.document_id }],
    },
    { jobId: `audit-export-${event.event_id}` },
  );
}

outbox.register(EVENTS.AUDIT_EXPORT_REQUESTED, "audit.send_export", (event) =>
  sendExport(event),
);

module.exports = { EVENTS, sendExport, filtersText };
