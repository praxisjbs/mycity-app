"use strict";
/**
 * What the assistant may read of the Audit Log (docs/guides/praxis-ai.md §6.13; foundation.md §9):
 * the ledger counted, never an entry. audit.summary gives a reader of the whole log (Settings view
 * over everything, and the CEO) the entries of a period by action, by person, by module or record
 * type, and by day, with the log's own filters; anyone else is told it is not available to them, as
 * the Audit Log itself refuses them. No entry's words, before or after values reach the assistant:
 * the log is read on Settings · Audit Log, with its masks. Nothing here writes (A23); the ledger
 * cannot be written to by anyone.
 */
const c = require("@mycity/contract");
const { defineManifest } = require("../../shared/ai/manifest");
const service = require("./audit.service");

module.exports = defineManifest({
  module: "settings",
  summaries: [
    {
      key: "audit.summary",
      description: "Audit Log figures for a period: entries by action, by person, by module or record type, and by day, with the log's filters; for a reader of the whole log",
      params: c.audit.AuditSummaryQuery,
      permission: ["settings", "view"],
      run: (client, params, actor) => service.aiSummary(client, params, actor.scope),
    },
  ],
  routes: [{ intent: "see the audit log", screen: "settings.audit-log" }],
});
