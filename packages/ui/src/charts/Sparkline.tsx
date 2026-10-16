/**
 * @component Sparkline
 * @group Charts
 * @summary A bare trend line with no axes, for inside a table cell or beside a figure.
 * @use A KPI's own short trend, a per-row trend in a wide table, a goal's progress over its quarter.
 * @avoid Anywhere a person has to read a figure off it (use AreaChart); fewer than three points; a caption or a title.
 * @phone The same line, sized by the card it sits in; it carries no text of its own.
 * @a11y One image named by what it trends, with its first and last figure in the name, so the direction is readable.
 * @status stable
 * @example <Sparkline label="Attendance" values={[18, 21, 22, 20, 24]} />
 */
import { Suspense } from "react";
import { cn } from "../lib/cn";
import { Skeleton } from "../display/Skeleton";
import { lazyDraw, type Series } from "./lazy";
import type { SparkDrawProps } from "./Sparkline.draw";

const Draw = lazyDraw<SparkDrawProps>(() => import("./Sparkline.draw"));

export interface SparklineProps {
  /** The figures, in order; at least two. */
  values: number[];
  /** What it trends, Title Case, at most 3 words: its accessible name. */
  label: string;
  /** Which of the six series to draw it in; 1 unless set. */
  series?: Series;
  /** Layout classes only (width). */
  className?: string;
}

export function Sparkline({ values, label, series = 1, className }: SparklineProps) {
  if (values.length < 2) return null;
  const first = values[0];
  const last = values[values.length - 1];
  return (
    <span role="img" aria-label={`${label}, ${first} to ${last}`} className={cn("block w-24", className)}>
      <Suspense fallback={<Skeleton shape="block" className="h-7" />}>
        <Draw values={values} series={series} />
      </Suspense>
    </span>
  );
}
