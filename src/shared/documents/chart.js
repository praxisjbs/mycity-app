"use strict";
/**
 * A chart in a document (docs/guides/praxis-ai.md §6.19 item 8.4): the one place a document draws a
 * chart. The renderer (render.js) prints a chart block, a value the code built and never one a
 * template or a person writes, as a grid and a signature already are:
 *
 *   { chart: { kind: "stacked_bar", title, labels: ["Engineering", ...], series: [{ label: "Spent", values: [...] }], unit: "ngn" } }
 *
 * It is drawn here as SVG from its numbers alone, every label escaped, so nothing written reaches the
 * markup ("there is no raw output" holds). Bar and stacked bar run sideways, a label to each bar, so a
 * department's whole name fits; a line runs along its labels; a donut is a ring with its key beside it.
 * A stacked bar, a donut and several lines carry a legend. A value below zero is drawn as zero on a bar
 * (decision 51: never a negative bar; the table under the chart says the figure).
 *
 * The series colours, the ink and the rules are the light theme's tokens (`--chart-1` to `--chart-6`,
 * `--foreground`, `--muted-foreground`, `--border` of `:root`), read once from
 * packages/ui/src/styles/tokens.css, so a colour still lives in one place; a release carries that file
 * (scripts/deploy/release-manifest.js).
 */
const fs = require("node:fs");
const path = require("node:path");
const { escapeHtml } = require("./markdown");
const money = require("../money/money");

const TOKENS = path.resolve(__dirname, "..", "..", "..", "packages", "ui", "src", "styles", "tokens.css");
const KINDS = new Set(["bar", "stacked_bar", "line", "donut"]);
const SERIES_TOKENS = ["--chart-1", "--chart-2", "--chart-3", "--chart-4", "--chart-5", "--chart-6"];
const INK_TOKENS = { ink: "--foreground", muted: "--muted-foreground", rule: "--border" };
const HEX = /^#[0-9A-Fa-f]{6}$/;

/** The page's width in SVG units: an A4 page's text column at the letterhead's margins. */
const WIDTH = 640;
const MAX_LABELS = 60;

/**
 * The light theme's colours from tokens.css: the first `:root` block's series, ink and rule tokens.
 * Throws when one is missing, so a renamed token fails a test, never a printed chart.
 * @param {string} css
 * @returns {{series: string[], ink: string, muted: string, rule: string}}
 */
function coloursFrom(css) {
  const at = String(css).indexOf(":root");
  if (at < 0) throw new Error("tokens.css has no :root block");
  const block = css.slice(at, css.indexOf("}", at));
  const token = (name) => {
    const m = new RegExp(`${name.replace(/-/g, "\\-")}:\\s*([^;\\s]+)`).exec(block);
    if (!m || !HEX.test(m[1])) throw new Error(`tokens.css: ${name} is not a colour in :root`);
    return m[1];
  };
  return {
    series: SERIES_TOKENS.map(token),
    ink: token(INK_TOKENS.ink),
    muted: token(INK_TOKENS.muted),
    rule: token(INK_TOKENS.rule),
  };
}

let colourCache = null;
/** The colours, read once per process. */
function colours() {
  if (!colourCache) colourCache = coloursFrom(fs.readFileSync(TOKENS, "utf8"));
  return colourCache;
}

const finite = (v) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const positive = (v) => Math.max(0, finite(v));
const esc = (v) => escapeHtml(String(v === null || v === undefined ? "" : v));
/** A label cut to fit beside a bar or under a point. */
const cut = (text, max) => {
  const s = String(text);
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};
const round1 = (v) => Math.round(v * 10) / 10;

/**
 * A figure as the chart's table and axis read it: naira with kobo when the chart's unit is `ngn`,
 * else a number with its thousands grouped.
 * @param {number} v
 * @param {string|null} unit
 */
function figureText(v, unit) {
  if (unit === "ngn") return money.formatNaira(money.toWire(String(finite(v))));
  return new Intl.NumberFormat("en-NG", { maximumFractionDigits: 2 }).format(finite(v));
}

/** An axis tick, short: ₦3.5M, 12k, 40. */
function tickText(v, unit) {
  const abs = Math.abs(v);
  const short = abs >= 1e9 ? `${round1(v / 1e9)}B` : abs >= 1e6 ? `${round1(v / 1e6)}M` : abs >= 1e3 ? `${round1(v / 1e3)}k` : String(round1(v));
  return unit === "ngn" ? `₦${short}` : short;
}

/** A round top for the axis, and its four steps. */
function niceMax(max) {
  if (!(max > 0)) return 1;
  const step = 10 ** Math.floor(Math.log10(max));
  const m = max / step;
  const nice = m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10;
  return nice * step;
}

