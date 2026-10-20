/**
 * @component TrendChart
 * @group Charts
 * @summary One to three figures over time on one scale, with an optional target line, gaps where nothing was recorded, and a readout that follows the pointer.
 * @use Behaviour over a window where the shape and the target both matter: response time against its target, the processor's busy and steal, data in and out.
 * @avoid A single figure where the target does not matter (use AreaChart); figures in different units on one scale (draw two charts); categories (use BarChart).
 * @phone No caption; a feature guide's §10 usually leaves trends off a phone, and the drawing never scrolls the page sideways.
 * @a11y The drawing is hidden from screen readers; the frame reads every point with each series' figure, and the key names each series and its latest figure.
 * @status beta
 * @example <TrendChart title="Response Time" labels={times} lines={[{ name: "p95", values: p95 }]} target={{ value: 800, label: "Target 800 ms" }} format={(v) => `${v} ms`} />
 */
import { Suspense, useState, type ReactNode } from "react";
import { cn } from "../lib/cn";
import { Skeleton } from "../display/Skeleton";
import { EmptyValue } from "../display/EmptyValue";
import { ChartFrame } from "./ChartFrame";
import { CHART_HEIGHT, lazyDraw, type Series } from "./lazy";
import type { TrendDrawProps } from "./TrendChart.draw";

const Draw = lazyDraw<TrendDrawProps>(() => import("./TrendChart.draw"));

/** One line of the chart. */
export interface TrendLine {
  /** Its name in the key, Title Case or a short code (p95, Mean, Busy). */
  name: string;
  /** One figure per label; null where nothing was recorded, drawn as a gap. */
  values: (number | null)[];
  /** Which of the six series to draw it in; the next one unless set. */
  series?: Series;
}

export interface TrendChartProps {
  /** What each point is, in order (a time, a day): the readout and the screen reader's list. */
  labels: string[];
  /** The shorter form under the chart, at its start, middle and end (14:00, Mon 19); the labels unless set. */
  ticks?: string[];
  /** One to three lines, in the same units. */
  lines: TrendLine[];
  /** A dashed line across, and its name in the key (Target 800 ms). */
  target?: { value: number; label: string };
  /** The top of the scale (100 for a share); the highest figure or the target, rounded up, unless set. */
  max?: number;
  /** Formats a figure for the scale, the readout and the screen reader (412 ms, 23%). */
  format?: (value: number) => string;
  /** The chart's title, Title Case, at most 4 words. */
  title?: ReactNode;
  /** Support text behind the title, at most 35 words. */
  help?: ReactNode;
  /** What sits at the right of the title row. */
  actions?: ReactNode;
  /** The line under the chart, at most 8 words, desktop only. */
  caption?: ReactNode;
  /** The drawing's accessible name, when there is no title or the title is not words. */
  label?: string;
  /** Layout classes only (spacing). */
  className?: string;
}

const SWATCH: Record<Series, string> = {
  1: "bg-chart-1",
  2: "bg-chart-2",
  3: "bg-chart-3",
  4: "bg-chart-4",
  5: "bg-chart-5",
  6: "bg-chart-6",
};

/** A top for the scale a person can read: 1, 2 or 5 times a power of ten, at or above the highest figure. */
function niceTop(n: number) {
  if (!(n > 0)) return 1;
  const power = 10 ** Math.floor(Math.log10(n));
  for (const step of [1, 2, 2.5, 5, 10]) if (step * power >= n) return step * power;
  return 10 * power;
}

/** The last figure a line recorded, for the key while the pointer is elsewhere. */
const lastOf = (values: (number | null)[]) => {
  for (let i = values.length - 1; i >= 0; i -= 1) if (values[i] !== null && Number.isFinite(values[i])) return i;
  return null;
};

export function TrendChart({ labels, ticks, lines, target, max, format = String, title, help, actions, caption, label, className }: TrendChartProps) {
  const [at, setAt] = useState<number | null>(null);
  const drawn = lines.slice(0, 3).map((l, i) => ({ ...l, series: l.series ?? ((i + 1) as Series) }));
  const figures = drawn.flatMap((l) => l.values.filter((v): v is number => v !== null && Number.isFinite(v)));
  const top = max ?? niceTop(Math.max(0, ...figures, target ? target.value : 0));
  const short = ticks ?? labels;
  const count = labels.length;
  const shown = at ?? Math.max(-1, ...drawn.map((l) => lastOf(l.values) ?? -1));
  const marks = count > 2 ? [0, Math.floor((count - 1) / 2), count - 1] : count === 2 ? [0, 1] : count === 1 ? [0] : [];

  return (
    <ChartFrame
      title={title}
      help={help}
      actions={actions}
      caption={caption}
      label={label}
      className={className}
      values={labels.map((l, i) => ({
        label: l,
        value: drawn.map((d) => `${d.name} ${d.values[i] === null || d.values[i] === undefined ? "not recorded" : format(d.values[i] as number)}`).join(", "),
      }))}
    >
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        {shown >= 0 && <span className="font-medium tabular-nums text-muted-foreground">{labels[shown]}</span>}
        {drawn.map((l) => {
          const v = shown >= 0 ? l.values[shown] : null;
          return (
            <span key={l.name} className="flex items-center gap-1.5">
              <span className={cn("size-2 flex-none rounded-full", SWATCH[l.series])} aria-hidden="true" />
              <span className="text-muted-foreground">{l.name}</span>
              <span className="font-medium tabular-nums">{v === null || v === undefined ? <EmptyValue label="Not recorded" /> : format(v)}</span>
            </span>
          );
        })}
        {target && (
          <span className="flex items-center gap-1.5">
            <span className="h-0 w-3 flex-none border-t-2 border-dashed border-destructive" aria-hidden="true" />
            <span className="text-muted-foreground">{target.label}</span>
          </span>
        )}
      </div>
      <div className="flex gap-2">
        <div className={cn("flex w-12 flex-none flex-col justify-between text-right text-2xs text-subtle-foreground tabular-nums", CHART_HEIGHT)} aria-hidden="true">
          <span>{format(top)}</span>
          <span>{format(top / 2)}</span>
          <span>{format(0)}</span>
        </div>
        <div className="min-w-0 flex-1">
          <Suspense fallback={<Skeleton shape="block" className={CHART_HEIGHT} />}>
            <Draw lines={drawn.map((l) => ({ values: l.values, series: l.series }))} count={count} top={top} target={target?.value} at={at} onAt={setAt} />
          </Suspense>
          <div className="mt-1 flex justify-between text-2xs text-subtle-foreground tabular-nums" aria-hidden="true">
            {marks.map((i) => (
              <span key={i}>{short[i]}</span>
            ))}
          </div>
        </div>
      </div>
    </ChartFrame>
  );
}
