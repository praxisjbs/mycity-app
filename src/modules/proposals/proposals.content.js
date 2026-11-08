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

/* ------------------------------------------------------------------ *
 * The figure check (§6.10): every number, date, price and percentage carries its source
 * ------------------------------------------------------------------ */

/** Fields that are not figures a person reads as a claim: keys, ids, the kit's own choices, the cover's date and reference. */
const NOT_FIGURES = new Set(["key", "layout", "hidden", "sources", "unconfirmed", "icon", "illustration", "display", "kind", "show_qr", "proof_point_id", "contact", "reference", "date", "unit"]);
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const NUMBER = /\d[\d,]*(?:\.\d+)?/g;

/** A number as compared: no separators, no trailing zeros after the point. */
const canon = (text) => {
  const plain = String(text).replace(/,/g, "");
  return plain.includes(".") ? plain.replace(/\.?0+$/, "") : plain;
};

/** The dates a source's words name, as ISO dates ("18 December 2026" and "2026-12-18"). */
function datesIn(text) {
  const out = new Set();
  for (const m of String(text).matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) out.add(m[0]);
  for (const m of String(text).toLowerCase().matchAll(/\b(\d{1,2})(?:st|nd|rd|th)? (january|february|march|april|may|june|july|august|september|october|november|december),? (\d{4})\b/g))
    out.add(`${m[3]}-${String(MONTHS.indexOf(m[2]) + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}`);
  return out;
}

/** Every figure a section states, as written and as compared. */
function figuresIn(section) {
  const out = [];
  const walk = (value, field) => {
    if (value === null || value === undefined || NOT_FIGURES.has(field) || /_asset_id$/.test(field || "")) return;
    if (Array.isArray(value)) return value.forEach((v) => walk(v, field));
    if (typeof value === "object") return Object.entries(value).forEach(([k, v]) => walk(v, k));
    if (typeof value === "number") return out.push({ figure: String(value), canon: canon(value), date: null });
    if (typeof value !== "string") return;
    if (["starts_on", "ends_on"].includes(field)) return out.push({ figure: value, canon: null, date: value });
    if (field === "price") return out.push({ figure: value, canon: canon(value), date: null });
    for (const m of value.matchAll(NUMBER)) out.push({ figure: m[0], canon: canon(m[0]), date: null });
  };
  walk(section, null);
  return out;
}

/**
 * Check a proposal's figures against their sources and what the record and the proof points hold.
 * A figure the record or a proof point states is sourced there and its source added; any other figure
 * must be in its section's `sources`.
 * @param {object} content  ProposalContent
 * @param {{numbers: Map<string, {source: string, ref: string}>, dates: Map<string, {source: string, ref: string}>}} known
 * @returns {{content: object, unsourced: Array<{key: string, figure: string}>}}
 */
function checkFigures(content, known) {
  const unsourced = [];
  const sections = content.sections.map((s) => {
    const sources = [...(s.sources || [])];
    const said = new Set();
    const saidDates = new Set();
    for (const src of sources) {
      for (const m of `${src.figure} ${src.ref || ""}`.matchAll(NUMBER)) said.add(canon(m[0]));
      datesIn(`${src.figure} ${src.ref || ""}`).forEach((d) => saidDates.add(d));
    }
    const years = new Set([...saidDates, ...known.dates.keys()].map((d) => d.slice(0, 4)));
    for (const f of figuresIn(s)) {
      if (f.date) {
        if (saidDates.has(f.date)) continue;
        const hit = known.dates.get(f.date);
        if (hit) {
          if (sources.length < 60) sources.push({ figure: f.figure, source: hit.source, ref: hit.ref });
          saidDates.add(f.date);
          continue;
        }
      } else {
        if (said.has(f.canon) || (f.canon.length === 4 && years.has(f.canon))) continue;
        const hit = known.numbers.get(f.canon);
        if (hit) {
          if (sources.length < 60) sources.push({ figure: f.figure, source: hit.source, ref: hit.ref });
          said.add(f.canon);
          continue;
        }
      }
      if (!unsourced.some((u) => u.key === s.key && u.figure === f.figure)) unsourced.push({ key: s.key, figure: f.figure });
    }
    return { ...s, sources };
  });
  return { content: { ...content, sections }, unsourced };
}

/** Mark figures nobody could source, for the person to confirm before Send. */
function markUnconfirmed(content, unsourced) {
  return {
    ...content,
    sections: content.sections.map((s) => {
      const mine = unsourced.filter((u) => u.key === s.key).map((u) => u.figure.slice(0, 120));
      return mine.length ? { ...s, unconfirmed: [...new Set([...(s.unconfirmed || []), ...mine])].slice(0, 20) } : s;
    }),
  };
}

/** What the record and the proof points state, for the check. */
function knownOf({ deal, proofPoints }) {
  const numbers = new Map();
  const dates = new Map();
  const num = (v, ref, source = "record") => {
    if (v === null || v === undefined || v === "") return;
    for (const m of String(v).matchAll(NUMBER)) if (!numbers.has(canon(m[0]))) numbers.set(canon(m[0]), { source, ref });
  };
  const day = (v, ref) => v && dates.set(String(v).slice(0, 10), { source: "record", ref });
  if (deal) {
    num(deal.estimated_value, "deal.estimated_value");
    num(deal.expected_attendance, "deal.expected_attendance");
    num(deal.commission_pct, "deal.commission_pct");
    num(deal.validity_days, "deal.validity_days");
    (deal.options || []).forEach((o, i) => {
      for (const f of ["original_price", "discount_pct", "deal_price", "commission_amount", "merchant_take"]) num(o[f], `deal.options.${i + 1}.${f}`);
    });
    day(deal.event_starts_on, "deal.event_starts_on");
    day(deal.event_ends_on, "deal.event_ends_on");
    day(deal.expected_close_on, "deal.expected_close_on");
    day(deal.valid_until, "deal.valid_until");
  }
  for (const p of proofPoints || []) {
    num(p.value, p.proof_point_id, "proof_point");
    num(p.label, p.proof_point_id, "proof_point");
  }
  return { numbers, dates };
}

