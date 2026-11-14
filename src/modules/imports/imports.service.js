"use strict";
/**
 * Imports: the API over every importer a module registers
 * (BACKEND_STRUCTURE §9.3). Nothing here knows what is being imported. An
 * importer declares its fields, its match keys and the service it writes
 * through; the engine (shared/import/engine.js) does the work, and this file is
 * the door the screen comes through.
 *
 * Who may run an import is the importer's own permission ("people" create for
 * the staff sheet), so it cannot be decided when the route is defined: the key
 * arrives in the request. Every call therefore asks the engine, which refuses a
 * caller who does not hold it (engine.assertMay). Reading the history is the
 * `settings` view grant, checked on the route.
 *
 * The preview is the real commit, run inside a transaction that is rolled back,
 * so the counts a person sees before committing are what committing will do.
 */
const { pool } = require("../../config/db");
const { atomically } = require("../../shared/db/tx");
const { AppError } = require("../../shared/errors");
const registry = require("../../shared/import/registry");
const engine = require("../../shared/import/engine");
const report = require("../../shared/import/report");
const { revert: revertBatch } = require("../../shared/import/revert");
const { scopeFor } = require("../../middleware/rbac");
const { maskedKeysFor } = require("../../shared/rbac/field-mask");
const mapping = require("../../shared/import/mapping");
const repo = require("./imports.repo");

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

/** One importer, as the Map step draws it: its fields, with nothing executable. */
const importerOf = (imp) => ({
  key: imp.key,
  label: imp.label,
  entity: imp.entity,
  permission: `${imp.permission[0]}.${imp.permission[1]}`,
  match_keys: [...imp.matchKeys],
  fields: imp.fields.map((f) => ({
    key: f.key,
    label: f.label,
    type: f.type || "text",
    required: f.required === true,
    aliases: [...(f.aliases || [])],
    options: registry.optionsOf(f),
    ref: f.ref || null,
    pass: f.pass || 1,
    create_missing: Boolean(f.createMissing),
    masked: Boolean(f.mask),
    example: f.example || null,
    hint: f.hint || null,
    map_values: f.mapValues ? f.mapValues.kind : null,
  })),
});

/** One batch, with the importer's label beside its key. */
function batchOf(row) {
  const imp = registry.get(row.importer_key);
  return {
    ...row,
    importer_label: imp ? imp.label : row.importer_key,
    created_by_name: row.created_by_name || null,
  };
}

const withBatch = async (row) => batchOf(await repo.get(pool, row.import_batch_id));

/** What this caller may import. */
const importers = async (user) => ({
  importers: (await registry.availableTo(pool, user)).map(importerOf),
});

/** The blank sheet for an importer: its columns, with a Reference sheet. */
async function template(user, key) {
  const imp = engine.importerOf(key);
  await engine.assertMay(pool, user, imp);
  return report.template(imp);
}

/**
 * May this caller see the batch at all? Either they may run its importer, or
 * they read the history, which is the `settings` view grant.
 */
async function assertMayRead(user, batch) {
  const imp = registry.get(batch.importer_key);
  if (imp) {
    try {
      await engine.assertMay(pool, user, imp);
      return;
    } catch {
      /* not theirs to run; the history grant is the other way in */
    }
  }
  if (!(await scopeFor(user, "settings", "view")))
    throw new AppError("NOT_FOUND", "Import not found", 404);
}

/** Upload: store the sheet, find the header, map the columns. */
async function create(file, body, actor) {
  if (!file)
    throw new AppError("FILE_REQUIRED", "Choose a file to upload", 422, {
      file: ["is required"],
    });
  const row = await tx((client) =>
    engine.createBatch(client, {
      importer_key: body.importer_key,
      file,
      actor,
    }),
  );
  return withBatch(row);
}

async function get(user, batchId) {
  const batch = await engine.loadBatch(pool, batchId);
  await assertMayRead(user, batch);
  return batchOf(await repo.get(pool, batchId));
}

/** Confirm or correct which column feeds which field. */
async function setMapping(batchId, body, actor) {
  const row = await tx((client) =>
    engine.setMapping(client, batchId, body, actor),
  );
  return withBatch(row);
}

/** Map Values: every distinct value of each list, person or place column, with what it maps to. */
async function values(user, batchId) {
  const client = await pool.connect();
  try {
    return await engine.valuesOf(client, batchId, user);
  } finally {
    client.release();
  }
}

/** Save what Map Values chose; the preview runs again after. */
async function setValues(batchId, body, actor) {
  const row = await tx((client) => engine.setValues(client, batchId, body, actor));
  return withBatch(row);
}

/** Validate, match and run the whole commit, rolled back. */
async function preview(batchId, body, actor) {
  const out = await engine.preview(batchId, { ...body, actor });
  return { batch: await withBatch(out.batch), stats: out.stats };
}

