/**
 * @component DonutChart
 * @group Charts
 * @summary A ring: one share of a whole with the figure in its middle, or a few slices that add up to it.
 * @use On time against late and absent, goals met against set, a budget drawn against its total.
 * @avoid More than four slices (use BarChart); a figure over time (use AreaChart); a share nobody compares to a whole.
 * @phone The ring with its lines beneath it rather than beside, so nothing is squeezed; no caption.
 * @a11y The ring is hidden from screen readers and the frame reads the figure and each slice as words.
 * @status stable
 * @example <DonutChart title="On Time" percent={77} middle="77%" under="on time" lines={["37 on time", "4 late", "7 absent"]} />
 * @example <DonutChart title="Goals Met" slices={[{ label: "Met", value: 14 }, { label: "Missed", value: 3 }]} middle="14" under="met" />
 */
import { Suspense, type ReactNode } from "react";
import { Skeleton } from "../display/Skeleton";
import { ChartFrame } from "./ChartFrame";
import { lazyDraw, type Series } from "./lazy";
import type { DonutDrawProps } from "./DonutChart.draw";

const Draw = lazyDraw<DonutDrawProps>(() => import("./DonutChart.draw"));

/** One slice of the ring. */
export interface DonutSlice {
  /** Its name, Title Case, at most 3 words. */
  label: string;
  /** Its figure; the slices are drawn in proportion to their sum. */
  value: number;
  /** Its own series; the next of the six unless set. */
  series?: Series;
}

export interface DonutChartProps {
  /** The figure in the middle, already formatted ("77%", "14", "₦1.3M"). */
  middle: string;
  /** The word under it, lower case, at most 2 words ("on time"). */
  under?: string;
  /** The slices, in order. Pass these or `percent`. */
  slices?: DonutSlice[];
  /** One share of the whole, 0 to 100, when there are no slices to draw. */
  percent?: number;
  /** The lines beside the ring: one figure each, at most 20 words a line. */
  lines?: ReactNode[];
  /** The chart's title, Title Case, at most 4 words. */
  title?: ReactNode;
  /** Support text behind the title, at most 35 words. */
  help?: ReactNode;
  /** What sits at the right of the title row. */
  actions?: ReactNode;
  /** The line under the chart, at most 8 words, desktop only. */
  caption?: ReactNode;
  /** The ring's accessible name, when there is no title; the title and the middle figure otherwise. */
  label?: string;
  /** The ring's series when it draws one share; 1 unless set. */
  series?: Series;
  /** Layout classes only (spacing). */
  className?: string;
}

export function DonutChart({ middle, under = "", slices, percent = 0, lines, title, help, actions, caption, label, series = 1, className }: DonutChartProps) {
  return (
    <ChartFrame
      title={title}
      help={help}
      actions={actions}
      caption={caption}
      label={label ?? (typeof title === "string" ? `${title}, ${middle}` : middle)}
      values={slices ? slices.map((s) => ({ label: s.label, value: String(s.value) })) : [{ label: under || "share", value: `${percent}%` }]}
      className={className}
    >
      <div className="flex flex-wrap items-center gap-4">
        <Suspense fallback={<Skeleton shape="circle" className="size-28" />}>
          <Draw slices={slices ?? []} percent={percent} middle={middle} under={under} series={series} />
        </Suspense>
        {lines && lines.length > 0 && (
          <ul className="flex min-w-0 flex-1 list-none flex-col gap-1 p-0 text-sm text-muted-foreground">
            {lines.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        )}
      </div>
    </ChartFrame>
  );
}
