"use strict";
/**
 * The right pane from a turn (docs/guides/praxis-ai.md §6.13): what the server builds from the
 * reads, never from the model's numbers. Sources from every read made (its outcome: read,
 * refused, invalid, failed, or timed_out when the database cut it); Overview from the summary
 * the draft names, its figures by key and one chart drawn from the summary's own groups or
 * series, a group whose rows carry parts drawn as a stacked bar; or, for a list whose whole answer
 * came back on one page, from that read's own rows (§6.19 item 6), its figures the server's own sums
 * and counts. A figure, group or series the summary does not hold is dropped, and so is a field the
 * rows do not hold as numbers; a chart title that names a number the summary or the rows do not hold
 * anywhere (a figure, a group's value, count or part, a point, a row's value) is dropped for the
 * chart's own label.
 */
const { humanise } = require("./cards");

const CHART_KINDS = new Set(["bar", "stacked_bar", "line", "donut"]);
const MAX_POINTS = 60;
/** At most this many rows in a list's one page: a read's whole list charts only when it fits. */
const PAGE_ROWS = 25;
/** An amount as the contract carries money: a string with two places. */
const TWO_PLACES = /^-?\d{1,16}\.\d{2}$/;
/** A day, or an instant, as the wire carries it: a label a line can run along. */
const ISO_DAY = /^\d{4}-\d{2}-\d{2}/;

/** The Sources tab's entries: one per read of the turn, in order. */
function sourcesOf(reads) {
  return (reads || []).map((r) => ({
    n: r.n,
    key: r.key,
    kind: r.kind || "read",
    module_key: r.module || null,
    params: r.params || {},
    outcome: r.outcome || (r.ok ? "read" : r.declined ? "refused" : "failed"),
    rows: r.kind === "summary" ? 0 : (r.rows || []).length,
    total: r.ok && r.kind !== "summary" ? r.total : r.kind === "summary" && r.result ? r.result.total : null,
    first: r.ok && r.page ? (r.page.number - 1) * r.page.size + 1 : null,
    masked: r.masked || [],
  }));
}

const num = (v) => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * A chart over a summary's group: its rows as labels. A stacked bar over rows that carry parts is
 * one series per part, in the order of the first row's parts (§6.19 item 1); a stacked bar over rows
 * without parts is drawn as a bar; any other kind draws the rows' values (a row with parts: their sum).
 */
function chartOfGroup(spec, group, result = null) {
  const rows = group.rows.slice(0, MAX_POINTS);
  const unit = moneyChart(result, rows.flatMap((r) => [r.value, ...(r.parts || []).map((p) => p.value)]));
  const labels = rows.map((r) => r.label);
  const parts = (rows.find((r) => Array.isArray(r.parts) && r.parts.length) || {}).parts;
  if (spec.kind === "stacked_bar" && parts) {
    const series = parts.slice(0, 6).map((p) => ({
      label: p.label,
      values: rows.map((r) => num(((r.parts || []).find((x) => x.key === p.key) || {}).value)),
    }));
    return { kind: "stacked_bar", title: spec.title, labels, series, unit };
  }
  const kind = spec.kind === "stacked_bar" ? "bar" : spec.kind;
  return { kind, title: spec.title, labels, series: [{ label: group.label, values: rows.map((r) => num(r.value)) }], unit };
}

/**
 * A summary's chart reads naira (decision 56; §6.19 item 7) when every value it draws is an amount
 * with two places and the summary holds a figure in naira, so a score's average ("72.50") in a summary
 * of counts stays a number. Null otherwise.
 */
function moneyChart(result, values) {
  if (!result || !(result.figures || []).some((f) => f.unit === "ngn")) return null;
  return values.length && values.every((v) => typeof v === "string" && TWO_PLACES.test(v)) ? "ngn" : null;
}

/** A chart over a summary's series: their points' labels, one line per series. */
function chartOfSeries(spec, series, result = null) {
  const labels = series[0].points.slice(0, MAX_POINTS).map((p) => p.at);
  const unit = moneyChart(result, series.slice(0, 6).flatMap((s) => s.points.slice(0, MAX_POINTS).map((p) => p.value)));
  return {
    kind: spec.kind,
    title: spec.title,
    labels,
    series: series.slice(0, 6).map((s) => ({ label: s.label, values: labels.map((at) => num((s.points.find((p) => p.at === at) || {}).value)) })),
    unit,
  };
}

