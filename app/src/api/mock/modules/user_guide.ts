import guide, { type ParsedChapter, type Reader } from "@mycity/contract/guide.js";
import type { GuideChapter, GuideContents } from "@mycity/contract/contract.gen.ts";
import { MODULES } from "@/shell/catalogue";
// A chapter's `cap` need is checked as hasCapability does; the user-guide gate holds each code to the catalogue.
import { visibleTabs } from "@/shell/access";
import { notFound, ok, route } from "../core";
import { me } from "./identity";

/**
 * Knowledge Hub · User Guide on the in-browser mock (laptops and CI only, F12 to F14): the real
 * chapters of docs/manual, parsed and cut to the signed-in demo account by the same file the API
 * uses (packages/contract/guide.js), and the real pictures beside them. A release build never
 * carries this file, so the pictures reach a live screen only through the API's own check.
 */
const SOURCES = import.meta.glob("../../../../../docs/manual/*.md", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const PICTURES = import.meta.glob("../../../../../docs/manual/img/**/*.png", { query: "?url", import: "default", eager: true }) as Record<string, string>;

const parsed: { chapters: ParsedChapter[]; quick: ParsedChapter | null } = (() => {
  const chapters: ParsedChapter[] = [];
  let quick: ParsedChapter | null = null;
  for (const [file, text] of Object.entries(SOURCES)) {
    const name = file.split("/").pop() as string;
    if (name === "README.md" || !text.startsWith("---")) continue;
    const { chapter } = guide.parseChapter(text, name);
    if (chapter.kind === "quick-start") quick = chapter;
    else chapters.push(chapter);
  }
  const rail = MODULES.map((m) => m.key as string);
  const key = (c: ParsedChapter) => (c.module && rail.includes(c.module) ? 1000 + rail.indexOf(c.module) : (c.order ?? 999));
  chapters.sort((a, b) => key(a) - key(b) || a.title.localeCompare(b.title));
  return { chapters, quick };
})();

/** The signed-in account as the guide asks it: the tabs the shell shows them, the needs they hold. */
function readerOf(user: string): Reader {
  const m = me(user);
  const can = (module: string, action: string) => m.is_ceo || ((m.grants as Record<string, string[] | undefined>)[module] ?? []).includes(action);
  return {
    screen: (module, tab) => {
      const mod = MODULES.find((x) => x.key === module);
      return Boolean(mod && can(module, "view") && visibleTabs(m, mod).some((t) => t.slug === tab));
    },
    holds: (need) =>
      need.kind === "grant" ? can(need.module, need.action) : need.kind === "cap" ? m.is_ceo || m.capabilities.includes(need.code) : need.kind === "manager" ? m.is_ceo || m.manages_people : m.is_ceo,
  };
}

function cut(user: string): { chapters: GuideChapter[]; quick: GuideChapter | null } {
  const reader = readerOf(user);
  const first = parsed.chapters.map((c) => guide.filterChapter(c, reader)).filter((c): c is GuideChapter => c !== null);
  const slugs = new Set(first.flatMap((c) => c.sections.flatMap((s) => [s.slug, ...s.tasks.map((t) => t.slug)])));
  return {
    chapters: parsed.chapters.map((c) => guide.filterChapter(c, reader, { slugs })).filter((c): c is GuideChapter => c !== null),
    quick: parsed.quick ? guide.filterChapter(parsed.quick, reader, { slugs }) : null,
  };
}

route("GET /api/v1/user-guide", (req) => {
  const mine = cut(req.user!);
  const contents: GuideContents = {
    chapters: mine.chapters.map((c) => ({
      slug: c.slug,
      title: c.title,
      module: c.module,
      icon: c.icon,
      summary: c.summary,
      sections: c.sections.map((s) => ({ slug: s.slug, title: s.title, screen: s.screen, tasks: s.tasks.map((t) => ({ slug: t.slug, title: t.title })) })),
    })),
    quick_start: (mine.quick?.sections ?? []).map((s) => ({ slug: s.slug, title: s.title, role: s.role })),
  };
  return ok(contents);
});

route("GET /api/v1/user-guide/quick-start", (req) =>
  ok(cut(req.user!).quick ?? { slug: "quick-start", kind: "quick-start", title: "Quick Start", module: null, icon: null, summary: "", intro: [], sections: [], pictures: [] }),
);

route("GET /api/v1/user-guide/chapters/:slug", (req) => {
  const found = cut(req.user!).chapters.find((c) => c.slug === req.params.slug);
  return found ? ok(found) : notFound();
});

/** A picture's bytes, from the file beside its chapter (the screen's fetchImage in mock mode). */
export async function mockPicture(url: string): Promise<Blob> {
  const m = /\/user-guide\/images\/([a-z0-9-]+)\/([a-z0-9.-]+\.png)$/.exec(url);
  const file = m ? Object.entries(PICTURES).find(([path]) => path.endsWith(`/img/${m[1]}/${m[2]}`)) : undefined;
  if (!file) throw new Error("That picture is not there.");
  const res = await fetch(file[1]);
  if (!res.ok) throw new Error("That picture is not there.");
  return res.blob();
}
