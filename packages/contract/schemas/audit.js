"use strict";
/**
 * Audit: the append-only ledger every write lands in through emit() (who, what,
 * which record, when, the record before and after), as Settings · Audit Log reads
 * it. Nobody can edit it; the database refuses an UPDATE or DELETE.
 *
 * Read by people who hold Settings view with scope all, and the CEO. Restricted
 * values inside a record (salary, bank, personal details) are masked for a reader
 * whose roles mask them, here and in the export, and named in `masked`.
 */
const { z } = require("zod");
const { uuid, isoDate, isoDateTime, listQuery, Paged } = require("./common");
const { ModuleKey } = require("./identity");

/** A snake_case record type ("employee", "app_user"). */
const EntityType = z.string().trim().regex(/^[a-z][a-z0-9_]{0,62}$/, "Not a record type");
/** An event key ("role.created"). */
const ActionKey = z.string().trim().regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/, "Not an action");

/** The filters the list, the summary and the export share. */
const filters = {
  module: ModuleKey.optional(),
  action: ActionKey.optional(),
  actor_user_id: uuid.optional(),
  entity_type: EntityType.optional(),
  entity_id: z.string().trim().min(1).max(100).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
};

/** One ledger entry. */
const AuditEntry = z
  .object({
    audit_ledger_id: uuid,
    occurred_at: isoDateTime,
    actor_user_id: uuid.nullable(),
    actor_name: z.string().nullable(),
    actor_email: z.string().nullable(),
    actor_ip: z.string().nullable(),
    /** The event key. */
    action: z.string(),
    /** What it means, in a line a person reads. */
    summary: z.string(),
    module_key: z.string(),
    entity_type: z.string(),
    entity_id: z.string(),
    /** Where the record opens in the app, when it has a screen. */
    link: z.string().nullable(),
    before: z.record(z.string(), z.unknown()).nullable(),
    after: z.record(z.string(), z.unknown()).nullable(),
    changed_fields: z.array(z.string()),
    is_sensitive: z.boolean(),
    /** Fields of before or after hidden from this reader by their roles. */
    masked: z.array(z.string()),
  })
  .strict();

/** GET /audit: newest first unless sorted otherwise. */
const AuditListQuery = listQuery(filters, ["occurred_at"]);

/**
 * The assistant's Audit Log summary (docs/guides/praxis-ai.md §6.13; foundation.md §9): entries by action,
 * by actor and by day over a period (the last 30 days unless `from` or `to` says otherwise), with the
 * log's own filters, and a third grouping by module or record type. Figures, never rows; no page. Only for
 * a reader of the whole log (Settings view over everything, and the CEO).
 */
const AuditSummaryBy = z.enum(["module", "entity_type"]);
const AuditSummaryQuery = z.object({ ...filters, by: AuditSummaryBy.default("module") }).strict();
const AuditPage = Paged(AuditEntry);

/** GET /audit/summary */
const AuditSummary = z
  .object({
    today: z.number().int().min(0),
    this_week: z.number().int().min(0),
    this_month: z.number().int().min(0),
    sensitive_this_month: z.number().int().min(0),
    /** Entries this month by module, most first; only modules with entries. */
    by_module: z.array(
      z.object({ module_key: z.string(), label: z.string(), entries: z.number().int().min(0) }).strict(),
    ),
    /** Every module, for the module filter. */
    modules: z.array(z.object({ key: z.string(), label: z.string() }).strict()),
  })
  .strict();

/**
 * POST /audit/exports: the whole filtered ledger as a workbook for the person who asked,
 * answered as documents ExportFile and downloaded on the device that pressed Export.
 */
const AuditExportRequest = z.object(filters).strict();

/** Which table each schema is a row of (gate 6, check/contract-columns.js). */
const TABLES = {
  AuditEntry: {
    table: "audit_ledger",
    virtual: {
      summary: "the event key's summary in the event catalogue",
      link: "where the record opens, from shared/route-map",
      masked: "the fields of before and after masked for this reader",
    },
  },
  AuditListQuery: { table: null, reason: "list controls and the Audit Log's filters" },
  AuditSummaryQuery: { table: null, reason: "the Audit Log's filters and the grouping of the assistant's summary; figures, never a row" },
  AuditPage: { table: null, reason: "a page of ledger entries" },
  AuditSummary: { table: null, reason: "counts over audit_ledger, and the module list of the access catalogue" },
  AuditExportRequest: { table: null, reason: "the Audit Log's filters, carried to the worker that builds the export" },
};

module.exports = {
  TABLES,
  EntityType,
  ActionKey,
  AuditEntry,
  AuditListQuery,
  AuditSummaryQuery,
  AuditPage,
  AuditSummary,
  AuditExportRequest,
};
