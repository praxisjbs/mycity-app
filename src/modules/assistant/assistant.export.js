"use strict";
/**
 * Praxis AI's two exports, each reserved in the request and made by the worker after commit. Nothing
 * is emailed; the screen waits on the file and downloads it (shared/documents/exports.js).
 *
 *   History's Export (docs/guides/praxis-ai.md §6.5): the person's own questions as a workbook.
 *   requestExport(actor)          POST /ai/history/export (202, the file pending)
 *   buildExport(event, ctx)       assistant.export_requested, in the worker after commit
 *
 *   Download Excel on an answer's Table (§6.16; decision 15): every row of one read of the answer,
 *   replayed page by page with the person's rights and masks as they stand when the file is made,
 *   at most READ_EXPORT_CEILING rows, with a second sheet, About This File, saying who exported it,
 *   when, the question, the read and its filters, the rows and the total, and the masks applied.
 *   requestReadExport(id, n, actor)   POST /ai/answers/:id/reads/:n/export (202, the file pending)
 *   buildReadExport(event, ctx)       assistant.read_export_requested, in the worker after commit
 *
 *   Download PDF on an answer's Overview (§6.19 item 8; decisions 53, 54): the Overview drawn again
 *   from the spec the answer kept, its summary or its read run again with the person's rights at the
 *   build, on the letterhead: the figures as tiles, the chart with its table, every other grouping
 *   and series of the summary with its own, and About This File.
 *   requestOverviewExport(id, actor)  POST /ai/answers/:id/overview/export (202, the PDF pending)
 *   buildOverviewPdf(event, ctx)      assistant.overview_export_requested, in the worker after commit
 */
const crypto = require("node:crypto");
const { config } = require("../../config/env");
const { pool } = require("../../config/db");
const { atomically } = require("../../shared/db/tx");
const { emit } = require("../../shared/events/emit");
const outbox = require("../../shared/events/outbox");
const exportFiles = require("../../shared/documents/exports");
const { exportFilename } = require("../../shared/spreadsheet/cells");
const { AppError } = require("../../shared/errors");
const { EVENTS, HISTORY_EXPORT, ANSWER_EXPORT, OVERVIEW_EXPORT } = require("./assistant.events");

/** The most questions one export holds, newest first. */
const EXPORT_CEILING = 2500;
/** The most rows one answer's read export holds (decision 15): more than a year of attendance. */
const READ_EXPORT_CEILING = 25_000;

/** POST /ai/history/export: reserve the file for the person asking; the worker fills it. */
async function requestExport(actor) {
  const client = await pool.connect();
  try {
    return await atomically(client, async () => {
      const doc = await exportFiles.reserve(client, {
        doc_type: HISTORY_EXPORT,
        entity: { type: HISTORY_EXPORT, id: crypto.randomUUID() },
        file_name: exportFilename({ base: "praxis-ai-questions", env: config.APP_ENV, extension: "xlsx" }),
        title: "Praxis AI history export",
        actor,
      });
      await emit(client, {
        key: EVENTS.ASSISTANT_EXPORT_REQUESTED,
        entity: { type: doc.entity_type, id: doc.entity_id },
        actor,
        payload: { requested_by: actor.user_id, document_id: doc.document_id },
      });
      return exportFiles.present(doc);
    });
  } finally {
    client.release();
  }
}

/** The person's questions, a page of 25 at a time, newest first, up to the ceiling. */
async function gather(userId) {
  const history = require("./assistant.history");
  const rows = [];
  let page = await history.questions({ page: 1 }, { user_id: userId });
  rows.push(...page.data);
  while (page.page.has_next && rows.length < EXPORT_CEILING) {
    page = await history.questions({ page: page.page.number + 1 }, { user_id: userId });
    rows.push(...page.data);
  }
  return { rows: rows.slice(0, EXPORT_CEILING), total: page.page.total };
}

const COLUMNS = [
  { key: "question", header: "Question", width: 60 },
  { key: "asked_at", header: "Asked", format: "datetime", width: 18 },
  { key: "sources", header: "Sources Read", width: 36 },
  { key: "tokens", header: "Tokens", format: "int", width: 12 },
  { key: "cost_ngn", header: "Cost", format: "money", width: 14, total: true },
];

