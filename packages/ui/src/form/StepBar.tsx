/**
 * @component StepBar
 * @group Forms
 * @summary Where a person is in a few steps: one bar per step, filled up to the step in hand, and Step 2 of 4.
 * @use Above a flow of two to six steps that a screen or sheet drives itself: a role being set up, an import (Upload, Map, Preview, Commit).
 * @avoid A form that owns its steps, with Back and Next (use Wizard, which draws this bar); progress through a count or a total (use ProgressBar).
 * @phone The same bars across the full width and the same line under them; nothing in it is a tap target.
 * @a11y An ordered list named Steps; each bar carries a hidden label naming its step (Step 2 of 4: Access) and the step in hand has aria-current="step". Nothing in it takes focus.
 * @status stable
 * @example <StepBar steps={["Name", "Access", "Details", "Review"]} at={1} />
 * @example <StepBar steps={["Name", "Access", "Details", "Review"]} at={1} titled />
 * @example <StepBar steps={["About You", "CV and Questions", "Why This Role"]} at={1} vertical decorative />
 */
import { cn } from "../lib/cn";
import { Icon } from "../icons/Icon";

export interface StepBarProps {
  /** The steps' titles in order, Title Case, at most 4 words each. */
  steps: readonly string[];
  /** The step in hand, counted from 0. */
  at: number;
  /** Also name the step in hand after its number ("Step 2 of 4 · Access"). Off inside Wizard, which shows the title as its heading. */
  titled?: boolean;
  /** A column of the steps by name, each with its number or a tick, for a pane beside the form (the public site's Apply). */
  vertical?: boolean;
  /** Hides the bar from assistive technology, when another bar on the screen already names the steps (the Wizard's own). */
  decorative?: boolean;
  /** Layout classes only (spacing). */
  className?: string;
}

export function StepBar({ steps, at, titled = false, vertical = false, decorative = false, className }: StepBarProps) {
  if (steps.length === 0) return null;
  const here = Math.min(Math.max(Math.trunc(at) || 0, 0), steps.length - 1);
  if (vertical)
    return (
      <ol className={cn("flex list-none flex-col p-0", className)} {...(decorative ? { "aria-hidden": true } : { "aria-label": "Steps" })}>
        {steps.map((title, i) => (
          <li key={`${i}:${title}`} aria-current={i === here ? "step" : undefined} className="relative flex items-center gap-3 pb-5 last:pb-0">
            {i < steps.length - 1 && (
              <span aria-hidden="true" className={cn("absolute top-8 bottom-0 left-3.5 w-0.5 -translate-x-1/2 rounded-full transition-colors duration-500", i < here ? "bg-primary" : "bg-border")} />
            )}
            <span
              className={cn(
                "relative flex size-7 flex-none items-center justify-center rounded-full text-xs font-strong transition-colors duration-300",
                i < here && "bg-primary text-primary-foreground",
                i === here && "bg-primary text-primary-foreground ring-4 ring-primary/25",
                i > here && "border border-border text-muted-foreground",
              )}
            >
              {i < here ? <Icon name="ok" /> : i + 1}
            </span>
            <span className={cn("text-sm transition-colors duration-300", i === here ? "font-strong text-foreground" : "text-muted-foreground")}>{title}</span>
          </li>
        ))}
      </ol>
    );

  return (
    <div className={cn(className) || undefined}>
      <ol className="mb-4 flex gap-1.5" aria-label="Steps">
        {steps.map((title, i) => (
          <li key={`${i}:${title}`} aria-current={i === here ? "step" : undefined} className="relative h-1 flex-1 overflow-hidden rounded-full bg-border">
            {/* The bar fills from the left as its step is reached, and empties going back. */}
            <span aria-hidden="true" className={cn("absolute inset-0 origin-left bg-secondary transition-transform duration-500 ease-out", i <= here ? "scale-x-100" : "scale-x-0")} />
            <span className="sr-only">
              Step {i + 1} of {steps.length}: {title}
            </span>
          </li>
        ))}
      </ol>
      <p className="mb-1 text-2xs font-semibold text-subtle-foreground uppercase">
        Step {here + 1} of {steps.length}
        {titled && <> · {steps[here]}</>}
      </p>
    </div>
  );
}
