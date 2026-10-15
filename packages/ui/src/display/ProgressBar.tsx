/**
 * @component ProgressBar
 * @group Display
 * @summary How far along something is: a bar with its percent, or a moving bar when the end is unknown; Meter is the thin inline bar with its figure (the merged Mini).
 * @use ProgressBar for work under way (an import, an upload, onboarding steps); Meter for a measure against a whole in a row or a card (leave used, a target met).
 * @avoid A chart of several values (use the chart components); a status (use Pill); colour as the only sign of good or bad (say it in the figure).
 * @phone Full width; the figure stays on the same line.
 * @a11y ProgressBar is a progressbar with its value (or busy, with no value, while indeterminate); Meter is a meter. Both need a name: the visible label, or the name prop. Under reduced motion the indeterminate bar does not move.
 * @status stable
 * @exports Meter
 * @example <ProgressBar label="Importing Employees" value={64} />
 * @example <ProgressBar label="Preparing Payslips" />
 * @example <Meter pct={40} label="8 of 20" name="Annual Leave Used" />
 */
import { useId, type CSSProperties, type ReactNode } from "react";
import { cn } from "../lib/cn";

/** The fill colours: primary (the default), the statuses, or a chart series (chart-1 to chart-4). */
export type BarTone = "primary" | "ok" | "warn" | "err" | "info" | "neutral" | "chart-1" | "chart-2" | "chart-3" | "chart-4";

const FILL: Record<BarTone, string> = {
  primary: "bg-primary",
  ok: "bg-success",
  warn: "bg-warning",
  err: "bg-destructive",
  info: "bg-info",
  neutral: "bg-input",
  "chart-1": "bg-chart-1",
  "chart-2": "bg-chart-2",
  "chart-3": "bg-chart-3",
  "chart-4": "bg-chart-4",
};

const clamp = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0);

/** The one runtime value a bar needs: its width, as a CSS variable the width class reads. */
const fill = (pct: number) => ({ "--fill": `${clamp(pct)}%` }) as CSSProperties;

export interface ProgressBarProps {
  /** How far along, from 0 to max; leave unset while the end is unknown (indeterminate). */
  value?: number;
  /** The whole; 100 unless set. */
  max?: number;
  /** The visible label above the bar, Title Case (Importing Employees); also its accessible name. */
  label?: ReactNode;
  /** The accessible name when there is no visible label. */
  name?: string;
  /** Show the percent at the right of the label (on unless false). */
  showValue?: boolean;
  /** The fill colour; primary unless set. */
  tone?: BarTone;
  /** Layout classes only (spacing, width). */
  className?: string;
}

export function ProgressBar({ value, max = 100, label, name, showValue = true, tone = "primary", className }: ProgressBarProps) {
  const known = value != null && Number.isFinite(value);
  const pct = known ? clamp((value / (max || 1)) * 100) : 0;
  const text = `${Math.round(pct)}%`;
  const id = useId();
  const labelId = label != null ? `${id}-label` : undefined;
  return (
    <div className={cn("min-w-0", className)}>
      {(label != null || (known && showValue)) && (
        <div className="mb-1.5 flex items-baseline justify-between gap-3 text-sm">
          {label != null && (
            <span id={labelId} className="min-w-0 truncate font-medium">
              {label}
            </span>
          )}
          {known && showValue && (
            <span aria-hidden="true" className="ml-auto flex-none text-xs text-muted-foreground tabular-nums">
              {text}
            </span>
          )}
        </div>
      )}
      <div
        role="progressbar"
        aria-label={name ?? (typeof label === "string" ? label : undefined)}
        aria-labelledby={name || typeof label === "string" ? undefined : labelId}
        aria-valuemin={known ? 0 : undefined}
        aria-valuemax={known ? 100 : undefined}
        aria-valuenow={known ? Math.round(pct) : undefined}
        aria-valuetext={known ? text : undefined}
        aria-busy={known ? undefined : true}
        data-state={known ? "determinate" : "indeterminate"}
        className="h-2 w-full overflow-hidden rounded-full bg-muted"
      >
        {known ? (
          <span className={cn("block h-full w-(--fill) rounded-full transition-all duration-(--dur) ease-out", FILL[tone])} style={fill(pct)} />
        ) : (
          <span className={cn("block h-full w-full animate-pulse rounded-full opacity-60", FILL[tone])} />
        )}
      </div>
    </div>
  );
}

/** A merged colour string ("var(--chart-2)") to the tone it names; unknown values fall back to chart-1. */
function toneOfColor(color: string): BarTone {
  const m = /--([a-z0-9-]+)/.exec(color);
  const name = m?.[1];
  if (name && name in FILL) return name as BarTone;
  if (name === "input") return "neutral";
  return "chart-1";
}

export interface MeterProps {
  /** The measure as a percent of the whole, 0 to 100 (clamped). */
  pct: number;
  /** The figure at the right (8 of 20, 40%); may be empty. */
  label?: ReactNode;
  /** What is measured, its accessible name (Annual Leave Used); the label or the percent is used when unset. */
  name?: string;
  /** The fill colour; chart-1 unless set. */
  tone?: BarTone;
  /** The merged colour, a token variable ("var(--chart-2)"); mapped to its tone. Prefer tone. */
  color?: string;
  /** Layout classes only (spacing, width). */
  className?: string;
}

/** The thin inline bar with its figure: table cells, leave balances, targets. */
export function Meter({ pct, label, name, tone, color, className }: MeterProps) {
  const p = clamp(pct);
  const t = tone ?? (color ? toneOfColor(color) : "chart-1");
  const hasLabel = label != null && label !== "";
  return (
    <span className={cn("flex min-w-0 items-center gap-2", className)}>
      <span
        role="meter"
        aria-label={name ?? (typeof label === "string" && label ? label : `${Math.round(p)}%`)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(p)}
        className="h-1.5 min-w-11 flex-1 overflow-hidden rounded-full bg-muted"
      >
        <span className={cn("block h-full w-(--fill) rounded-full", FILL[t])} style={fill(p)} />
      </span>
      {hasLabel && <span className="w-12 flex-none text-right text-xs text-muted-foreground tabular-nums">{label}</span>}
    </span>
  );
}
