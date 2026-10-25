"use strict";
/**
 * Knowledge Hub · User Guide (docs/guides/user-guide.md): the chapters of `docs/manual/`, read
 * by packages/contract/guide.js and cut to the reader on the server, down to the step.
 *
 *   GET /user-guide                     GuideContents   the chapters and their sections, the Quick Start's cards
 *   GET /user-guide/chapters/:slug      GuideChapter    one chapter, as this reader may read it
 *   GET /user-guide/quick-start         GuideChapter    the Quick Start's cards this reader may follow
 *   GET /user-guide/images/:chapter/:file               a picture a section this reader may read shows
 *
 * The text is content a person reads, not interface copy (FRONTEND_GUIDE §5.3).
 */
const { z } = require("zod");

const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "lower-case words and hyphens");

/** A run of text with its marks. `href` is a screen, a section of the guide or a page outside. */
const GuideSpan = z
  .object({
    text: z.string(),
    bold: z.boolean(),
    italic: z.boolean(),
    code: z.boolean(),
    href: z.string().nullable(),
  })
  .strict();
const Spans = z.array(GuideSpan);

/** A picture a block shows, by its shot id, with the words that stand for it. */
const GuideFigure = z.object({ shot: slug, alt: z.string() }).strict();

/** One block of a chapter: what GuideBody (@mycity/ui) draws. */
const GuideBlock = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("paragraph"), spans: Spans }).strict(),
  z
    .object({
      kind: z.literal("steps"),
      items: z.array(z.object({ n: z.number().int().min(1), spans: Spans, figure: GuideFigure.nullable() }).strict()),
    })
    .strict(),
  z.object({ kind: z.literal("bullets"), items: z.array(Spans) }).strict(),
  z.object({ kind: z.literal("note"), tone: z.enum(["tip", "important", "note"]), spans: Spans }).strict(),
  z.object({ kind: z.literal("figure"), figure: GuideFigure }).strict(),
  z.object({ kind: z.literal("table"), head: z.array(Spans), rows: z.array(z.array(Spans)) }).strict(),
]);

/** One job inside a section: its steps. */
const GuideTask = z.object({ slug, title: z.string(), blocks: z.array(GuideBlock) }).strict();

/** A section: one screen or one subject. `screen` is `<module>/<tab>` when it is about a tab. */
const GuideSection = z
  .object({
    slug,
    title: z.string(),
    screen: z.string().nullable(),
    role: z.string().nullable(),
    icon: z.string().nullable(),
    blocks: z.array(GuideBlock),
    tasks: z.array(GuideTask),
  })
  .strict();

/** A picture the chapter shows: the devices it was taken on, and its numbered marks. */
const GuidePicture = z
  .object({
    shot: slug,
    devices: z.array(z.enum(["desktop", "phone"])),
    legend: z.array(z.object({ n: z.number().int().min(1), text: z.string() }).strict()),
  })
  .strict();

/** One chapter (or the Quick Start), as this reader may read it. */
const GuideChapter = z
  .object({
    slug,
    kind: z.enum(["chapter", "quick-start"]),
    title: z.string(),
    module: z.string().nullable(),
    icon: z.string().nullable(),
    summary: z.string(),
    intro: z.array(GuideBlock),
    sections: z.array(GuideSection),
    pictures: z.array(GuidePicture),
  })
  .strict();

/** A chapter in the contents: its sections and their tasks, by title. */
const GuideContentsChapter = z
  .object({
    slug,
    title: z.string(),
    module: z.string().nullable(),
    icon: z.string().nullable(),
    summary: z.string(),
    sections: z.array(
      z
        .object({
          slug,
          title: z.string(),
          screen: z.string().nullable(),
          tasks: z.array(z.object({ slug, title: z.string() }).strict()),
        })
        .strict(),
    ),
  })
  .strict();

/**
 * The contents: every chapter this reader may read, in the rail's order, and the Quick Start's
 * cards. One document's outline, returned whole (docs/guides/user-guide.md §6.7).
 */
const GuideContents = z
  .object({
    chapters: z.array(GuideContentsChapter),
    quick_start: z.array(z.object({ slug, title: z.string(), role: z.string().nullable() }).strict()),
  })
  .strict();

/** GET /user-guide/chapters/:slug */
const GuideChapterParams = z.object({ slug }).strict();

/** GET /user-guide/images/:chapter/:file: `<shot>.desktop.png` or `<shot>.phone.png`. */
const GuideImageParams = z
  .object({
    chapter: slug,
    file: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*\.(desktop|phone)\.png$/, "a picture's file name"),
  })
  .strict();

/** Gate 6: the guide is files shipped with each release, never a table. */
const TABLES = {
  GuideSpan: { table: null, reason: "a run of a chapter's text, parsed from docs/manual" },
  GuideFigure: { table: null, reason: "a picture a chapter names, from docs/manual" },
  GuideTask: { table: null, reason: "a task of a chapter, from docs/manual" },
  GuideSection: { table: null, reason: "a section of a chapter, from docs/manual" },
  GuidePicture: { table: null, reason: "a picture's devices and marks, from its shot spec" },
  GuideChapter: { table: null, reason: "a chapter of docs/manual, cut to the reader" },
  GuideContentsChapter: { table: null, reason: "a chapter's outline in the contents" },
  GuideContents: { table: null, reason: "the outline of every chapter the reader may read" },
  GuideChapterParams: { table: null, reason: "a chapter's file name" },
  GuideImageParams: { table: null, reason: "a picture's chapter and file name" },
};

module.exports = {
  TABLES,
  GuideSpan,
  GuideFigure,
  GuideBlock,
  GuideTask,
  GuideSection,
  GuidePicture,
  GuideChapter,
  GuideContentsChapter,
  GuideContents,
  GuideChapterParams,
  GuideImageParams,
};