/** Every number a summary holds, as strings: its figures, its groups' values, counts and parts, its points. */
function valuesOf(result) {
  const out = new Set();
  const add = (v) => {
    if (v === null || v === undefined || v === "") return;
    const n = typeof v === "number" ? v : Number(v);
    if (Number.isFinite(n)) {
      out.add(String(n));
      out.add(String(Math.round(n)));
    }
    out.add(String(v));
  };
  for (const f of result.figures || []) add(f.value);
  for (const g of result.groups || [])
    for (const r of g.rows || []) {
      add(r.value);
      add(r.count);
      for (const p of r.parts || []) add(p.value);
    }
  for (const s of result.series || []) for (const p of s.points || []) add(p.value);
  add(result.total);
  return out;
}

/**
 * Whether a chart's title names a number the summary does not hold anywhere (a figure the model made
 * up). A year or a day in a date (2026, November 2026, 21/10/2026, 2026-11) is not a figure and is let through.
 */
function titleNamesAValueNotShown(title, chart, figures, result = null) {
  const held = result ? valuesOf(result) : new Set();
  for (const v of [...chart.series.flatMap((s) => s.values), ...figures.map((f) => num(f.value))]) held.add(String(v));
  const text = String(title)
    .replace(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g, " ")
    .replace(/\b\d{4}-\d{2}(?:-\d{2})?\b/g, " ")
    .replace(/\b(?:19|20)\d{2}\b/g, " ");
  const numbers = text.match(/\d[\d,]*(?:\.\d+)?/g) || [];
  return numbers.some((n) => {
    const plain = n.replace(/,/g, "");
    return !held.has(plain) && !held.has(String(Number(plain)));
  });
}

/**
 * The Overview the draft asked for, from the summary it names.
 * @param {{summary: string, figures?: string[], chart?: {kind: string, title: string, group?: string|null, series?: string[]|null}|null}|null} spec
 * @param {Array<{n: number, key: string, kind: string, ok: boolean, result?: object}>} reads
 */
function overviewOf(spec, reads) {
  if (!spec || !spec.summary) return null;
  const made = (reads || []).find((r) => r.kind === "summary" && r.ok && r.key === spec.summary && r.result);
  if (!made) return null;
  const { figures, groups, series } = made.result;
  const picked = (spec.figures || [])
    .filter((k) => typeof k === "string")
    .map((k) => figures.find((f) => f.key === k))
    .filter(Boolean)
    .slice(0, 3);
  let chart = null;
  const c = spec.chart;
  if (c && CHART_KINDS.has(c.kind) && c.title) {
    if (c.group) {
      const g = groups.find((x) => x.by === c.group);
      if (g && g.rows.length) chart = chartOfGroup(c, g, made.result);
    } else if (Array.isArray(c.series) && c.series.length) {
      const s = c.series.map((k) => series.find((x) => x.key === k)).filter(Boolean);
      if (s.length && s[0].points.length) chart = chartOfSeries(c, s, made.result);
    }
    if (chart && titleNamesAValueNotShown(chart.title, chart, picked, made.result)) chart = { ...chart, title: chartLabel(chart) };
  }
  return { summary: spec.summary, read: null, title: null, figures: picked, chart };
}

/** A chart's own words when the model's title cannot be kept: its first series' label. */
const chartLabel = (chart) => (chart.series[0] && chart.series[0].label) || "Overview";

/* ------------------------------------------------------------------ *
 * An Overview from a whole list's rows (§6.19 item 6; decision 50)
 * ------------------------------------------------------------------ */

/** The value at a field of a row, a dotted field reaching into it ("department.name"); undefined when the row has none. */
function valueIn(row, field) {
  let v = row;
  for (const k of String(field).split(".")) {
    if (v === null || typeof v !== "object" || Array.isArray(v) || !Object.prototype.hasOwnProperty.call(v, k)) return undefined;
    v = v[k];
  }
  return v;
}

/**
 * The rows of a read whose whole list came back on its first page, or null: a list read that
 * returned, page 1, no next page, its rows its total, at most 25. One record, a document's reading
 * and a summary never chart from rows; a list longer than a page is charted only from its summary.
 */
