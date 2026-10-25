/**
 * The guide parser (packages/contract/guide.js) as the in-browser mock uses it: the same file the
 * API and the gate read, so the demo cuts a chapter exactly as the server does.
 */
declare module "@mycity/contract/guide.js" {
  import type { GuideChapter } from "@mycity/contract/contract.gen.ts";
  export type Need = { kind: "grant"; module: string; action: string } | { kind: "cap"; code: string } | { kind: "manager" } | { kind: "ceo" };
  export interface ParsedChapter {
    slug: string;
    kind: "chapter" | "quick-start";
    title: string;
    module: string | null;
    order: number | null;
    sections: Array<{ slug: string; title: string; screen: { module: string; tab: string } | null; tasks: Array<{ slug: string; title: string }> }>;
  }
  export interface Reader {
    screen: (module: string, tab: string) => boolean;
    holds: (need: Need) => boolean;
  }
  const guide: {
    parseChapter: (text: string, file: string) => { chapter: ParsedChapter; problems: string[] };
    filterChapter: (chapter: ParsedChapter, reader: Reader, known?: { slugs?: Set<string> }) => GuideChapter | null;
  };
  export default guide;
}
