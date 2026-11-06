/**
 * @component QuestionMap
 * @group Navigation
 * @summary The questions of a sitting as numbered squares: the one in hand in yellow, each answered one in green, a press moving to that question.
 * @use Under an assessment's clock in the split aside, so a candidate sees what is left and can go back to any question.
 * @avoid A form's steps (Wizard draws its own); pages of a list (Pager); more than about twenty questions.
 * @phone The squares wrap onto more rows, each a 44 px target.
 * @a11y A group named by `label` of buttons, each named Question n and saying when it is answered; the one in hand carries aria-current step.
 * @status beta
 * @example <QuestionMap label="Questions" count={3} at={0} answered={[true, false, false]} onPick={go} />
 */
import { cn } from "../lib/cn";

export interface QuestionMapProps {
  /** Names the group (Questions). */
  label: string;
  /** How many questions there are. */
  count: number;
  /** The question in hand, counted from 0. */
  at: number;
  /** Which are answered, by index. */
  answered: ReadonlyArray<boolean>;
  /** Called with the index pressed (the page saves the answer in hand, then moves). */
  onPick: (index: number) => unknown;
  /** Layout classes only (spacing). */
  className?: string;
}

export function QuestionMap({ label, count, at, answered, onPick, className }: QuestionMapProps) {
  return (
    <div role="group" aria-label={label} className={cn("ps-qmap", className)}>
      {Array.from({ length: count }, (_, i) => (
        <button
          key={i}
          type="button"
          aria-label={`Question ${i + 1}${answered[i] ? ", answered" : ""}`}
          aria-current={i === at ? "step" : undefined}
          data-answered={answered[i] && i !== at ? "" : undefined}
          onClick={() => void onPick(i)}
        >
          {i + 1}
        </button>
      ))}
    </div>
  );
}
