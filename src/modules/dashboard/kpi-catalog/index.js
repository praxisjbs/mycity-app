"use strict";
/**
 * The KPI catalogue: every card Home can show, the grant that gates it, and how its figure
 * and the records behind it are read. One place, so the Overview, the card picker, a role's
 * cards, the Team tab and a card's records all mean the same card.
 *
 * A CARD INHERITS RIGHTS, IT NEVER GRANTS THEM. Every figure is a count or a sum over a
 * module its reader can already open, in their own scope on that module (eligibility.js),
 * so the catalogue grows without adding any authority, and taking a module from a role
 * retires its cards everywhere at once: who may see a card is worked out when it is read,
 * never stored.
 *
 * WHY THE CATALOGUE IS CODE, NOT A TABLE. Which rights exist is data (roles, grants); which
 * figures exist is a claim about queries this repository ships. What a role or a person
 * chooses is data (role_kpi, home_kpi_pick), over these ids.
 *
 * A card is `live` (its query ships; computed and offered) or `hidden` (declared with no
 * query at all, never offered). The milestone in a hidden card's `until` makes it live by
 * adding its value and its records in the same pull request; its id is already the one a
 * role or a person will store.
 *
 * WHY THE CHECK RUNS AT REQUIRE TIME. The failure is a half-defined card: live with no
 * value, a title over four words, a module or a capability nobody declared. The last line of
 * this file throws, with every problem listed, so it stops the boot rather than drawing a
 * blank card; the unit tests require this file, so CI finds it first.
 *
 *   const kpi = require("./kpi-catalog");
 *   const ctx = kpi.context({ user, scopes, today });           // scopes from eligibility.forUser()
 *   const figures = await kpi.figuresFor(client, ids, ctx);    // { id: figure | null }
 *   kpi.cardOf(kpi.BY_ID.get(id), figures[id]);                // HomeKpiCard
 */
const { AppError } = require("../../../shared/errors");
const lagos = require("../../../shared/time/lagos");
const guards = require("./guards");
const { MAX_CARDS, DOMAINS, UNITS, assertEntry } = require("./shared");

/** Each domain's cards, in the picker's group order. */
const TILES = Object.freeze({
  people: require("./tiles/people"),
  work: require("./tiles/work"),
  business: require("./tiles/business"),
  finance: require("./tiles/finance"),
});

const CATALOG = Object.freeze(DOMAINS.flatMap((domain) => TILES[domain].ENTRIES).map(assertEntry));

const BY_ID = new Map(CATALOG.map((e) => [e.id, e]));

/** Cards computed and offered. */
const LIVE_IDS = Object.freeze(CATALOG.filter((e) => e.status === "live").map((e) => e.id));

/** Live cards a person or a role may choose; the Team cards belong to their tab alone. */
const PICKABLE_IDS = Object.freeze(CATALOG.filter((e) => e.status === "live" && e.pickable).map((e) => e.id));

/** Every module a card names: the grants eligibility reads. */
const MODULES = Object.freeze([...new Set(CATALOG.map((e) => e.module))]);

const LIVE = new Set(LIVE_IDS);
const PICKABLE = new Set(PICKABLE_IDS);
const isLive = (id) => LIVE.has(id);
const isPickable = (id) => PICKABLE.has(id);

/**
 * The checks over the whole catalogue (assertEntry checks each card): an id twice, a card
 * filed under another domain's file.
 * @throws {Error} listing every problem
 */
function assertCatalogSane() {
  const problems = [];
  const seen = new Set();
  for (const domain of DOMAINS) {
    for (const e of TILES[domain].ENTRIES) {
      if (seen.has(e.id)) problems.push(`"${e.id}" is declared twice`);
      seen.add(e.id);
      if (e.domain !== domain) problems.push(`${e.id}: domain "${e.domain}" is filed in tiles/${domain}.js`);
    }
  }
  if (problems.length) throw new Error(`kpi-catalog:\n  ${problems.join("\n  ")}`);
}

/* ------------------------------------------------------------------ *
 * Reading figures
 * ------------------------------------------------------------------ */

/**
 * What every card's read is given: the reader, today and now in Lagos, and their scope on
 * each module they may view (eligibility.forUser). A card asking for a module the reader
 * cannot view is a defect, and fails, leaving that card out.
 *
 * @param {{user: object, scopes: Map<string, {scope: string, scope_ids: string[]|null, employee_id: string|null}>,
 *          today?: string, now?: Date}} reader
 */
function context({ user, scopes, today, now = new Date() }) {
  return Object.freeze({
    user,
    now,
    today: today || lagos.today(now),
    scope(module) {
      const s = scopes.get(module);
      if (!s) throw new Error(`kpi-catalog: the reader holds no view on "${module}"`);
      return s;
    },
  });
}

const isWhole = (n) => Number.isInteger(n) && n >= 0;
const WIRE = /^-?\d{1,16}\.\d{2}$/;

