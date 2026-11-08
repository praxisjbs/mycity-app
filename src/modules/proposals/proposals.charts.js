"use strict";
/**
 * The design kit's charts (docs/guides/partnerships.md §6.11): a `ProposalChart` turned into the
 * shapes `templates/proposals/chart.html` draws as SVG. Geometry only, in the chart's own units: the
 * template escapes every value, and the kit's CSS colours each series from its tokens, so a chart
 * looks the same in the PDF, the studio and the public page, on paper and on Deep Green.
 *
 *   columns (bar), bars (hbar), stacked columns, a line, an area, a donut, progress rings
 *
 * Numbers read as the house's (`en-NG`, "12,400"); past a hundred thousand they shorten ("1.3M"),
 * as a KPI tile does.
 */

const round = (n) => Math.round(n * 10) / 10;
const plain = new Intl.NumberFormat("en-NG", { maximumFractionDigits: 1 });
const short = new Intl.NumberFormat("en-NG", { notation: "compact", maximumFractionDigits: 1 });

/** A value as a person reads it, with the chart's unit after it. */
function label(value, unit) {
  const n = Math.abs(value) >= 100000 ? short.format(value) : plain.format(value);
  if (!unit) return n;
  return unit === "%" ? `${n}%` : `${n} ${unit}`;
}

/** A round top for an axis: 1, 2, 2.5 or 5 times a power of ten, at or above the largest value. */
function niceMax(max) {
  if (max <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(max));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= max) return m * p;
  return 10 * p;
}

const textW = (s, size = 12) => String(s).length * size * 0.56;

/** Columns side by side (one series or several), or stacked. */
function columns(chart, w, h, stacked) {
  const series = chart.series;
  const labels = series[0].points.map((p) => p.label);
  const totals = labels.map((_, i) => series.reduce((sum, s) => sum + s.points[i].value, 0));
  const top = niceMax(stacked ? Math.max(...totals) : Math.max(...series.flatMap((s) => s.points.map((p) => p.value))));
  const left = 8;
  const right = w - 8;
  const plotTop = 22;
  const plotBottom = h - 30;
  const ph = plotBottom - plotTop;
  const band = (right - left) / labels.length;
  const groupW = Math.min(band * 0.62, stacked ? 56 : 28 * series.length + 8);
  const barW = stacked ? groupW : (groupW - (series.length - 1) * 4) / series.length;
  const y = (v) => plotBottom - (v / top) * ph;
  const grid = [0.25, 0.5, 0.75, 1].map((f) => ({ x1: left, y1: round(y(top * f)), x2: right, y2: round(y(top * f)) }));
  grid.push({ x1: left, y1: plotBottom, x2: right, y2: plotBottom });
  const rects = [];
  const texts = [];
  labels.forEach((name, i) => {
    const gx = left + band * i + (band - groupW) / 2;
    let base = 0;
    series.forEach((s, si) => {
      const v = s.points[i].value;
      const x = stacked ? gx : gx + si * (barW + 4);
      const y0 = stacked ? y(base + v) : y(v);
      const hgt = stacked ? y(base) - y(base + v) : plotBottom - y(v);
      rects.push({ s: si + 1, x: round(x), y: round(y0), rw: round(barW), rh: round(Math.max(hgt, 0.5)), r: stacked ? 0 : Math.min(4, barW / 3) });
      base += v;
      if (!stacked && series.length === 1) texts.push({ cls: "c-value", tx: round(x + barW / 2), ty: round(y0 - 8), anchor: "middle", text: label(v, chart.unit) });
    });
    if (stacked) texts.push({ cls: "c-value", tx: round(gx + groupW / 2), ty: round(y(totals[i]) - 8), anchor: "middle", text: label(totals[i], chart.unit) });
    texts.push({ cls: "c-label", tx: round(gx + groupW / 2), ty: plotBottom + 20, anchor: "middle", text: name });
  });
  return { grid, rects, texts, paths: [], dots: [] };
}

