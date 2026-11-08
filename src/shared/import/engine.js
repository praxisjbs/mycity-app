"use strict";
/**
 * The import engine (BACKEND_STRUCTURE §9): a spreadsheet in, records out, through the
 * owning module's own service, with a preview that is the real result.
 *
 *   upload    createBatch()   store the file, parse, find the header, map columns (or a saved profile)
 *   map       setMapping()    the person confirms or corrects the mapping
 *   values    valuesOf(), setValues()   Map Values: each distinct value of a list, person or
 *                             place column, shown once with its row count, mapped to a list value,
 *                             created (ticked) or left empty; kept on the mapping and its profile
 *   preview   preview()       the WHOLE commit, run inside a transaction that is rolled back:
 *                             per-row action (create, update, unchanged), field-level changes,
 *                             every problem, "will be created" lists. Not a simulation.
 *   commit    commit()        the same code path, committed. All-or-nothing unless the person
 *                             chose "commit valid rows only", which is recorded on the batch
 *   report    report.js       the error file: their own rows and columns, plus Status and Problem
 *   revert    revert.js       creates archived, updates restored, refused where changed since
 *
 * How a row is processed:
 *   coerce     each mapped cell to its field type (money as a decimal string, phone to +234,
 *              dates day-first or Excel serials; an ambiguous date is an error, never a guess)
 *   validate   the row against the importer's contract schema, the same rules as the screen
 *   duplicate  a match-key value seen earlier in the file → "duplicate", not written
 *   match      the existing record by the match keys, in order; two keys naming two
 *              different records → "conflict"
 *   pass 1     references resolved (an unknown department is "will be created" when the field
 *              allows it and the person ticked it), then the row written: create or update,
 *              or "unchanged" when nothing differs. Each row in its own SAVEPOINT, so one bad
 *              row does not abort the others
 *   pass 2     references to other rows of the same file (line manager) resolved against the
 *              now-complete set, cycles refused, then linked
 *
 * Every write carries the batch id in the request context, so each audit row names its
 * batch, and revert can tell a later edit from the import's own.
 *
 * Tables (migration 0085; BACKEND_STRUCTURE §11.1): import_batch, import_row, import_mapping_profile.
 */
const crypto = require("node:crypto");
const { AppError } = require("../errors");
const { atomically, inTransaction } = require("../db/tx");
const requestContext = require("../../config/request-context");
const numbering = require("../numbering/numbering");
const money = require("../money/money");
const { emit } = require("../events/emit");
const { defineEvents } = require("../events/catalogue");
const { pageQuery, TOTAL_COL } = require("../http/paged");
const { readDate } = require("../spreadsheet/day-first-cells");
const { readSheets } = require("../spreadsheet/parse");
const vault = require("../documents/vault");
const storage = require("../../services/storage/storage.service");
const registry = require("./registry");
const mapping = require("./mapping");

const EVENTS = defineEvents("settings", {
  "import.batch_created": { summary: "A spreadsheet was uploaded for import" },
  "import.committed": { summary: "An import was committed" },
  "import.reverted": { summary: "An import was reverted" },
  "import.expired": {
    summary: "An unfinished import was closed after it was left",
  },
});

const BATCH_COLUMNS = `import_batch_id, number, importer_key, document_id, file_name, sheet, header_row, mapping, options,
  status, stats, created_by, created_at, previewed_at, committed_at, committed_by, reverted_at, reverted_by`;

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const ROLLBACK = Symbol("preview rollback");

/* ------------------------------------------------------------------ *
 * Coercion
 * ------------------------------------------------------------------ */

const BOOLEAN = new Map([
  ["yes", true],
  ["y", true],
  ["true", true],
  ["1", true],
  ["no", false],
  ["n", false],
  ["false", false],
  ["0", false],
]);

/**
 * One cell to its field's type.
 * @param {object} field
 * @param {*} raw
 * @param {{pad?: number}} [opts]  pad: the padding of the number a `sequenceOf` field holds
 * @returns {{value: *, error: string|null}}  value null for an empty cell
 */
function coerce(field, raw, opts = {}) {
  const empty =
    raw === null ||
    raw === undefined ||
    (typeof raw === "string" && raw.trim() === "");
  if (empty)
    return { value: null, error: field.required ? "is required" : null };
  const type = field.type || "text";
  const text = raw instanceof Date ? null : String(raw).trim();
  switch (type) {
    case "text":
    case "reference": {
      if (raw instanceof Date)
        return { value: null, error: "should be text, not a date" };
      let value = text;
      if (opts.pad && /^\d+$/.test(value) && value.length < opts.pad)
        value = value.padStart(opts.pad, "0");
      if (typeof field.clean === "function") value = field.clean(value);
      return value.length > (field.max || 500)
        ? { value: null, error: `is longer than ${field.max || 500} characters` }
        : { value, error: null };
    }
    case "int": {
      const n = Number(text.replace(/,/g, ""));
      return Number.isInteger(n)
        ? { value: n, error: null }
        : { value: null, error: "should be a whole number" };
    }
    case "number": {
      const n = Number(text.replace(/,/g, ""));
      return Number.isFinite(n)
        ? { value: n, error: null }
        : { value: null, error: "should be a number" };
    }
    case "money": {
      const cleaned =
        typeof raw === "number"
          ? raw.toFixed(2)
          : text.replace(/[₦,\s]/g, "").replace(/^NGN/i, "");
      try {
        return { value: money.toWire(money.money(cleaned)), error: null };
      } catch {
        return { value: null, error: "should be an amount, like 250000.00" };
      }
    }
    case "phone": {
      const c = require("@mycity/contract");
      // A number cell has lost its leading 0; the contract reads ten digits and 234... alike.
      const r = c.common.phone.safeParse(
        typeof raw === "number" ? String(raw) : text,
      );
      return r.success
        ? { value: r.data, error: null }
        : { value: null, error: "should be a Nigerian phone number" };
    }
    case "email": {
      const v = text.toLowerCase();
      return EMAIL_RE.test(v)
        ? { value: v, error: null }
        : { value: null, error: "should be an email address" };
    }
    case "enum": {
      const choices = registry.optionsOf(field);
      const n = mapping.normalise(text);
      const hit = registry
        .spellingsOf(field)
        .find((o) => o.names.some((name) => mapping.normalise(name) === n));
      return hit
        ? { value: hit.value, error: null }
        : {
            value: null,
            error: `should be one of: ${choices.map((o) => o.label).join(", ")}`,
          };
    }
    case "date": {
      const r = readDate(raw);
      return r.error
        ? { value: null, error: r.error }
        : { value: r.date, error: null };
    }
    case "boolean": {
      const b = BOOLEAN.get(mapping.normalise(text));
      return b === undefined
        ? { value: null, error: "should be Yes or No" }
        : { value: b, error: null };
    }
    default:
      return { value: null, error: `unknown type ${type}` };
  }
}

