"use strict";
/**
 * Imports: one API over every importer a module registers
 * (BACKEND_STRUCTURE §9.3). The screen is Settings · Imports, opened with
 * `?importer=<key>`; the wizard walks Upload, Map, Preview, Commit, and the
 * history keeps every batch with its counts, its error file and Revert.
 *
 * Nothing here knows what is being imported. An importer declares its own
 * fields and the engine answers with them, so the staff sheet (track A) and
 * every later importer use the same screen and the same routes.
 *
 * The one rule a reader needs: the preview is the real commit, run inside a
 * transaction that is rolled back, so its counts and per-row results are what
 * a commit would do, not a guess.
 */
const { z } = require("zod");
const {
  uuid,
  text,
  optionalText,
  isoDateTime,
  listQuery,
  Paged,
} = require("./common");

const ImporterFieldType = z.enum([
  "text",
  "int",
  "number",
  "money",
  "phone",
  "email",
  "enum",
  "date",
  "boolean",
  "reference",
]);

const ImportBatchStatus = z.enum([
  "uploaded",
  "mapped",
  "previewed",
  "committed",
  "reverted",
  "failed",
]);

const ImportRowStatus = z.enum([
  "ok",
  "warning",
  "error",
  "duplicate",
  "unchanged",
  "skipped",
]);

const ImportRowAction = z.enum(["create", "update", "none"]);

/** One column an importer takes, as the Map step draws it. */
const ImporterField = z
  .object({
    key: z.string(),
    label: z.string(),
    type: ImporterFieldType,
    required: z.boolean(),
    aliases: z.array(z.string()),
    options: z.array(z.object({ value: z.string(), label: z.string() }).strict()),
    ref: z.string().nullable(),
    pass: z.number().int().min(1).max(2),
    create_missing: z.boolean(),
    masked: z.boolean(),
    example: z.string().nullable(),
    hint: z.string().nullable(),
  })
  .strict();

/** What can be imported, as this caller may run it. */
const Importer = z
  .object({
    key: z.string(),
    label: z.string(),
    entity: z.string(),
    permission: z.string(),
    match_keys: z.array(z.string()),
    fields: z.array(ImporterField),
  })
  .strict();

/** GET /imports/importers. A registry of code, not a list of records. */
const ImporterList = z.object({ importers: z.array(Importer) }).strict();

/** GET /imports/importers/:key/template and GET /imports/:id/report. */
const ImporterKeyParams = z
  .object({
    key: z.string().regex(/^[a-z][a-z0-9_]*$/, "Pick an import that exists"),
  })
  .strict();

/** One column of the sheet, and the field it feeds. */
const ImportMappingColumn = z
  .object({
    index: z.number().int().min(0),
    header: z.string(),
    field: z.string().nullable(),
  })
  .strict();

const ImportMapping = z
  .object({ columns: z.array(ImportMappingColumn) })
  .strict();

/** The counts a preview or a commit produced. */
const ImportStats = z
  .object({
    rows: z.number().int().min(0),
    create: z.number().int().min(0),
    update: z.number().int().min(0),
    unchanged: z.number().int().min(0),
    warning: z.number().int().min(0),
    error: z.number().int().min(0),
    duplicate: z.number().int().min(0),
    /** Referenced values that do not exist yet, per field, to tick before a commit. */
    missing: z.record(z.array(z.string())),
    /** The file's sheets, so the Map step can offer another one. */
    sheets: z.array(z.string()).optional(),
    header_signature: z.string().optional(),
    profile_applied: z.boolean().optional(),
    /** The run committed only the rows that were right; recorded on the batch. */
    valid_only: z.boolean().optional(),
    /** The import was started and left, and the cleanup closed it. */
    expired: z.boolean().optional(),
  })
  .strict();

/** One batch: a file somebody uploaded, and what became of it. */
const ImportBatch = z
  .object({
    import_batch_id: uuid,
    number: z.string(),
    importer_key: z.string(),
    importer_label: z.string(),
    document_id: uuid,
    file_name: z.string(),
    sheet: z.string().nullable(),
    header_row: z.number().int().min(0).nullable(),
    mapping: ImportMapping,
    options: z.record(z.unknown()),
    status: ImportBatchStatus,
    stats: ImportStats.partial(),
    created_by_name: z.string().nullable(),
    created_at: isoDateTime,
    previewed_at: isoDateTime.nullable(),
    committed_at: isoDateTime.nullable(),
    reverted_at: isoDateTime.nullable(),
  })
  .strict();

/** POST /imports: the text fields beside the file in the multipart. */
const ImportCreate = z
  .object({
    importer_key: z
      .string()
      .regex(/^[a-z][a-z0-9_]*$/, "Pick an import that exists"),
    purpose: z.literal("import_sheet").optional(),
  })
  .strict();

