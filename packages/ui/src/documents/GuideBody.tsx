/**
 * @component GuideBody
 * @group Documents
 * @summary A User Guide chapter's body: numbered steps with Open links, notes, tables and annotated pictures.
 * @use The Knowledge Hub's User Guide, the Full Guide and the Quick Start cards, fed the blocks the API sent (docs/guides/user-guide.md §6.2).
 * @avoid An article someone wrote (ArticleBody); a document the product generated (Paper); help on a field (HelpTerm).
 * @phone Steps keep their numbers on the left, a picture is the phone shot when there is one, and a wide table scrolls inside its own box.
 * @a11y Steps are an ordered list, each with its own id so a reader can come back to it; a picture carries its text and its marks are listed under it. A link to another site says it opens in a new tab.
 * @status beta
 * @example <GuideBody blocks={section.blocks} anchor="people-add-employee" picture={pictureOf} onLink={open} />
 */
import { useEffect, useState, type MouseEvent } from "react";
import { cn } from "../lib/cn";
import { useIsPhone } from "../lib/media";
import { useSeen } from "../lib/seen";
import { content } from "../lib/slots";
import { Icon, type IconName } from "../icons/Icon";

/** A run of text with its marks, as the API sends it. `href` is a screen, a section of the guide or a page outside. */
export interface GuideSpan {
  text: string;
  bold: boolean;
  italic: boolean;
  code: boolean;
  href: string | null;
}

/** A picture a block shows, by its shot id. */
export interface GuideFigureRef {
  shot: string;
  alt: string;
}

/** One block of a chapter, in the wire shape (packages/contract/guide.js filterChapter). */
export type GuideBlock =
  | { kind: "paragraph"; spans: GuideSpan[] }
  | { kind: "steps"; items: Array<{ n: number; spans: GuideSpan[]; figure: GuideFigureRef | null }> }
  | { kind: "bullets"; items: GuideSpan[][] }
  | { kind: "note"; tone: "tip" | "important" | "note"; spans: GuideSpan[] }
  | { kind: "figure"; figure: GuideFigureRef }
  | { kind: "table"; head: GuideSpan[][]; rows: GuideSpan[][][] };

/** A picture's files and the marks drawn on it. */
export interface GuidePicture {
  /** The desktop shot's address; the phone's is used when this is missing. */
  desktop?: string | null;
  /** The phone shot's address; the desktop's is used when this is missing. */
  phone?: string | null;
  /** The numbered marks on the picture, in order. */
  legend: Array<{ n: number; text: string }>;
}

/** Where a link was followed from, so the reader can be brought back to the same line. */
export interface GuideLinkFrom {
  anchor: string;
  step: number | null;
}

export interface GuideBodyProps {
  /** The blocks, as the API sent them. */
  blocks: GuideBlock[];
  /** The section's or task's slug: each step's id is `<anchor>-step-<n>`. */
  anchor: string;
  /** A picture's files and marks by its shot id; null when it has none. */
  picture?: (shot: string) => GuidePicture | null;
  /** Fetches a picture that needs the session; without it the address is drawn as it is. */
  fetchImage?: (url: string) => Promise<Blob>;
  /** Called for a screen (`/people?tab=x`) or a section (`#slug`) link; without it they are plain links. */
  onLink?: (href: string, from: GuideLinkFrom) => void;
  /** Called when a picture is pressed, to show it full size. */
  onZoom?: (shot: string) => void;
  /** The step to mark as the one the reader came back to. */
  highlight?: number | null;
  /** Layout classes only (spacing). */
  className?: string;
}

const outside = (href: string) => /^(https:|mailto:)/.test(href);

function Spans({ spans, from, onLink }: { spans: GuideSpan[]; from: GuideLinkFrom; onLink?: GuideBodyProps["onLink"] }) {
  return (
    <>
      {spans.map((s, i) => {
        const text = s.code ? (
          <code className="rounded-ctl bg-muted px-1 font-mono text-xs text-foreground">{s.text}</code>
        ) : (
          s.text
        );
        const marked = s.bold ? <strong className="font-semibold text-foreground">{text}</strong> : s.italic ? <em>{text}</em> : text;
        if (!s.href) return <span key={i}>{marked}</span>;
        if (outside(s.href))
          return (
            <a key={i} href={s.href} target="_blank" rel="noopener noreferrer" className="font-semibold text-accent-foreground underline underline-offset-2">
              {marked}
              <Icon name="external" className="ml-0.5 inline-block align-text-bottom" />
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          );
        const follow = (e: MouseEvent<HTMLAnchorElement>) => {
          // A new tab or window is the browser's own; a plain press stays in the app and remembers the line.
          if (!onLink || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
          e.preventDefault();
          onLink(s.href as string, from);
        };
        return (
          <a key={i} href={s.href} onClick={follow} className="font-semibold text-accent-foreground underline underline-offset-2">
            {marked}
          </a>
        );
      })}
    </>
  );
}

/** A picture's file, fetched with the session when it needs one, once it comes near the screen. */
function useSource(url: string | null, fetchImage?: (url: string) => Promise<Blob>) {
  const [wanted, setWanted] = useState(!fetchImage);
  const [href, setHref] = useState<string | null>(fetchImage ? null : url);
  const seen = useSeen<HTMLElement>(fetchImage ? () => setWanted(true) : undefined);
  useEffect(() => {
    if (!fetchImage) {
      setHref(url);
      return;
    }
    if (!url || !wanted) return;
    let live = true;
    let made: string | null = null;
    fetchImage(url)
      .then((blob) => {
        if (!live) return;
        made = URL.createObjectURL(blob);
        setHref(made);
      })
      .catch(() => live && setHref(null));
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
      setHref(null);
    };
  }, [url, wanted, fetchImage]);
  return { href, seen };
}

