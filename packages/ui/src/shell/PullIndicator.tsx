/**
 * @component PullIndicator
 * @group Shell
 * @summary The pull to refresh's Pin Drop: the pin in a disc that drops from under the header as the page is pulled, its yellow ring closing at the release point, Deep Green with the reload mark past the second notch.
 * @use Drawn by PhoneShell and PhonePage while their page is pulled (F28), fed by their pull; a screen never draws one. `distance` sets it still, for the gallery and tests.
 * @avoid Desktop (the refresh button in NavCapsule); a list loading its first page (Skeleton); work inside the content (Spinner).
 * @phone The whole point. It follows the finger under the header, lands with a small bounce once the ring closes (64 px), turns while the screen refreshes and shows a tick when it is done; pulled on past 136 px it turns Deep Green with the reload mark. The page under it never moves.
 * @a11y Hidden while it is only being pulled; while it works it is a status that says Refreshing or Reloading once. Anyone who cannot pull has Refresh Screen and Reload App in ⌘K.
 * @status stable
 * @example <PullIndicator ref={indicator} state={state} />
 */
import { forwardRef, type CSSProperties } from "react";
import { cn } from "../lib/cn";
import { Icon } from "../icons/Icon";
import { Brand } from "./Brand";
import { PULL_REFRESH, type PullState } from "./pull";

export interface PullIndicatorProps {
  /** Where the pull is: idle, pulling, armed (the ring closed), deep (past the second notch), refreshing, reloading, done, settling. */
  state: PullState;
  /** A fixed pull in px, for a still picture; in use the pull writes it as the finger moves. */
  distance?: number;
  /** Layout classes only. */
  className?: string;
}

/** Following the finger it moves with no delay; released, it springs to where it rests. */
const FOLLOWS: PullState[] = ["pulling", "armed", "deep"];

export const PullIndicator = forwardRef<HTMLDivElement, PullIndicatorProps>(function PullIndicator({ state, distance, className }, ref) {
  const still = distance === undefined ? undefined : ({ "--pull": distance, "--pull-p": Math.min(1, distance / PULL_REFRESH) } as CSSProperties);
  const working = state === "refreshing" || state === "reloading";
  const reload = state === "deep" || state === "reloading";
  return (
    <div
      ref={ref}
      style={still}
      data-pull={state}
      className={cn("pointer-events-none absolute inset-x-0 top-0 z-20 flex h-36 justify-center overflow-hidden", state === "idle" && "invisible", className)}
    >
      <div
        aria-hidden="true"
        className={cn(
          "pull-disc relative flex size-10 flex-none items-center justify-center rounded-full shadow-3",
          reload ? "bg-deep" : "bg-card",
          !FOLLOWS.includes(state) && "transition duration-(--dur) ease-(--ease-spring)",
        )}
      >
        <svg viewBox="0 0 40 40" className={cn("absolute inset-0 size-full -rotate-90", working && "animate-spin")}>
          <circle cx="20" cy="20" r="17.5" pathLength={100} strokeWidth={3} strokeLinecap="round" className={cn("fill-none stroke-primary", working ? "pull-ring-busy" : "pull-ring")} />
        </svg>
        {state === "done" ? (
          <Icon name="ok" size="m" className="text-success" />
        ) : reload ? (
          <Icon name="refresh" size="m" className="text-primary" />
        ) : (
          <span className={cn("pull-lift flex", state === "armed" && "animate-pin-land")}>
            <Brand size="s" />
          </span>
        )}
      </div>
      <span role="status" className="sr-only">
        {working ? (reload ? "Reloading" : "Refreshing") : ""}
      </span>
    </div>
  );
});
