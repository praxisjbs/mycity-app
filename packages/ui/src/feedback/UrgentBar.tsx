/**
 * @component UrgentBar
 * @group Feedback
 * @summary The red bar under the top bar on every screen while an urgent notice waits on the person: its title, how many wait, and Acknowledge or Open.
 * @use An open urgent notice of the signed-in person (an urgent announcement, a change to who can do what, an approval past its time limit); each shell mounts one, fed by the app.
 * @avoid A notice that can wait (the bell and the banner carry it); a page's own warning (Banner); news after an action (a toast).
 * @phone Full width under the top bar: the title on one line, the count, the action at 44 px; swipe the bar sideways to step through several (the arrows are desktop only).
 * @a11y An alert region, so a new urgent notice is announced without moving focus. The title opens the notice and the action is a real button named by its verb; the arrows are named Previous Notice and Next Notice. It pulses slowly, every 2 seconds and never flashing, and is steady red when motion is off.
 * @status beta
 * @example <UrgentBar title="Fire drill at 11" position={1} count={2} actionLabel="Acknowledge" onAction={acknowledge} onNext={next} />
 */
import { useRef } from "react";
import { cn } from "../lib/cn";
import { Icon } from "../icons/Icon";
import { Button, IconButton } from "../actions/Button";

export interface UrgentBarProps {
  /** The notice's title: what waits on the person (their own notice, not interface copy). */
  title: string;
  /** Which of the open urgent notices this is, from 1. */
  position?: number;
  /** How many urgent notices are open; "1 of 3" shows when more than one. */
  count?: number;
  /** The action's verb: Acknowledge when only that closes the notice, else Open. */
  actionLabel: string;
  /** The action. Return the work and the button spins until it settles. */
  onAction: () => unknown;
  /** Opens what the notice is about (a tap on the title). */
  onOpen?: () => unknown;
  /** The notice before (a desktop arrow, or a swipe right on a phone). */
  onPrevious?: () => unknown;
  /** The notice after (a desktop arrow, or a swipe left on a phone). */
  onNext?: () => unknown;
  /** Layout classes only (spacing, width); the look is the component's own. */
  className?: string;
}

/** How far a finger travels sideways before it counts as a swipe. */
const SWIPE_PX = 48;

export function UrgentBar({ title, position = 1, count = 1, actionLabel, onAction, onOpen, onPrevious, onNext, className }: UrgentBarProps) {
  const startX = useRef<number | null>(null);
  const many = count > 1;
  return (
    <div
      role="alert"
      data-urgent-bar=""
      onTouchStart={(e) => {
        startX.current = e.touches[0]?.clientX ?? null;
      }}
      onTouchEnd={(e) => {
        const from = startX.current;
        startX.current = null;
        const to = e.changedTouches[0]?.clientX;
        if (!many || from == null || to == null || Math.abs(to - from) < SWIPE_PX) return;
        if (to < from) onNext?.();
        else onPrevious?.();
      }}
      className={cn(
        "flex min-w-0 animate-urgent items-center gap-2 border-y border-destructive bg-destructive-soft px-3.5 py-1.5 text-destructive phone:py-1",
        className,
      )}
    >
      <Icon name="alert" className="flex-none" />
      <button
        type="button"
        onClick={() => onOpen?.()}
        disabled={!onOpen}
        className="min-w-0 flex-1 truncate text-left text-sm font-strong outline-none phone:min-h-tap disabled:cursor-default"
      >
        <span data-copy="content">{title}</span>
      </button>
      {many && (
        <span className="flex-none text-xs tabular-nums">
          {position} of {count}
        </span>
      )}
      {many && (
        <span className="flex flex-none items-center phone:hidden">
          <IconButton icon="left" label="Previous Notice" size="sm" onClick={onPrevious} disabled={!onPrevious} />
          <IconButton icon="right" label="Next Notice" size="sm" onClick={onNext} disabled={!onNext} />
        </span>
      )}
      <Button size="sm" onClick={onAction} className="flex-none">
        {actionLabel}
      </Button>
    </div>
  );
}