/** Bars across, a label on the left and the value at the bar's end. */
function bars(chart, w, h) {
  const series = chart.series;
  const labels = series[0].points.map((p) => p.label);
  const top = niceMax(Math.max(...series.flatMap((s) => s.points.map((p) => p.value))));
  const labelW = Math.min(Math.max(...labels.map((l) => textW(l, 13))) + 12, w * 0.36);
  const left = labelW;
  const right = w - 64;
  const row = Math.min((h - 4) / labels.length, 54);
  const barH = Math.min(row * 0.56, 12 * series.length + 8) / series.length;
  const x = (v) => left + (v / top) * (right - left);
  const rects = [];
  const texts = [];
  labels.forEach((name, i) => {
    const gy = 2 + row * i + (row - barH * series.length) / 2;
    texts.push({ cls: "c-label", tx: round(left - 12), ty: round(gy + (barH * series.length) / 2 + 4), anchor: "end", text: name });
    series.forEach((s, si) => {
      const v = s.points[i].value;
      const by = gy + si * barH;
      rects.push({ s: si + 1, x: left, y: round(by), rw: round(Math.max(x(v) - left, 0.5)), rh: round(barH - 2), r: Math.min(3, barH / 3) });
      if (series.length === 1) texts.push({ cls: "c-value", tx: round(x(v) + 8), ty: round(by + barH / 2 + 3.5), anchor: "start", text: label(v, chart.unit) });
    });
  });
  const grid = [{ x1: left, y1: 0, x2: left, y2: round(row * labels.length + 4) }];
  return { grid, rects, texts, paths: [], dots: [] };
}

/** A line, or an area under it, for each series. */
function lines(chart, w, h, area) {
  const series = chart.series;
  const labels = series[0].points.map((p) => p.label);
  const top = niceMax(Math.max(...series.flatMap((s) => s.points.map((p) => p.value))));
  const left = 12;
  const right = w - 12;
  const plotTop = 24;
  const plotBottom = h - 30;
  const x = (i) => left + (labels.length === 1 ? 0 : (i / (labels.length - 1)) * (right - left));
  const y = (v) => plotBottom - (v / top) * (plotBottom - plotTop);
  const grid = [0.25, 0.5, 0.75, 1].map((f) => ({ x1: left, y1: round(y(top * f)), x2: right, y2: round(y(top * f)) }));
  grid.push({ x1: left, y1: plotBottom, x2: right, y2: plotBottom });
  const paths = [];
  const dots = [];
  const texts = [];
  series.forEach((s, si) => {
    const pts = s.points.map((p, i) => [round(x(i)), round(y(p.value))]);
    const d = pts.map(([px, py], i) => `${i ? "L" : "M"}${px} ${py}`).join("");
    if (area) paths.push({ cls: `c-area c-s${si + 1}`, d: `${d}L${pts[pts.length - 1][0]} ${plotBottom}L${pts[0][0]} ${plotBottom}Z`, sw: 0 });
    paths.push({ cls: `c-line c-s${si + 1}`, d, sw: 3 });
    pts.forEach(([cx, cy]) => dots.push({ s: si + 1, cx, cy, cr: 4.5 }));
    if (series.length === 1) {
      s.points.forEach((p, i) => {
        const anchor = i === 0 ? "start" : i === s.points.length - 1 ? "end" : "middle";
        texts.push({ cls: "c-value", tx: pts[i][0], ty: round(pts[i][1] - 12), anchor, text: label(p.value, chart.unit) });
      });
    }
  });
  labels.forEach((name, i) => {
    const anchor = i === 0 ? "start" : i === labels.length - 1 ? "end" : "middle";
    texts.push({ cls: "c-label", tx: round(x(i)), ty: plotBottom + 20, anchor, text: name });
  });
  return { grid, rects: [], texts, paths, dots };
}

/** An arc of a ring, from one fraction of the turn to another, as path data. */
function arc(cx, cy, r, from, to) {
  const a0 = from * 2 * Math.PI - Math.PI / 2;
  const a1 = to * 2 * Math.PI - Math.PI / 2;
  const large = to - from > 0.5 ? 1 : 0;
  const p = (a) => `${round(cx + r * Math.cos(a))} ${round(cy + r * Math.sin(a))}`;
  if (to - from >= 0.9999) return `M${p(a0)}A${r} ${r} 0 1 1 ${p(a0 + Math.PI)}A${r} ${r} 0 1 1 ${p(a0)}`;
  return `M${p(a0)}A${r} ${r} 0 ${large} 1 ${p(a1)}`;
}