/* ------------------------------------------------------------------ *
 * Rows from the sheet
 * ------------------------------------------------------------------ */

const fieldMap = (imp) => new Map(imp.fields.map((f) => [f.key, f]));

/** What Map Values chose for one value of a field: { to } (null: left empty), { create: true }, or undefined. */
function targetOf(values, fieldKey, value) {
  const byValue = values && values[fieldKey];
  if (!byValue) return undefined;
  const hit = byValue[mapping.normalise(value instanceof Date ? value.toISOString().slice(0, 10) : value)];
  return hit && typeof hit === "object" ? hit : undefined;
}

/** The values one cell of a Map Values field holds: split when the field says so, empty and skipped ones left out. */
function piecesOf(field, cell) {
  if (cell === null || cell === undefined) return [];
  const text = cell instanceof Date ? cell.toISOString().slice(0, 10) : String(cell).trim();
  if (!text) return [];
  const mv = field.mapValues || {};
  const pieces = typeof mv.split === "function" ? mv.split(text) : [text];
  return pieces.map((p) => String(p).trim()).filter((p) => p && !(typeof mv.skip === "function" && mv.skip(p)));
}

/**
 * The data rows under the header, coerced and validated. Pure.
 *
 * `options.skip_unreadable_optional` (the roster loader's): a cell of an optional column that
 * does not read as its field is left out with a note, instead of failing the whole row, so one
 * "N/A" under Gender never keeps a person off the register.
 *
 * @param {{options?: object, pads?: Record<string, number>}} [opts]
 * @returns {Array<{row_number, raw, values, problems, status}>}
 */
function buildRows(imp, grid, headerRow, columnsMap, { options = {}, pads = {} } = {}) {
  const fields = fieldMap(imp);
  const chosen = (columnsMap && columnsMap.values) || {};
  const header = grid[headerRow] || [];
  const mapped = columnsMap.columns.filter(
    (c) => c.field && fields.has(c.field),
  );
  const out = [];
  for (let i = headerRow + 1; i < grid.length; i += 1) {
    const cells = grid[i] || [];
    if (cells.every((v) => v === null || v === undefined || v === "")) continue;
    const raw = {};
    header.forEach((h, idx) => {
      raw[
        h === null || h === undefined || h === ""
          ? `Column ${idx + 1}`
          : String(h)
      ] =
        cells[idx] instanceof Date
          ? cells[idx].toISOString().slice(0, 10)
          : (cells[idx] ?? null);
    });
    const values = {};
    const problems = [];
    const notes = [];
    for (const c of mapped) {
      const f = fields.get(c.field);
      let cell = cells[c.index];
      // An enum value mapped on Map Values reads as the option it was mapped to, or as empty.
      if (f.mapValues && (f.type || "text") === "enum" && cell !== null && cell !== undefined) {
        const target = targetOf(chosen, f.key, cell);
        if (target && target.to === null) cell = null;
        else if (target && target.to) cell = target.to;
      }
      const { value, error } = coerce(f, cell, { pad: pads[f.key] });
      const optional = !f.required && !imp.matchKeys.includes(f.key);
      if (error && optional && options.skip_unreadable_optional)
        notes.push({ field: f.key, message: `${f.label} ${error}; left out` });
      else if (error)
        problems.push({ field: f.key, message: `${f.label} ${error}` });
      else if (value !== null) values[f.key] = value;
    }
    for (const f of fields.values()) {
      if (f.required && !mapped.some((c) => c.field === f.key))
        problems.push({ field: f.key, message: `${f.label} is required` });
    }
    if (problems.length === 0) {
      const parsed = imp.schema.safeParse(values);
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          const key = issue.path[0];
          const label = fields.has(key)
            ? fields.get(key).label
            : String(key || "Row");
          problems.push({
            field: key || null,
            message: `${label}: ${issue.message}`,
          });
        }
      } else Object.assign(values, parsed.data); // the contract's own form: trimmed, upper-cased
    }
    out.push({
      row_number: i + 1,
      raw,
      values,
      problems: [...problems, ...notes],
      status: problems.length ? "error" : "ok",
      action: "none",
      target_id: null,
      before: null,
      diff: null,
    });
  }
  return out;
}

/** Second and later rows sharing a match-key value with an earlier row. Mutates rows. */
function markDuplicates(imp, rows) {
  const seen = new Map();
  for (const row of rows) {
    if (row.status === "error") continue;
    for (const key of imp.matchKeys) {
      const v = row.values[key];
      if (v === undefined || v === null) continue;
      const id = `${key}:${mapping.normalise(v)}`;
      if (seen.has(id)) {
        row.status = "duplicate";
        row.problems.push({
          field: key,
          message: `Same ${fieldMap(imp).get(key).label} as row ${seen.get(id)}`,
        });
        break;
      }
      seen.set(id, row.row_number);
    }
  }
}

/* ------------------------------------------------------------------ *
 * Batches
 * ------------------------------------------------------------------ */

async function loadBatch(client, id, { forUpdate = false } = {}) {
  const { rows } = await client.query(
    `SELECT ${BATCH_COLUMNS} FROM import_batch WHERE import_batch_id = $1${forUpdate ? " FOR UPDATE" : ""}`,
    [id],
  );
  if (!rows[0]) throw new AppError("NOT_FOUND", "Import not found", 404);
  return rows[0];
}

