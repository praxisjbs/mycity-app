"use strict";
/**
 * The Partnership Returns importer, `partnership_returns` (docs/guides/partnerships.md §6.14): the
 * consumer app's monthly report of a deal's units sold, gross, MyCity's commission, the payout and
 * downloads, written through partner_pipeline.returns.saveIn with source `import` and the batch, as
 * Enter Returns writes a month on the 360. It needs `partnerships.money`, as the 360's tab does.
 *
 *  - **Which deal.** The deal's number (DEAL-2026-0001), else its partner's (or lead's) name and its
 *    title. A deal the importer cannot see, or no deal, or two deals of the same name and title, is
 *    an error on the row: it is never guessed.
 *  - **Which month.** "2026-11", "Nov 2026", "November 2026", "11/2026", or a date in the month.
 *  - **A month imported again** replaces that month's figures for the deal, audited; the row is
 *    unchanged when nothing differs. Reverting puts back what the month held before, or removes a
 *    month the import made.
 */
const c = require("@mycity/contract");
const { defineImporter } = require("../../shared/import/registry");
const { normalise } = require("../../shared/import/mapping");
const { readDate } = require("../../shared/spreadsheet/day-first-cells");
const { AppError } = require("../../shared/errors");
const { scopeFor } = require("../../middleware/rbac");
const repo = require("./partner_pipeline.repo");
const returns = require("./partner_pipeline.returns");

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const pad = (n) => String(n).padStart(2, "0");
const text = (v) => (v === null || v === undefined ? null : String(v).replace(/\s+/g, " ").trim() || null);

/** A Month cell as `YYYY-MM`, or null: "2026-11", "Nov 2026", "November, 2026", "11/2026", or a date in it. */
function monthOf(cell) {
  if (cell === null || cell === undefined || cell === "") return null;
  const t = String(cell).trim();
  let m = /^(\d{4})-(\d{1,2})$/.exec(t);
  if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) return `${m[1]}-${pad(m[2])}`;
  m = /^(\d{1,2})[/.-](\d{4})$/.exec(t);
  if (m && Number(m[1]) >= 1 && Number(m[1]) <= 12) return `${m[2]}-${pad(m[1])}`;
  m = /^([a-z]+)[\s,]+(\d{4})$/i.exec(t);
  if (m && MONTHS[m[1].toLowerCase().slice(0, 3)]) return `${m[2]}-${pad(MONTHS[m[1].toLowerCase().slice(0, 3)])}`;
  const d = readDate(typeof cell === "number" || cell instanceof Date ? cell : t);
  return d.date ? d.date.slice(0, 7) : null;
}

/** The row's line: its deal (a number, or partner and title) and its month. */
const lineKey = ({ deal_number, partner, deal_title, month }) => `${deal_number || `${partner || ""} / ${deal_title || ""}`} · ${month}`;

/** A line read back: the deal it names and its month. */
function lineOf(key) {
  const at = String(key).lastIndexOf(" · ");
  if (at < 0) return null;
  const deal = key.slice(0, at);
  const month = key.slice(at + 3);
  const slash = deal.indexOf(" / ");
  return slash < 0 ? { number: deal, month } : { partner: deal.slice(0, slash), title: deal.slice(slash + 3), month };
}

const HEADERS = [
  ["deal_number", /^(deal number|deal no|deal ref|deal reference|reference|number)$/],
  ["partner", /^(partner|partner name|merchant|organisation|organization)$/],
  ["deal_title", /^(deal|deal title|offer|event)$/],
  ["month", /^(month|period)$/],
  ["units_sold", /^(units sold|units|tickets sold|tickets|coupons|sold)$/],
  ["gross_sales", /^(gross sales|gross|sales|revenue)$/],
  ["mycity_commission", /^(mycity commission|my city commission|commission|mycity s commission)$/],
  ["paid_to_partner", /^(paid to partner|payout|paid|partner payout|merchant take|merchant s take)$/],
  ["downloads", /^(downloads|app downloads|in app downloads)$/],
  ["note", /^(note|notes|comment|comments)$/],
];
const headerKey = (cell) => (HEADERS.find(([, re]) => re.test(normalise(cell))) || [])[0] || null;

/** The report's rows, each keyed by field with its line made; throws for a sheet with no Month column. */
function extract(sheets) {
  for (const sheet of sheets) {
    const at = (sheet.rows || []).slice(0, 20).findIndex((r) => {
      const keys = (r || []).map(headerKey);
      return keys.includes("month") && (keys.includes("deal_number") || keys.includes("partner"));
    });
    if (at < 0) continue;
    const cols = {};
    (sheet.rows[at] || []).forEach((cell, i) => {
      const key = headerKey(cell);
      if (key && cols[key] === undefined) cols[key] = i;
    });
    const cell = (r, key) => (cols[key] === undefined ? null : (r || [])[cols[key]]);
    const rows = [];
    for (const r of sheet.rows.slice(at + 1)) {
      if (!(r || []).some((v) => text(v))) continue;
      const row = {
        deal_number: text(cell(r, "deal_number")),
        partner: text(cell(r, "partner")),
        deal_title: text(cell(r, "deal_title")),
        month: monthOf(cell(r, "month")) || text(cell(r, "month")),
        units_sold: cell(r, "units_sold"),
        gross_sales: cell(r, "gross_sales"),
        mycity_commission: cell(r, "mycity_commission"),
        paid_to_partner: cell(r, "paid_to_partner"),
        downloads: cell(r, "downloads"),
        note: text(cell(r, "note")),
      };
      if (!row.deal_number && !(row.partner && row.deal_title) && !row.month) continue;
      rows.push({ line_key: lineKey(row), ...row });
    }
    return { rows, notes: [] };
  }
  throw new AppError("IMPORT_NOT_RETURNS", "This is not a returns report: no sheet has a Month column beside a Deal Number or Partner", 422);
}

