/**
 * @component ShareBar
 * @group Display
 * @summary The share of a total, drawn behind a row of text rather than beside it.
 * @use A poll option's votes behind its words, a tally where the bar must not take a column of its own.
 * @avoid A measure a person reads a figure off (use Meter); progress through work under way (use ProgressBar); a bar that hides the text over it.
 * @phone The same bar; the row over it keeps its 44 px, so the share never changes what can be tapped.
 * @a11y Decorative: the figure it shows is in the words over it, and the row itself says whether it is chosen.
 * @status stable
 * @example <ShareBar percent={62} />
 */
import type { CSSProperties } from "react";
import { cn } from "../lib/cn";

const clamp = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0);

export interface ShareBarProps {
  /** The share, 0 to 100 (held inside that range). */
  percent: number;
  /** Layout classes only (the tint, where a screen wants another). */
  className?: string;
}

/** The row around it must be `relative` and `overflow-hidden`; the bar fills its left edge. */
export function ShareBar({ percent, className }: ShareBarProps) {
  return (
    <i
      aria-hidden="true"
      /* The one runtime value is the width, as a CSS variable the class reads. */
      style={{ "--share": `${clamp(percent)}%` } as CSSProperties}
      className={cn("absolute inset-y-0 left-0 w-(--share) bg-accent", className)}
    />
  );
}