function importerOf(key) {
  const imp = registry.get(key);
  if (!imp) throw new AppError("NOT_FOUND", `There is no "${key}" import`, 404);
  return imp;
}

/** Refuse a user who does not hold the importer's permission (the CEO always may). */
async function assertMay(client, user, imp) {
  const may = await registry.availableTo(client, user);
  if (!may.includes(imp))
    throw new AppError("PERMISSION_DENIED", "You cannot run this import", 403);
}

/** The one sheet an `extract` importer's rows make. */
const EXTRACTED = "Rows";

/**
 * A workbook's sheets as the importer reads them. An importer with `extract(sheets)` takes a
 * whole workbook as the business keeps it (a planning workbook, not one table) and answers
 * `{ rows, notes }`, each row keyed by field: its rows become one sheet whose header is the
 * importer's field labels, so mapping, preview, errors, commit and revert work as for any sheet.
 * @returns {{sheets: Array<{name: string, rows: Array<Array<*>>}>, notes: string[]}}
 */
function sheetsFor(imp, sheets) {
  if (typeof imp.extract !== "function") return { sheets, notes: [] };
  const { rows = [], notes = [] } = imp.extract(sheets) || {};
  const header = imp.fields.map((f) => f.label);
  const grid = rows.map((r) => imp.fields.map((f) => (r[f.key] === undefined ? null : r[f.key])));
  return { sheets: [{ name: EXTRACTED, rows: [header, ...grid] }], notes };
}

async function sourceGrid(client, batch) {
  const doc = await vault.get(client, batch.document_id);
  if (!doc)
    throw new Error(
      `import ${batch.import_batch_id}: its source file record is gone`,
    );
  const book = await readSheets({
    buffer: await storage.get(doc.storage_key),
    filename: doc.original_name,
  });
  return sheetsFor(importerOf(batch.importer_key), book.sheets).sheets;
}

function sheetOf(sheets, name) {
  const s = sheets.find((x) => x.name === name);
  if (!s)
    throw new AppError(
      "IMPORT_SHEET_MISSING",
      `The file has no sheet called "${name}"`,
      422,
    );
  return s;
}

const moduleOf = (imp) => imp.permission[0];

/**
 * Upload: store the source file, parse it, find the header, map the columns.
 *
 * `options` is the importer's own, kept on the batch and handed to every row as
 * `ctx.options`, so a caller that is not a person can say how the importer should
 * behave (the staff roster loader asks it to keep what the app already has:
 * docs/guides/foundation.md §6.1). The Import wizard sends none.
 *
 * @param {import("pg").PoolClient} client  inside atomically()
 * @param {{importer_key: string, file: {buffer: Buffer, originalname: string}, actor: object,
 *          options?: object}} opts
 */
async function createBatch(client, { importer_key: key, file, actor, options = {} }) {
  if (!inTransaction(client))
    throw new Error("import.createBatch must run inside atomically()");
  const imp = importerOf(key);
  await assertMay(client, actor, imp);
  const id = crypto.randomUUID();
  const book = await readSheets({
    buffer: file && file.buffer,
    filename: file && file.originalname,
  });
  const { sheets, notes } = sheetsFor(imp, book.sheets);
  const doc = await vault.store(client, {
    file,
    purpose: "import_sheet",
    doc_type: "import_source",
    entity: { type: "import_batch", id },
    sensitivity: "restricted",
    source: "import",
    actor,
  });

  let sheet = sheets[0];
  let headerRow = null;
  for (const s of sheets) {
    const h = mapping.detectHeaderRow(s.rows, imp.fields);
    if (h !== null) {
      sheet = s;
      headerRow = h;
      break;
    }
  }
  if (!sheet)
    throw new AppError("IMPORT_EMPTY", "The file has no sheets with data", 422);
  const headerCells = headerRow === null ? [] : sheet.rows[headerRow];
  const signature = mapping.headerSignature(headerCells);
  const profile =
    headerRow === null
      ? null
      : await mapping.findProfile(client, key, signature);
  const columns =
    headerRow === null
      ? { columns: [] }
      : profile
        ? mapping.applyProfile(profile, headerCells)
        : mapping.autoMap(headerCells, imp.fields);
  const number = (await numbering.allocate(client, "import_batch")).number;
  const dataRows =
    headerRow === null
      ? 0
      : sheet.rows
          .slice(headerRow + 1)
          .filter((r) => r.some((v) => v !== null && v !== "")).length;

  const { rows } = await client.query(
    `INSERT INTO import_batch
       (import_batch_id, number, importer_key, document_id, file_name, sheet, header_row, mapping, options, status, stats, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $12::jsonb, $9, $10::jsonb, $11)
     RETURNING ${BATCH_COLUMNS}`,
    [
      id,
      number,
      key,
      doc.document_id,
      doc.original_name,
      sheet.name,
      headerRow,
      JSON.stringify(columns),
      headerRow === null ? "uploaded" : "mapped",
      JSON.stringify({
        rows: dataRows,
        sheets: book.sheets.map((s) => s.name),
        header_signature: signature,
        profile_applied: Boolean(profile),
        ...(notes.length ? { notes } : {}),
      }),
      actor ? actor.user_id : null,
      JSON.stringify(options || {}),
    ],
  );
  await emit(client, {
    key: EVENTS.IMPORT_BATCH_CREATED,
    entity: { type: "import_batch", id },
    module: moduleOf(imp),
    actor,
    payload: { import_batch_id: id, importer_key: key, rows: dataRows },
  });
  return rows[0];
}

/**
 * Confirm or correct the mapping.
 * @param {import("pg").PoolClient} client  inside atomically()
 * @param {string} batchId
 * @param {{sheet?: string, header_row?: number, fields?: Record<number, string|null>, save_profile?: boolean, profile_name?: string}} input
 *   fields  column index → field key (null to ignore the column). Left out, the columns of the
 *           chosen header row are matched afresh (autoMap) and the person confirms them: the
 *           way past a sheet whose header row was not found on upload
 */