function wholeList(read) {
  if (!read || !read.ok || read.kind === "summary" || !read.list) return null;
  const rows = Array.isArray(read.rows) ? read.rows : [];
  const page = read.page;
  if (!rows.length || rows.length > PAGE_ROWS || !page || page.number !== 1 || page.has_next) return null;
  return read.total === rows.length ? rows : null;
}

/** A field's words, from its last part: "department.allocated" reads Allocated. */
const fieldWords = (field) => humanise(String(field).split(".").pop());

/** A read's words for how many rows it has: "worksites.list" reads Worksites. */
function readWords(key) {
  const words = String(key)
    .split(/[._]/)
    .filter((w) => w && w !== "list")
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
  return words || "Rows";
}

/**
 * A field's values over every row, when each is a number or an amount with two places; null when
 * any is not (missing, masked to null, words). `money` when they are amounts in a field named like
 * money (the adapter's `moneyField`).
 */
function numbersOf(rows, field, moneyField) {
  const raw = rows.map((r) => valueIn(r, field));
  const ok = raw.every((v) => (typeof v === "number" && Number.isFinite(v)) || (typeof v === "string" && TWO_PLACES.test(v)));
  if (!ok) return null;
  return { raw, values: raw.map(Number), money: raw.every((v) => typeof v === "string") && Boolean(moneyField(field)) };
}

/** What a person reads in a label: the table's own cell, or null when it is nothing a person reads (an id). */
function labelText(cell, field, v) {
  if (v === undefined) return null;
  const c = cell(field, v);
  if (!c) return null;
  return c.text === "" ? "None" : String(c.text).slice(0, 60);
}

/**
 * The figures the draft asked for, worked out from the rows: how many rows, the sum of a number or
 * money field (money through the adapter's `sumMoney`, exact to the kobo), how many rows hold a
 * code. A figure the rows cannot give is dropped; never a number the model wrote.
 */
function rowFigures(asked, rows, key, { cell, moneyField, sumMoney }) {
  const out = [];
  for (const f of asked || []) {
    if (!f || typeof f !== "object") continue;
    let figure = null;
    if (f.of === "rows") figure = { key: "rows", label: readWords(key), value: rows.length, unit: "count" };
    else if (f.of === "sum" && f.field) {
      const n = numbersOf(rows, f.field, moneyField);
      if (n && n.money) figure = sumMoney ? { key: `sum_${f.field}`, label: fieldWords(f.field), value: sumMoney(n.raw), unit: "ngn" } : null;
      else if (n) figure = { key: `sum_${f.field}`, label: fieldWords(f.field), value: Number(n.values.reduce((s, v) => s + v, 0).toFixed(6)), unit: null };
    } else if (f.of === "count" && f.field && f.value !== null && f.value !== undefined) {
      const raw = rows.map((r) => valueIn(r, f.field));
      if (raw.every((v) => v === undefined)) continue;
      const want = String(f.value).trim().toLowerCase();
      const matches = (v) => v !== undefined && v !== null && (String(v).toLowerCase() === want || String((cell(f.field, v) || {}).text || "").toLowerCase() === want);
      const hit = raw.find(matches);
      const label = labelText(cell, f.field, hit !== undefined ? hit : String(f.value));
      if (label) figure = { key: `count_${f.field}_${String(f.value)}`, label, value: raw.filter(matches).length, unit: "count" };
    }
    if (!figure) continue;
    figure.key = figure.key.replace(/[^A-Za-z0-9_.-]+/g, "_").slice(0, 64);
    figure.label = figure.label.slice(0, 60);
    if (!out.some((x) => x.key === figure.key)) out.push(figure);
  }
  return out.slice(0, 3);
}

/**
 * A chart of a whole list's rows (§6.19 item 6). `values`: each row a bar named by its `label`
 * field, one value field a bar (a donut when asked, a line over a date label when asked, the rows
 * then in date order), several a stacked bar when asked (parts of one whole) or lines over a date
 * label, else the first alone as a bar. `count`: the rows counted by a code field's words, most first,
 * a donut when asked, else a bar. Null when a field is not every row's, a value is not a number or an
 * amount, a label is nothing a person reads, or a bar, stacked bar or donut would go below zero.
 */
