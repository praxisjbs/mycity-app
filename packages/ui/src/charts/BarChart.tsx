/**
 * @component BarChart
 * @group Charts
 * @summary Figures side by side as bars: headcount by department, claims by month, interviews by stage.
 * @use Comparing a handful of categories, where each figure matters as much as the shape.
 * @avoid A run of days (use AreaChart); shares of one whole (use DonutChart); a labelled list with its own values (use Bars).
 * @phone No caption; the drawing scrolls inside its own card, so the page never scrolls sideways.
 * @a11y The drawing is hidden from screen readers and the frame reads every bar as a label and a figure instead.
 * @status stable
 * @example <BarChart title="Claims by Month" bars={months} caption="Approved claims only" />
 */
import { Suspense, type ReactNode } from "react";
import { Skeleton } from "../display/Skeleton";
import { ChartFrame } from "./ChartFrame";
import { CHART_HEIGHT, lazyDraw, type Series } from "./lazy";
import type { BarDrawProps } from "./BarChart.draw";

const Draw = lazyDraw<BarDrawProps>(() => import("./BarChart.draw"));

/** One bar. */
export interface BarChartBar {
  /** Its name under the bar, short enough to read (Jan, Finance, Offer). */
  label: string;
  /** Its figure. */
  value: number;
  /** Its own series, when one bar should stand apart from the rest. */
  series?: Series;
}

export interface BarChartProps {
  /** The bars, left to right. */
  bars: BarChartBar[];
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

export function BarChart({ bars, title, help, actions, caption, label, series = 1, colourPerBar, format, className }: BarChartProps) {
  return (
    <ChartFrame
      title={title}
      help={help}
      actions={actions}
      caption={caption}
      label={label}
      values={bars.map((b) => ({ label: b.label, value: format ? format(b.value) : String(b.value) }))}
      scrolls
      className={className}
    >
      <Suspense fallback={<Skeleton shape="block" className={CHART_HEIGHT} />}>
        <Draw bars={bars} series={series} perBar={Boolean(colourPerBar)} />
      </Suspense>
    </ChartFrame>
  );
}