async function setMapping(client, batchId, input, actor) {
  if (!inTransaction(client))
    throw new Error("import.setMapping must run inside atomically()");
  const batch = await loadBatch(client, batchId, { forUpdate: true });
  if (!["uploaded", "mapped", "previewed"].includes(batch.status))
    throw new AppError(
      "IMPORT_CLOSED",
      `This import is already ${batch.status}`,
      409,
    );
  const imp = importerOf(batch.importer_key);
  await assertMay(client, actor, imp);
  const sheets = await sourceGrid(client, batch);
  const sheet = sheetOf(sheets, input.sheet || batch.sheet);
  const headerRow =
    input.header_row === undefined || input.header_row === null
      ? batch.header_row
      : Number(input.header_row);
  if (
    !Number.isInteger(headerRow) ||
    headerRow < 0 ||
    headerRow >= sheet.rows.length
  )
    throw new AppError(
      "IMPORT_HEADER_ROW",
      "Choose the row that holds the column names",
      422,
    );
  const headerCells = sheet.rows[headerRow];
  // The values a person mapped stay with the batch while its columns are corrected.
  const keptValues = batch.mapping && batch.mapping.values ? { values: batch.mapping.values } : {};
  if (input.fields === undefined || input.fields === null) {
    const auto = { ...mapping.autoMap(headerCells, imp.fields), ...keptValues };
    const { rows } = await client.query(
      `UPDATE import_batch SET sheet = $2, header_row = $3, mapping = $4::jsonb, status = 'mapped', previewed_at = NULL
        WHERE import_batch_id = $1 RETURNING ${BATCH_COLUMNS}`,
      [batchId, sheet.name, headerRow, JSON.stringify(auto)],
    );
    return rows[0];
  }
  const columns = {
    columns: headerCells.map((cell, index) => ({
      index,
      header: cell === null || cell === undefined ? "" : String(cell),
      field: Object.prototype.hasOwnProperty.call(input.fields || {}, index)
        ? input.fields[index] || null
        : null,
    })),
    ...keptValues,
  };
  const problems = mapping.problemsOf(columns, imp.fields);
  if (problems.length)
    throw new AppError("IMPORT_MAPPING_INVALID", problems[0], 422, {
      mapping: problems,
    });
  if (input.save_profile) {
    await mapping.saveProfile(client, {
      importer_key: imp.key,
      name: input.profile_name,
      signature: mapping.headerSignature(headerCells),
      mapping: columns,
      user_id: actor ? actor.user_id : null,
    });
  }
  const { rows } = await client.query(
    `UPDATE import_batch SET sheet = $2, header_row = $3, mapping = $4::jsonb, status = 'mapped', previewed_at = NULL
      WHERE import_batch_id = $1 RETURNING ${BATCH_COLUMNS}`,
    [batchId, sheet.name, headerRow, JSON.stringify(columns)],
  );
  return rows[0];
}

/* ------------------------------------------------------------------ *
 * Map Values
 * ------------------------------------------------------------------ */

/** The Map Values fields of an importer that the batch's mapping feeds, with their column. */
function valueColumns(imp, batch) {
  const fields = fieldMap(imp);
  return ((batch.mapping && batch.mapping.columns) || [])
    .filter((c) => c.field && fields.has(c.field) && fields.get(c.field).mapValues)
    .map((c) => ({ field: fields.get(c.field), index: c.index }));
}

/** The list a field's values map to: an enum's options, or the importer's choices. */
async function choicesOf(client, imp, field, ctx) {
  if ((field.type || "text") === "enum") return registry.optionsOf(field);
  if (typeof field.mapValues.choices === "function") return (await field.mapValues.choices(client, field, ctx)) || [];
  return [];
}

/** A target's label: its choice's, else the importer's describe(), else none. */
async function labelOf(client, field, to, choices) {
  if (to === null || to === undefined) return null;
  const hit = choices.find((o) => String(o.value) === String(to));
  if (hit) return hit.label;
  if (typeof field.mapValues.describe === "function") return (await field.mapValues.describe(client, field, to)) || null;
  return null;
}

/** The target a value would get if nobody chose: the enum option it reads as, resolve()'s answer, or suggest()'s. */
async function suggestionOf(client, imp, field, value, ctx) {
  const type = field.type || "text";
  if (type === "enum") {
    const { value: v, error } = coerce({ ...field, required: false }, value);
    return error || v === null ? null : v;
  }
  if (type === "reference") return (await imp.resolve(client, field, value, ctx)) || null;
  const s = await field.mapValues.suggest(client, field, value, ctx);
  return s || null;
}

/**
 * Map Values' list (GET /imports/:id/values): for each Map Values field the mapping feeds, every
 * distinct value of its column once, with its row count, what was chosen for it, and what it would
 * get unchosen. The values come from the file, not a table: a file of 100 rows holds at most 100.
 * @returns {Promise<{fields: object[]}>}
 */
async function valuesOf(client, batchId, actor) {
  const batch = await loadBatch(client, batchId);
  const imp = importerOf(batch.importer_key);
  await assertMay(client, actor, imp);
  const columns = valueColumns(imp, batch);
  if (!columns.length) return { fields: [] };
  const sheet = sheetOf(await sourceGrid(client, batch), batch.sheet);
  const chosen = (batch.mapping && batch.mapping.values) || {};
  const ctx = { actor, batch, importer: imp, preview: true, options: batch.options || {}, values: chosen, valueOf: (k, v) => targetOf(chosen, k, v) };
  const out = [];
  for (const { field, index } of columns) {
    const seen = new Map();
    for (const row of sheet.rows.slice((batch.header_row ?? 0) + 1)) {
      // A value counts once a row, however often its cell spells it ("IBADAN, ibadan").
      const once = new Map();
      for (const p of piecesOf(field, (row || [])[index])) if (!once.has(mapping.normalise(p))) once.set(mapping.normalise(p), p);
      for (const [key, piece] of once) {
        if (!key) continue;
        const had = seen.get(key);
        if (had) had.rows += 1;
        else seen.set(key, { value: piece, rows: 1 });
      }
    }
    const choices = await choicesOf(client, imp, field, ctx);
    const values = [];
    for (const [key, v] of [...seen.entries()].sort((a, b) => b[1].rows - a[1].rows || a[1].value.localeCompare(b[1].value))) {
      const target = chosen[field.key] && chosen[field.key][key] ? chosen[field.key][key] : null;
      const suggested = await suggestionOf(client, imp, field, v.value, ctx);
      values.push({
        value: v.value,
        rows: v.rows,
        target: target ? { ...(target.create ? { create: true } : { to: target.to ?? null }) } : null,
        target_label: target && target.to ? await labelOf(client, field, target.to, choices) : null,
        suggested,
        suggested_label: suggested ? await labelOf(client, field, suggested, choices) : null,
      });
    }
    out.push({
      field: field.key,
      label: field.label,
      kind: field.mapValues.kind,
      create_missing: Boolean(field.createMissing),
      choices,
      values,
    });
  }
  return { fields: out };
}

