"use strict";
/**
 * What the assistant may read of the User Guide (docs/guides/user-guide.md §9):
 *
 *   guide.search   the sections and tasks this person may read that answer a how-to question, best
 *                  first, each with the lines that answer it, a page of 25
 *
 * The same search as the guide's box and ⌘K (§6.8), cut to the asker's own grants, so the
 * assistant tells a person only how to use what they may open. Each row cites its section, which
 * opens the guide at it. It never writes (A23).
 */
const c = require("@mycity/contract");
const { defineManifest } = require("../../shared/ai/manifest");
const { pageOf, envelope, PAGE_SIZE } = require("../../shared/http/paged");
const engine = require("@mycity/contract/guide-search");
const service = require("./user_guide.service");

/** A row's lines, at most this many characters, so a whole page fits what the model is shown. */
const ROW_TEXT = 400;

async function search(client, params, actor) {
  const { index, visible, hits } = await service.hitsFor(client, actor, { q: params.q });
  const { number, offset } = pageOf(params);
  const rows = hits.slice(offset, offset + PAGE_SIZE).map((h) => ({
    slug: h.anchor,
    title: h.title,
    chapter: h.chapter_title,
    section: h.section_title,
    screen: h.screen,
    step: h.step,
    text: engine.linesOf(index, h.anchor, visible).join(" ").slice(0, ROW_TEXT),
  }));
  return envelope(rows, number, hits.length);
}

module.exports = defineManifest({
  module: "knowledge",
  reads: [
    {
      key: "guide.search",
      description: "Search the User Guide for how to do something in the hub: which screen to open, which button to press, the steps of a task",
      params: c.common.PageQuery,
      permission: ["knowledge", "view"],
      run: search,
      cite: (row) => ({ type: "guide_section", id: row.slug, label: `${row.chapter}: ${row.title}` }),
    },
  ],
  routes: [{ intent: "read how to use a screen in the User Guide", screen: "knowledge.user-guide" }],
});
