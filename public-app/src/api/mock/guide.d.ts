/**
 * The guide parser (packages/contract/guide.js) as the public mock uses it for the Help page: the
 * same file the API reads, so the demo shows the chapter exactly as the server cuts it.
 */
declare module "@mycity/contract/guide.js" {
  import type { GuideChapter } from "@mycity/contract/contract.gen.ts";
  export interface ParsedChapter {
    slug: string;
    kind: "chapter" | "quick-start" | "public-help";
    title: string;
  }
  export interface Reader {
    screen: (module: string, tab: string) => boolean;
    holds: (need: unknown) => boolean;
  }
  const guide: {
    parseChapter: (text: string, file: string) => { chapter: ParsedChapter; problems: string[] };
    filterChapter: (chapter: ParsedChapter, reader: Reader) => GuideChapter | null;
  };
  export default guide;
}
