import type { GuideChapter } from "@mycity/contract/contract.gen.ts";
import { fail, ok, route } from "./core";

/**
 * The Help page on the in-browser mock (laptops and CI only, F12 to F14): the real chapter,
 * docs/manual/public-site.md, cut by the same parser the API uses (packages/contract/guide.js) for a
 * reader nobody signed in, and its real pictures. A release build never carries this file.
 */
/* Loaded on the page's first request, not when the mock starts: every page's test boots the mock. */
const SOURCE = import.meta.glob("../../../../docs/manual/public-site.md", { query: "?raw", import: "default" }) as Record<string, () => Promise<string>>;
const PICTURES = import.meta.glob("../../../../docs/manual/img/public-site/*.png", { query: "?url", import: "default" }) as Record<string, () => Promise<string>>;

let reading: Promise<GuideChapter | null> | null = null;

/** The chapter as the API sends it: every section, nothing that needs a grant. */
function help(): Promise<GuideChapter | null> {
  reading ??= (async () => {
    const read = Object.values(SOURCE)[0];
    if (!read) return null;
    const guide = (await import("@mycity/contract/guide.js")).default;
    const { chapter } = guide.parseChapter(await read(), "public-site.md");
    return guide.filterChapter(chapter, { screen: () => true, holds: () => false });
  })();
  return reading;
}

route("GET /api/public/v1/help", async () => {
  const chapter = await help();
  return chapter ? ok(chapter) : fail(404, "NOT_FOUND", "Help is not there.");
});

/** A picture's bytes, from the file beside the chapter (the Help page's fetchImage in mock mode). */
export async function mockPicture(url: string): Promise<Blob> {
  const m = /\/help\/images\/([a-z0-9.-]+\.png)$/.exec(url);
  const file = m ? Object.entries(PICTURES).find(([path]) => path.endsWith(`/img/public-site/${m[1]}`)) : undefined;
  if (!file) throw new Error("That picture is not there.");
  const res = await fetch(await file[1]());
  if (!res.ok) throw new Error("That picture is not there.");
  return res.blob();
}