/** Whether a figure has the shape its card's unit draws (guards.js). */
function shaped(entry, f) {
  if (!f || typeof f !== "object") return false;
  switch (entry.unit) {
    case "count":
      return isWhole(f.value);
    case "days":
      return Number.isFinite(f.value);
    case "pct":
    case "pair":
      return Number.isFinite(f.value) && isWhole(f.denominator);
    case "money":
      return typeof f.amount === "string" && WIRE.test(f.amount);
    default:
      return false;
  }
}

/**
 * One card's figure for the reader, or null when it cannot be had: not a live card, a read
 * that failed, or a figure of the wrong shape (each logged by the guards).
 * @returns {Promise<object|null>}
 */
async function figureOf(entry, client, ctx) {
  if (!entry || entry.status !== "live") return null;
  const g = guards.forCard(entry.id);
  const figure = await g.figure(() => entry.value(client, g, ctx));
  if (figure === null) return null;
  return g.figure(() => {
    if (!shaped(entry, figure)) throw new TypeError(`a ${entry.unit} figure has the wrong shape`);
    return figure;
  });
}

/**
 * Figures for the ids asked, each read on its own so a failing card costs only itself. A
 * hidden card answers null, never a figure; an id the catalogue does not have is left out.
 * @param {{query: Function}} client
 * @param {string[]} ids
 * @param {ReturnType<typeof context>} ctx
 * @returns {Promise<Record<string, object|null>>}
 */
async function figuresFor(client, ids, ctx) {
  const wanted = [...new Set(ids)].filter((id) => BY_ID.has(id));
  const figures = await Promise.all(wanted.map((id) => figureOf(BY_ID.get(id), client, ctx)));
  return Object.fromEntries(wanted.map((id, i) => [id, figures[i]]));
}

/* ------------------------------------------------------------------ *
 * Shapes for the wire (packages/contract/schemas/dashboard.js)
 * ------------------------------------------------------------------ */

/** Whether a figure is zero: a zero is drawn, but it takes no tone. */
const isZero = (unit, f) => (unit === "money" ? /^-?0+\.00$/.test(f.amount) : f.value === 0);

/**
 * A card with its figure (HomeKpiCard). A ratio keeps what it is out of; over nothing it is
 * not measurable and the screen shows no figure. The tone is the card's own, taken only when
 * the figure is not zero. There is no trend until a figure keeps its history.
 * @param {object} entry  a live catalogue card
 * @param {object} figure  its figure, never null (a card with none is left out of the row)
 */
function cardOf(entry, figure) {
  const ratio = entry.unit === "pct" || entry.unit === "pair";
  return {
    key: entry.id,
    title: entry.label,
    unit: entry.unit,
    value: entry.unit === "money" ? null : figure.value,
    amount: entry.unit === "money" ? figure.amount : null,
    denominator: ratio ? figure.denominator : null,
    measurable: ratio ? figure.denominator > 0 : true,
    caption: entry.caption ? entry.caption(figure) : null,
    tone: entry.tone && !isZero(entry.unit, figure) ? entry.tone : null,
    trend: null,
    opens: true,
  };
}

/** A card as the picker and a role's editor offer it (HomeKpiOption). */
const optionOf = (entry) => ({ key: entry.id, title: entry.label, domain: entry.domain, unit: entry.unit });

/**
 * What the records behind a card are (HomeKpiDetailMeta): their title, the line above them,
 * their columns, and their chips each with how many records it holds, from the figure.
 * @param {object} entry  a live catalogue card
 * @param {object|null} figure  its figure for the reader; with none, no line and no counts
 */
function metaOf(entry, figure) {
  const { detail } = entry;
  const counts = (figure && figure.groups) || {};
  return {
    key: entry.id,
    title: detail.title,
    summary: figure && detail.summary ? detail.summary(figure) : null,
    columns: detail.columns.map((col) => ({
      key: col.key,
      label: col.label,
      numeric: col.numeric === true,
      phone: col.phone === true,
    })),
    groups: detail.groups.map((g) => ({ value: g.value, label: g.label, count: counts[g.value] || 0 })),
  };
}

/**
 * One page of the records behind a card (HomeKpiDetailPage), in the reader's scope.
 * `query.group` keeps one chip's records and must be one of the card's chips.
 * @param {object} entry  a live catalogue card the reader may see (the caller checks)
 * @param {{query: Function}} client
 * @param {{page?: number, q?: string, group?: string}} query
 * @param {ReturnType<typeof context>} ctx
 */
async function detailPage(entry, client, query, ctx) {
  if (query.group && !entry.detail.groups.some((g) => g.value === query.group))
    throw new AppError("KPI_GROUP_UNKNOWN", "That group is not on this card", 422, { group: ["Not on this card"] });
  return entry.detail.list(client, query, ctx);
}

assertCatalogSane();

module.exports = {
  MAX_CARDS,
  DOMAINS,
  UNITS,
  TILES,
  CATALOG,
  BY_ID,
  LIVE_IDS,
  PICKABLE_IDS,
  MODULES,
  isLive,
  isPickable,
  assertCatalogSane,
  context,
  figureOf,
  figuresFor,
  cardOf,
  optionOf,
  metaOf,
  detailPage,
};