/**
 * Save what Map Values chose (PUT /imports/:id/values), replacing the batch's earlier choices, and
 * with `save_profile` keep them with the columns for the next file of the same header. A list value
 * is one of the field's choices; a person, a place or a created value is checked as the importer
 * says; a value left out of the body is left to the importer's own matching.
 * @param {{values: Record<string, Record<string, {to?: string|null, create?: true}>>, save_profile?: boolean, profile_name?: string}} input
 */
async function setValues(client, batchId, input, actor) {
  if (!inTransaction(client)) throw new Error("import.setValues must run inside atomically()");
  const batch = await loadBatch(client, batchId, { forUpdate: true });
  if (!["mapped", "previewed"].includes(batch.status))
    throw new AppError("IMPORT_CLOSED", `This import is already ${batch.status}`, 409);
  const imp = importerOf(batch.importer_key);
  await assertMay(client, actor, imp);
  const fed = new Map(valueColumns(imp, batch).map((c) => [c.field.key, c.field]));
  const ctx = { actor, batch, importer: imp, preview: true, options: batch.options || {} };
  const saved = {};
  for (const [key, byValue] of Object.entries(input.values || {})) {
    const field = fed.get(key);
    if (!field) throw new AppError("IMPORT_VALUES_INVALID", `No column of this file feeds "${key}"`, 422, { values: [`${key} is not mapped`] });
    const choices = await choicesOf(client, imp, field, ctx);
    saved[key] = {};
    for (const [value, target] of Object.entries(byValue || {})) {
      const norm = mapping.normalise(value);
      if (!norm) continue;
      if (target.create) {
        if (!field.createMissing)
          throw new AppError("IMPORT_VALUES_INVALID", `${field.label} values cannot be created here`, 422, { values: [`${field.label}: pick a value`] });
        saved[key][norm] = { create: true };
        continue;
      }
      const to = target.to ?? null;
      if (to !== null) {
        const known = field.mapValues.kind === "list" ? choices.some((o) => String(o.value) === String(to)) : Boolean(await labelOf(client, field, to, choices));
        if (!known)
          throw new AppError("IMPORT_VALUES_INVALID", `"${value}" is mapped to something ${field.label} does not offer`, 422, { values: [`${field.label}: pick again`] });
      }
      saved[key][norm] = { to };
    }
  }
  const next = { ...(batch.mapping || { columns: [] }), values: saved };
  if (input.save_profile) {
    const sheet = sheetOf(await sourceGrid(client, batch), batch.sheet);
    await mapping.saveProfile(client, {
      importer_key: imp.key,
      name: input.profile_name,
      signature: mapping.headerSignature(sheet.rows[batch.header_row] || []),
      mapping: next,
      user_id: actor ? actor.user_id : null,
    });
  }
  const { rows } = await client.query(
    `UPDATE import_batch SET mapping = $2::jsonb, status = 'mapped', previewed_at = NULL
      WHERE import_batch_id = $1 RETURNING ${BATCH_COLUMNS}`,
    [batchId, JSON.stringify(next)],
  );
  return rows[0];
}

/* ------------------------------------------------------------------ *
 * Running: preview and commit share every line
 * ------------------------------------------------------------------ */

/** A service's field key as the importer's own: the id a reference became is its column. */
function columnOf(imp, key) {
  const keys = new Set(imp.fields.map((f) => f.key));
  if (keys.has(key)) return key;
  const bare = key.replace(/(_seat)?_id$/, "");
  return keys.has(bare) ? bare : null;
}

/**
 * What a refused write says on its row: the service's own sentence, under the label of the
 * column it is about ("Staff Number: Staff number 00012 belongs to ..."), never a field key.
 */
function problemOf(err, imp) {
  if (err instanceof AppError) {
    const keys = err.fields ? Object.keys(err.fields) : [];
    const labels = imp ? fieldMap(imp) : new Map();
    if (keys.length)
      return keys.map((k) => {
        const column = imp ? columnOf(imp, k) : null;
        const label = column ? labels.get(column).label : null;
        return { field: column || k, message: label ? `${label}: ${err.message}` : err.message };
      });
    return [{ field: null, message: err.message }];
  }
  return [{ field: null, message: "This row could not be saved" }];
}

async function inSavepoint(client, fn) {
  await client.query("SAVEPOINT import_row");
  try {
    const out = await fn();
    await client.query("RELEASE SAVEPOINT import_row");
    return { ok: true, out };
  } catch (err) {
    await client.query("ROLLBACK TO SAVEPOINT import_row");
    if (!(err instanceof AppError))
      require("../../config/logger").logger.warn({ err }, "import row failed");
    return { ok: false, err };
  }
}

const same = (a, b) => mapping.normalise(a) === mapping.normalise(b);

/**
 * Rows whose self-reference closes a loop (A manages B manages A). `edges` maps a
 * record id to { to: the id it points at, row }. Only rows ON a loop are returned, not
 * rows that merely lead into one.
 * @returns {Set<number>} row numbers
 */
function cycleRows(edges) {
  const bad = new Set();
  const done = new Set();
  for (const start of edges.keys()) {
    if (done.has(start)) continue;
    const path = [];
    const index = new Map();
    let at = start;
    while (edges.has(at) && !done.has(at) && !index.has(at)) {
      index.set(at, path.length);
      path.push(at);
      at = edges.get(at).to;
    }
    if (index.has(at))
      for (const id of path.slice(index.get(at))) bad.add(edges.get(id).row);
    for (const id of path) done.add(id);
  }
  return bad;
}