/** A donut: slices with a gap between, the largest share in the middle, the slices in the legend. */
function donut(chart, w, h) {
  const pts = chart.series[0].points;
  const total = pts.reduce((s, p) => s + p.value, 0) || 1;
  const r = Math.min(h / 2 - 16, w / 2 - 16, 120);
  const thick = Math.max(r * 0.26, 18);
  const cx = w / 2;
  const cy = h / 2;
  const gap = pts.length > 1 ? 0.006 : 0;
  let at = 0;
  const paths = [{ cls: "c-track", d: arc(cx, cy, r, 0, 1), sw: thick }];
  pts.forEach((p, i) => {
    const share = p.value / total;
    if (share > 0) paths.push({ cls: `c-arc c-s${i + 1}`, d: arc(cx, cy, r, at + gap, at + share - gap), sw: thick });
    at += share;
  });
  const big = pts.reduce((m, p) => (p.value > m.value ? p : m), pts[0]);
  const pct = Math.round((big.value / total) * 100);
  const texts = [
    { cls: "c-big", tx: round(cx), ty: round(cy + 6), anchor: "middle", text: `${pct}%` },
    { cls: "c-label", tx: round(cx), ty: round(cy + 28), anchor: "middle", text: big.label },
  ];
  const legend = pts.map((p, i) => ({ s: i + 1, name: `${p.label} ${Math.round((p.value / total) * 100)}%` }));
  return { grid: [], rects: [], texts, paths, dots: [], legend };
}

/** Progress rings: one a point, each a percentage, its label under it. */
function rings(chart, w, h) {
  const pts = chart.series[0].points;
  const cell = w / pts.length;
  const r = Math.min(cell / 2 - 18, h / 2 - 34, 92);
  const thick = Math.max(r * 0.2, 10);
  const cy = r + thick / 2 + 4;
  const paths = [];
  const texts = [];
  pts.forEach((p, i) => {
    const cx = cell * i + cell / 2;
    paths.push({ cls: "c-track", d: arc(cx, cy, r, 0, 1), sw: thick });
    if (p.value > 0) paths.push({ cls: `c-ring c-s${i === 0 ? 1 : (i % 4) + 1}`, d: arc(cx, cy, r, 0, Math.min(p.value, 100) / 100), sw: thick });
    texts.push({ cls: "c-big", tx: round(cx), ty: round(cy + 12), anchor: "middle", text: label(p.value, "%") });
    texts.push({ cls: "c-label", tx: round(cx), ty: round(cy + r + thick + 22), anchor: "middle", text: p.label });
  });
  return { grid: [], rects: [], texts, paths, dots: [] };
}

/**
 * The shapes of a chart drawn in a box of `w` by `h`.
 * @param {object} chart  a ProposalChart, already checked
 * @param {{w: number, h: number}} box
 */
function shapes(chart, { w, h }) {
  const drawn =
    chart.kind === "bar"
      ? columns(chart, w, h, false)
      : chart.kind === "stacked"
        ? columns(chart, w, h, true)
        : chart.kind === "hbar"
          ? bars(chart, w, h)
          : chart.kind === "line" || chart.kind === "area"
            ? lines(chart, w, h, chart.kind === "area")
            : chart.kind === "donut"
              ? donut(chart, w, h)
              : rings(chart, w, h);
  const many = chart.series.length > 1;
  const legend = drawn.legend || (many ? chart.series.map((s, i) => ({ s: i + 1, name: s.name || `Series ${i + 1}` })) : []);
  const points = chart.series[0].points.map((p, i) => `${p.label} ${chart.series.map((s) => label(s.points[i].value, chart.unit)).join(", ")}`);
  return {
    kind: chart.kind,
    title: chart.title,
    w,
    h,
    aria: `${chart.title}: ${points.join("; ")}`,
    grid: drawn.grid,
    rects: drawn.rects,
    paths: drawn.paths,
    dots: drawn.dots,
    texts: drawn.texts,
    legend,
  };
}

module.exports = { shapes, label, niceMax };
