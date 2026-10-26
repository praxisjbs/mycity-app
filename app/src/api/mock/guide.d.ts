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
  /** A piece of a chapter a search finds (passagesOf), with what the reader needs to receive it. */
  export interface Passage {
    kind: "title" | "text" | "step" | "whole";
    anchor: string;
    text: string;
  }
  const guide: {
    parseChapter: (text: string, file: string) => { chapter: ParsedChapter; problems: string[] };
    filterChapter: (chapter: ParsedChapter, reader: Reader, known?: { slugs?: Set<string> }) => GuideChapter | null;
    passagesOf: (chapter: ParsedChapter) => Passage[];
    passageFor: (passage: Passage, reader: Reader) => { step: number | null } | null;
  };
  export default guide;
}

/**
 * The User Guide's search (packages/contract/guide-search.js): the words half, the same file the
 * API ranks with, so the demo finds what the server finds without the meaning half.
 */
declare module "@mycity/contract/guide-search.js" {
  import type { GuideHit } from "@mycity/contract/contract.gen.ts";
  import type { Passage, Reader } from "@mycity/contract/guide.js";
  export interface Index {
    passages: Array<Passage & { id: number }>;
  }
  type Visible = Map<number, { step: number | null }>;
  const engine: {
    indexOf: (passages: Passage[]) => Index;
    visibleTo: (index: Index, reader: Reader, passageFor: (p: Passage, r: Reader) => { step: number | null } | null) => Visible;
    search: (index: Index, q: string, opts: { visible: Visible; meaning?: Map<number, number> | null }) => Array<GuideHit & { score: number }>;
    linesOf: (index: Index, anchor: string, visible: Visible) => string[];
  };
  export default engine;
}