/* ------------------------------------------------------------------ *
 * Built by hand: a proposal from the record alone when Claude cannot be asked (AI Is Off)
 * ------------------------------------------------------------------ */

/**
 * The pages the record can fill without Claude: the cover, MyCity's figures, the packages, the
 * timeline, the next steps and the back cover. A person adds and writes the rest in Edit.
 */
function starter({ title, partnerName, reference, today, deal, owner, proofPoints, coverAssetId, logoAssetId }) {
  const sections = [
    { key: "cover", layout: "cover", title: clip(title, 150), prepared_for: clip(partnerName, 150), date: today, reference, image_asset_id: coverAssetId || null, partner_logo_asset_id: logoAssetId || null },
  ];
  const stats = (proofPoints || []).filter((p) => p.kind === "stat" && p.value).slice(0, 6);
  if (stats.length >= 3)
    sections.push({
      key: "why_mycity",
      layout: "why_mycity",
      heading: "Why MyCity",
      points: stats.map((p) => ({ proof_point_id: p.proof_point_id, value: p.value, label: clip(p.label, 120) })),
      sources: stats.map((p) => ({ figure: p.value, source: "proof_point", ref: p.proof_point_id })),
    });
  const options = (deal.options || []).filter((o) => o.label);
  if (options.length)
    sections.push({
      key: "packages",
      layout: "packages",
      heading: "Packages",
      display: options.length <= 3 ? "cards" : "table",
      options: options.map((o) => ({ label: clip(o.label, 60), price: o.deal_price || null, price_note: o.deal_price ? null : o.price_note || "On request", includes: [], terms: null })),
    });
  if (deal.event_starts_on)
    sections.push({
      key: "timeline",
      layout: "timeline",
      heading: "Timeline",
      phases: [{ name: clip(deal.event_title || deal.title, 60), starts_on: deal.event_starts_on, ends_on: deal.event_ends_on || null, detail: clip(deal.event_title || deal.title, 400) }],
    });
  sections.push({
    key: "next_steps",
    layout: "next_steps",
    heading: "Next Steps",
    steps: ["Reply to agree the next step"],
    contact: { name: owner.name, title: owner.title || null, email: owner.email || null, phone: owner.phone || null },
    show_qr: true,
  });
  sections.push({ key: "closing", layout: "closing", message: null, image_asset_id: null });
  return c.proposals.ProposalContent.parse({ sections });
}

/* ------------------------------------------------------------------ *
 * Edits on screen
 * ------------------------------------------------------------------ */

/**
 * One edit applied: a section's fields (a new key adds a page before the back cover), its layout, its
 * place, whether it shows, or an image (the proposal_asset given). Throws an AppError a person can read.
 */
function applyEdit(content, op, { assetId = null } = {}) {
  const { AppError } = require("../../shared/errors");
  const sections = [...content.sections];
  const at = sections.findIndex((s) => s.key === op.key);
  if (op.op !== "section" && at < 0) throw new AppError("NOT_FOUND", "That page is not in this proposal", 404);
  switch (op.op) {
    case "section": {
      if (op.section.key !== op.key) throw new AppError("VALIDATION", "Check the page", 422, { key: ["Must match the page"] });
      if (at >= 0) sections[at] = op.section;
      else {
        const closing = sections.findIndex((s) => s.layout === "closing");
        sections.splice(closing < 0 ? sections.length : closing, 0, op.section);
      }
      break;
    }
    case "layout":
      if (!fitsOf(sections[at]).includes(op.layout)) throw new AppError("VALIDATION", "That layout does not fit", 422, { layout: ["Does not fit"] });
      sections[at] = convert(sections[at], op.layout);
      break;
    case "move": {
      const to = op.direction === "up" ? at - 1 : at + 1;
      if (to < 0 || to >= sections.length) throw new AppError("VALIDATION", "Already at the end", 422, { direction: ["Already at the end"] });
      [sections[at], sections[to]] = [sections[to], sections[at]];
      break;
    }
    case "hide":
      sections[at] = { ...sections[at], hidden: op.hidden };
      break;
    case "image": {
      const s = sections[at];
      const allowed = { cover: ["image_asset_id", "partner_logo_asset_id"], closing: ["image_asset_id"], letter: ["signer_photo_asset_id"] }[s.layout] || [];
      if (!allowed.includes(op.field)) throw new AppError("VALIDATION", "This page has no such image", 422, { field: ["Not on this page"] });
      sections[at] = { ...s, [op.field]: assetId, ...(s.layout === "closing" ? { illustration: null } : {}) };
      break;
    }
    default:
      throw new AppError("VALIDATION", "Check the edit", 422);
  }
  const parsed = c.proposals.ProposalContent.safeParse({ sections });
  if (!parsed.success) throw new AppError("VALIDATION", "Check the page", 422, { section: [parsed.error.issues[0].message] });
  return parsed.data;
}

module.exports = { fitsOf, convert, figuresIn, checkFigures, markUnconfirmed, knownOf, starter, applyEdit, FIGURES, LISTS };
