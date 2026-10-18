"use strict";
/**
 * ⌘K for Home's cards: a KPI card the reader may see, by its title or the title of the
 * records behind it (docs/guides/home.md §9). A result opens the Overview on that card's
 * records (shared/route-map.js `home_kpi`, the card's catalogue key as its id).
 *
 * The cards are the KPI catalogue, which is code, so this provider searches it in memory
 * rather than a table. Every login holds `home` view, the only check the search service
 * makes, so the provider decides per person: only cards eligible for the reader (their
 * module's `view`, the card's capability, its field unmasked; kpi-catalog/eligibility.js)
 * and offered on the Overview, never a card they cannot open. Paged at 25, as every list.
 */
const { pageOf, envelope } = require("../../shared/http/paged");
const routeMap = require("../../shared/route-map");
const kpi = require("./kpi-catalog");
const eligibility = require("./kpi-catalog/eligibility");

/** Lower case, accents off, so "clocked" finds "Clocked In Today". */
const fold = (value) =>
  String(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

const matches = (entry, term) => fold(entry.label).includes(term) || fold(entry.detail.title).includes(term);

module.exports = Object.freeze({
  type: "home_kpi",
  module: "home",
  label: "KPI Cards",
  words: ["kpi", "kpis", "card", "cards", "dashboard"],
  scoped: false,
  columns: [],
  async search(client, { term, page = 1, user }) {
    const wanted = fold(term);
    const { eligible } = await eligibility.forUser(client, user);
    const found = kpi.CATALOG.filter((e) => kpi.isPickable(e.id) && eligible.has(e.id) && matches(e, wanted));
    const { number, size, offset } = pageOf({ page });
    const items = found.slice(offset, offset + size).map((e) => ({
      id: e.id,
      type: "home_kpi",
      ref: null,
      title: e.label,
      sub: null,
      status: null,
      link: routeMap.linkFor("home_kpi", e.id).path,
    }));
    return { page: envelope(items, number, found.length).page, items };
  },
});
