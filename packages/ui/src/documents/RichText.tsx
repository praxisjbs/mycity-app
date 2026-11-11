/**
 * @component RichText
 * @group Documents
 * @summary Formatted text the server sent as blocks (headings, paragraphs, lists, tables, bold, italic, links), drawn as elements, never as injected HTML.
 * @use A policy's text on Policy Updates and Knowledge Hub · Policies; an agreement's wording with its options table on Contracts & MOUs and the signing page; any text a person wrote that the API gives back as blocks. `look="site"` is the public site's: a role's text in its body ink, a numbered heading's number on a Deep Green badge, bullets as small yellow squares.
 * @avoid Text being written (use RichTextField); an email's own HTML (use EmailFrame); a short plain answer (a paragraph is enough).
 * @phone The same text at the phone's body size; long words and links wrap rather than push the page sideways. A table becomes a card a row, each cell under its column's name, since a phone shows no table.
 * @a11y Real headings, lists and links in reading order, so a screen reader can move by heading; pass `top` so the headings sit under the page's own.
 * @status beta
 * @example <RichText blocks={version.body} top={3} />
 */
import { Fragment, type ReactNode } from "react";
import { cn } from "../lib/cn";
import { content } from "../lib/slots";
import { useIsPhone } from "../lib/media";

/** A run of text with its marks, as the API sends it. */
export interface RichTextSpan {
  text: string;
  bold: boolean;
  italic: boolean;
  /** A link's address (http, https, mailto or tel), or null. */
  href: string | null;
}

/** One cell of a table: its runs of text. */
export type RichTextCell = RichTextSpan[];

/** One block: a heading (2 to 4), a paragraph, a list's items, or a table (its header row, then its rows). */
export type RichTextBlock =
  | { kind: "heading"; level: number; spans: RichTextSpan[] }
  | { kind: "paragraph"; spans: RichTextSpan[] }
  | { kind: "bullets"; items: RichTextSpan[][] }
  | { kind: "numbered"; items: RichTextSpan[][] }
  | { kind: "table"; head: RichTextCell[]; rows: RichTextCell[][] };

export interface RichTextProps {
  /** The text, block by block, as the API sends it. */
  blocks: RichTextBlock[];
  /** The heading level the text's top headings take (2 unless set): one below the heading the text sits under. */
  top?: 2 | 3 | 4;
  /** `site`: the public site's (a vacancy's text): its body ink and size, numbered headings on a badge, yellow bullets. */
  look?: "default" | "site";
  /** Layout classes only (spacing, width); the look is the component's own. */
  className?: string;
}

/** A heading that opens with its number ("1. Sales & Revenue Strategy"): the number, and the rest. */
const NUMBERED = /^(\d{1,2})\.\s+/;

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

const textOf = (cell: RichTextCell | undefined) => (cell ?? []).map((s) => s.text).join("").trim();

/**
 * A table: on a computer, the table, scrolling inside itself when wider than the text; on a phone, a
 * card a row (no table shows on a phone), its title the row's first cell when the header leaves that
 * column unnamed (an agreement's options: Deal Price, then a value under each option).
 */
function Table({ head, rows }: { head: RichTextCell[]; rows: RichTextCell[][] }) {
  const phone = useIsPhone();
  const titled = textOf(head[0]) === "";
  if (phone)
    return (
      <div className="my-2 grid gap-2">
        {rows.map((row, i) => (
          <div key={i} className="rounded-md border border-border bg-card px-3 py-2">
            {titled && <p className="font-semibold text-foreground"><Spans spans={row[0] ?? []} /></p>}
            <dl className="grid gap-1">
              {head.map((h, k) =>
                titled && k === 0 ? null : (
                  <div key={k} className="flex justify-between gap-3">
                    <dt className="text-subtle-foreground"><Spans spans={h} /></dt>
                    <dd className="text-right text-foreground"><Spans spans={row[k] ?? []} /></dd>
                  </div>
                ),
              )}
            </dl>
          </div>
        ))}
      </div>
    );
  return (
    <div className="overflow-x-auto">
      <table>
        <thead>
          <tr>
            {head.map((h, k) =>
              titled && k === 0 ? <td key={k} /> : <th key={k} scope="col"><Spans spans={h} /></th>,
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {head.map((_, k) =>
                titled && k === 0 ? (
                  <th key={k} scope="row"><Spans spans={row[k] ?? []} /></th>
                ) : (
                  <td key={k}><Spans spans={row[k] ?? []} /></td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function RichText({ blocks, top = 2, look = "default", className }: RichTextProps) {
  const site = look === "site";
  return (
    <div {...content} className={cn(site ? "ps-rte break-words" : "rte text-sm leading-relaxed break-words text-muted-foreground", className)}>
      {blocks.map((b, i) => {
        if (b.kind === "heading") {
          const level = Math.min(6, top + Math.max(0, b.level - 2));
          const H = `h${level}` as "h2" | "h3" | "h4" | "h5" | "h6";
          const first = b.spans[0];
          const n = site && first ? NUMBERED.exec(first.text) : null;
          if (n && first)
            return (
              <H key={i}>
                <span data-n="" aria-hidden="true">
                  {n[1]}
                </span>
                <span className="sr-only">{n[1]}.</span>{" "}
                <span>
                  <Spans spans={[{ ...first, text: first.text.slice(n[0].length) }, ...b.spans.slice(1)]} />
                </span>
              </H>
            );
          return <H key={i} className="text-foreground"><Spans spans={b.spans} /></H>;
        }
        if (b.kind === "paragraph") return <p key={i}><Spans spans={b.spans} /></p>;
        if (b.kind === "table") return <Table key={i} head={b.head} rows={b.rows} />;
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
