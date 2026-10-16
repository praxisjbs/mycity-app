/**
 * @component AreaChart
 * @group Charts
 * @summary A figure over time as a filled line: attendance across a month, signed value by week, headcount by quarter.
 * @use One series over a run of days, weeks or months, where the shape matters more than each figure.
 * @avoid Comparing categories (use BarChart); one share of a whole (use DonutChart); a figure inside a table cell (use Sparkline).
 * @phone No caption; the drawing scrolls inside its own card, so the page never scrolls sideways.
 * @a11y The drawing is hidden from screen readers and the frame reads every point as a label and a figure instead.
 * @status stable
 * @example <AreaChart title="Attendance" labels={days} values={present} caption="Dips are Saturdays, a half day" />
 */
import { Suspense, type ReactNode } from "react";
import { Skeleton } from "../display/Skeleton";
import { ChartFrame } from "./ChartFrame";
import { CHART_HEIGHT, lazyDraw, type Series } from "./lazy";
import type { AreaDrawProps } from "./AreaChart.draw";

const Draw = lazyDraw<AreaDrawProps>(() => import("./AreaChart.draw"));

export interface AreaChartProps {
  /** The figures, in order; an empty set draws nothing. */
  values: number[];
  /** What each figure is (a date, a month), in the same order: the screen reader's list and the point's tooltip. */
  labels: string[];
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
  /** Which of the six series to draw it in; 1 unless set. */
  series?: Series;
  /** Drop the grid lines, for a small strip inside a card. */
  bare?: boolean;
  /** Formats a figure for the screen reader's list; the figure itself unless set. */
  format?: (value: number) => string;
  /** Layout classes only (spacing). */
  className?: string;
}

export function AreaChart({ values, labels, title, help, actions, caption, label, series = 1, bare, format, className }: AreaChartProps) {
  return (
    <ChartFrame
      title={title}
      help={help}
      actions={actions}
      caption={caption}
      label={label}
      values={values.map((v, i) => ({ label: labels[i] ?? String(i + 1), value: format ? format(v) : String(v) }))}
      scrolls
      className={className}
    >
      <Suspense fallback={<Skeleton shape="block" className={CHART_HEIGHT} />}>
        <Draw values={values} labels={labels} series={series} grid={!bare} />
      </Suspense>
    </ChartFrame>
  );
}
