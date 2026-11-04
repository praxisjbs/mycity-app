"use strict";
/**
 * The right pane from a turn (docs/guides/praxis-ai.md §6.13): what the server builds from the
 * reads, never from the model's numbers. Sources from every read made (its outcome: read,
 * refused, invalid, failed, or timed_out when the database cut it); Overview from the summary
 * the draft names, its figures by key and one chart drawn from the summary's own groups or
 * series. A figure, group or series the summary does not hold is dropped; a chart title that
 * names a number the summary does not hold anywhere (a figure, a group's value or count, a
 * point) is dropped for the chart's own label.
 */

const CHART_KINDS = new Set(["bar", "stacked_bar", "line", "donut"]);
const MAX_POINTS = 60;

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

/** A chart over a summary's group: its rows as labels, one series of their values. */
function chartOfGroup(spec, group) {
  const rows = group.rows.slice(0, MAX_POINTS);
  return { kind: spec.kind, title: spec.title, labels: rows.map((r) => r.label), series: [{ label: group.label, values: rows.map((r) => num(r.value)) }] };
}

/** A chart over a summary's series: their points' labels, one line per series. */
function chartOfSeries(spec, series) {
  const labels = series[0].points.slice(0, MAX_POINTS).map((p) => p.at);
  return {
    kind: spec.kind,
    title: spec.title,
    labels,
    series: series.slice(0, 6).map((s) => ({ label: s.label, values: labels.map((at) => num((s.points.find((p) => p.at === at) || {}).value)) })),
  };
}

/** Every number a summary holds, as strings: its figures, its groups' values and counts, its points. */
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
  const picked = (spec.figures || []).map((k) => figures.find((f) => f.key === k)).filter(Boolean).slice(0, 3);
  let chart = null;
  const c = spec.chart;
  if (c && CHART_KINDS.has(c.kind) && c.title) {
    if (c.group) {
      const g = groups.find((x) => x.by === c.group);
      if (g && g.rows.length) chart = chartOfGroup(c, g);
    } else if (Array.isArray(c.series) && c.series.length) {
      const s = c.series.map((k) => series.find((x) => x.key === k)).filter(Boolean);
      if (s.length && s[0].points.length) chart = chartOfSeries(c, s);
    }
    if (chart && titleNamesAValueNotShown(chart.title, chart, picked, made.result)) chart = { ...chart, title: chartLabel(chart) };
  }
  return { summary: spec.summary, title: null, figures: picked, chart };
}

/** A chart's own words when the model's title cannot be kept: its first series' label. */
const chartLabel = (chart) => (chart.series[0] && chart.series[0].label) || "Overview";

module.exports = { sourcesOf, overviewOf, chartOfGroup, chartOfSeries, titleNamesAValueNotShown, valuesOf, CHART_KINDS };