/** PUT /imports/:id/mapping: column index to field key, null to ignore a column. */
const ImportMappingSet = z
  .object({
    sheet: optionalText(120),
    header_row: z.coerce.number().int().min(0).max(999).optional(),
    fields: z.record(
      z.string().regex(/^\d+$/, "a column number"),
      z.string().regex(/^[a-z][a-z0-9_]*$/).nullable(),
    ),
    save_profile: z.boolean().optional(),
    profile_name: optionalText(120),
  })
  .strict();

/** POST /imports/:id/preview and /commit. */
const ImportRun = z
  .object({
    valid_only: z.boolean().optional(),
    create_missing: z.record(z.array(text(200))).optional(),
  })
  .strict();

/** What a preview or a commit answers with. */
const ImportResult = z
  .object({ batch: ImportBatch, stats: ImportStats })
  .strict();

/** What a revert answers with. */
const ImportRevertResult = z
  .object({
    batch: ImportBatch,
    archived: z.number().int().min(0),
    restored: z.number().int().min(0),
  })
  .strict();

/** One row of the sheet, as the Preview step shows it. */
const ImportRowRecord = z
  .object({
    import_row_id: uuid,
    row_number: z.number().int().min(1),
    raw: z.record(z.unknown()),
    values: z.record(z.unknown()).nullable(),
    status: ImportRowStatus,
    problems: z.array(
      z
        .object({ field: z.string().nullable(), message: z.string() })
        .strict(),
    ),
    action: ImportRowAction.nullable(),
    target_id: z.string().nullable(),
    diff: z.record(z.array(z.unknown())).nullable(),
  })
  .strict();

const ImportRowListQuery = listQuery({ status: ImportRowStatus.optional() }, [
  "row_number",
]);
const ImportRowPage = Paged(ImportRowRecord);

/** GET /imports: the history. */
const ImportListQuery = listQuery(
  {
    importer: z
      .string()
      .regex(/^[a-z][a-z0-9_]*$/, "Pick an import that exists")
      .optional(),
    status: ImportBatchStatus.optional(),
  },
  ["created_at"],
);
const ImportPage = Paged(ImportBatch);

/** Which table each schema is a row of (gate 6, check/contract-columns.js). */
const TABLES = {
  ImporterField: {
    table: null,
    reason: "one column an importer declares in code, for the Map step",
  },
  Importer: {
    table: null,
    reason: "an importer as the registry declares it; importers are code, not rows",
  },
  ImporterList: { table: null, reason: "the importers this caller may run" },
  ImporterKeyParams: { table: null, reason: "the :key of an importer's path" },
  ImportMappingColumn: {
    table: null,
    reason: "one entry of import_batch.mapping jsonb",
  },
  ImportMapping: { table: null, reason: "import_batch.mapping jsonb" },
  ImportStats: { table: null, reason: "import_batch.stats jsonb" },
  ImportBatch: {
    table: "import_batch",
    virtual: {
      importer_label: "the importer's label, from the registry in code",
      created_by_name: "who uploaded it, joined from app_user and employee",
    },
  },
  ImportCreate: {
    table: null,
    reason: "the text fields beside the sheet in a multipart upload",
  },
  ImportMappingSet: {
    table: null,
    reason: "the sheet, header row and column choices that build import_batch.mapping",
  },
  ImportRun: {
    table: null,
    reason: "the two choices a preview or a commit takes, recorded on the batch",
  },
  ImportResult: { table: null, reason: "the batch and its counts after a run" },
  ImportRevertResult: {
    table: null,
    reason: "the batch and how many records a revert put back",
  },
  ImportRowRecord: { table: "import_row" },
  ImportRowListQuery: {
    table: null,
    reason: "list controls and the status filter for a batch's rows",
  },
  ImportRowPage: { table: null, reason: "a page of a batch's rows" },
  ImportListQuery: {
    table: null,
    reason: "list controls and the filters for the import history",
  },
  ImportPage: { table: null, reason: "a page of the import history" },
};

module.exports = {
  TABLES,
  ImporterFieldType,
  ImportBatchStatus,
  ImportRowStatus,
  ImportRowAction,
  ImporterField,
  Importer,
  ImporterList,
  ImporterKeyParams,
  ImportMappingColumn,
  ImportMapping,
  ImportStats,
  ImportBatch,
  ImportCreate,
  ImportMappingSet,
  ImportRun,
  ImportResult,
  ImportRevertResult,
  ImportRowRecord,
  ImportRowListQuery,
  ImportRowPage,
  ImportListQuery,
  ImportPage,
};
