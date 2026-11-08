"use strict";
/**
 * The proposal design kit's renderer (docs/guides/partnerships.md §6.11): `ProposalContent` drawn as
 * the kit's 16:9 pages, the same HTML for the PDF (Chromium), the studio's preview and the public page.
 *
 * The one document engine draws every page (shared/documents/render.js: every value escaped, the house
 * formats for dates and money): `templates/proposals/layouts/<layout>.html` for a page's content inside
 * `templates/proposals/page.html` (its frame and the route along its foot), and the kit's entry,
 * `templates/documents/proposal.html`, around them all. A page's one visual (a chart, drawn from
 * `templates/proposals/chart.html`, or one of the kit's drawings) is what the layout includes as its
 * body. Pictures are data URLs, so the PDF renders offline and the preview needs nothing outside it.
 *
 * Each layout's content has a page budget: a section longer than its page continues on the next with
 * its heading repeated (the deliverables six a page, the terms six, a letter's or an opportunity's
 * paragraphs by their length). One visual a page: a chart, else a photograph or the pull quote, else a
 * drawing.
 */
const fs = require("node:fs");
const path = require("node:path");
const c = require("@mycity/contract");
const { render } = require("../../shared/documents/render");
const money = require("../../shared/money/money");
const charts = require("./proposals.charts");

const KIT = path.resolve(__dirname, "..", "..", "..", "templates", "proposals");
const ENTRY = path.resolve(__dirname, "..", "..", "..", "templates", "documents", "proposal.html");

/** The photographs the kit stands in with until MyCity uploads its own, in the order they are given out. */
const STAND_INS = ["lagos", "accra", "nairobi", "abidjan", "douala", "johannesburg", "rabat", "london"];

const LAYOUT_LABELS = Object.freeze({
  cover: "Cover",
  letter: "Letter",
  opportunity: "Opportunity",
  why_mycity: "Why MyCity",
  audience: "Audience",
  deliverables: "Deliverables",
  packages: "Packages",
  timeline: "Timeline",
  proof: "Proof",
  terms: "Terms",
  next_steps: "Next Steps",
  closing: "Closing",
  insight: "Insight",
});

/** Pages drawn on Deep Green; the rest are paper. */
const TONES = Object.freeze({ cover: "deep", why_mycity: "deep", closing: "deep" });

/** The box each layout gives its chart, in the chart's own units (the SVG scales to its panel). */
const CHART_BOX = Object.freeze({
  opportunity: { w: 340, h: 300 },
  why_mycity: { w: 340, h: 300 },
  audience: { w: 600, h: 320 },
  packages: { w: 340, h: 300 },
  proof: { w: 340, h: 300 },
  insight: { w: 1136, h: 330 },
});

/* ------------------------------------------------------------------ *
 * The kit's files, read once a process
 * ------------------------------------------------------------------ */

let files = null;

/** A drawing is ours, but it is inlined, so it is held to what the kit lets a drawing hold. */
function checkDrawing(name, svg) {
  const bad =
    /<(script|style|foreignObject|image|use|a|iframe|object)\b/i.test(svg) ||
    /\s(on\w+|href|xlink:href|style)\s*=/i.test(svg) ||
    !/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 240 180">[\s\S]*<\/svg>\s*$/.test(svg);
  if (bad) throw new Error(`templates/proposals/illustrations/${name}.svg is not a drawing the kit can inline`);
  return svg.trim().replace("<svg ", '<svg class="illus" aria-hidden="true" focusable="false" ');
}

function load() {
  if (files) return files;
  const read = (...p) => fs.readFileSync(path.join(KIT, ...p), "utf8");
  const layouts = {};
  for (const layout of c.proposals.LayoutName.options) layouts[layout] = read("layouts", `${layout}.html`);
  const drawings = {};
  const dir = path.join(KIT, "illustrations");
  for (const name of c.proposals.ILLUSTRATIONS) {
    const file = path.join(dir, `${name}.svg`);
    drawings[name] = fs.existsSync(file) ? checkDrawing(name, fs.readFileSync(file, "utf8")) : null;
  }
  const font = (f) => fs.readFileSync(path.join(KIT, "fonts", f)).toString("base64");
  const fontCss =
    `@font-face{font-family:"Geist";font-style:normal;font-weight:100 900;font-display:block;src:url(data:font/woff2;base64,${font("geist-latin.woff2")}) format("woff2");` +
    "unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD;}" +
    `@font-face{font-family:"Geist";font-style:normal;font-weight:100 900;font-display:block;src:url(data:font/woff2;base64,${font("geist-latin-ext.woff2")}) format("woff2");` +
    "unicode-range:U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF;}";
  files = {
    page: read("page.html"),
    chart: read("chart.html"),
    entry: fs.readFileSync(ENTRY, "utf8"),
    css: `${fontCss}\n${read("kit.tokens.css")}\n${read("kit.css")}`,
    icons: JSON.parse(read("icons.json")).icons,
    layouts,
    drawings,
  };
  return files;
}

