/**
 * @component Bars
 * @group Display
 * @summary Labelled rows, each a bar and its figure: pipeline stages, a department's spend, progress against a target.
 * @use A handful of named measures a person reads top to bottom, where the label matters as much as the figure.
 * @avoid A figure over time (use AreaChart); comparing one measure across categories (use BarChart); a single measure (use Meter).
 * @phone The same rows, with a narrower label column; the bar keeps its figure beside it.
 * @a11y Each row is a meter with its own name and figure, so the proportion is read rather than guessed from a colour.
 * @status stable
 * @example <Bars rows={[{ label: "Qualified", percent: 64, value: "18 leads" }]} />
 */
import type { CSSProperties, ReactNode } from "react";
import { content, slot } from "../lib/slots";
import type { Series } from "../charts/lazy";
import { seriesInk } from "../charts/lazy";

/** One labelled bar. */
export interface BarsRow {
  /** What it measures, Title Case, at most 4 words. */
  label: string;
  /** How full the bar is, 0 to 100. */
  percent: number;
  /** The figure beside it, already formatted ("18 leads", "₦1.3M", "64%"). */
  value: ReactNode;
  /** Its own series; 1 unless set. */
  series?: Series;
}

export interface BarsProps {
  /** The rows, top to bottom. */
  rows: BarsRow[];
  /** The line under the rows, at most 8 words, desktop only. */
  note?: ReactNode;
  /** Layout classes only (spacing). */
  className?: string;
}

const clamp = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0);

export function Bars({ rows, note, className }: BarsProps) {
  return (
    <div className={className}>
      <ul className="m-0 flex list-none flex-col p-0">
        {rows.map((row) => {
          const percent = clamp(row.percent);
          const fill = { "--bar-fill": `${percent}%`, "--bar-ink": seriesInk(row.series ?? 1) } as CSSProperties;
          return (
            <li key={row.label} {...content} className="flex items-center gap-2.5 py-1.5">
              <span className="w-32 flex-none text-xs font-semibold phone:w-24">{row.label}</span>
              <span
                role="meter"
                aria-label={row.label}
                aria-valuenow={percent}
                aria-valuemin={0}
                aria-valuemax={100}
                style={fill}
                className="h-5 min-w-0 flex-1 overflow-hidden rounded-box bg-muted"
              >
                <span className="block h-full w-(--bar-fill) rounded-box bg-(--bar-ink)" />
              </span>
              <span className="w-20 flex-none text-right text-xs font-strong tabular-nums">{row.value}</span>
            </li>
          );
        })}
      </ul>
      {note != null && (
        <p {...slot("chart-caption")} className="mt-2.5 border-t border-dashed border-border pt-2.5 text-2xs text-subtle-foreground phone:hidden">
          {note}
        </p>
      )}
    </div>
  );
}
