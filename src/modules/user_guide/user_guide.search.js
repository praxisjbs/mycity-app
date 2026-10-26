"use strict";
/**
 * ⌘K's Guide group (docs/guides/user-guide.md §9): the sections and tasks of the User Guide this
 * person may read that answer the term, ranked by the guide's own search (§6.8), cut exactly as
 * the chapters are. A result opens the guide at that section, and at the step that answers.
 *
 * A description (three words or more) is searched by meaning too. Its vector is asked for in
 * `prepare`, before ⌘K's transaction opens, and given little time: ⌘K is typed into all day, and
 * a word or two is found by its words as well as by its meaning. Not a table: the guide is files,
 * so the matches are made in memory, a page of 25 like every group.
 */
const routeMap = require("../../shared/route-map");
const { pageOf, envelope, PAGE_SIZE } = require("../../shared/http/paged");
const service = require("./user_guide.service");
const meaning = require("./user_guide.meaning");

/** Words a term needs before ⌘K searches it by meaning too. */
const MEANING_WORDS = 3;
/** How long ⌘K waits for a term's vector before it searches by words alone. */
const MEANING_WAIT_MS = 1_500;

const hitOf = (h) => {
  const link = routeMap.linkFor("guide_section", h.anchor);
  const path = link ? (h.step ? `${link.path}&step=${h.step}` : link.path) : null;
  const sub = h.kind === "task" ? `${h.chapter_title} · ${h.section_title}` : h.chapter_title;
  return { id: h.anchor, type: "guide_section", ref: null, title: h.title, sub, status: null, link: path };
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
  async prepare({ term, user }) {
    if (term.split(" ").filter(Boolean).length < MEANING_WORDS) return null;
    return meaning.embedSearch({ q: term, user, timeoutMs: MEANING_WAIT_MS });
  },
  async search(c, { term, page = 1, user, prepared = null }) {
    const near = prepared ? (index, visible) => meaning.nearest({ index, visible, ...prepared, db: c }) : false;
    const { hits } = await service.hitsFor(c, user, { q: term }, { meaning: near });
    const { number, offset } = pageOf({ page });
    const result = envelope(hits.slice(offset, offset + PAGE_SIZE).map(hitOf), number, hits.length);
    return { page: result.page, items: result.data };
  },
});
