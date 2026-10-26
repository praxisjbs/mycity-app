/**
 * @component GuideResults
 * @group Documents
 * @summary The User Guide's search results, each a section or task with the line that answers marked, and its short answer with numbered sources.
 * @use The Knowledge Hub's User Guide while a search is typed: the results the API ranked (GuideResults) and, once asked, the answer written from them (GuideAnswerCard).
 * @avoid A list of records (DataView); ⌘K's own results (CommandPalette); a match in text a person wrote (LinkText).
 * @phone The same list: each result is a full width row at least 44 px tall, its step a pill under the title; the answer's sources are full width rows below it.
 * @a11y Results are an ordered list of buttons named by their titles, the marked words a mark element; the answer is a live region, each source a button naming its number and title.
 * @status beta
 * @exports GuideAnswerCard
 * @example <GuideResults hits={page.data} onOpen={open} label="Guide Results" />
 */
import { cn } from "../lib/cn";
import { Icon } from "../icons/Icon";
import { Pill } from "../display/Pill";
import { Skeleton } from "../display/Skeleton";

/** A run of a result's line; `hit` marks a word the search found. */
export interface GuideSnippetRun {
  text: string;
  hit: boolean;
}

/** One section or task that answers a search, in the wire shape (packages/contract user_guide GuideHit). */
export interface GuideHitView {
  anchor: string;
  kind: "section" | "task";
  chapter_title: string;
  section_title: string;
  title: string;
  step: number | null;
  snippet: GuideSnippetRun[];
}

/** An answer written from the results: its sentences, each citing sources numbered from 1. */
export interface GuideAnswerView {
  found: boolean;
  sentences: Array<{ text: string; sources: number[] }>;
  sources: GuideHitView[];
}

export interface GuideResultsProps {
  /** The results, best first, as the API sent them. */
  hits: GuideHitView[];
  /** Opens a result: the guide at its section or task, at its step. */
  onOpen: (hit: GuideHitView) => void;
  /** Names the list for assistive technology. */
  label?: string;
  /** Layout classes only (spacing). */
  className?: string;
}

/** Where a result sits: its chapter, and for a task its section. */
const placeOf = (h: GuideHitView) => (h.kind === "task" ? `${h.chapter_title} › ${h.section_title}` : h.chapter_title);

function Snippet({ runs }: { runs: GuideSnippetRun[] }) {
  return (
    <span className="text-sm text-muted-foreground">
      {runs.map((r, i) =>
        r.hit ? (
          <mark key={i} className="rounded-ctl bg-accent text-foreground">
            {r.text}
          </mark>
        ) : (
          <span key={i}>{r.text}</span>
        ),
      )}
    </span>
  );
}

/** The User Guide's results: each opens the guide at its section or task, at the step that answers. */
export function GuideResults({ hits, onOpen, label = "Guide Results", className }: GuideResultsProps) {
  return (
    <ol aria-label={label} data-copy="content" className={cn("m-0 flex list-none flex-col gap-2 p-0", className)}>
      {hits.map((h) => (
        <li key={h.anchor}>
          <button
            type="button"
            onClick={() => onOpen(h)}
            className="flex w-full min-w-0 items-start gap-2.5 rounded-card border border-border bg-card px-3.5 py-3 text-left text-card-foreground hover:bg-muted phone:min-h-tap"
          >
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="flex min-w-0 flex-wrap items-center gap-2">
                <b className="text-sm font-semibold wrap-any">{h.title}</b>
                {h.step != null && <Pill tone="info">{`Step ${h.step}`}</Pill>}
              </span>
              <span className="text-2xs text-subtle-foreground">{placeOf(h)}</span>
              {h.snippet.length > 0 && <Snippet runs={h.snippet} />}
            </span>
            <Icon name="right" size="s" aria-hidden className="mt-0.5 flex-none text-subtle-foreground" />
          </button>
        </li>
      ))}
    </ol>
  );
}

export interface GuideAnswerCardProps {
  /** The answer once written; null while it is being written. */
  answer: GuideAnswerView | null;
  /** Opens one of its sources, as a result does. */
  onOpen: (hit: GuideHitView) => void;
  /** Layout classes only (spacing). */
  className?: string;
}

/** The short answer written from the results, each sentence followed by the numbers of its sources. */
export function GuideAnswerCard({ answer, onOpen, className }: GuideAnswerCardProps) {
  return (
    <section aria-label="Answer" aria-live="polite" aria-busy={answer === null} className={cn("rounded-card border border-border bg-card p-3.5 text-card-foreground shadow-1", className)}>
      <h2 data-ui="title" className="mb-2 flex items-center gap-2 text-base font-strong">
        <Icon name="spark" size="s" aria-hidden className="text-accent-foreground" />
        Answer
      </h2>
      {answer === null ? (
        <Skeleton lines={3} label="Writing the answer" />
      ) : !answer.found ? (
        <p className="text-sm text-muted-foreground">The guide has no answer to that. The results below may help.</p>
      ) : (
        <div data-copy="content" className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            {answer.sentences.map((s, i) => (
              <p key={i} className="text-sm text-foreground">
                {s.text}
                {s.sources.map((n) => (
                  <sup key={n} className="ml-0.5 font-semibold text-accent-foreground">
                    {n}
                  </sup>
                ))}
              </p>
            ))}
          </div>
          <ol aria-label="Sources" className="m-0 flex list-none flex-col gap-1 border-t border-border p-0 pt-2">
            {answer.sources.map((h, i) =>
              answer.sentences.some((s) => s.sources.includes(i + 1)) ? (
                <li key={h.anchor}>
                  <button
                    type="button"
                    onClick={() => onOpen(h)}
                    aria-label={`Source ${i + 1}: ${h.title}, ${placeOf(h)}`}
                    className="flex w-full min-w-0 items-center gap-2 rounded-ctl px-1 py-1 text-left hover:bg-muted phone:min-h-tap"
                  >
                    <span aria-hidden className="flex size-5 flex-none items-center justify-center rounded-full bg-primary text-2xs font-strong text-primary-foreground">
                      {i + 1}
                    </span>
                    <span className="min-w-0 flex-1 text-sm font-semibold wrap-any">{h.title}</span>
                    <span className="hidden text-2xs text-subtle-foreground desk:inline">{placeOf(h)}</span>
                  </button>
                </li>
              ) : null,
            )}
          </ol>
        </div>
      )}
    </section>
  );
}