async function processRows(client, imp, rows, ctx) {
  const fields = fieldMap(imp);
  const refs1 = imp.fields.filter(
    (f) => f.type === "reference" && f.pass !== 2,
  );
  const refs2 = imp.fields.filter(
    (f) => f.type === "reference" && f.pass === 2,
  );
  const missing = {};

  // Pass 1: match, resolve, write.
  for (const row of rows) {
    if (row.status !== "ok") continue;
    const found = new Map();
    for (const key of imp.matchKeys) {
      const v = row.values[key];
      if (v === undefined || v === null) continue;
      const hit = await imp.find(client, { key, value: v });
      if (hit) found.set(String(hit.id), hit);
    }
    if (found.size > 1) {
      row.status = "error";
      row.problems.push({
        field: null,
        message: `${imp.matchKeys.map((k) => fields.get(k).label).join(" and ")} point at different existing records`,
      });
      continue;
    }
    const existing = found.size ? [...found.values()][0] : null;

    const write = { ...row.values };
    for (const f of refs2) delete write[f.key];
    let refProblem = false;
    for (const f of refs1) {
      const v = row.values[f.key];
      if (v === undefined || v === null) continue;
      const target = f.mapValues ? targetOf(ctx.values, f.key, v) : undefined;
      if (target && target.to === null) {
        delete write[f.key];
        continue;
      }
      let id = target && target.to ? target.to : await imp.resolve(client, f, v, ctx);
      if (!id && f.missing === "leave") {
        delete write[f.key];
        row.problems.push({ field: f.key, message: `${f.label} "${v}" is not matched; saved without it` });
        continue;
      }
      if (!id && f.createMissing) {
        (missing[f.key] = missing[f.key] || new Set()).add(v);
        const ticked =
          Boolean(target && target.create) ||
          (ctx.create_missing[f.key] &&
            [...ctx.create_missing[f.key]].some((x) => same(x, v)));
        if (ticked || ctx.preview) {
          const created = await inSavepoint(client, () =>
            imp.create(client, f, v, ctx),
          );
          if (created.ok) {
            id = created.out;
            if (ctx.preview)
              row.problems.push({
                field: f.key,
                message: `${f.label} "${v}" will be created${ticked ? "" : " if you tick it"}`,
              });
          }
        } else {
          row.problems.push({
            field: f.key,
            message: `${f.label} "${v}" does not exist. Tick it to create it, or correct the cell.`,
          });
          refProblem = true;
          continue;
        }
      }
      if (!id) {
        row.problems.push({
          field: f.key,
          message: `${f.label} "${v}" was not found`,
        });
        refProblem = true;
        continue;
      }
      write[f.key] = id;
    }
    if (refProblem) {
      row.status = "error";
      continue;
    }

    if (existing) {
      const diff = {};
      for (const [k, v] of Object.entries(write)) {
        const was = existing.values ? existing.values[k] : undefined;
        if (!same(was, v)) diff[k] = [was === undefined ? null : was, v];
      }
      row.before = existing.values || null;
      row.target_id = String(existing.id);
      row.diff = diff;
      if (Object.keys(diff).length === 0) {
        row.action = "none";
        row.status =
          row.status === "ok" && row.problems.length ? "warning" : "unchanged";
        continue;
      }
      row.action = "update";
    } else {
      row.action = "create";
    }

    const res = await inSavepoint(client, () =>
      imp.write(client, write, {
        ...ctx,
        existing,
        row_number: row.row_number,
      }),
    );
    if (!res.ok) {
      row.status = "error";
      row.action = "none";
      row.problems.push(...problemOf(res.err, imp));
      continue;
    }
    row.target_id = String(res.out.id);
    // What the module saved without, or read differently, is a note on the row.
    if (Array.isArray(res.out.notes)) row.problems.push(...res.out.notes);
    // The module's service may answer that the row needed no write after all (it keeps
    // what a person edited on screen). The batch then reports it as unchanged, not as an
    // update that did nothing.
    if (res.out.action === "none") {
      row.action = "none";
      row.diff = null;
      row.status = row.problems.length ? "warning" : "unchanged";
      continue;
    }
    // The match said this row was an edit and the service made a new record instead: the
    // match key belonged to somebody else, who gave it up (a staff number the roster
    // takes back). What was written is what the batch reports.
    if (res.out.action === "create" && row.action === "update") {
      row.action = "create";
      row.before = null;
      row.diff = null;
    }
    if (row.problems.length) row.status = "warning";
  }

  // Pass 2: references to rows of this file, now that every row exists.
  for (const f of refs2) {
    const edges = new Map();
    const resolved = new Map();
    for (const row of rows) {
      const v = row.values[f.key];
      if (
        !row.target_id ||
        v === undefined ||
        v === null ||
        !["ok", "warning", "unchanged"].includes(row.status)
      )
        continue;
      const id = await imp.resolve(client, f, v, ctx);
      if (!id) {
        row.status = row.action === "none" ? "error" : "warning";
        row.problems.push({
          field: f.key,
          message: `${f.label} "${v}" is not in the file or the system${row.action === "none" ? "" : `; saved without ${f.label}`}`,
        });
        continue;
      }
      resolved.set(row, String(id));
      if (f.ref === imp.entity)
        edges.set(row.target_id, { to: String(id), row: row.row_number });
    }
    const cyclic = cycleRows(edges);
    /* A row written in pass 1 keeps its record when its line cannot be set: it is a
       warning, saved without the line, so it is counted, reported and reverted as written. */
    const unlinked = (row, problems) => {
      row.status = row.action === "none" ? "error" : "warning";
      row.problems.push(...problems);
    };
    const link = (row, id) =>
      inSavepoint(client, () =>
        imp.link(
          client,
          row.target_id,
          { [f.key]: id },
          { ...ctx, row_number: row.row_number, values: row.values },
        ),
      );
    const linked = (row, id, res) => {
      if (
        // An importer's link answers false when it wrote nothing (it keeps what a person
        // set on screen), and the row then stays unchanged rather than counting as an update.
        res.out !== false &&
        row.action === "none" &&
        row.status === "unchanged" &&
        (!row.before || !same(row.before[f.key], id))
      ) {
        row.action = "update";
        row.status = "ok";
        row.diff = {
          ...(row.diff || {}),
          [f.key]: [row.before ? row.before[f.key] || null : null, id],
        };
      }
    };
    /* A loop the database sees may be one this file is about to undo (a re-org that swaps two
       people), so a row refused for a loop is tried once more after the others. */
    const again = [];
    for (const [row, id] of resolved) {
      if (cyclic.has(row.row_number) || id === row.target_id) {
        unlinked(row, [
          {
            field: f.key,
            message: `${f.label} would make a loop (someone managing themselves, directly or through others)${row.action === "none" ? "" : `; saved without ${f.label}`}`,
          },
        ]);
        continue;
      }
      const res = await link(row, id);
      if (res.ok) linked(row, id, res);
      else if (res.err instanceof AppError && res.err.code === "REPORTING_LOOP") again.push([row, id]);
      else unlinked(row, problemOf(res.err, imp));
    }
    for (const [row, id] of again) {
      const res = await link(row, id);
      if (res.ok) linked(row, id, res);
      else unlinked(row, problemOf(res.err, imp));
    }
  }

  return Object.fromEntries(
    Object.entries(missing).map(([k, set]) => [k, [...set].sort()]),
  );
}

