/**
 * @component ProgressLine
 * @group Assistant
 * @summary What Praxis AI is doing while a question runs: Reading leave requests, 2 of 5; nothing is streamed, the answer lands whole.
 * @use Under the question waiting for its answer, fed by the `ai:progress` realtime events; drop it the moment the answer arrives.
 * @avoid A spinner for any other wait (use Spinner or Skeleton); a toast; a line that stays once the answer is on screen.
 * @phone The same line, in the conversation's column; its words wrap.
 * @a11y A polite live region (role status), so a screen reader hears each step without being interrupted.
 * @status beta
 * @example <ProgressLine words="leave requests" step={{ n: 2, of: 5 }} />
 */
import { cn } from "../lib/cn";
import { Icon } from "../icons/Icon";

export interface ProgressLineProps {
  /** What is being read, as the reads' own words ("leave requests"); Your Records when nothing is known yet. */
  words?: string | null;
  /** Which read of the question's five is running. */
  step?: { n: number; of: number } | null;
  /** Layout classes only (spacing). */
  className?: string;
}

export function ProgressLine({ words, step, className }: ProgressLineProps) {
  return (
    <div role="status" className={cn("flex w-fit max-w-full items-center gap-2 bubble-them border border-border px-3 py-2.5 text-xs text-subtle-foreground", className)}>
      <Icon name="spark" className="flex-none animate-pulse" />
      <span className="wrap-any">
        {words ? (
          <>
            Reading <span data-copy="content">{words}</span>
          </>
        ) : (
          "Reading Your Records"
        )}
        {step && step.of > 1 && (
          <>
            {" · "}
            {step.n} of {step.of}
          </>
        )}
      </span>
    </div>
  );
}
