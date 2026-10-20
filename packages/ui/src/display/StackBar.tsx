/**
 * @component StackBar
 * @group Display
 * @summary A whole split into named parts on one bar, with a key under it: memory by service, the disk by what fills it.
 * @use Showing how a capacity is shared out, in real units, where the parts and what is left matter more than a trend.
 * @avoid One share of a whole (use Meter); parts over time (use TrendChart); more than seven parts (group the small ones as Other first).
 * @phone The key wraps under the bar; nothing scrolls sideways.
 * @a11y The bar is drawn for the eye only; the key is a list read in order, each part's name and figure, then what is left. Pass `label` to name the whole.
 * @status beta
 * @example <StackBar label="Memory" total={18432} parts={[{ key: "production", label: "Production", value: 1900, figure: "1.9 GB" }]} rest={{ label: "Free", figure: "3.5 GB" }} />
 */
import type { CSSProperties } from "react";
import { cn } from "../lib/cn";
import type { Series } from "../charts/lazy";

/** One part of the whole. */
export interface StackBarPart {
  /** Its own key. */
  key: string;
  /** Its name in the key, Title Case (Production, Backups). */
  label: string;
  /** Its size in the whole's units (MB, a percent). */
  value: number;
  /** Its size as a person reads it (1.9 GB, 12%). */
  figure: string;
  /** Its colour: one of the six chart series, or muted for something that is not a problem (cache). The next series unless set. */
  series?: Series | "muted";
}

export interface StackBarProps {
  /** The parts, in the order they are drawn, left to right. */
  parts: StackBarPart[];
  /** The whole, in the parts' units. What the parts leave of it is drawn as the empty track. */
  total: number;
  /** The name and figure of what the parts leave (Free 3.5 GB); left out of the key when unset. */
  rest?: { label: string; figure: string };
  /** The whole's name for assistive technology (Memory, Disk). */
  label: string;
  /** Draw the key under the bar (on unless false). */
  legend?: boolean;
  /** Layout classes only (spacing, width); the look is the component's own. */
  className?: string;
}

const FILL: Record<Series | "muted", string> = {
  1: "bg-chart-1",
  2: "bg-chart-2",
  3: "bg-chart-3",
  4: "bg-chart-4",
  5: "bg-chart-5",
  6: "bg-chart-6",
  muted: "bg-input",
};

const clamp = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0);

/** The one runtime value a part needs: its width, as a CSS variable the width class reads. */
const fill = (pct: number) => ({ "--fill": `${clamp(pct)}%` }) as CSSProperties;

export function StackBar({ parts, total, rest, label, legend = true, className }: StackBarProps) {
  const whole = total > 0 ? total : 1;
  let next = 0;
  const drawn = parts.map((p) => {
    const series = p.series ?? ((next++ % 6) + 1) as Series;
    return { ...p, series, pct: (p.value * 100) / whole };
  });
  return (
    <div className={cn("min-w-0", className)}>
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
        {drawn.map((p) =>
          p.pct > 0 ? (
            <span key={p.key} className={cn("block h-full w-(--fill) flex-none border-r-2 border-card last:border-r-0", FILL[p.series])} style={fill(p.pct)} />
          ) : null,
        )}
      </div>
      <ul aria-label={label} className={cn("mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs", !legend && "sr-only")}>
        {drawn.map((p) => (
          <li key={p.key} className="flex items-center gap-1.5">
            <span className={cn("size-2 flex-none rounded-full", FILL[p.series])} aria-hidden="true" />
            <span className="text-muted-foreground">{p.label}</span>
            <span className="font-medium tabular-nums">{p.figure}</span>
          </li>
        ))}
        {rest && (
          <li className="flex items-center gap-1.5">
            <span className="size-2 flex-none rounded-full border border-border bg-muted" aria-hidden="true" />
            <span className="text-muted-foreground">{rest.label}</span>
            <span className="font-medium tabular-nums">{rest.figure}</span>
          </li>
        )}
      </ul>
    </div>
  );
}