function chartOfRows(c, rows, { cell, moneyField }) {
  if (!c || !CHART_KINDS.has(c.kind) || !c.title) return null;
  if (c.count) {
    const groups = new Map();
    for (const r of rows) {
      const text = labelText(cell, c.count, valueIn(r, c.count));
      if (text === null) return null;
      groups.set(text, (groups.get(text) || 0) + 1);
    }
    const sorted = [...groups.entries()].map(([label, n], i) => ({ label, n, i })).sort((x, y) => y.n - x.n || x.i - y.i);
    return {
      kind: c.kind === "donut" ? "donut" : "bar",
      title: c.title,
      labels: sorted.map((g) => g.label),
      series: [{ label: fieldWords(c.count), values: sorted.map((g) => g.n) }],
      unit: null,
    };
  }
  if (!c.label || !Array.isArray(c.values) || !c.values.length) return null;
  const fields = [...new Set(c.values)].slice(0, 6);
  const numbers = fields.map((f) => numbersOf(rows, f, moneyField));
  if (numbers.some((n) => !n)) return null;
  const raws = rows.map((r) => valueIn(r, c.label));
  const labels = raws.map((v) => labelText(cell, c.label, v));
  if (labels.some((l) => l === null)) return null;
  const dated = raws.every((v) => typeof v === "string" && ISO_DAY.test(v));
  let kind = "bar";
  let use = [0];
  if (c.kind === "line" && dated) {
    kind = "line";
    use = numbers.map((_, i) => i);
  } else if (fields.length === 1) kind = c.kind === "donut" ? "donut" : "bar";
  else if (c.kind === "stacked_bar") {
    kind = "stacked_bar";
    use = numbers.map((_, i) => i);
  }
  let order = rows.map((_, i) => i);
  if (kind === "line") order = order.sort((x, y) => (raws[x] < raws[y] ? -1 : raws[x] > raws[y] ? 1 : x - y));
  const series = use.map((i) => ({ label: fieldWords(fields[i]), values: order.map((r) => numbers[i].values[r]) }));
  if (kind !== "line" && series.some((s) => s.values.some((v) => v < 0))) return null;
  return {
    kind,
    title: c.title,
    labels: order.map((r) => labels[r]),
    series,
    unit: use.every((i) => numbers[i].money) ? "ngn" : null,
  };
}

/**
 * The Overview the draft asked for from a read whose rows are its whole list (§6.19 item 6), or null.
 * The adapter hands in the table's own `cell(field, value)`, so a label reads as its cell does,
 * `moneyField(field)`, whether a field holds naira, and `sumMoney(amounts)`, their total as a
 * two-place string (shared/money); the engine knows nothing of any of them.
 * @param {{read: number, figures?: Array<object|string>, chart?: object|null}|null} spec
 * @param {Array<object>} reads
 * @param {{cell: (field: string, value: unknown) => ({text: string}|null), moneyField?: (field: string) => boolean, sumMoney?: (amounts: string[]) => string}} deps
 */
function overviewOfRows(spec, reads, { cell, moneyField = () => false, sumMoney = null } = {}) {
  if (!spec || !spec.read || typeof cell !== "function") return null;
  const made = (reads || []).find((r) => r.n === spec.read);
  const rows = wholeList(made);
  if (!rows) return null;
  const deps = { cell, moneyField, sumMoney };
  const figures = rowFigures(spec.figures, rows, made.key, deps);
  let chart = chartOfRows(spec.chart, rows, deps);
  if (chart) {
    const held = rows.flatMap((r) => [...(spec.chart.values || [])].map((f) => valueIn(r, f))).filter((v) => typeof v === "number" || typeof v === "string");
    const result = { figures, groups: [], series: [{ points: held.map((value) => ({ value })) }], total: rows.length };
    if (titleNamesAValueNotShown(chart.title, chart, figures, result)) chart = { ...chart, title: chartLabel(chart) };
  }
  if (!figures.length && !chart) return null;
  return { summary: null, read: made.n, title: null, figures, chart };
}

module.exports = { sourcesOf, overviewOf, overviewOfRows, wholeList, chartOfRows, rowFigures, chartOfGroup, chartOfSeries, moneyChart, titleNamesAValueNotShown, valuesOf, CHART_KINDS };