/** The same code path, committed. */
async function commit(batchId, body, actor) {
  const out = await engine.commit(batchId, { ...body, actor });
  return { batch: await withBatch(out.batch), stats: out.stats };
}

/** Undo a committed import: records it created archived, records it updated restored. */
async function revert(batchId, actor) {
  const out = await revertBatch(batchId, { actor });
  return {
    batch: await withBatch(out.batch),
    archived: out.archived,
    restored: out.restored,
  };
}

/**
 * A page of the sheet's rows, as the Preview step shows them. A restricted column (bank,
 * personal) is blanked for a reader masked from it, in the cells, the values and the changes,
 * exactly as the error file blanks it.
 */
async function rows(user, batchId, query) {
  const batch = await engine.loadBatch(pool, batchId);
  await assertMayRead(user, batch);
  const page = await engine.rowsOf(pool, batchId, query);
  const imp = registry.get(batch.importer_key);
  const masked = new Set(await maskedKeysFor(pool, user));
  const keys = new Set(imp ? imp.fields.filter((f) => f.mask && masked.has(f.mask)).map((f) => f.key) : []);
  if (keys.size === 0) return page;
  const headers = new Set(
    ((batch.mapping && batch.mapping.columns) || [])
      .filter((c) => keys.has(c.field))
      .map((c) => mapping.normalise(c.header === "" ? `Column ${c.index + 1}` : c.header)),
  );
  const blank = (obj, hidden) =>
    obj && Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, hidden(k) ? null : v]));
  return {
    ...page,
    data: page.data.map((r) => ({
      ...r,
      raw: blank(r.raw, (k) => headers.has(mapping.normalise(k))),
      values: blank(r.values, (k) => keys.has(k)),
      diff: r.diff && Object.fromEntries(Object.entries(r.diff).filter(([k]) => !keys.has(k))),
    })),
  };
}

/** The error file: the person's own rows and columns, plus Status and Problem. */
async function errorFile(user, batchId) {
  const batch = await engine.loadBatch(pool, batchId);
  await assertMayRead(user, batch);
  return report.errorFile(pool, batchId, user);
}

/** The history: every batch, newest first. */
async function history(query) {
  const page = await repo.history(pool, query);
  return { ...page, data: page.data.map(batchOf) };
}

/* ------------------------------------------------------------------ *
 * The assistant's summary (docs/guides/praxis-ai.md §6.13, Workspace, Knowledge Hub, Community, Home and Settings)
 * ------------------------------------------------------------------ */

/** A batch's status as the history reads it. */
const STATUS_WORDS = Object.freeze({
  committed: "Committed",
  reverted: "Reverted",
  failed: "Failed",
  previewed: "Previewed",
  mapped: "Mapped",
  uploaded: "Uploaded",
});
const ROW_PARTS = Object.freeze([
  { key: "imported", label: "Imported" },
  { key: "refused", label: "Refused", optional: true },
]);

/**
 * Every import in figures, as Import History lists them: every one unless a period (started) is asked;
 * by importer stacked by the rows imported and refused, by status, by month. Runs on the client the
 * assistant hands over.
 * @param {{query: Function}} client
 * @param {object} params   ImportSummaryQuery, parsed
 */
async function aiSummary(client, params, now = new Date()) {
  const { figure, group, series, askedPeriod, stacked } = require("../../shared/ai/summary");
  const period = askedPeriod(params, now);
  const r = await repo.aiSummary(client, { importer: params.importer, status: params.status, from: period && period.from, to: period && period.to });
  const f = r.figures;
  const counted = new Map(r.by_status.map((x) => [x.key, x.value]));
  const labelOf = (key) => (registry.get(key) ? registry.get(key).label : key);
  const groups = [
    group("importer", "Rows by importer", stacked(r.by_importer.map((x) => ({ ...x, label: labelOf(x.key) })), ROW_PARTS)),
    group("status", "Imports by status", Object.keys(STATUS_WORDS).filter((k) => counted.has(k)).map((k) => ({ key: k, label: STATUS_WORDS[k], value: counted.get(k) }))),
  ];
  if (params.by === "status") groups.reverse();
  return {
    figures: [
      figure("imports", "Imports", f.imports || 0),
      figure("committed", "Committed", f.committed || 0),
      figure("reverted", "Reverted", f.reverted || 0),
      figure("failed", "Failed", f.failed || 0),
      figure("in_progress", "In progress", f.in_progress || 0),
      figure("imported", "Rows imported", f.imported || 0),
      figure("refused", "Rows refused", f.refused || 0),
      figure("created", "Records created", f.created || 0),
      figure("updated", "Records updated", f.updated || 0),
    ],
    groups,
    series: [series("imports", "Imports by month", r.by_month)],
    total: f.imports || 0,
  };
}

module.exports = {
  aiSummary,
  importerOf,
  batchOf,
  importers,
  template,
  create,
  get,
  setMapping,
  values,
  setValues,
  preview,
  commit,
  revert,
  rows,
  errorFile,
  history,
};
