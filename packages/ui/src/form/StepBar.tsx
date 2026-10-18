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
 */
import { cn } from "../lib/cn";

export interface StepBarProps {
  /** The steps' titles in order, Title Case, at most 4 words each. */
  steps: readonly string[];
  /** The step in hand, counted from 0. */
  at: number;
  /** Also name the step in hand after its number ("Step 2 of 4 · Access"). Off inside Wizard, which shows the title as its heading. */
  titled?: boolean;
  /** Layout classes only (spacing). */
  className?: string;
}

export function StepBar({ steps, at, titled = false, className }: StepBarProps) {
  if (steps.length === 0) return null;
  const here = Math.min(Math.max(Math.trunc(at) || 0, 0), steps.length - 1);

  return (
    <div className={cn(className) || undefined}>
      <ol className="mb-4 flex gap-1.5" aria-label="Steps">
        {steps.map((title, i) => (
          <li key={`${i}:${title}`} aria-current={i === here ? "step" : undefined} className={cn("h-1 flex-1 rounded-full", i <= here ? "bg-secondary" : "bg-border")}>
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