/** A stand-in photograph as a data URL. */
const photos = new Map();
function standIn(city) {
  if (!photos.has(city)) photos.set(city, `data:image/webp;base64,${fs.readFileSync(path.join(KIT, "photos", `${city}.webp`)).toString("base64")}`);
  return photos.get(city);
}

/** Two different cities for a proposal, the same ones every time it is drawn. */
function standInsFor(seed) {
  let h = 0;
  for (const ch of String(seed || "")) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const first = h % STAND_INS.length;
  return { cover: STAND_INS[first], closing: STAND_INS[(first + 3) % STAND_INS.length] };
}

/* ------------------------------------------------------------------ *
 * Splitting a section over pages
 * ------------------------------------------------------------------ */

/** Items in groups of `n`. */
const chunk = (list, n) => {
  const out = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out.length ? out : [[]];
};

/** Paragraphs in pages of at most `budget` characters, never splitting a paragraph. */
function byLength(paras, budget) {
  const pages = [[]];
  let used = 0;
  for (const p of paras) {
    if (used && used + p.length > budget) {
      pages.push([]);
      used = 0;
    }
    pages[pages.length - 1].push(p);
    used += p.length;
  }
  return pages;
}

const initialsOf = (name) =>
  String(name || "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");

const titleSize = (t) => (t.length <= 42 ? "" : t.length <= 72 ? "display--m" : "display--s");

/* ------------------------------------------------------------------ *
 * One section's pages: what its layout's template is given, and its visual
 * ------------------------------------------------------------------ */

/**
 * The pages of one section.
 * @returns {Array<{vm: object, visual: {chart?: object, drawing?: string}|null}>}
 */
