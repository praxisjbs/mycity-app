"use strict";
/**
 * A proposal's content (docs/guides/partnerships.md §6.10, §6.11): the layouts a section's content fits
 * (Change Layout) and its move from one to another, and the figure check that keeps every number,
 * date, price, percentage and named organisation sourced.
 *
 * Change Layout offers only layouts that hold the same content: the figures (Why MyCity, Audience,
 * Proof's results), the lists (Deliverables, Terms), and any section with a chart as an Insight page.
 */
const c = require("@mycity/contract");

const FIGURES = ["why_mycity", "audience", "proof"];
const LISTS = ["deliverables", "terms"];

/** A section's figures as value and label pairs, whichever figure layout holds them. */
const figuresOf = (s) => (s.layout === "why_mycity" ? s.points.map((p) => ({ value: p.value, label: p.label })) : s.layout === "audience" ? s.stats : s.results);
/** A section's list as title and detail pairs. */
const listOf = (s) => (s.layout === "deliverables" ? s.items.map((i) => ({ title: i.title, detail: i.detail })) : s.items.map((i) => ({ title: i.label, detail: i.detail })));

/** The layouts a section's content fits, its own first. */
function fitsOf(s) {
  const out = [s.layout];
  if (FIGURES.includes(s.layout)) {
    const n = figuresOf(s).length;
    for (const l of FIGURES) if (l !== s.layout && (l !== "why_mycity" || n >= 3) && (l !== "audience" || n >= 1)) out.push(l);
  }
  if (LISTS.includes(s.layout)) for (const l of LISTS) if (l !== s.layout) out.push(l);
  if (s.chart && s.layout !== "insight") out.push("insight");
  return out;
}

const base = (s, layout) => ({ key: s.key, layout, hidden: s.hidden, sources: s.sources, unconfirmed: s.unconfirmed });
const clip = (text, max) => (text && text.length > max ? `${text.slice(0, max - 1).trimEnd()}.` : text);

/**
 * The same content in another layout it fits; what the new layout cannot hold is left behind.
 * @throws {Error} when the content does not fit
 */
function convert(s, layout) {
  if (layout === s.layout) return s;
  if (!fitsOf(s).includes(layout)) throw new Error(`${s.layout} does not fit ${layout}`);
  const heading = s.heading || c.proposals.LayoutName.options.find((l) => l === layout);
  let out;
  if (layout === "insight") {
    const takeaway = s.pull_quote || (s.paragraphs && s.paragraphs[0]) || s.intro || s.chart.title;
    out = { ...base(s, layout), heading, takeaway: clip(takeaway, 160), chart: s.chart, note: null };
  } else if (FIGURES.includes(layout)) {
    const figs = figuresOf(s);
    if (layout === "why_mycity") out = { ...base(s, layout), heading, points: figs.slice(0, 6).map((f) => ({ proof_point_id: null, value: f.value, label: f.label })), chart: s.chart || null };
    else if (layout === "audience") out = { ...base(s, layout), heading, intro: null, stats: figs.slice(0, 6), chart: s.chart || null };
    else out = { ...base(s, layout), heading, logos: [], results: figs.slice(0, 6), chart: s.chart || null };
  } else if (LISTS.includes(layout)) {
    const list = listOf(s);
    out =
      layout === "deliverables"
        ? { ...base(s, layout), heading, items: list.slice(0, 12).map((i) => ({ title: clip(i.title, 120), detail: i.detail, icon: "circle-check" })), illustration: s.illustration || null }
        : { ...base(s, layout), heading, items: list.slice(0, 8).map((i) => ({ label: clip(i.title, 60), detail: i.detail || i.title })), illustration: s.illustration || null };
  }
  return c.proposals.Section.parse(out);
}

module.exports = { fitsOf, convert, FIGURES, LISTS };
