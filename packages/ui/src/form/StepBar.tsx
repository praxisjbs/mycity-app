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

export interface StepBarProps {
  /** The steps' titles in order, Title Case, at most 4 words each. */
  steps: readonly string[];
  /** The step in hand, counted from 0. */
  at: number;
  /** Also name the step in hand after its number ("Step 2 of 4 · Access"). Off inside Wizard, which shows the title as its heading. */
  titled?: boolean;
  /** A column of the steps by name, each in a numbered circle (yellow for the one in hand, green once done), for the aside beside the form (PublicPage layout split `steps`: Apply, Sign Offer). */
  vertical?: boolean;
  /** vertical: every step done (the application sent, the offer signed). */
  complete?: boolean;
  /** Hides the bar from assistive technology, when another bar on the screen already names the steps (the Wizard's own). */
  decorative?: boolean;
  /** Layout classes only (spacing). */
  className?: string;
}

export function StepBar({ steps, at, titled = false, vertical = false, complete = false, decorative = false, className }: StepBarProps) {
  if (steps.length === 0) return null;
  const here = Math.min(Math.max(Math.trunc(at) || 0, 0), steps.length - 1);
  if (vertical)
    return (
      <ol className={cn("flex list-none flex-col p-0", className)} {...(decorative ? { "aria-hidden": true } : { "aria-label": "Steps" })}>
        {steps.map((title, i) => {
          const done = complete || i < here;
          const now = !complete && i === here;
          return (
            <li
              key={`${i}:${title}`}
              aria-current={now ? "step" : undefined}
              data-step={done ? "done" : now ? "on" : undefined}
              className={cn("relative flex min-h-11.5 items-center gap-3 text-md transition-colors duration-300", now ? "font-semibold text-foreground" : "text-muted-foreground")}
            >
              {i < steps.length - 1 && <span aria-hidden="true" className="absolute top-9 left-3.75 h-5 w-0.5 bg-canvas-line-strong" />}
              <b
                className={cn(
                  "grid size-8 flex-none place-items-center rounded-full border-2 text-md font-bold transition-all duration-300",
                  done && "border-success bg-success-soft text-success",
                  now && "border-primary bg-primary text-primary-foreground",
                  !done && !now && "border-canvas-line-strong text-muted-foreground",
                )}
              >
                {i + 1}
              </b>
              {done && <span className="sr-only">Done: </span>}
              {title}
            </li>
          );
        })}
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