/** A chart block's chart as drawn, or null when it is not one the code built. */
function checked(chart) {
  if (!chart || typeof chart !== "object" || !KINDS.has(chart.kind)) return null;
  const labels = Array.isArray(chart.labels) ? chart.labels.slice(0, MAX_LABELS).map((l) => String(l)) : [];
  const series = (Array.isArray(chart.series) ? chart.series : [])
    .slice(0, 6)
    .filter((s) => s && typeof s === "object" && Array.isArray(s.values))
    .map((s) => ({ label: String(s.label ?? ""), values: labels.map((_, i) => finite(s.values[i])) }));
  if (!labels.length || !series.length) return null;
  return { kind: chart.kind, title: String(chart.title ?? ""), labels, series, unit: chart.unit === "ngn" ? "ngn" : null };
}

function legendSvg(items, y, c) {
  let x = 0;
  const out = [];
  let row = y;
  for (const [i, label] of items.entries()) {
    const w = 22 + Math.min(label.length, 28) * 6.2;
    if (x + w > WIDTH) {
      x = 0;
      row += 18;
    }
    out.push(`<rect x="${x}" y="${row - 9}" width="10" height="10" rx="2" fill="${c.series[i % 6]}"/><text x="${x + 15}" y="${row}" font-size="10" fill="${c.ink}">${esc(cut(label, 28))}</text>`);
    x += w + 12;
  }
  return { svg: out.join(""), bottom: row + 8 };
}

/** Bars running sideways, one a label; a stacked bar's parts end to end in the series' colours. */
function barsSvg(ch, c) {
  const stacked = ch.kind === "stacked_bar";
  const parts = stacked ? ch.series : [ch.series[0]];
  const totals = ch.labels.map((_, i) => parts.reduce((n, s) => n + positive(s.values[i]), 0));
  const top = niceMax(Math.max(...totals));
  const labelW = 170;
  const plotW = WIDTH - labelW - 8;
  const rowH = 22;
  const head = 8;
  const out = [];
  for (let t = 0; t <= 4; t += 1) {
    const x = labelW + (plotW * t) / 4;
    out.push(`<line x1="${x}" y1="${head - 4}" x2="${x}" y2="${head + rowH * ch.labels.length}" stroke="${c.rule}" stroke-width="1"/>`);
    out.push(`<text x="${x}" y="${head + rowH * ch.labels.length + 14}" font-size="9" fill="${c.muted}" text-anchor="middle">${esc(tickText((top * t) / 4, ch.unit))}</text>`);
  }
  ch.labels.forEach((label, i) => {
    const y = head + rowH * i;
    out.push(`<text x="${labelW - 8}" y="${y + 14}" font-size="10" fill="${c.ink}" text-anchor="end">${esc(cut(label, 30))}</text>`);
    let x = labelW;
    parts.forEach((s, k) => {
      const w = (plotW * positive(s.values[i])) / top;
      if (w > 0) out.push(`<rect x="${round1(x)}" y="${y + 4}" width="${round1(w)}" height="${rowH - 8}" fill="${stacked ? c.series[k % 6] : c.series[ch.labels.length <= 6 ? i % 6 : 0]}"/>`);
      x += w;
    });
  });
  let bottom = head + rowH * ch.labels.length + 24;
  if (stacked) {
    const legend = legendSvg(parts.map((s) => s.label), bottom + 6, c);
    out.push(legend.svg);
    bottom = legend.bottom;
  }
  return { body: out.join(""), height: bottom };
}

/** One line a series along its labels, every few labels named under the axis. */
function linesSvg(ch, c) {
  const all = ch.series.flatMap((s) => s.values);
  const top = niceMax(Math.max(...all, 0));
  const low = Math.min(...all, 0);
  const left = 56;
  const plotW = WIDTH - left - 10;
  const plotH = 180;
  const head = 8;
  const span = top - low || 1;
  const xOf = (i) => left + (ch.labels.length === 1 ? plotW / 2 : (plotW * i) / (ch.labels.length - 1));
  const yOf = (v) => head + plotH - (plotH * (v - low)) / span;
  const out = [];
  for (let t = 0; t <= 4; t += 1) {
    const v = low + (span * t) / 4;
    const y = yOf(v);
    out.push(`<line x1="${left}" y1="${round1(y)}" x2="${WIDTH - 10}" y2="${round1(y)}" stroke="${c.rule}" stroke-width="1"/>`);
    out.push(`<text x="${left - 6}" y="${round1(y + 3)}" font-size="9" fill="${c.muted}" text-anchor="end">${esc(tickText(v, ch.unit))}</text>`);
  }
  const every = Math.max(1, Math.ceil(ch.labels.length / 8));
  ch.labels.forEach((label, i) => {
    if (i % every === 0 || i === ch.labels.length - 1)
      out.push(`<text x="${round1(xOf(i))}" y="${head + plotH + 14}" font-size="9" fill="${c.muted}" text-anchor="middle">${esc(cut(label, 12))}</text>`);
  });
  ch.series.forEach((s, k) => {
    const points = s.values.map((v, i) => `${round1(xOf(i))},${round1(yOf(v))}`).join(" ");
    out.push(`<polyline points="${points}" fill="none" stroke="${c.series[k % 6]}" stroke-width="2"/>`);
    if (s.values.length === 1) out.push(`<circle cx="${round1(xOf(0))}" cy="${round1(yOf(s.values[0]))}" r="3" fill="${c.series[k % 6]}"/>`);
  });
  let bottom = head + plotH + 24;
  if (ch.series.length > 1) {
    const legend = legendSvg(ch.series.map((s) => s.label), bottom + 6, c);
    out.push(legend.svg);
    bottom = legend.bottom;
  }
  return { body: out.join(""), height: bottom };
}

