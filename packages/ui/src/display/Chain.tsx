/**
 * @component Chain
 * @group Display
 * @summary An approval route: the steps already done, the one in hand, and what is still to come.
 * @use Above a record that waits on people (an expense claim, a leave request, a requisition, an offer).
 * @avoid What has already happened with dates (use Timeline); a progress figure (use ProgressBar or Meter); more than six steps.
 * @phone The steps wrap onto as many lines as they need; the arrows stay between them, never a sideways scroll.
 * @a11y An ordered list whose current step says so in words, so the state is never the colour of a pill alone.
 * @status stable
 * @example <Chain steps={[{ label: "Submitted", state: "done" }, { label: "Line Manager", state: "now" }, { label: "Finance" }]} />
 */
import { cn } from "../lib/cn";
import { content } from "../lib/slots";
import { Icon } from "../icons/Icon";

/** One step of the route. */
export interface ChainStep {
  /** Who or what the step is, Title Case, at most 3 words. */
  label: string;
  /** `done` is behind us, `now` is where it waits; unset is still to come. */
  state?: "done" | "now";
}

export interface ChainProps {
  /** The steps, first to last. */
  steps: ChainStep[];
  /** Names the route for screen readers; "Approval route" unless set. */
  label?: string;
  /** Layout classes only (spacing). */
  className?: string;
}

const STATE = {
  done: "border-transparent bg-success-soft text-success",
  now: "border-transparent bg-primary text-primary-foreground",
} as const;

export function Chain({ steps, label = "Approval route", className }: ChainProps) {
  return (
    <ol {...content} aria-label={label} className={cn("m-0 flex list-none flex-wrap items-center gap-y-1.5 p-0", className)}>
      {steps.map((step, i) => (
        <li key={step.label} className="flex items-center">
          {i > 0 && (
            <span aria-hidden="true" className="flex flex-none px-1 text-subtle-foreground">
              <Icon name="right" size="s" />
            </span>
          )}
          <span
            className={cn(
              "flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold",
              step.state ? STATE[step.state] : "border-border bg-muted text-subtle-foreground",
            )}
          >
            {step.state === "done" && <Icon name="ok" size="s" />}
            {step.label}
            {step.state === "now" && <span className="sr-only">, waiting here</span>}
            {step.state === "done" && <span className="sr-only">, done</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}
