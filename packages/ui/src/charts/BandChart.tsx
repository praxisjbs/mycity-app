/**
 * @component BandChart
 * @group Charts
 * @summary Salary bands: each grade's range on one scale, with its midpoint marked and its figures beside it.
 * @use The salary structure, a grade's range against the band above and below it, a budget envelope per department.
 * @avoid A single figure per row (use Bars); comparing categories (use BarChart); working money out from the positions.
 * @phone The grade and its range stack, with the scale under the name, so nothing is squeezed; no caption.
 * @a11y Each row is a term and its range in words, so the figures are read even though the bars are decorative.
 * @status stable
 * @example <BandChart title="Salary Structure" scale="₦0 to ₦5M" rows={grades} />
 */
import { Suspense, type ReactNode } from "react";
import { Skeleton } from "../display/Skeleton";
import { ChartFrame } from "./ChartFrame";
import { lazyDraw, type Series } from "./lazy";
import type { BandDrawProps } from "./BandChart.draw";

const Draw = lazyDraw<BandDrawProps>(() => import("./BandChart.draw"));

/** One grade's band. */
export interface BandChartRow {
  /** The grade, Title Case, at most 3 words (Grade 4, Manager). */
  label: string;
  /** What sits under the grade, at most 3 words (12 people). */
  sub?: string;
  /** Where the band starts on the scale, 0 to 100. */
  from: number;
  /** Where it ends, 0 to 100. */
  to: number;
  /** Where its midpoint sits, 0 to 100. */
  middle: number;
  /** The range in words, already formatted ("₦1.2M to ₦1.8M"). */
  value: ReactNode;
  /** Its own series; 1 unless set. */
  series?: Series;
}

export interface BandChartProps {
  /** The grades, lowest first. */
  rows: BandChartRow[];
  /** What the scale runs from and to, at the right of the title row ("₦0 to ₦5M"). */
  scale?: string;
  /** The chart's title, Title Case, at most 4 words. */
  title?: ReactNode;
  /** Support text behind the title, at most 35 words. */
  help?: ReactNode;
  /** The line under the chart, at most 8 words, desktop only. */
  caption?: ReactNode;
  /** The drawing's accessible name, when there is no title or the title is not words. */
  label?: string;
  /** Layout classes only (spacing). */
  className?: string;
}

export function BandChart({ rows, scale, title, help, caption, label, className }: BandChartProps) {
  return (
    <ChartFrame
      title={title}
      help={help}
      caption={caption}
      label={label}
      actions={scale && <span className="text-2xs text-subtle-foreground">{scale}</span>}
      values={rows.map((r) => ({ label: r.label, value: typeof r.value === "string" ? r.value : `${r.from}% to ${r.to}%` }))}
      className={className}
    >
      <ul className="flex list-none flex-col gap-2 p-0">
        {rows.map((row) => (
          <li key={row.label} className="flex items-center gap-3 phone:flex-wrap">
            <span className="w-32 flex-none text-sm font-semibold phone:w-full">
              {row.label}
              {row.sub && <em className="block text-2xs font-medium text-subtle-foreground not-italic">{row.sub}</em>}
            </span>
            <span className="min-w-0 flex-1">
              <Suspense fallback={<Skeleton shape="block" className="h-6" />}>
                <Draw from={row.from} to={row.to} middle={row.middle} series={row.series ?? 1} />
              </Suspense>
            </span>
            <span className="w-32 flex-none text-right text-2xs font-semibold text-muted-foreground tabular-nums phone:w-full phone:text-left">{row.value}</span>
          </li>
        ))}
      </ul>
    </ChartFrame>
  );
}