/** A ring of the first series, its key beside it with each slice's figure. */
function donutSvg(ch, c) {
  const values = ch.series[0].values.map(positive);
  const sum = values.reduce((n, v) => n + v, 0);
  const cx = 110;
  const cy = 110;
  const r = 90;
  const inner = 54;
  const out = [];
  let a = -Math.PI / 2;
  values.forEach((v, i) => {
    if (!(v > 0) || !(sum > 0)) return;
    const sweep = (2 * Math.PI * v) / sum;
    const colour = c.series[i % 6];
    if (sweep >= 2 * Math.PI - 1e-9) {
      out.push(`<circle cx="${cx}" cy="${cy}" r="${(r + inner) / 2}" fill="none" stroke="${colour}" stroke-width="${r - inner}"/>`);
    } else {
      const b = a + sweep;
      const large = sweep > Math.PI ? 1 : 0;
      const p = (rad, ang) => `${round1(cx + rad * Math.cos(ang))} ${round1(cy + rad * Math.sin(ang))}`;
      out.push(`<path d="M ${p(r, a)} A ${r} ${r} 0 ${large} 1 ${p(r, b)} L ${p(inner, b)} A ${inner} ${inner} 0 ${large} 0 ${p(inner, a)} Z" fill="${colour}"/>`);
      a = b;
    }
  });
  out.push(`<text x="${cx}" y="${cy + 4}" font-size="12" font-weight="600" fill="${c.ink}" text-anchor="middle">${esc(tickText(sum, ch.unit))}</text>`);
  ch.labels.forEach((label, i) => {
    const y = 24 + i * 18;
    out.push(`<rect x="250" y="${y - 9}" width="10" height="10" rx="2" fill="${c.series[i % 6]}"/><text x="266" y="${y}" font-size="10" fill="${c.ink}">${esc(cut(label, 40))} · ${esc(figureText(values[i], ch.unit))}</text>`);
  });
  return { body: out.join(""), height: Math.max(2 * cy, 24 + ch.labels.length * 18) };
}

/**
 * A chart block as SVG, or "" when it is not a chart the code built.
 * @param {{kind: string, title?: string, labels: string[], series: Array<{label: string, values: number[]}>, unit?: string|null}} chart
 * @param {{colours?: object}} [opts]  tests hand in colours
 * @returns {string}
 */
function chartSvg(chart, { colours: given = null } = {}) {
  const ch = checked(chart);
  if (!ch) return "";
  const c = given || colours();
  const drawn = ch.kind === "donut" ? donutSvg(ch, c) : ch.kind === "line" ? linesSvg(ch, c) : barsSvg(ch, c);
  const height = Math.ceil(drawn.height);
  return `<figure class="doc-chart"><svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(ch.title)}" viewBox="0 0 ${WIDTH} ${height}" width="100%" font-family="Geist, Helvetica, Arial, sans-serif">${drawn.body}</svg></figure>`;
}

/**
 * The chart's figures as a table: its labels down the side, a column for each series or part, a Total
 * for a stacked bar; amounts in naira when its unit is `ngn`.
 * @param {object} chart
 * @param {string} [firstHead]  the side column's heading
 * @returns {{head: string[], rows: string[][]}|null}
 */
function chartTable(chart, firstHead = "") {
  const ch = checked(chart);
  if (!ch) return null;
  const stacked = ch.kind === "stacked_bar" && ch.series.length > 1;
  const used = ch.kind === "bar" || ch.kind === "donut" ? [ch.series[0]] : ch.series;
  const head = [firstHead || "Label", ...used.map((s) => s.label || "Value"), ...(stacked ? ["Total"] : [])];
  const rows = ch.labels.map((label, i) => [
    label,
    ...used.map((s) => figureText(s.values[i], ch.unit)),
    ...(stacked ? [figureText(used.reduce((n, s) => n + positive(s.values[i]), 0), ch.unit)] : []),
  ]);
  return { head, rows };
}

/** Tests only. */
function __reset() {
  colourCache = null;
}

module.exports = { chartSvg, chartTable, coloursFrom, colours, figureText, KINDS, TOKENS, __reset };
