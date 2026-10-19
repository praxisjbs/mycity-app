"use strict";
/**
 * Download PDF's drawing (docs/guides/organogram.md §6): the tree the org chart read returns,
 * laid out in millimetres for templates/documents/org-chart.html, which only places what this
 * works out. The PDF renderer runs no script, so nothing on the page can measure itself.
 *
 * The same cards and solid lines as the desktop tree: a card centred over the places its
 * branch takes, a line down from it, one across its reports and one down to each. The CEO's
 * tree comes first, then any other card at the top. One change keeps the page near A3
 * proportions: a manager with STACK_FROM or more reports, none of whom has reports of their
 * own, has them in two columns down a line from their card instead of in one wide row.
 *
 * The page is the chart plus its margins and the letterhead around it, never smaller than A4
 * landscape. A chart wider or taller than MAX_SIDE is drawn smaller (`chart.scale`), because a
 * PDF page stops at 200 inches.
 */

/** A card, in mm: room for two lines of name, two of title, the chip, the since line and a tag. */
const CARD = Object.freeze({ width: 44, height: 38 });
/** The width one card's place takes across, the gap to the next included. */
const SLOT = 50;
/** Between a card and the row below it, where the lines run. */
const GAP = 12;
/** Between two cards in a column. */
const STACK_GAP = 4;
/** Reports, none with reports of their own, that go into two columns rather than a row. */
const STACK_FROM = 5;
/** From the line down a column to the cards either side of it. */
const RAIL = (SLOT - CARD.width) / 2;
/** The page's margins (they match the template's @page rule) and the letterhead around the chart. */
const MARGIN = Object.freeze({ side: 12, top: 12, bottom: 16 });
const LETTERHEAD = 72;
/** The smallest page, A4 landscape. */
const MIN_PAGE = Object.freeze({ width: 297, height: 210 });
/** The chart's longest side, so the page with its letterhead and margins stays under 5,080 mm. */
const MAX_SIDE = 4900;

const round = (n) => Math.round(n * 10) / 10;

/** "Ifeoma Mbonu" → "IM"; one word gives one letter. */
function initialsOf(name) {
  const words = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "";
  const last = words.length > 1 ? words[words.length - 1][0] : "";
  return `${words[0][0]}${last}`.toUpperCase();
}

/**
 * @param {Array<object>} nodes  OrgChartTree.nodes, in the read's order
 * @param {{maxSide?: number}} [opts]
 * @returns {{page: {width: number, height: number}, chart: {width: number, height: number, scale: number},
 *            card: {width: number, height: number}, cards: object[], lines: object[]}}
 */
function layout(nodes, { maxSide = MAX_SIDE } = {}) {
  const ids = new Set(nodes.map((n) => n.node_id));
  const below = new Map();
  for (const n of nodes) {
    const up = n.manager_node_id && ids.has(n.manager_node_id) ? n.manager_node_id : null;
    if (!below.has(up)) below.set(up, []);
    below.get(up).push(n);
  }
  /* A node has one line above it, so walking down from the tops meets each card once. */
  const kidsOf = (n) => below.get(n.node_id) || [];
  const stacked = (n) => kidsOf(n).length >= STACK_FROM && kidsOf(n).every((c) => kidsOf(c).length === 0);

  /** How many places a branch takes across, and how far down it reaches. */
  const sizes = new Map();
  const measure = (n) => {
    const kids = kidsOf(n);
    let size;
    if (!kids.length) size = { span: 1, height: CARD.height };
    else if (stacked(n)) {
      const rows = Math.ceil(kids.length / 2);
      size = { span: 2, height: CARD.height + GAP + rows * CARD.height + (rows - 1) * STACK_GAP };
    } else {
      const parts = kids.map(measure);
      size = {
        span: parts.reduce((s, p) => s + p.span, 0),
        height: CARD.height + GAP + Math.max(...parts.map((p) => p.height)),
      };
    }
    sizes.set(n.node_id, size);
    return size;
  };

  const cards = [];
  const lines = [];
  const card = (n, x, y) =>
    cards.push({
      x: round(x),
      y: round(y),
      initials: n.vacant ? "" : initialsOf(n.display_name),
      name: n.display_name,
      title: n.vacant ? `Vacant · ${n.department}` : n.job_title,
      department: n.department,
      meta: n.meta || null,
      dotted: n.dotted_line_to || null,
      vacant: Boolean(n.vacant),
      ceo: Boolean(n.is_ceo),
    });
  const down = (x, y, h) => lines.push({ x: round(x), y: round(y), w: 0, h: round(h), across: false });
  const across = (x, y, w) => lines.push({ x: round(x), y: round(y), w: round(w), h: 0, across: true });

  const place = (n, left, top) => {
    const x = left + (sizes.get(n.node_id).span * SLOT - CARD.width) / 2;
    card(n, x, top);
    const centre = x + CARD.width / 2;
    const bottom = top + CARD.height;
    const kids = kidsOf(n);
    if (!kids.length) return;

    if (stacked(n)) {
      /* Two columns either side of a line down from the card, each card joined to it. */
      const first = bottom + GAP;
      kids.forEach((c, i) => {
        const y = first + Math.floor(i / 2) * (CARD.height + STACK_GAP);
        const cx = i % 2 === 0 ? left + RAIL : left + SLOT + RAIL;
        card(c, cx, y);
        across(i % 2 === 0 ? cx + CARD.width : centre, y + CARD.height / 2, RAIL);
      });
      const lastRow = Math.ceil(kids.length / 2) - 1;
      down(centre, bottom, first + lastRow * (CARD.height + STACK_GAP) + CARD.height / 2 - bottom);
      return;
    }

    const middle = bottom + GAP / 2;
    const centres = [];
    let at = left;
    for (const c of kids) {
      const span = sizes.get(c.node_id).span;
      centres.push(at + (span * SLOT) / 2);
      place(c, at, bottom + GAP);
      at += span * SLOT;
    }
    down(centre, bottom, GAP / 2);
    if (centres.length > 1) across(centres[0], middle, centres[centres.length - 1] - centres[0]);
    for (const c of centres) down(c, middle, GAP / 2);
  };

  /* The CEO's tree first, whatever else sits at the top; the rest keep the read's order. */
  const roots = [...(below.get(null) || [])].sort((a, b) => Number(Boolean(b.is_ceo)) - Number(Boolean(a.is_ceo)));
  let width = 0;
  let height = 0;
  for (const r of roots) {
    const size = measure(r);
    place(r, width, 0);
    width += size.span * SLOT;
    height = Math.max(height, size.height);
  }

  const fit = Math.min(1, maxSide / Math.max(width, 1), maxSide / Math.max(height, 1));
  const scale = fit < 1 ? Math.floor(fit * 1000) / 1000 : 1;
  return {
    page: {
      width: round(Math.max(MIN_PAGE.width, width * scale + 2 * MARGIN.side)),
      height: round(Math.max(MIN_PAGE.height, height * scale + MARGIN.top + MARGIN.bottom + LETTERHEAD)),
    },
    chart: { width: round(width), height: round(height), scale },
    card: { width: CARD.width, height: CARD.height },
    cards,
    lines,
  };
}

module.exports = { layout, initialsOf, CARD, SLOT, GAP, STACK_GAP, STACK_FROM, MAX_SIDE };
