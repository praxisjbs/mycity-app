"use strict";
/**
 * ⌘K's Guide group (docs/guides/user-guide.md §9): the sections and tasks of the User Guide this
 * person may read, matched by their titles, their chapter and their words, cut exactly as the
 * chapters are. A result opens the guide at that section. Not a table: the guide is files, so the
 * matches are made in memory, a page of 25 like every group.
 */
const routeMap = require("../../shared/route-map");
const { pageOf, envelope, PAGE_SIZE } = require("../../shared/http/paged");
const { rankOf, fold } = require("../../shared/search/search.service");
const service = require("./user_guide.service");

/** The words of some blocks, as one line to match against. */
function wordsOf(blocks) {
  const out = [];
  const spans = (list) => out.push(list.map((s) => s.text).join(""));
  for (const b of blocks) {
    if (b.kind === "paragraph" || b.kind === "note") spans(b.spans);
    else if (b.kind === "steps") b.items.forEach((i) => spans(i.spans));
    else if (b.kind === "bullets") b.items.forEach(spans);
    else if (b.kind === "table") b.rows.forEach((r) => r.forEach(spans));
    else if (b.kind === "figure") out.push(b.figure.alt);
  }
  return out.join(" ");
}

const hit = (slug, title, sub) => {
  const link = routeMap.linkFor("guide_section", slug);
  return { id: slug, type: "guide_section", ref: null, title, sub, status: null, link: link ? link.path : null };
};

module.exports = Object.freeze({
  type: "guide_section",
  module: "knowledge",
  label: "User Guide",
  words: ["guide", "how to", "help"],
  scoped: false,
  owned: false,
  capability: null,
  columns: [],
  async search(c, { term, page = 1, user }) {
    const guide = service.cut(service.load(), service.asReader(await service.guideReaderOf(c, user)));
    const entries = [];
    for (const chapter of guide.chapters)
      for (const s of chapter.sections) {
        entries.push({ title: s.title, words: [wordsOf(s.blocks)], context: chapter.title, hit: hit(s.slug, s.title, chapter.title) });
        for (const t of s.tasks)
          entries.push({ title: t.title, words: [wordsOf(t.blocks)], context: `${chapter.title} ${s.title}`, hit: hit(t.slug, t.title, `${chapter.title} · ${s.title}`) });
      }
    const folded = fold(term);
    const ranked = entries
      .map((e, i) => ({ e, i, rank: rankOf(e, folded) }))
      .filter((x) => x.rank > 0)
      .sort((x, y) => y.rank - x.rank || x.i - y.i);
    const { number, offset } = pageOf({ page });
    const result = envelope(ranked.slice(offset, offset + PAGE_SIZE).map((x) => x.e.hit), number, ranked.length);
    return { page: result.page, items: result.data };
  },
});
