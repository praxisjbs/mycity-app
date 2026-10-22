"use strict";
/**
 * The import engine (BACKEND_STRUCTURE §9): a spreadsheet in, records out, through the
 * owning module's own service, with a preview that is the real result.
 *
 *   upload    createBatch()   store the file, parse, find the header, map columns (or a saved profile)
 *   map       setMapping()    the person confirms or corrects the mapping
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
 * @returns {{value: *, error: string|null}}  value null for an empty cell
 */
function coerce(field, raw) {
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
    case "reference":
      if (raw instanceof Date)
        return { value: null, error: "should be text, not a date" };
      return text.length > (field.max || 500)
        ? { value: null, error: `is longer than ${field.max || 500} characters` }
        : { value: text, error: null };
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
      const r = c.common.phone.safeParse(
        typeof raw === "number" ? `0${raw}` : text,
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
      const opts = registry.optionsOf(field);
      const n = mapping.normalise(text);
      const hit = opts.find(
        (o) =>
          mapping.normalise(o.value) === n || mapping.normalise(o.label) === n,
      );
      return hit
        ? { value: hit.value, error: null }
        : {
            value: null,
            error: `should be one of: ${opts.map((o) => o.label).join(", ")}`,
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

/**
 * The data rows under the header, coerced and validated. Pure.
 * @returns {Array<{row_number, raw, values, problems, status}>}
 */
function buildRows(imp, grid, headerRow, columnsMap) {
  const fields = fieldMap(imp);
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
    for (const c of mapped) {
      const f = fields.get(c.field);
      const { value, error } = coerce(f, cells[c.index]);
      if (error)
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
      }
    }
    out.push({
      row_number: i + 1,
      raw,
      values,
      problems,
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
 * @param {{sheet?: string, header_row?: number, fields: Record<number, string|null>, save_profile?: boolean, profile_name?: string}} input
 *   fields  column index → field key (null to ignore the column)
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
  const columns = {
    columns: headerCells.map((cell, index) => ({
      index,
      header: cell === null || cell === undefined ? "" : String(cell),
      field: Object.prototype.hasOwnProperty.call(input.fields || {}, index)
        ? input.fields[index] || null
        : null,
    })),
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
 * Running: preview and commit share every line
 * ------------------------------------------------------------------ */

function problemOf(err) {
  if (err instanceof AppError) {
    const fields = err.fields ? Object.entries(err.fields) : [];
    if (fields.length)
      return fields.map(([f, msgs]) => ({
        field: f,
        message: `${f}: ${[].concat(msgs).join(", ")}`,
      }));
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
      let id = await imp.resolve(client, f, v, ctx);
      if (!id && f.createMissing) {
        (missing[f.key] = missing[f.key] || new Set()).add(v);
        const ticked =
          ctx.create_missing[f.key] &&
          [...ctx.create_missing[f.key]].some((x) => same(x, v));
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
      row.problems.push(...problemOf(res.err));
      continue;
    }
    row.target_id = String(res.out.id);
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
    for (const [row, id] of resolved) {
      if (cyclic.has(row.row_number) || id === row.target_id) {
        row.status = "error";
        row.problems.push({
          field: f.key,
          message: `${f.label} would make a loop (someone managing themselves, directly or through others)`,
        });
        continue;
      }
      const res = await inSavepoint(client, () =>
        imp.link(
          client,
          row.target_id,
          { [f.key]: id },
          { ...ctx, row_number: row.row_number, values: row.values },
        ),
      );
      if (!res.ok) {
        row.status = "error";
        row.problems.push(...problemOf(res.err));
      } else if (
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
    const rows = buildRows(imp, sheet.rows, batch.header_row, batch.mapping);
    markDuplicates(imp, rows);
    const ctx = {
      actor,
      batch,
      importer: imp,
      preview: !commit,
      options: batch.options || {},
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
 * error, duplicate and warning, so a row that saves with something missing is seen too.
 * @param {{query: Function}} client
 */
function rowsOf(client, batchId, query = {}) {
  return pageQuery(
    client,
    `SELECT import_row_id, row_number, raw, "values", status, problems, action, target_id, diff, ${TOTAL_COL}
       FROM import_row
      WHERE import_batch_id = $1
        AND ($2::text IS NULL OR status = $2
             OR ($2::text = 'problem' AND status IN ('error', 'duplicate', 'warning')))
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
