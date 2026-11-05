"use strict";
/**
 * What the Talent Pool records, and the export's work (docs/guides/recruitment.md §6.9, §7). Loaded by
 * the API (through the service) and the worker. Payloads carry ids and numbers, never a reason.
 *
 *   talent_pool.added, .renewed, .invited, .removed, .expired   the pool's own changes; audit
 *   talent_pool.export_requested   the whole filtered pool as a workbook, made here after commit and
 *                                  downloaded on the device that pressed Export (shared/documents/exports.js)
 *
 * Invite to Apply mails through the candidates module (application.invited, source pool).
 */
const { pool } = require("../../config/db");
const { defineEvents } = require("../../shared/events/catalogue");
const { defineDocumentType } = require("../../shared/documents/types");
const vault = require("../../shared/documents/vault");
const outbox = require("../../shared/events/outbox");

const EVENTS = defineEvents("recruitment", {
  "talent_pool.added": { summary: "A candidate was added to the Talent Pool" },
  "talent_pool.renewed": { summary: "A candidate in the Talent Pool was added again" },
  "talent_pool.invited": { summary: "A candidate in the Talent Pool was invited to apply" },
  "talent_pool.removed": { summary: "A candidate was taken off the Talent Pool" },
  "talent_pool.expired": { summary: "A candidate's time in the Talent Pool ended" },
  "talent_pool.export_requested": { summary: "A Talent Pool export was requested" },
});

const EXPORT_DOC_TYPE = "talent_pool_export";
defineDocumentType(EXPORT_DOC_TYPE, { label: "Talent Pool export", module: "recruitment", sensitivity: "restricted", export: true });
/** The workbook (names, emails, reasons) is for the person who asked for it, and the CEO; the rule decides alone. */
vault.defineAccess(EXPORT_DOC_TYPE, async (_client, user, doc) => user.is_ceo === true || (Boolean(user.user_id) && doc.uploaded_by === user.user_id));

const COLUMNS = [
  { key: "name", header: "Candidate", width: 26 },
  { key: "email", header: "Email", width: 30 },
  { key: "applied_for", header: "Applied For", width: 30 },
  { key: "score", header: "Score", width: 10 },
  { key: "provisional", header: "Provisional", width: 12 },
  { key: "reason", header: "Reason", width: 40 },
  { key: "created_at", header: "Added", format: "datetime", width: 20 },
  { key: "expires_at", header: "Kept Until", format: "datetime", width: 20 },
  { key: "invited_to", header: "Invited To", width: 30 },
  { key: "invited_at", header: "Invited", format: "datetime", width: 20 },
];

/** The outbox handler: the workbook made into the file the request reserved, in the asker's scope. */
async function buildExport(event, ctx) {
  const exportFiles = require("../../shared/documents/exports");
  const { buildWorkbook } = require("../../shared/spreadsheet/build");
  const { workbookContext } = require("../../shared/spreadsheet/context");
  const grantsCache = require("../../shared/rbac/grants-cache");
  const { scopeFor } = require("../../middleware/rbac");
  const service = require("./talent_pool.service");

  const p = event.payload || {};
  if (!p.document_id) return;
  const reader = await grantsCache.getAuthUser(pool, p.requested_by || event.actor_user_id);
  if (!reader || reader.status !== "active") return exportFiles.fail(p.document_id, "The person who asked is no longer active.");
  const scope = await scopeFor(reader, "recruitment", "export");
  if (!scope) return exportFiles.fail(p.document_id, "The person who asked no longer holds Recruitment.");
  await exportFiles.make(p.document_id, ctx, async () => {
    const { rows, total, capped } = await service.gather(p.filters || {}, { scope: scope.scope, scope_ids: scope.scope_ids || null });
    return buildWorkbook({
      sheets: [{ name: "Talent Pool", columns: COLUMNS, rows, freeze: { y: 1 } }],
      context: workbookContext({
        actor: { name: reader.display_name },
        title: "Talent Pool",
        lines: [["People", capped ? `The newest ${rows.length} of ${total}.` : String(rows.length)]],
      }),
      cover: true,
    });
  });
}

outbox.register(EVENTS.TALENT_POOL_EXPORT_REQUESTED, "talent_pool.build_export", (event, ctx) => buildExport(event, ctx));

module.exports = { EVENTS, EXPORT_DOC_TYPE, buildExport };
