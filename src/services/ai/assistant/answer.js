"use strict";
/**
 * What the screen shows for an answer (docs/guides/praxis-ai.md §6.4), from the model's draft and
 * the reads the question made. Nothing the model typed becomes a figure: a table's cells are the
 * named read's own rows, the screen button is one of the routes offered this question, and the
 * citations are the records the reads returned (shared/ai/cite.js), never the answer's words.
 *
 *   const shown = answer.build({ draft, reads, routes, screens });
 *   // → { content, table, link, citations, citations_total, reads, declined, more, rows_read, module_key,
 *   //     metadata, stored_citations }
 */
const { mergeCitations } = require("../../../shared/ai/cite");
const routeMap = require("../../../shared/route-map");
const { formatDate, formatDateTime } = require("../../../shared/time/day-first");
const { formatNaira } = require("../../../shared/money/money");

const MAX_CITATIONS = 50;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const MONEY = /^-?\d{1,16}\.\d{2}$/;
/** Fields named like an amount: a two-place string there is naira. */
const MONEY_FIELD = /(amount|total|salary|cost|price|fee|balance|pay|ngn|naira|budget|spend|deduction|value)/i;

/** One cell for a person to read, and whether it right-aligns. */
function cell(field, v) {
  if (v === null || v === undefined || v === "") return { text: "", numeric: false };
  if (typeof v === "number") return { text: String(v), numeric: true };
  if (typeof v === "boolean") return { text: v ? "Yes" : "No", numeric: false };
  if (typeof v !== "string") return null;
  if (ISO_DATE.test(v)) return { text: formatDate(v), numeric: false };
  if (ISO_INSTANT.test(v) && !Number.isNaN(Date.parse(v))) return { text: formatDateTime(v), numeric: false };
  if (MONEY.test(v) && MONEY_FIELD.test(field)) return { text: formatNaira(v), numeric: true };
  return { text: v, numeric: false };
}

/**
 * The table the draft asked for, drawn from the read's rows. A field the rows do not carry, or that
 * holds a list or an object, is left out; a table with no field left is no table.
 */
function tableOf(spec, reads) {
  if (!spec) return null;
  const read = reads.find((r) => r.n === spec.read && r.ok);
  if (!read || !read.rows.length) return null;
  const cols = [];
  spec.fields.forEach((f, i) => {
    if (cols.some((c) => c.field === f)) return;
    const values = read.rows.map((row) => (row && Object.prototype.hasOwnProperty.call(row, f) ? cell(f, row[f]) : undefined));
    if (values.some((v) => v === undefined || v === null)) return;
    cols.push({ field: f, label: spec.labels[i] || f, values });
  });
  if (!cols.length) return null;
  return {
    columns: cols.map((c) => c.label),
    rows: read.rows.map((_, r) => cols.map((c) => c.values[r].text)),
    numeric: cols.map((c, i) => (c.values.some((v) => v.text !== "") && c.values.every((v) => v.text === "" || v.numeric) ? i : -1)).filter((i) => i >= 0),
  };
}

/** The values of a prefill its route's schema takes, each checked on its own; never one of the route's params. */
function prefillOf(route, values) {
  if (!route.prefill || !values || typeof values !== "object") return {};
  let s = route.prefill;
  while (s && s._def && !s.shape && (s._def.schema || s._def.innerType)) s = s._def.schema || s._def.innerType;
  const shape = (s && s.shape) || {};
  const out = {};
  for (const [k, v] of Object.entries(values)) {
    if (!Object.prototype.hasOwnProperty.call(shape, k) || (route.params && k in route.params)) continue;
    // A list of plain values (New Event's attendees) travels as one comma-separated value.
    if (Array.isArray(v) && v.length && v.every((x) => typeof x === "string" && !x.includes(","))) {
      if (shape[k].safeParse(v).success) out[k] = v.join(",");
      continue;
    }
    if (typeof v !== "string" && typeof v !== "number" && typeof v !== "boolean") continue;
    if (!shape[k].safeParse(v).success) continue;
    out[k] = String(v);
  }
  return out;
}

/** The screen button: one of the offered routes, by its intent. */
function linkOf(intent, values, routes, screens) {
  if (!intent) return null;
  const want = String(intent).trim().toLowerCase();
  const route = routes.find((r) => r.intent.toLowerCase() === want);
  if (!route) return null;
  const screen = screens.find((s) => s.module === route.module && s.tab === route.tab);
  const name = screen ? screen.label : route.tab;
  const params = { ...prefillOf(route, values), ...(route.params || {}) };
  return {
    label: name.split(/\s+/).length <= 2 ? `Open ${name}` : name,
    path: routeMap.screenPath(route.module, route.tab, { params }),
  };
}

/**
 * @param {{draft: object, reads: Array<object>, routes: Array<object>, screens: Array<object>}} q
 */
function build({ draft, reads, routes, screens }) {
  const ok = reads.filter((r) => r.ok);
  const table = tableOf(draft.table, reads);
  const link = linkOf(draft.route, draft.prefill, routes, screens);
  const all = mergeCitations(ok.map((r) => r.citations || [])).map((c) => ({
    entity_type: c.type,
    entity_id: c.id,
    label: c.label || c.type,
    link: c.link,
    read_key: c.read,
  }));
  const citations = all.slice(0, MAX_CITATIONS);
  let declined = null;
  if (link) declined = "change";
  else if (reads.some((r) => r.declined) && !ok.length) declined = "not_available";
  const madeReads = reads.map((r) => ({
    key: r.key,
    params: r.params,
    rows: r.rows.length,
    total: r.ok ? r.total : null,
    first: r.ok && r.page ? (r.page.number - 1) * r.page.size + 1 : null,
  }));
  const more = Boolean(draft.more) && ok.some((r) => r.page && r.page.has_next);
  const shown = {
    content: draft.text,
    table,
    link,
    citations,
    citations_total: all.length,
    reads: madeReads.map(({ key, rows, total, first }) => ({ key, rows, total, first })),
    declined,
    more,
    rows_read: ok.reduce((n, r) => n + r.rows.length, 0),
    module_key: ok.length ? ok[0].module : null,
  };
  // What is kept on the answer's message, for History and the next turn's replay, and every
  // citation, whose count History shows beside the first fifty.
  shown.metadata = { table, link, reads: madeReads, declined, more };
  shown.stored_citations = all;
  return shown;
}

module.exports = { build, tableOf, linkOf, prefillOf, cell, MAX_CITATIONS };
