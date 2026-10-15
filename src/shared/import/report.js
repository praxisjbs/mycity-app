"use strict";
/**
 * The two files an import hands a person.
 *
 *   template(importer)                 a blank .xlsx: the header row in the right order, a
 *                                      note and a dropdown on every choice column, and a
 *                                      protected Reference sheet saying what each column takes
 *   errorFile(client, batchId, user)   THEIR OWN rows and columns as uploaded, plus Status
 *                                      and Problem columns, so they fix the file they know
 *                                      and upload it again
 *
 * Restricted columns (a field with `mask`, e.g. bank and salary) are blanked in the error
 * file for a person masked from that field key, exactly as the preview hides them.
 */
const { AppError } = require("../errors");
const { config } = require("../../config/env");
const { buildWorkbook } = require("../spreadsheet/build");
const { exportFilename } = require("../spreadsheet/cells");
const { workbookContext } = require("../spreadsheet/context");
const { maskedKeysFor } = require("../rbac/field-mask");
const { completeQuery } = require("../http/paged");
const registry = require("./registry");
const engine = require("./engine");
const mapping = require("./mapping");

const RULE = {
  text: "Text",
  int: "A whole number",
  number: "A number",
  money: "An amount in naira, like 250000.00 (no ₦ sign needed)",
  phone: "A Nigerian phone number, like 0803 123 4567",
  email: "An email address",
  date: "A date, day first: 03/07/2026",
  boolean: "Yes or No",
  reference: "The name or code of an existing record",
};

const fileName = (base) =>
  exportFilename({
    base,
    env: config.APP_ENV === "staging" ? "staging" : "live",
    extension: "xlsx",
  });

/** What to type in a column, in one sentence. */
function ruleOf(f) {
  const type = f.type || "text";
  let rule = f.hint || RULE[type];
  if (type === "enum")
    rule = "One of the values listed under this column's name";
  if (f.createMissing)
    rule += ". A new one is created only if you confirm it when importing";
  if (f.pass === 2) rule += ". May name another row of this file";
  return rule;
}

/**
 * The blank template for an importer: the header row, a dropdown on every choice
 * column, a note on each header saying what it takes, and a Reference sheet listing
 * every column's rule and every choice column's values.
 */
async function template(imp) {
  const choiceBlocks = imp.fields
    .filter((f) => f.type === "enum")
    .map((f) => ({
      title: f.label,
      values: registry.optionsOf(f).map((o) => o.label),
    }));
  const reference = [
    {
      title: "Column",
      values: imp.fields.map((f) => [
        f.label,
        `${f.required ? "Required" : "Optional"}. ${ruleOf(f)}.${f.example ? ` Example: ${f.example}` : ""}`,
      ]),
    },
    ...choiceBlocks,
  ];
  const buffer = await buildWorkbook({
    sheets: [
      {
        name: imp.label,
        columns: imp.fields.map((f) => ({
          key: f.key,
          header: f.label,
          note: `${f.required ? "Required" : "Optional"}. ${ruleOf(f)}.`,
          refColumn: f.type === "enum" ? f.label : undefined,
          width: Math.max(14, f.label.length + 6),
        })),
        rows: [],
      },
    ],
    reference,
    context: workbookContext({ title: `${imp.label} import` }),
  });
  return { buffer, filename: fileName(`${imp.key}-import-template`) };
}

/**
 * The error file for a batch.
 * @param {{query: Function}} client
 * @param {string} batchId
 * @param {object} user  req.user (for masking)
 */
async function errorFile(client, batchId, user) {
  const batch = await engine.loadBatch(client, batchId);
  const imp = engine.importerOf(batch.importer_key);
  if (!["previewed", "committed", "reverted"].includes(batch.status))
    throw new AppError("IMPORT_NOT_PREVIEWED", "Preview the import first", 409);
  // pagination:complete the error file is every row the person uploaded, in order
  const { rows } = await completeQuery(
    client,
    "SELECT row_number, raw, status, problems FROM import_row WHERE import_batch_id = $1 ORDER BY row_number",
    [batchId],
    { label: "import error file", ceiling: 100000 },
  );

  const masked = new Set(await maskedKeysFor(client, user));
  const hidden = new Set(
    (batch.mapping.columns || [])
      .filter((c) => c.field)
      .filter((c) => {
        const f = imp.fields.find((x) => x.key === c.field);
        return f && f.mask && masked.has(f.mask);
      })
      .map((c) => mapping.normalise(c.header)),
  );

  // Column order from the mapping (the sheet's own order); a jsonb object keeps no key order.
  const headers = (batch.mapping.columns || []).map((c) =>
    c.header === "" ? `Column ${c.index + 1}` : c.header,
  );
  const STATUS = {
    ok: "OK",
    warning: "OK, see note",
    unchanged: "Unchanged",
    error: "Not imported",
    duplicate: "Duplicate",
    skipped: "Skipped",
  };
  const columns = [
    ...headers.map((h, i) => ({
      key: `c${i}`,
      header: h,
      width: Math.min(40, Math.max(12, h.length + 4)),
    })),
    { key: "status", header: "Status", width: 16 },
    {
      key: "problem",
      header: "Problem",
      width: 60,
      wrap: true,
      emphasis: true,
    },
  ];
  const sheetRows = rows.map((r) => {
    const out = {
      status: STATUS[r.status] || r.status,
      problem: (r.problems || []).map((p) => p.message).join("; "),
    };
    headers.forEach((h, i) => {
      out[`c${i}`] = hidden.has(mapping.normalise(h)) ? null : r.raw[h];
    });
    return out;
  });
  const buffer = await buildWorkbook({
    sheets: [{ name: imp.label, columns, rows: sheetRows }],
    context: workbookContext({
      actor: user,
      title: `${imp.label} import ${batch.number}`,
    }),
  });
  return { buffer, filename: fileName(`${batch.number}-${imp.key}-report`) };
}

module.exports = { template, errorFile };