/**
 * The outbox handler: the person's questions made into the file the request reserved. A person
 * no longer active gets a failed file instead.
 * @param {object} event  assistant.export_requested
 * @param {{attempt: number, max_attempts: number}} ctx  the outbox's
 */
async function buildExport(event, ctx) {
  const { buildWorkbook } = require("../../shared/spreadsheet/build");
  const { workbookContext } = require("../../shared/spreadsheet/context");
  const grantsCache = require("../../shared/rbac/grants-cache");

  const p = event.payload || {};
  if (!p.document_id) return;
  const reader = await grantsCache.getAuthUser(pool, p.requested_by || event.actor_user_id);
  if (!reader || reader.status !== "active") return exportFiles.fail(p.document_id, "The person who asked is no longer active.");

  await exportFiles.make(p.document_id, ctx, async () => {
    const { rows, total } = await gather(reader.user_id);
    return buildWorkbook({
      sheets: [
        {
          name: "Questions",
          columns: COLUMNS,
          rows: rows.map((r) => ({
            question: r.question,
            asked_at: r.asked_at,
            sources: r.sources.join(", "),
            tokens: r.tokens,
            cost_ngn: r.cost_ngn,
          })),
          freeze: { y: 1 },
        },
      ],
      context: workbookContext({
        actor: { name: reader.display_name },
        title: "Praxis AI questions",
        lines: [["Questions", rows.length < total ? `The newest ${rows.length} of ${total}.` : String(rows.length)]],
      }),
      cover: true,
    });
  });
}

outbox.register(EVENTS.ASSISTANT_EXPORT_REQUESTED, "assistant.export_history", (event, ctx) => buildExport(event, ctx));

/* ------------------------------------------------------------------ *
 * Download Excel on an answer's Table (§6.16)
 * ------------------------------------------------------------------ */

/**
 * POST /ai/answers/:id/reads/:n/export: the read must be the caller's and one that may be run again
 * (assistant.reads.replayable); the file is reserved for them and the worker fills it.
 * @returns {Promise<object>} the ExportFile, pending
 */
async function requestReadExport(messageId, n, actor) {
  const reads = require("./assistant.reads");
  const { read } = await reads.replayable(messageId, n, actor);
  const client = await pool.connect();
  try {
    return await atomically(client, async () => {
      const doc = await exportFiles.reserve(client, {
        doc_type: ANSWER_EXPORT,
        entity: { type: ANSWER_EXPORT, id: crypto.randomUUID() },
        file_name: exportFilename({ base: `praxis-ai-${read.read_key.replace(/\./g, "-")}`, env: config.APP_ENV, extension: "xlsx" }),
        title: "Praxis AI answer export",
        actor,
      });
      await emit(client, {
        key: EVENTS.ASSISTANT_READ_EXPORT_REQUESTED,
        entity: { type: doc.entity_type, id: doc.entity_id },
        actor,
        payload: { requested_by: actor.user_id, document_id: doc.document_id, ai_message_id: messageId, n, read_key: read.read_key },
      });
      return exportFiles.present(doc);
    });
  } finally {
    client.release();
  }
}

