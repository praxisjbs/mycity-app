/**
 * @component BarChart
 * @group Charts
 * @summary Figures side by side as bars, or each bar as its parts stacked: headcount by department, claims by month, budgets by department.
 * @use Comparing a handful of categories, or each day of a month, where each figure matters as much as the shape. Stacked parts where what each bar is made of matters too (Spent, Committed, Remaining).
 * @avoid A run of days where only the shape matters (use AreaChart); shares of one whole (use DonutChart); a labelled list with its own values (use Bars); a negative part (name it as a part of its own, Over Budget); more than six parts.
 * @phone No caption. Up to 12 bars every label shows and a narrow card scrolls the drawing inside it; past 12 (a month of days) labels that would touch are left off, never the first or the last. A stacked chart's key wraps under the title. The page never scrolls sideways.
 * @a11y The drawing is hidden from screen readers and the frame reads every bar as a label and a figure instead; a stacked bar as its label, each part's name and figure, then its total.
 * @status stable
 * @example <BarChart title="Claims by Month" bars={months} caption="Approved claims only" />
 * @example <BarChart title="Budget by Department" parts={["Spent", "Committed", "Remaining"]} bars={[{ label: "Finance", value: 2500000, parts: [1250000, 400000, 850000] }]} />
 */
import { Suspense, type ReactNode } from "react";
import { cn } from "../lib/cn";
import { Skeleton } from "../display/Skeleton";
import { ChartFrame } from "./ChartFrame";
import { CHART_HEIGHT, lazyDraw, SERIES, type Series } from "./lazy";
import type { BarDrawProps } from "./BarChart.draw";

const Draw = lazyDraw<BarDrawProps>(() => import("./BarChart.draw"));

/** One bar. */
export interface BarChartBar {
  /** Its name under the bar, short enough to read (Jan, Finance, 14/10). Past 12 bars one that would touch its neighbour is left off the drawing, never off the read-out list. */
  label: string;
  /** Its figure; for a stacked bar, the total of its parts. */
  value: number;
  /** Its own series, when one bar should stand apart from the rest. */
  series?: Series;
  /** Its parts' figures, one for each name in the chart's `parts` and in their order, stacked bottom to top. A missing or negative part counts as 0. */
  parts?: number[];
}

export interface BarChartProps {
  /** The bars, left to right. */
  bars: BarChartBar[];
  /** The names of the stacked parts, bottom to top, at most 6 (Spent, Committed, Remaining): each bar is drawn as its parts in series 1 to 6, with a key of these names under the title. `series` and `colourPerBar` do nothing then. */
  parts?: string[];
  /** The chart's title, Title Case, at most 4 words. */
  title?: ReactNode;
  /** Support text behind the title, at most 35 words. */
  help?: ReactNode;
  /** What sits at the right of the title row (a period filter). */
  actions?: ReactNode;
  /** The line under the chart, at most 8 words, desktop only. */
  caption?: ReactNode;
  /** The drawing's accessible name, when there is no title or the title is not words. */
  label?: string;
  /** The series every bar takes unless it names its own; 1 unless set. */
  series?: Series;
  /** A colour per bar, for categories that are not one measure (departments, stages). */
  colourPerBar?: boolean;
  /** Formats a figure for the screen reader's list; the figure itself unless set. */
  format?: (value: number) => string;
  /** Layout classes only (spacing). */
  className?: string;
}

/** The most parts a bar stacks: one for each chart series. */
const MOST_PARTS = SERIES.length;

/** The swatch beside a part's name in the key: its series' fill, as a token class. */
const SWATCH: Record<Series, string> = {
  1: "bg-chart-1",
  2: "bg-chart-2",
  3: "bg-chart-3",
  4: "bg-chart-4",
  5: "bg-chart-5",
  6: "bg-chart-6",
};

/** A part as drawn and read: a missing, negative or broken figure counts as 0. */
const partOf = (v: number | undefined) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);

export function BarChart({ bars, parts, title, help, actions, caption, label, series = 1, colourPerBar, format, className }: BarChartProps) {
  const show = format ?? String;
  const names = (parts ?? []).slice(0, MOST_PARTS);
  const stacked = names.length > 0;
  // Each bar's parts lined up with the names, so the drawing and the read-out see the same figures.
  const drawn = stacked ? bars.map((b) => ({ ...b, parts: names.map((_, k) => partOf(b.parts?.[k])) })) : bars;
  const values = stacked
    ? drawn.map((b) => ({ label: b.label, value: [...names.map((name, k) => `${name} ${show(b.parts?.[k] ?? 0)}`), `Total ${show(b.value)}`].join(", ") }))
    : bars.map((b) => ({ label: b.label, value: show(b.value) }));

  return (
    <ChartFrame title={title} help={help} actions={actions} caption={caption} label={label} values={values} scrolls className={className}>
      {stacked && (
        <ul className="mb-2 flex list-none flex-wrap items-center gap-x-3 gap-y-1 p-0 text-xs">
          {names.map((name, k) => (
            <li key={k} className="flex items-center gap-1.5">
              <span className={cn("size-2 flex-none rounded-full", SWATCH[SERIES[k] ?? 1])} aria-hidden="true" />
              <span className="text-muted-foreground">{name}</span>
            </li>
          ))}
        </ul>
      )}
      <Suspense fallback={<Skeleton shape="block" className={CHART_HEIGHT} />}>
        <Draw bars={drawn} series={series} perBar={Boolean(colourPerBar)} parts={names} />
      </Suspense>
    </ChartFrame>
  );
}