const FIGURES = ["units_sold", "gross_sales", "mycity_commission", "paid_to_partner", "downloads", "note"];

/** The deal a line names, seen by the person importing; null when none, several, or out of their scope. */
async function dealOf(client, line, actor) {
  const found = await repo.dealForReturns(client, line);
  if (!found) return null;
  const scope = await scopeFor(actor, "partnerships", "view");
  if (!scope) return null;
  return (await repo.get(client, found.deal_id, { scope: scope.scope, scope_ids: scope.scope_ids || null })) ? found : null;
}

/** A month as find() and the diff compare it: the line's own cells beside the month's figures. */
function valuesOf(key, line, held) {
  const out = { line_key: key, month: line.month };
  if (line.number) out.deal_number = line.number;
  else Object.assign(out, { partner: line.partner, deal_title: line.title });
  for (const k of FIGURES) out[k] = held ? held[k] : null;
  return out;
}

const FIELDS = [
  { key: "line_key", label: "Line", required: true, max: 400, example: "DEAL-2026-0001 · 2026-11", hint: "Made from the deal and the month" },
  { key: "deal_number", label: "Deal Number", max: 40, example: "DEAL-2026-0001" },
  { key: "partner", label: "Partner", max: 150, hint: "With Deal, when there is no Deal Number" },
  { key: "deal_title", label: "Deal", max: 150 },
  { key: "month", label: "Month", required: true, example: "2026-11" },
  { key: "units_sold", label: "Units Sold", type: "int" },
  { key: "gross_sales", label: "Gross Sales", type: "money" },
  { key: "mycity_commission", label: "MyCity Commission", type: "money" },
  { key: "paid_to_partner", label: "Paid to Partner", type: "money" },
  { key: "downloads", label: "Downloads", type: "int" },
  { key: "note", label: "Note", max: 500 },
];

defineImporter({
  key: "partnership_returns",
  label: "Partnership Returns",
  permission: ["partnerships", "create"],
  capability: "partnerships.money",
  entity: "deal_return",
  schema: c.partner_pipeline.ReturnImportRow,
  matchKeys: ["line_key"],
  fields: FIELDS,
  extract,

  async find(client, { value }) {
    const line = lineOf(value);
    const deal = line && (await repo.dealForReturns(client, line));
    const held = deal && (await repo.returnOf(client, deal.deal_id, `${line.month}-01`));
    return held ? { id: held.deal_return_id, values: { ...valuesOf(value, line, held), source: held.source } } : null;
  },

  async write(client, values, ctx) {
    const line = { number: values.deal_number || null, partner: values.partner || null, title: values.deal_title || null, month: values.month };
    const deal = await dealOf(client, line, ctx.actor);
    if (!deal) {
      const message = line.number ? `No deal ${line.number} you can see` : `No one deal "${line.title || ""}" of ${line.partner || "that partner"} you can see`;
      throw new AppError("VALIDATION_FAILED", message, 422, { [line.number ? "deal_number" : "deal_title"]: [message] });
    }
    const figures = Object.fromEntries(FIGURES.map((k) => [k, values[k] ?? null]));
    const saved = await returns.saveIn(client, ctx.actor, await repo.lock(client, deal.deal_id), values.month, figures, {
      source: "import",
      importBatchId: ctx.batch.import_batch_id,
    });
    return { id: saved.deal_return_id, action: ctx.existing ? "update" : "create" };
  },

  // A month entered on the 360 or imported again since stays: reverting would lose those figures.
  async isReferenced(client, id, { batch }) {
    const held = await repo.returnById(client, id);
    return Boolean(held) && !(held.source === "import" && held.import_batch_id === batch.import_batch_id);
  },

  async archive(client, id, ctx) {
    const held = await repo.returnById(client, id);
    if (held) await returns.removeIn(client, ctx.actor, { deal_id: held.deal_id, number: held.deal_number }, held.month);
  },

  async restore(client, id, before, ctx) {
    const held = await repo.returnById(client, id);
    if (!held || !before) return;
    const figures = Object.fromEntries(FIGURES.map((k) => [k, before[k] ?? null]));
    await returns.saveIn(client, ctx.actor, { deal_id: held.deal_id, number: held.deal_number }, String(held.month).slice(0, 7), figures, {
      source: before.source === "import" ? "import" : "entered",
    });
  },
});

module.exports = { FIELDS, extract, monthOf, lineKey, lineOf };