/** The parameters a read ran with, as the sheet says them: "status = submitted, from = 01/10/2026". */
function paramsText(params) {
  const { formatDate } = require("../../shared/time/day-first");
  const parts = Object.entries(params || {})
    .filter(([k, v]) => k !== "page" && v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${k.replace(/_/g, " ")} = ${/^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? formatDate(String(v)) : Array.isArray(v) ? v.join(", ") : String(v)}`);
  return parts.length ? parts.join(", ") : "none";
}

/**
 * Every row of the read, a page of 25 at a time with the reader's rights now, up to the ceiling, each
 * page drawn as the Table shows it.
 * @returns {Promise<{columns: string[], rows: string[][], total: number, capped: boolean, masked: string[]}>}
 */
async function gatherRead(found, n, reader, { ceiling = READ_EXPORT_CEILING } = {}) {
  const reads = require("./assistant.reads");
  const rows = [];
  let columns = [];
  let masked = [];
  let got = await reads.page(found, 1, reader);
  let total;
  for (;;) {
    const t = reads.drawn(found, n, got.list);
    if (!columns.length) columns = t.columns;
    masked = got.masked || masked;
    rows.push(...t.rows);
    total = got.page.total;
    if (!got.page.has_next || rows.length >= ceiling || !found.spec.list) break;
    got = await reads.page(found, got.page.number + 1, reader);
  }
  return { columns, rows: rows.slice(0, ceiling), total, capped: total > ceiling, masked };
}

/**
 * The outbox handler: one read of an answer made into the file the request reserved, as the person
 * who asked may see it now. A person no longer active, or an answer or read that is gone, gets a
 * failed file instead.
 * @param {object} event  assistant.read_export_requested
 * @param {{attempt: number, max_attempts: number}} ctx  the outbox's
 * @param {{ceiling?: number}} [opts]  tests lower the row ceiling
 */
async function buildReadExport(event, ctx, { ceiling = READ_EXPORT_CEILING } = {}) {
  const { buildWorkbook } = require("../../shared/spreadsheet/build");
  const { workbookContext } = require("../../shared/spreadsheet/context");
  const { formatInstant } = require("../../shared/spreadsheet/cells");
  const { FIELDS } = require("../../shared/rbac/field-mask");
  const grantsCache = require("../../shared/rbac/grants-cache");
  const reads = require("./assistant.reads");
  const registry = require("../../shared/ai/registry");

  const p = event.payload || {};
  if (!p.document_id) return;
  const reader = await grantsCache.getAuthUser(pool, p.requested_by || event.actor_user_id);
  if (!reader || reader.status !== "active") return exportFiles.fail(p.document_id, "The person who asked is no longer active.");
  let found;
  try {
    found = await reads.replayable(p.ai_message_id, p.n, reader);
  } catch (err) {
    if (err && err.status === 404) return exportFiles.fail(p.document_id, "That answer, or its read, is no longer there.");
    throw err;
  }

  await exportFiles.make(p.document_id, ctx, async () => {
    const got = await gatherRead(found, p.n, reader, { ceiling });
    const now = new Date();
    const tool = registry.read(found.read.read_key);
    const label = tool ? tool.description : found.read.read_key;
    const masks = (got.masked || []).map((k) => (FIELDS[k] ? FIELDS[k].label : k));
    const about = [
      ["Exported by", reader.display_name],
      ["Exported at", `${formatInstant(now)} (Lagos)`],
      ["Question", found.kept ? found.kept.question : ""],
      ["Asked on", found.kept && found.kept.created_at ? `${formatInstant(found.kept.created_at)} (Lagos)` : ""],
      ["Read", `${label} (${found.read.read_key})`],
      ["Filters", paramsText(found.read.params)],
      ["Rows in this file", String(got.rows.length)],
      ["Rows the read has now", String(got.total)],
      ["Cut at", got.capped ? `The first ${ceiling.toLocaleString("en-NG")} rows: narrow the question for the rest.` : "Not cut: every row is here."],
      ["Masked fields", masks.length ? masks.join(", ") : "None: every field your role may see is here."],
      ["Environment", config.APP_ENV === "staging" ? "Staging: not live data" : "Live"],
    ];
    const columns = (got.columns.length ? got.columns : ["Row"]).map((header, i) => ({ key: `c${i}`, header, width: Math.min(60, Math.max(14, header.length + 6)) }));
    return buildWorkbook({
      sheets: [
        {
          name: label.slice(0, 31),
          columns,
          rows: got.rows.map((r) => Object.fromEntries(r.map((v, i) => [`c${i}`, v]))),
          freeze: { y: 1 },
        },
        {
          name: "About This File",
          columns: [
            { key: "item", header: "Item", width: 24 },
            { key: "value", header: "Value", width: 90, wrap: true },
          ],
          rows: about.map(([item, value]) => ({ item, value })),
          freeze: { y: 1 },
        },
      ],
      context: workbookContext({ actor: { name: reader.display_name }, title: "Praxis AI answer", generatedAt: now }),
    });
  });
}

outbox.register(EVENTS.ASSISTANT_READ_EXPORT_REQUESTED, "assistant.export_read", (event, ctx) => buildReadExport(event, ctx));

/* ------------------------------------------------------------------ *
 * Download PDF on an answer's Overview (§6.19 item 8)
 * ------------------------------------------------------------------ */

const notFound = () => new AppError("NOT_FOUND", "Not found", 404);

/**
 * POST /ai/answers/:id/overview/export: the caller's answer with an Overview chart; the PDF is
 * reserved for them (exports.reserve, pending) and the worker draws it with their rights at the build.
 * @returns {Promise<object>} the ExportFile, pending
 */
async function requestOverviewExport(messageId, actor) {
  const repo = require("./assistant.repo");
  const kept = await repo.answerOf(pool, messageId, actor.user_id);
  const overview = kept && kept.metadata ? kept.metadata.overview : null;
  if (!overview || !overview.chart) throw notFound();
  const client = await pool.connect();
  try {
    return await atomically(client, async () => {
      const doc = await exportFiles.reserve(client, {
        doc_type: OVERVIEW_EXPORT,
        entity: { type: OVERVIEW_EXPORT, id: crypto.randomUUID() },
        file_name: exportFilename({ base: "praxis-ai-overview", env: config.APP_ENV, extension: "pdf" }),
        title: "Praxis AI overview",
        actor,
      });
      await emit(client, {
        key: EVENTS.ASSISTANT_OVERVIEW_EXPORT_REQUESTED,
        entity: { type: doc.entity_type, id: doc.entity_id },
        actor,
        payload: { requested_by: actor.user_id, document_id: doc.document_id, ai_message_id: messageId },
      });
      return exportFiles.present(doc);
    });
  } finally {
    client.release();
  }
}

/** A figure as a tile reads it: an amount for the template's `money`, else its words. */
function tileOf(f) {
  if (f.unit === "ngn") return { label: f.label, value: String(f.value), money: true };
  const n = Number(f.value);
  const words = Number.isFinite(n) ? new Intl.NumberFormat("en-NG", { maximumFractionDigits: 2 }).format(n) : String(f.value);
  const unit = f.unit === "percent" ? "%" : f.unit === "days" ? " days" : f.unit === "minutes" ? " minutes" : "";
  return { label: f.label, value: `${words}${unit}`.slice(0, 40), money: false };
}

/**
 * The spec of an Overview kept before its spec was (§6.19 item 8.2): its figure keys, and the grouping
 * or series whose labels its chart drew, found in the summary run again. A table Overview's chart
 * cannot be rebuilt from what was kept, so its rows are drawn instead.
 */
function specOfKept(overview, result) {
  const chart = overview.chart;
  if (overview.read) {
    const figures = (overview.figures || [])
      .map((f) => (f.key === "rows" ? { of: "rows" } : String(f.key).startsWith("sum_") ? { of: "sum", field: String(f.key).slice(4) } : null))
      .filter(Boolean);
    return { summary: null, read: overview.read, figures, chart: null };
  }
  let on = null;
  if (chart && result) {
    const names = chart.series.map((x) => x.label);
    const g = (result.groups || []).find((x) => {
      if (!x.rows.length) return false;
      const parts = (x.rows.find((r) => Array.isArray(r.parts) && r.parts.length) || {}).parts;
      return chart.kind === "stacked_bar" && parts ? names.every((n) => parts.some((p) => p.label === n)) : x.label === names[0];
    });
    if (g) on = { group: g.by, series: null };
    else {
      const keys = names.map((n) => ((result.series || []).find((x) => x.label === n) || {}).key).filter(Boolean);
      if (keys.length) on = { group: null, series: keys };
    }
  }
  return {
    summary: overview.summary,
    read: null,
    figures: (overview.figures || []).map((f) => f.key),
    chart: on ? { kind: chart.kind, title: chart.title, ...on, label: null, values: null, count: null } : null,
  };
}

/** A chart and its figures as one section of the document, or null without a chart. */
function chartSection(chart, side) {
  if (!chart) return null;
  const { chartTable } = require("../../shared/documents/chart");
  return { title: chart.title, chart: { chart: { kind: chart.kind, title: chart.title, labels: chart.labels, series: chart.series, unit: chart.unit || null } }, table: chartTable(chart, side), note: null };
}

/** A failure that a retry cannot mend: the asker no longer reaches the summary or the read. */
const REFUSED = new Set(["AI_READ_FORBIDDEN", "AI_READ_UNKNOWN", "NOT_FOUND"]);

/**
 * What the document says (AiOverviewDocumentVars), drawn again with the reader's rights now.
 * @param {object} kept  the answer (assistant.repo answerOf)
 * @param {Array<object>} reads  its ai_message_read rows
 * @param {object} reader  the asker, as grantsCache.getAuthUser gives them
 * @param {Date} now
 */
async function overviewDocument(kept, reads, reader, now = new Date()) {
  const authorise = require("../../shared/ai/authorise");
  const registry = require("../../shared/ai/registry");
  const { FIELDS } = require("../../shared/rbac/field-mask");
  const engine = require("../../services/ai/engine");
  const answer = require("../../services/ai/assistant/answer");
  const assistantReads = require("./assistant.reads");

  const md = kept.metadata || {};
  const kept0 = md.overview;
  let spec = md.overview_spec || null;
  const masked = new Set();
  const sections = [];
  let figures = [];

  const summaryKey = (spec && spec.summary) || (!spec && kept0.summary) || null;
  const readN = (spec && spec.read) || (!spec && kept0.read) || null;
  if (summaryKey) {
    const stored = reads.find((r) => r.kind === "summary" && r.read_key === summaryKey && r.outcome === "read");
    if (!stored) throw notFound();
    const res = await authorise.runSummary(pool, reader, summaryKey, stored.params || {});
    (res.masked || []).forEach((k) => masked.add(k));
    if (!spec) spec = specOfKept(kept0, res.result);
    const made = { n: stored.n, key: summaryKey, kind: "summary", ok: true, result: res.result };
    const drawn = answer.overviewFor(spec, [made]) || { figures: [], chart: null };
    figures = drawn.figures;
    const c = spec.chart || {};
    const mainGroup = c.group ? res.result.groups.find((g) => g.by === c.group) : null;
    const main = chartSection(drawn.chart, mainGroup ? mainGroup.label : "When");
    if (main) sections.push(main);
    for (const g of res.result.groups) {
      if (!g.rows.length || (drawn.chart && g.by === c.group)) continue;
      const parts = g.rows.some((r) => Array.isArray(r.parts) && r.parts.length);
      sections.push(chartSection(engine.pane.chartOfGroup({ kind: parts ? "stacked_bar" : "bar", title: g.label }, g, res.result), g.label));
    }
    const shown = new Set(drawn.chart && Array.isArray(c.series) ? c.series : []);
    for (const s of res.result.series) {
      if (!s.points.length || shown.has(s.key)) continue;
      sections.push(chartSection(engine.pane.chartOfSeries({ kind: "line", title: s.label }, [s], res.result), "When"));
    }
  } else if (readN) {
    const stored = reads.find((r) => r.n === readN && r.kind === "read" && r.outcome === "read");
    const tool = stored ? registry.read(stored.read_key) : null;
    if (!stored || !tool) throw notFound();
    if (!spec) spec = specOfKept(kept0, null);
    const params = tool.list ? { ...(stored.params || {}), page: 1 } : { ...(stored.params || {}) };
    const res = await authorise.runRead(pool, reader, stored.read_key, params);
    (res.masked || []).forEach((k) => masked.add(k));
    const rows = res.list ? res.data : res.data ? [res.data] : [];
    const made = { n: readN, key: stored.read_key, kind: "read", ok: true, list: res.list, rows, page: res.page, total: res.list ? res.page.total : rows.length };
    const drawn = answer.overviewFor(spec, [made]);
    if (drawn && drawn.chart) {
      figures = drawn.figures;
      sections.push(chartSection(drawn.chart, ""));
    } else {
      // The list is no longer all on its first page (or its chart cannot be drawn again): its rows,
      // How Many as its total now, and no sum or count over rows that are no longer all there.
      const whole = engine.pane.wholeList(made);
      figures = whole && drawn ? drawn.figures : (spec.figures || []).some((f) => f && f.of === "rows") ? [{ key: "rows", label: "How Many", value: made.total, unit: "count" }] : [];
      const t = assistantReads.drawn({ spec: tool, kept }, readN, rows);
      sections.push({
        title: (kept0.chart && kept0.chart.title) || tool.description,
        chart: null,
        table: t.columns.length ? { head: t.columns, rows: t.rows } : null,
        note: whole ? null : `The list now has ${new Intl.NumberFormat("en-NG").format(made.total)} rows.`,
      });
    }
  } else throw notFound();

  const final = sections.filter(Boolean);
  if (!final.length) final.push({ title: (kept0.chart && kept0.chart.title) || "Overview", chart: null, table: null, note: "There is nothing to chart now." });
  const readLines = reads.map((r) => {
    const tool = registry.read(r.read_key) || registry.summary(r.read_key);
    const name = tool ? tool.description : r.read_key;
    return { item: `${r.n}. ${r.kind === "summary" ? "Summary" : "Read"}`, value: `${name} (${r.read_key}). Filters: ${paramsText(r.params)}.` };
  });
  const masks = [...masked].map((k) => (FIELDS[k] ? FIELDS[k].label : k));
  return {
    question: String(kept.question || "").trim() || "Praxis AI answer",
    asked_by: reader.display_name || "",
    asked_on: new Date(kept.created_at).toISOString(),
    as_at: now.toISOString(),
    answer: String(kept.content || ""),
    figures: figures.slice(0, 3).map(tileOf),
    sections: final.slice(0, 12),
    about: [
      { item: "Made for", value: reader.display_name || "" },
      ...readLines,
      { item: "Masked fields", value: masks.length ? masks.join(", ") : "None: every field your role may see is here." },
      { item: "Environment", value: config.APP_ENV === "staging" ? "Staging: not live data" : "Live" },
    ],
  };
}

/**
 * The outbox handler: the answer's Overview drawn again with the asker's rights now and made a PDF on
 * the letterhead in the file the request reserved. A person no longer active, an answer that is gone,
 * or a summary or read the person no longer reaches, gets a failed file instead.
 * @param {object} event  assistant.overview_export_requested
 * @param {{attempt: number, max_attempts: number}} ctx  the outbox's
 */
async function buildOverviewPdf(event, ctx) {
  const grantsCache = require("../../shared/rbac/grants-cache");
  const documents = require("../../shared/documents/generate");
  const repo = require("./assistant.repo");

  const p = event.payload || {};
  if (!p.document_id) return;
  const reader = await grantsCache.getAuthUser(pool, p.requested_by || event.actor_user_id);
  if (!reader || reader.status !== "active") return exportFiles.fail(p.document_id, "The person who asked is no longer active.");
  const kept = await repo.answerOf(pool, p.ai_message_id, reader.user_id);
  if (!kept || !kept.metadata || !kept.metadata.overview) return exportFiles.fail(p.document_id, "That answer is no longer there.");

  let data;
  try {
    data = await overviewDocument(kept, await repo.readsOf(pool, p.ai_message_id, reader.user_id), reader);
  } catch (err) {
    if (err && REFUSED.has(err.code)) return exportFiles.fail(p.document_id, "Those figures are no longer available to you.");
    if (!ctx || ctx.attempt < ctx.max_attempts) throw err;
    return exportFiles.fail(p.document_id, err);
  }
  await exportFiles.make(p.document_id, ctx, async () => (await documents.previewPdf(pool, { doc_type: OVERVIEW_EXPORT, data })).pdf);
}

outbox.register(EVENTS.ASSISTANT_OVERVIEW_EXPORT_REQUESTED, "assistant.export_overview", (event, ctx) => buildOverviewPdf(event, ctx));

module.exports = { EXPORT_CEILING, READ_EXPORT_CEILING, requestExport, gather, buildExport, requestReadExport, gatherRead, buildReadExport, paramsText, requestOverviewExport, overviewDocument, buildOverviewPdf, specOfKept, tileOf };
