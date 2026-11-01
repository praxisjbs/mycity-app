/**
 * @component SourcesPane
 * @group Assistant
 * @summary The pane's Sources: every read a question made, in order, with its filters, rows and total, outcome and the fields masked for the person; a read with rows opens in the Table.
 * @use In PaneTabs' sources slot with the answer's reads (AiAnswer.reads), named in words by the screen (docs/guides/praxis-ai.md decision 13).
 * @avoid The citations themselves (From's chips); the Audit Log; a list of the person's questions (History).
 * @phone The same cards, one under the other, inside the pane sheet; Open Table is a 44 px target.
 * @a11y A list of the reads, each a region named by the read; the outcome is a Pill with words, never colour alone.
 * @status beta
 * @example <SourcesPane reads={reads} when="22/10/2026 09:30" onOpenTable={showTable} />
 */
import { cn } from "../lib/cn";
import { formatCount } from "../lib/format";
import { Button } from "../actions/Button";
import { EmptyState } from "../display/EmptyState";
import { KeyValue } from "../display/KeyValue";
import { Pill } from "../display/Pill";
import type { PaneRead } from "./pane";

export interface SourcesPaneProps {
  /** The reads, first to last. */
  reads: PaneRead[];
  /** When the question was answered, day first, as the screen formats it. */
  when?: string | null;
  /** Opens a read's rows in the Table, by its number. */
  onOpenTable?: (n: number) => void;
  /** Layout classes only (spacing). */
  className?: string;
}

const OUTCOME = {
  read: { tone: "ok", word: "Read" },
  refused: { tone: "err", word: "Not Available" },
  invalid: { tone: "warn", word: "Not Run" },
  failed: { tone: "warn", word: "Failed" },
  timed_out: { tone: "warn", word: "Too Much" },
} as const;

/** "25 of 312 rows", "1 record", or nothing for a summary or a read that returned nothing. */
export function rowsText(r: Pick<PaneRead, "kind" | "rows" | "total" | "outcome">): string | null {
  if (r.outcome !== "read") return null;
  if (r.kind === "summary") return r.total != null ? `${formatCount(r.total)} in all` : "figures";
  if (r.total == null) return r.rows === 1 ? "1 record" : `${formatCount(r.rows)} rows`;
  if (r.total <= r.rows) return r.total === 1 ? "1 row" : `${formatCount(r.total)} rows`;
  return `${formatCount(r.rows)} of ${formatCount(r.total)} rows`;
}

export function SourcesPane({ reads, when, onOpenTable, className }: SourcesPaneProps) {
  if (!reads.length) return <EmptyState bare title="No Reads Made" className={className} />;
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {when && <p className="text-xs text-subtle-foreground">Read {when}</p>}
      <ol className="m-0 flex list-none flex-col gap-2.5 p-0">
        {reads.map((r) => {
          const outcome = OUTCOME[r.outcome];
          const rows = rowsText(r);
          const items = [...r.filters.map(([label, value]) => [<span key={label} data-copy="content">{label}</span>, value] as const), ...(r.masked.length ? [["Masked", <span key="masked" data-copy="content">{r.masked.join(", ")}</span>] as const] : [])];
          return (
            <li key={r.n} aria-label={`Read ${r.n}, ${r.name}`} className="rounded-box border border-border bg-card p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-strong">
                  <span className="text-subtle-foreground">{r.n}. </span>
                  <span data-copy="content">{r.name}</span>
                </span>
                <Pill tone={outcome.tone} className="ml-auto">
                  {outcome.word}
                </Pill>
              </div>
              {rows && <p className="mt-1 text-xs text-muted-foreground">{rows}</p>}
              {items.length > 0 && <KeyValue layout="stacked" items={items} className="mt-2" />}
              {r.opens && onOpenTable && (
                <Button size="sm" className="mt-2.5" onClick={() => onOpenTable(r.n)}>
                  Open Table
                </Button>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