function Figure({ figure, picture, fetchImage, onZoom }: { figure: GuideFigureRef } & Pick<GuideBodyProps, "picture" | "fetchImage" | "onZoom">) {
  const phone = useIsPhone();
  const p = picture?.(figure.shot) ?? null;
  const url = p ? (phone ? (p.phone ?? p.desktop) : (p.desktop ?? p.phone)) ?? null : null;
  const { href, seen } = useSource(url, fetchImage);
  const img = href ? (
    <img src={href} alt={figure.alt} loading="lazy" className="block h-auto w-full rounded-box" />
  ) : (
    <div role="img" aria-label={figure.alt} className="flex aspect-video w-full items-center justify-center rounded-box bg-muted text-muted-foreground">
      <Icon name="image" size="m" />
    </div>
  );
  return (
    <figure ref={seen} className="my-3 overflow-hidden rounded-card border border-border bg-card" data-shot={figure.shot}>
      {onZoom && href ? (
        <button type="button" onClick={() => onZoom(figure.shot)} aria-label={`Enlarge: ${figure.alt}`} className="block w-full cursor-zoom-in">
          {img}
        </button>
      ) : (
        img
      )}
      {p && p.legend.length > 0 && (
        <ol className="grid grid-cols-2 gap-1.5 border-t border-border px-3 py-2.5 text-sm phone:grid-cols-1">
          {p.legend.map((m) => (
            <li key={m.n} className="flex items-start gap-2">
              <span aria-hidden="true" className="flex size-5 flex-none items-center justify-center rounded-full bg-primary text-2xs font-strong text-primary-foreground">
                {m.n}
              </span>
              <span className="sr-only">Mark {m.n}: </span>
              <span className="min-w-0 text-foreground">{m.text}</span>
            </li>
          ))}
        </ol>
      )}
    </figure>
  );
}

const NOTE: Record<"tip" | "important" | "note", { box: string; icon: IconName; label: string | null }> = {
  tip: { box: "bg-success-soft text-success", icon: "spark", label: "Tip" },
  important: { box: "bg-warning-soft text-warning", icon: "alert", label: "Important" },
  note: { box: "bg-info-soft text-info", icon: "info", label: null },
};

export function GuideBody({ blocks, anchor, picture, fetchImage, onLink, onZoom, highlight, className }: GuideBodyProps) {
  const at = (step: number | null): GuideLinkFrom => ({ anchor, step });
  return (
    <div {...content} className={cn("text-sm leading-relaxed text-muted-foreground", className)}>
      {blocks.map((b, i) => {
        if (b.kind === "paragraph")
          return (
            <p key={i} className="my-2 first:mt-0">
              <Spans spans={b.spans} from={at(null)} onLink={onLink} />
            </p>
          );
        if (b.kind === "bullets")
          return (
            <ul key={i} className="my-2 list-disc space-y-1 pl-5">
              {b.items.map((spans, j) => (
                <li key={j}>
                  <Spans spans={spans} from={at(null)} onLink={onLink} />
                </li>
              ))}
            </ul>
          );
        if (b.kind === "note") {
          const t = NOTE[b.tone];
          return (
            <div key={i} data-tone={b.tone} className={cn("my-3 flex items-start gap-2.5 rounded-box px-3 py-2.5", t.box)}>
              <Icon name={t.icon} className="mt-0.5 flex-none" />
              <p className="min-w-0 text-foreground">
                {t.label && <strong className="font-semibold">{t.label}: </strong>}
                <Spans spans={b.spans} from={at(null)} onLink={onLink} />
              </p>
            </div>
          );
        }
        if (b.kind === "figure") return <Figure key={i} figure={b.figure} picture={picture} fetchImage={fetchImage} onZoom={onZoom} />;
        if (b.kind === "table")
          return (
            <div key={i} className="my-3 overflow-x-auto rounded-box border border-border">
              <table className="w-full border-collapse text-left text-sm">
                <thead className="bg-muted">
                  <tr>
                    {b.head.map((cell, j) => (
                      <th key={j} scope="col" className="px-3 py-2 text-xs font-strong text-foreground">
                        <Spans spans={cell} from={at(null)} onLink={onLink} />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {b.rows.map((row, r) => (
                    <tr key={r} className="border-t border-border">
                      {row.map((cell, j) => (
                        <td key={j} className="px-3 py-2 align-top">
                          <Spans spans={cell} from={at(null)} onLink={onLink} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        return (
          <ol key={i} className="my-3 space-y-2">
            {b.items.map((s) => (
              <li
                key={s.n}
                id={`${anchor}-step-${s.n}`}
                data-current={highlight === s.n || undefined}
                className={cn("scroll-mt-24 rounded-box", highlight === s.n && "bg-accent px-2 py-1.5 -mx-2")}
              >
                <div className="flex items-start gap-2.5">
                  <span aria-hidden="true" className="mt-0.5 flex size-6 flex-none items-center justify-center rounded-full border border-border bg-card text-xs font-strong text-foreground">
                    {s.n}
                  </span>
                  <div className="min-w-0 flex-1">
                    <span className="sr-only">Step {s.n}: </span>
                    <span className="text-foreground">
                      <Spans spans={s.spans} from={at(s.n)} onLink={onLink} />
                    </span>
                    {s.figure && <Figure figure={s.figure} picture={picture} fetchImage={fetchImage} onZoom={onZoom} />}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        );
      })}
    </div>
  );
}