function pagesOf(s, ctx) {
  const img = (id) => (id && ctx.images[id] ? ctx.images[id] : null);
  const mark = { mark: ctx.org.mark_white || null, org_name: ctx.org.display_name };
  switch (s.layout) {
    case "cover": {
      const photo = img(s.image_asset_id);
      const logo = img(s.partner_logo_asset_id);
      return [
        {
          vm: {
            ...mark,
            photo: photo ? photo.src : standIn(ctx.stand_ins.cover),
            photo_alt: photo ? photo.alt : "",
            logo: logo ? logo.src : null,
            logo_alt: logo ? logo.alt : s.prepared_for,
            title: s.title,
            size: titleSize(s.title),
            prepared_for: s.prepared_for,
            date: s.date,
            reference: s.reference,
          },
          visual: null,
        },
      ];
    }
    case "letter": {
      const photo = img(s.signer_photo_asset_id);
      const pages = byLength(s.paragraphs, 1500);
      return pages.map((paras, i) => ({
        vm: {
          photo: photo ? photo.src : null,
          initials: initialsOf(s.signer_name),
          signer_name: s.signer_name,
          signer_title: s.signer_title,
          paras: paras.map((text, j) => ({ text, lead: i === 0 && j === 0 })),
          last: i === pages.length - 1,
          bleed: "left",
        },
        visual: null,
      }));
    }
    case "opportunity": {
      const side = s.chart ? "chart" : s.pull_quote ? "quote" : s.illustration ? "illus" : null;
      const pages = byLength(s.paragraphs, side ? 1100 : 1700);
      return pages.map((paras, i) => {
        const first = i === 0;
        const pageSide = first ? side : null;
        return {
          vm: {
            heading: s.heading,
            paras: paras.map((text, j) => ({ text, lead: first && j === 0 })),
            side: pageSide,
            side_chart: pageSide === "chart",
            side_quote: pageSide === "quote",
            side_illus: pageSide === "illus",
            quote: s.pull_quote,
            bleed: pageSide === "quote" ? "right" : null,
            visual: pageSide === "quote" ? Boolean(s.illustration) : Boolean(pageSide),
          },
          visual: !pageSide ? null : pageSide === "chart" ? { chart: s.chart } : s.illustration ? { drawing: s.illustration } : null,
        };
      });
    }
    case "why_mycity": {
      const n = s.points.length;
      const cols = s.chart ? 2 : n === 4 ? 4 : n === 2 ? 2 : 3;
      // The figures as large as their column allows: the longest value and the columns decide.
      const longest = Math.max(...s.points.map((p) => p.value.length));
      const room = 1136 / cols / (s.chart ? 1.7 : 1);
      const size = ["fig-xl", "fig-l", "fig-m", "fig-s"].find((_, i) => longest * [0.64, 0.5, 0.39, 0.3][i] * 100 <= room) || "fig-s";
      return [
        {
          vm: { heading: s.heading, points: s.points.map((p) => ({ ...p, size })), count: n, cols, visual: Boolean(s.chart) },
          visual: s.chart ? { chart: s.chart } : null,
        },
      ];
    }
    case "audience":
      return [
        {
          vm: { heading: s.heading, intro: s.intro, stats: s.stats, cols: s.stats.length > 4 ? 2 : s.stats.length > 1 ? 2 : 1, visual: Boolean(s.chart) },
          visual: s.chart ? { chart: s.chart } : null,
        },
      ];
    case "deliverables": {
      const pages = chunk(s.items, 6);
      const icons = load().icons;
      return pages.map((items, i) => ({
        vm: {
          heading: s.heading,
          two: s.items.length <= 4,
          items: items.map((it, j) => ({
            n: i * 6 + j + 1,
            title: it.title,
            detail: it.detail,
            paths: (icons[it.icon] || icons["circle-check"]).map((d) => ({ d })),
          })),
          visual: i === 0 && Boolean(s.illustration),
        },
        visual: i === 0 && s.illustration ? { drawing: s.illustration } : null,
      }));
    }
    case "packages": {
      const cards = s.display === "cards" && s.options.length <= 3;
      // Three cards: the dearest, the first of equals, is drawn as the top one; none when nothing has a price.
      let topAt = -1;
      if (cards && s.options.length === 3)
        s.options.forEach((o, i) => {
          if (o.price && money.compare(o.price, "0") > 0 && (topAt < 0 || money.compare(o.price, s.options[topAt].price) > 0)) topAt = i;
        });
      return [
        {
          vm: {
            heading: s.heading,
            cards,
            cols: s.options.length,
            options: s.options.map((o, i) => ({
              ...o,
              top: i === topAt,
              includes: o.includes.map((text) => ({ text })),
              includes_text: o.includes.join(", "),
            })),
            visual: Boolean(s.chart),
          },
          visual: s.chart ? { chart: s.chart } : null,
        },
      ];
    }
    case "timeline": {
      const ev = ctx.event;
      let keyAt = s.phases.findIndex((p) => ev && ev.starts_on && p.starts_on && p.starts_on <= ev.starts_on && (p.ends_on || p.starts_on) >= ev.starts_on);
      if (keyAt < 0) keyAt = 0;
      return [
        {
          vm: {
            heading: s.heading,
            count: s.phases.length,
            phases: s.phases.map((p, i) => ({ ...p, both: Boolean(p.starts_on && p.ends_on), key: i === keyAt })),
            visual: Boolean(s.illustration),
          },
          visual: s.illustration ? { drawing: s.illustration } : null,
        },
      ];
    }
    case "proof": {
      const logos = s.logos.map((l) => ({ label: l.label, img: ctx.proofImages[l.proof_point_id] || null }));
      return [
        {
          vm: {
            heading: s.heading,
            logos: logos.length ? logos : null,
            cols: s.chart ? (logos.length > 4 ? 3 : 2) : logos.length > 8 ? 6 : 4,
            results: s.results.length ? s.results : null,
            rcols: Math.min(Math.max(s.results.length, 2), s.chart ? 3 : 4),
            visual: Boolean(s.chart),
          },
          visual: s.chart ? { chart: s.chart } : null,
        },
      ];
    }
    case "terms": {
      const pages = chunk(s.items, 6);
      return pages.map((items, i) => ({
        vm: { heading: s.heading, items, visual: i === 0 && Boolean(s.illustration) },
        visual: i === 0 && s.illustration ? { drawing: s.illustration } : null,
      }));
    }
    case "next_steps": {
      const qr = s.show_qr && ctx.qr ? ctx.qr : null;
      return [
        {
          vm: { heading: s.heading, steps: s.steps.map((text) => ({ text })), contact: s.contact, qr, visual: !qr && Boolean(s.illustration), bleed: "right" },
          visual: !qr && s.illustration ? { drawing: s.illustration } : null,
        },
      ];
    }
    case "closing": {
      const photo = s.illustration ? null : img(s.image_asset_id);
      return [
        {
          vm: {
            ...mark,
            photo: s.illustration ? null : photo ? photo.src : standIn(ctx.stand_ins.closing),
            photo_alt: photo ? photo.alt : "",
            message: s.message,
            website: ctx.org.website || "mycityapp.io",
            visual: Boolean(s.illustration),
          },
          visual: s.illustration ? { drawing: s.illustration } : null,
        },
      ];
    }
    case "insight":
      return [{ vm: { heading: s.heading, takeaway: s.takeaway, note: s.note }, visual: { chart: s.chart } }];
    default:
      throw new Error(`the kit has no layout ${s.layout}`);
  }
}

