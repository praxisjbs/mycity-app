/**
 * @component SplitPanes
 * @group Layout
 * @summary A list beside the record it opens, with a divider the person can drag; on a phone the list fills the screen and the record covers it.
 * @use A screen read one record at a time out of a list: the mailbox, chat, a day's punches.
 * @avoid A page of sections (use Grid); a list and a detail that fit side by side at a fixed width (use Grid "1.4/1"); three panes a person drags independently.
 * @phone There are no panes: the list fills the screen and an open record covers it, above the shell, with the safe area kept clear.
 * @a11y The divider is a real separator with its width as its value, and the arrow keys move it, so the panes can be resized without a pointer.
 * @status stable
 * @example const split = useSplitPanes("mailbox", 320);
 * @example <SplitPanes split={split} open={open} list={list} detail={reader} />
 */
import { useCallback, useState, type PointerEvent as ReactPointerEvent, type CSSProperties, type ReactNode } from "react";
import { cn } from "../lib/cn";
import { useIsPhone } from "../lib/media";

/** How narrow and how wide the list may be dragged, in pixels. */
const NARROWEST = 220;
const WIDEST = 480;

/** How far an arrow key moves the divider, in pixels. */
const NUDGE = 20;

/** What the hook hands the panes. */
export interface SplitState {
  /** The list's width in pixels. */
  width: number;
  /** Starts a drag. */
  onDragStart: (e: ReactPointerEvent<HTMLDivElement>) => void;
  /** Moves the divider by a number of pixels (the arrow keys). */
  nudge: (by: number) => void;
}

/**
 * The list's width, dragged by the divider and remembered on this device.
 * Browser storage is a per-viewer convenience here: a width that cannot be read
 * back just starts at the default.
 */
export function useSplitPanes(key: string, initial: number): SplitState {
  const store = `mc-split-${key}`;
  const [width, setWidth] = useState(() => {
    try {
      return Number(localStorage.getItem(store)) || initial;
    } catch {
      return initial;
    }
  });

  const hold = (value: number) => Math.min(WIDEST, Math.max(NARROWEST, value));

  const onDragStart = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const fromX = e.clientX;
      const fromWidth = width;
      const handle = e.currentTarget;
      handle.setPointerCapture(e.pointerId);
      document.body.style.cursor = "col-resize";

      const move = (ev: PointerEvent) => setWidth(hold(fromWidth + ev.clientX - fromX));
      const done = () => {
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", done);
        document.body.style.cursor = "";
        setWidth((value) => {
          try {
            localStorage.setItem(store, String(value));
          } catch {
            /* a per-device convenience only: a width that cannot be stored is not an error */
          }
          return value;
        });
      };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", done);
    },
    [store, width],
  );

  return { width, onDragStart, nudge: useCallback((by: number) => setWidth((value) => hold(value + by)), []) };
}

export interface SplitPanesProps {
  /** The width and the drag, from `useSplitPanes`. */
  split: SplitState;
  /** The list, which fills the screen on a phone. */
  list: ReactNode;
  /** The record in view, which covers the list on a phone. */
  detail: ReactNode;
  /** A third pane at the right on desktop, 300 px wide (a channel's own information). */
  aside?: ReactNode;
  /** A record is open: on a phone it covers the list. */
  open?: boolean;
  /** The panes' least height; `md` unless a screen wants more. */
  minHeight?: "sm" | "md";
  /** The open record scrolls as one, rather than its own parts scrolling (the mailbox reads this way). */
  scrolls?: boolean;
  /** Layout classes only (spacing). */
  className?: string;
}

const MIN_HEIGHT = { sm: "min-h-88", md: "min-h-96" } as const;

const PANE = "flex min-h-0 flex-col overflow-hidden rounded-card border border-border bg-card shadow-1";

export function SplitPanes({ split, list, detail, aside, open, minHeight = "md", scrolls, className }: SplitPanesProps) {
  const phone = useIsPhone();

  if (phone) {
    return (
      <>
        <div className={cn(PANE, className)}>{list}</div>
        {/*
         * Above the shell and under the staging bar, with the home indicator's
         * area kept clear: an open record on a phone is the whole screen.
         */}
        {open && <div className={cn("pt-safe fixed inset-x-0 top-(--env-bar) bottom-0 z-62 flex flex-col bg-card", scrolls && "overflow-y-auto")}>{detail}</div>}
      </>
    );
  }

  return (
    <div
      className={cn("grid flex-1 gap-1", MIN_HEIGHT[minHeight], aside ? "cols-panes-aside" : "cols-panes", className)}
      style={{ "--pane": `${split.width}px` } as CSSProperties}
    >
      <div className={PANE}>{list}</div>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize the list"
        aria-valuenow={split.width}
        aria-valuemin={NARROWEST}
        aria-valuemax={WIDEST}
        tabIndex={0}
        onPointerDown={split.onDragStart}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") split.nudge(-NUDGE);
          else if (e.key === "ArrowRight") split.nudge(NUDGE);
        }}
        className="group relative cursor-col-resize touch-none rounded-md -outline-offset-2 hover:bg-accent focus-visible:bg-accent"
      >
        <span aria-hidden="true" className="absolute top-1/2 left-0.5 -mt-5 h-10 w-0.5 rounded-sm bg-input opacity-55 transition-all group-hover:-mt-8 group-hover:h-16 group-hover:opacity-100" />
      </div>
      <div className={cn(PANE, scrolls && "overflow-y-auto overscroll-contain")}>{detail}</div>
      {aside}
    </div>
  );
}
