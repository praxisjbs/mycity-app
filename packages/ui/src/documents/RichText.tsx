/**
 * @component RichText
 * @group Documents
 * @summary Formatted text the server sent as blocks (headings, paragraphs, lists, bold, italic, links), drawn as elements, never as injected HTML.
 * @use A policy's text on Policy Updates and Knowledge Hub · Policies; any text a person wrote that the API gives back as blocks.
 * @avoid Text being written (use RichTextField); an email's own HTML (use EmailFrame); a short plain answer (a paragraph is enough).
 * @phone The same text at the phone's body size; long words and links wrap rather than push the page sideways.
 * @a11y Real headings, lists and links in reading order, so a screen reader can move by heading; pass `top` so the headings sit under the page's own.
 * @status beta
 * @example <RichText blocks={version.body} top={3} />
 */
import { Fragment, type ReactNode } from "react";
import { cn } from "../lib/cn";
import { content } from "../lib/slots";

/** A run of text with its marks, as the API sends it. */
export interface RichTextSpan {
  text: string;
  bold: boolean;
  italic: boolean;
  /** A link's address (http, https, mailto or tel), or null. */
  href: string | null;
}

/** One block: a heading (2 to 4), a paragraph, or a list's items. */
export type RichTextBlock =
  | { kind: "heading"; level: number; spans: RichTextSpan[] }
  | { kind: "paragraph"; spans: RichTextSpan[] }
  | { kind: "bullets"; items: RichTextSpan[][] }
  | { kind: "numbered"; items: RichTextSpan[][] };

export interface RichTextProps {
  /** The text, block by block, as the API sends it. */
  blocks: RichTextBlock[];
  /** The heading level the text's top headings take (2 unless set): one below the heading the text sits under. */
  top?: 2 | 3 | 4;
  /** Layout classes only (spacing, width); the look is the component's own. */
  className?: string;
}

const SAFE = /^(https?:|mailto:|tel:)/i;

function Spans({ spans }: { spans: RichTextSpan[] }) {
  return (
    <>
      {spans.map((s, i) => {
        let node: ReactNode = s.text;
        if (s.italic) node = <em>{node}</em>;
        if (s.bold) node = <strong className="text-foreground">{node}</strong>;
        if (s.href && SAFE.test(s.href)) node = <a href={s.href} target="_blank" rel="noopener noreferrer">{node}</a>;
        return <Fragment key={i}>{node}</Fragment>;
      })}
    </>
  );
}

export function RichText({ blocks, top = 2, className }: RichTextProps) {
  return (
    <div {...content} className={cn("rte text-sm leading-relaxed break-words text-muted-foreground", className)}>
      {blocks.map((b, i) => {
        if (b.kind === "heading") {
          const level = Math.min(6, top + Math.max(0, b.level - 2));
          const H = `h${level}` as "h2" | "h3" | "h4" | "h5" | "h6";
          return <H key={i} className="text-foreground"><Spans spans={b.spans} /></H>;
        }
        if (b.kind === "paragraph") return <p key={i}><Spans spans={b.spans} /></p>;
        const List = b.kind === "numbered" ? "ol" : "ul";
        return (
          <List key={i}>
            {b.items.map((item, j) => (
              <li key={j}><Spans spans={item} /></li>
            ))}
          </List>
        );
      })}
    </div>
  );
}