function statsOf(rows, missing, base = {}) {
  const count = (pred) => rows.filter(pred).length;
  return {
    ...base,
    rows: rows.length,
    create: count((r) => r.action === "create" && r.status !== "error"),
    update: count((r) => r.action === "update" && r.status !== "error"),
    unchanged: count((r) => r.status === "unchanged"),
    warning: count((r) => r.status === "warning"),
    error: count((r) => r.status === "error"),
    duplicate: count((r) => r.status === "duplicate"),
    missing,
  };
}

async function saveRows(client, batchId, rows) {
  await client.query("DELETE FROM import_row WHERE import_batch_id = $1", [
    batchId,
  ]);
  for (let i = 0; i < rows.length; i += 500) {
    const part = rows.slice(i, i + 500);
    await client.query(
      `INSERT INTO import_row (import_batch_id, row_number, raw, "values", status, problems, action, target_id, "before", diff)
       SELECT $1, t.row_number, t.raw, t.vals, t.status, t.problems, t.action, t.target_id, t.before, t.diff
         FROM jsonb_to_recordset($2::jsonb)
           AS t(row_number int, raw jsonb, vals jsonb, status text, problems jsonb, action text, target_id text, before jsonb, diff jsonb)`,
      [
        batchId,
        JSON.stringify(
          part.map((r) => ({
            row_number: r.row_number,
            raw: r.raw,
            vals: r.values,
            status: r.status,
            problems: r.problems,
            action: r.action,
            target_id: r.target_id,
            before: r.before,
            diff: r.diff,
          })),
        ),
      ],
    );
  }
}

/**
 * Run a batch: preview (rolled back) or commit.
 * @param {string} batchId
 * @param {{commit: boolean, actor: object, valid_only?: boolean, create_missing?: Record<string, string[]>, db?: import("pg").Pool}} opts
 * @returns {Promise<{batch: object, stats: object}>}
 */
async function run(
  batchId,
  {
    commit,
    actor,
    valid_only: validOnly = false,
    create_missing: createMissing = {},
    db = require("../../config/db").pool,
  },
) {
  const client = await db.connect();
  let outcome = null;
  try {
    const batch = await loadBatch(client, batchId);
    const imp = importerOf(batch.importer_key);
    await assertMay(client, actor, imp);
    if (commit && batch.status !== "previewed")
      throw new AppError(
        "IMPORT_PREVIEW_FIRST",
        "Preview the import before committing it",
        409,
      );
    if (!commit && !["mapped", "previewed"].includes(batch.status))
      throw new AppError(
        "IMPORT_NOT_READY",
        `This import is ${batch.status}`,
        409,
      );
    const problems = mapping.problemsOf(batch.mapping, imp.fields);
    if (problems.length)
      throw new AppError("IMPORT_MAPPING_INVALID", problems[0], 422, {
        mapping: problems,
      });

    const sheet = sheetOf(await sourceGrid(client, batch), batch.sheet);
    const pads = {};
    for (const f of imp.fields)
      if (f.sequenceOf) pads[f.key] = await numbering.paddingOf(client, f.sequenceOf);
    const rows = buildRows(imp, sheet.rows, batch.header_row, batch.mapping, {
      options: batch.options || {},
      pads,
    });
    markDuplicates(imp, rows);
    const values = (batch.mapping && batch.mapping.values) || {};
    const ctx = {
      actor,
      batch,
      importer: imp,
      preview: !commit,
      options: batch.options || {},
      values,
      /** Map Values' choice for one value of a field the importer reads itself (a text field). */
      valueOf: (fieldKey, value) => targetOf(values, fieldKey, value),
      create_missing: Object.fromEntries(
        Object.entries(createMissing || {}).map(([k, v]) => [
          k,
          new Set([].concat(v)),
        ]),
      ),
    };

    const work = async () => {
      await client.query(
        "SELECT 1 FROM import_batch WHERE import_batch_id = $1 FOR UPDATE",
        [batchId],
      );
      const missing = await processRows(client, imp, rows, ctx);
      const stats = statsOf(rows, missing, {
        valid_only: validOnly,
        header_signature: batch.stats && batch.stats.header_signature,
      });
      const blocked = stats.error + stats.duplicate > 0 && !validOnly;
      if (!commit || blocked) {
        outcome = { stats, blocked };
        throw ROLLBACK;
      }
      await saveRows(client, batchId, rows);
      const { rows: up } = await client.query(
        `UPDATE import_batch SET status = 'committed', stats = $2::jsonb, options = options || $3::jsonb, committed_at = now(), committed_by = $4
          WHERE import_batch_id = $1 RETURNING ${BATCH_COLUMNS}`,
        [
          batchId,
          JSON.stringify(stats),
          JSON.stringify({
            valid_only: validOnly,
            create_missing: createMissing || {},
          }),
          actor ? actor.user_id : null,
        ],
      );
      await emit(client, {
        key: EVENTS.IMPORT_COMMITTED,
        entity: { type: "import_batch", id: batchId },
        module: moduleOf(imp),
        actor,
        payload: {
          import_batch_id: batchId,
          importer_key: imp.key,
          create: stats.create,
          update: stats.update,
          error: stats.error,
        },
      });
      outcome = { batch: up[0], stats, blocked: false };
    };

    try {
      await requestContext.run(
        { ...(requestContext.get() || {}), importBatchId: batchId },
        () => atomically(client, work),
      );
    } catch (err) {
      if (err !== ROLLBACK) throw err;
    }

    if (outcome.batch) return { batch: outcome.batch, stats: outcome.stats };

    // Preview, or a commit refused for errors: keep the per-row result for the screen and the error file.
    const saved = await atomically(client, async () => {
      await saveRows(client, batchId, rows);
      const { rows: up } = await client.query(
        `UPDATE import_batch SET status = 'previewed', stats = $2::jsonb, previewed_at = now()
          WHERE import_batch_id = $1 RETURNING ${BATCH_COLUMNS}`,
        [batchId, JSON.stringify(outcome.stats)],
      );
      return up[0];
    });
    if (commit && outcome.blocked) {
      throw new AppError(
        "IMPORT_HAS_ERRORS",
        `${outcome.stats.error + outcome.stats.duplicate} rows have problems. Fix them in the file, or commit the valid rows only.`,
        422,
      );
    }
    return { batch: saved, stats: outcome.stats };
  } finally {
    client.release();
  }
}

