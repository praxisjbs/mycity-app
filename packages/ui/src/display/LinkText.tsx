/**
 * @component LinkText
 * @group Display
 * @summary Text a person wrote, with every link in it clickable and, while searching, each match marked.
 * @use A chat message, a caption, an announcement's body: anything a person typed that may hold a link (https://nfelia.com, www.mycityapp.io, nfelia.com).
 * @avoid Interface copy (it has no links); a mail body (use EmailFrame, which keeps the sender's own links); a link the product makes itself (a Button with asChild, or a router Link).
 * @phone The same; a link is tapped like any other, and long addresses wrap instead of pushing the bubble wider.
 * @a11y Links are real anchors that open in a new tab with no opener and say so to assistive technology; the text keeps its line breaks and is marked as content.
 * @status beta
 * @example <LinkText text="See https://nfelia.com today" highlight="nfelia" />
 */
import type { ReactNode } from "react";
import { cn } from "../lib/cn";
import { findLinks } from "../lib/links";

export interface LinkTextProps {
  /** The text, as the person wrote it. */
  text: string;
  /** A search term: each match is marked (`mark.hit`, which the search steps between). */
  highlight?: string;
  /** Layout classes only (spacing, width); the look is the component's own. */
  className?: string;
}

/** Marks for every match of `q` in `text`, case-insensitive. */
function marked(text: string, q: string | undefined, key: string): ReactNode[] {
  const term = (q ?? "").trim();
  if (!term) return [text];
  const parts = text.split(new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"));
  return parts.map((p, i) =>
    i % 2 ? (
      <mark key={`${key}-${i}`} className="hit">
        {p}
      </mark>
    ) : (
      p
    ),
  );
}

export function LinkText({ text, highlight, className }: LinkTextProps) {
  const out: ReactNode[] = [];
  let at = 0;
  for (const link of findLinks(text)) {
    if (link.start > at) out.push(...marked(text.slice(at, link.start), highlight, `t${at}`));
    out.push(
      <a
        key={`a${link.start}`}
        href={link.href}
        target="_blank"
        rel="noopener noreferrer"
        className="font-strong break-all underline underline-offset-2"
      >
        {marked(link.text, highlight, `a${link.start}`)}
        <span className="sr-only"> (opens in a new tab)</span>
      </a>,
    );
    at = link.end;
  }
  if (at < text.length) out.push(...marked(text.slice(at), highlight, `t${at}`));
  return (
    <span data-copy="content" className={cn("whitespace-pre-wrap", className)}>
      {out}
    </span>
  );
}