/** A page's visual as HTML: a chart drawn by the engine, or one of the kit's drawings. */
function visualHtml(layout, visual) {
  if (!visual) return "";
  const kit = load();
  if (visual.chart) return render(kit.chart, charts.shapes(visual.chart, CHART_BOX[layout]));
  return kit.drawings[visual.drawing] || "";
}

/* ------------------------------------------------------------------ *
 * The whole proposal
 * ------------------------------------------------------------------ */

/** What a section is called beside the page: its heading, else its layout's name. */
const labelOf = (s) => s.heading || s.title || LAYOUT_LABELS[s.layout];

/** The image fields of a section, and whether each draws a stand-in. */
function imagesOf(s, ctx) {
  const has = (id) => Boolean(id && ctx.images[id]);
  if (s.layout === "cover")
    return [
      { field: "image_asset_id", stand_in: !has(s.image_asset_id) },
      { field: "partner_logo_asset_id", stand_in: false },
    ];
  if (s.layout === "closing") return s.illustration ? [] : [{ field: "image_asset_id", stand_in: !has(s.image_asset_id) }];
  if (s.layout === "letter") return [{ field: "signer_photo_asset_id", stand_in: false }];
  return [];
}

/**
 * Draw a proposal.
 * @param {object} content  ProposalContent (checked here; defaults filled)
 * @param {object} ctx
 *   reference      "PRO-0012"
 *   org            { display_name, website, mark_white }  MyCity's mark for Deep Green, or the wordmark
 *   images         { [proposal_asset_id]: { src, alt } }  the proposal's own pictures as data URLs
 *   proofImages    { [proof_point_id]: src }               the proof points' logos as data URLs
 *   qr             a data URL of the QR to the web version, or null before the link exists
 *   event          { starts_on, ends_on } of the deal, or null
 *   seed           what picks the stand-in cities (the proposal's number)
 * @param {{mode?: "pdf"|"web"|"studio"}} [opts]
 * @returns {{html: string, sections: object[], checks: {stand_ins: object[], unconfirmed: object[]}}}
 */
function renderProposal(content, ctx, { mode = "pdf" } = {}) {
  const kit = load();
  const parsed = c.proposals.ProposalContent.parse(content);
  const full = {
    images: {},
    proofImages: {},
    qr: null,
    event: null,
    org: { display_name: "MyCity", website: null, mark_white: null },
    ...ctx,
    stand_ins: standInsFor(ctx.seed || ctx.reference),
  };
  const shown = parsed.sections.filter((s) => !s.hidden);
  const pages = [];
  const counts = new Map();
  for (const s of shown) {
    const list = pagesOf(s, full);
    counts.set(s.key, list.length);
    list.forEach((p) => pages.push({ s, ...p }));
  }
  const total = pages.length;
  const html = pages
    .map((p, i) => {
      const inner = render(kit.layouts[p.s.layout], { ...p.vm, layout: p.s.layout, reference: full.reference }, { body: visualHtml(p.s.layout, p.visual) });
      const stops = Array.from({ length: total }, (_, j) => ({ past: j < i, here: j === i }));
      return render(
        kit.page,
        {
          layout: p.s.layout,
          key: p.s.key,
          label: labelOf(p.s),
          tone: TONES[p.s.layout] || null,
          bleed: p.vm.bleed || null,
          route: i > 0 && p.s.layout !== "closing",
          reference: full.reference,
          page_no: i + 1,
          total,
          stops,
        },
        { body: inner },
      );
    })
    .join("\n");
  const body = render(kit.entry, { reference: full.reference }, { body: html });
  const doc =
    `<!doctype html><html lang="en-GB" class="kit-${mode}"><head><meta charset="utf-8">` +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    `<style>${kit.css}</style></head><body>${body}</body></html>`;

  const sections = parsed.sections.map((s) => ({
    key: s.key,
    layout: s.layout,
    label: labelOf(s),
    hidden: s.hidden,
    pages: counts.get(s.key) || 0,
    fits: require("./proposals.content").fitsOf(s),
    images: imagesOf(s, full),
    unconfirmed: s.unconfirmed,
  }));
  const checks = {
    stand_ins: sections
      .filter((s) => !s.hidden && s.images.some((i) => i.stand_in))
      .map((s) => ({ key: s.key, label: s.label })),
    unconfirmed: shown.flatMap((s) => s.unconfirmed.map((figure) => ({ key: s.key, figure }))),
  };
  return { html: doc, sections, checks };
}

/** The gallery's page of every layout (`#/ProposalKit`), from templates/proposals/sample.json. */
function renderSample(sample) {
  return renderProposal(sample.content, sample.context, { mode: "web" }).html;
}

module.exports = { renderProposal, renderSample, standInsFor, LAYOUT_LABELS, STAND_INS, __reset: () => (files = null) };