const preview = (batchId, opts) => run(batchId, { ...opts, commit: false });
const commit = (batchId, opts) => run(batchId, { ...opts, commit: true });

/**
 * A page of a batch's rows, optionally by status; "problem" is the preview's list: every
 * error, duplicate and warning, so a row that saves with something missing is seen too;
 * "change" is every row that changes a record already in the system.
 * @param {{query: Function}} client
 */
function rowsOf(client, batchId, query = {}) {
  return pageQuery(
    client,
    `SELECT import_row_id, row_number, raw, "values", status, problems, action, target_id, diff, ${TOTAL_COL}
       FROM import_row
      WHERE import_batch_id = $1
        AND ($2::text IS NULL OR status = $2
             OR ($2::text = 'problem' AND status IN ('error', 'duplicate', 'warning'))
             OR ($2::text = 'change' AND action = 'update' AND status <> 'error'))
      ORDER BY row_number, import_row_id`,
    [batchId, query.status || null],
    query,
  );
}

/** Import history, newest first, 25 per page. */
function history(client, query = {}) {
  return pageQuery(
    client,
    `SELECT import_batch_id, number, importer_key, file_name, status, stats, created_by, created_at, committed_at, reverted_at, ${TOTAL_COL}
       FROM import_batch
      WHERE ($1::text IS NULL OR importer_key = $1)
      ORDER BY created_at DESC, import_batch_id`,
    [query.importer || null],
    query,
  );
}

/** Days an unfinished import (uploaded, mapped, previewed) is kept before import-cleanup closes it. */
const ABANDONED_AFTER_DAYS = 14;

/**
 * Close imports that were started and left (the import-cleanup scheduler). Their per-row
 * results are copies of the person's spreadsheet cells, personal data included, and
 * nobody is going to act on them, so the rows are removed and the batch is marked
 * `failed` with `stats.expired`. The batch stays in the history and the source file
 * stays in the vault. Committed and reverted batches are never touched: revert needs
 * their rows. Each batch is its own transaction.
 * @param {{db?: import("pg").Pool, days?: number, limit?: number}} [opts]
 * @returns {Promise<{expired: number}>}
 */
async function expireAbandoned({
  db = require("../../config/db").pool,
  days = ABANDONED_AFTER_DAYS,
  limit = 100,
} = {}) {
  const { rows } = await db.query(
    `SELECT import_batch_id FROM import_batch
      WHERE status IN ('uploaded', 'mapped', 'previewed')
        AND GREATEST(created_at, COALESCE(previewed_at, created_at)) < now() - make_interval(days => $1)
      ORDER BY created_at, import_batch_id
      LIMIT $2 -- pagination:batch abandoned imports one cleanup run closes`,
    [days, limit],
  );
  let expired = 0;
  for (const { import_batch_id: id } of rows) {
    const client = await db.connect();
    try {
      await atomically(client, async () => {
        const { rows: up } = await client.query(
          `UPDATE import_batch
              SET status = 'failed', stats = COALESCE(stats, '{}'::jsonb) || jsonb_build_object('expired', true)
            WHERE import_batch_id = $1 AND status IN ('uploaded', 'mapped', 'previewed')
            RETURNING import_batch_id, importer_key, status`,
          [id],
        );
        if (!up[0]) return;
        const { rowCount } = await client.query(
          "DELETE FROM import_row WHERE import_batch_id = $1",
          [id],
        );
        const imp = registry.get(up[0].importer_key);
        await emit(client, {
          key: EVENTS.IMPORT_EXPIRED,
          entity: { type: "import_batch", id },
          module: imp ? moduleOf(imp) : "settings",
          actor: null,
          payload: {
            import_batch_id: id,
            importer_key: up[0].importer_key,
            rows_removed: rowCount,
            after_days: days,
          },
        });
        expired += 1;
      });
    } finally {
      client.release();
    }
  }
  return { expired };
}

module.exports = {
  EVENTS,
  BATCH_COLUMNS,
  coerce,
  buildRows,
  markDuplicates,
  cycleRows,
  createBatch,
  setMapping,
  valuesOf,
  setValues,
  targetOf,
  piecesOf,
  preview,
  commit,
  rowsOf,
  history,
  expireAbandoned,
  ABANDONED_AFTER_DAYS,
  loadBatch,
  importerOf,
  assertMay,
};
