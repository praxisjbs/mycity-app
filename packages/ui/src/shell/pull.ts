/**
 * Pull to refresh (FRONTEND_FOUNDATION F28) for the one element that scrolls a
 * phone's page: PhoneShell's page and PhonePage's body.
 *
 * It only listens (passive touch listeners, never a cancelled touch), so
 * scrolling never waits on it, and it starts only when all of these hold:
 *
 *   - the page, and every list between it and the finger, is at its very top
 *   - the touch did not start in a field or inside anything marked
 *     data-pull="off" (a map, the signature pad, a document, a chat thread)
 *   - the first 10 px head clearly down, so a sideways swipe (the tab strip, a
 *     row to mark it read, a board's stages, a wide chart) never starts it
 *
 * The page carries overscroll-behavior: none, so the browser's own pull never
 * reloads the app behind this one.
 *
 * Let go once the ring has closed (PULL_REFRESH) and onRefresh runs, the ring
 * turning until its promise settles (MAX_WAIT at most). With onReload, pulled
 * on past PULL_RELOAD the disc turns to Reload and letting go runs that instead.
 * How far the page is pulled is written on the indicator as CSS variables
 * (--pull, --pull-p), so the disc follows the finger with no React render per
 * move; React hears only the few changes of state.
 */
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

/** Where a pull is: what PullIndicator draws. */
export type PullState = "idle" | "pulling" | "armed" | "deep" | "refreshing" | "reloading" | "done" | "settling";

/** How far the page is pulled, in px after the resistance, for the ring to close and a refresh to run. */
export const PULL_REFRESH = 64;
/** How far for the second notch: Reload. */
export const PULL_RELOAD = 136;
/** Where the disc rests while the screen refreshes. */
const PARKED = 64;
/** Movement under this is a wobble, not a direction. */
const SLOP = 10;
/** A refresh that has not settled by then lets the disc go anyway. */
const MAX_WAIT = 15000;
/** Touches that never start a pull. */
const NOT_HERE = '[data-pull="off"], input, textarea, select, [contenteditable="true"], [contenteditable=""]';

export interface PullOptions {
  /** Refresh in place; the indicator turns until its promise settles. Without it there is no pull. */
  onRefresh?: () => Promise<unknown>;
  /** The second notch: restart the app. A promise it returns settles only if the page stays (the person kept unsaved work). */
  onReload?: () => unknown;
  /** false: no pull (a fit page, whose panes scroll themselves). */
  enabled?: boolean;
}

/** Can a pull start from this touch? The page and every list under the finger at their top, and not on a field or an opted-out part. */
export function canPullFrom(target: EventTarget | null, scroller: HTMLElement): boolean {
  if (scroller.scrollTop > 0) return false;
  const el = target instanceof Element ? target : null;
  if (!el || el.closest(NOT_HERE)) return false;
  for (let n: Element | null = el; n && n !== scroller; n = n.parentElement) {
    if (n.scrollTop > 0) return false;
  }
  return true;
}

/** The finger's travel, after the resistance a phone's own pull has. */
export function pullDistance(dy: number, deep: boolean): number {
  if (dy <= 0) return 0;
  let d = dy * 0.55;
  if (d > PULL_REFRESH) d = PULL_REFRESH + (d - PULL_REFRESH) * 0.7;
  return Math.min(deep ? 176 : 112, d);
}

const tick = (ms: number) => {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* no vibration motor, or no permission: the ring says it anyway */
  }
};

/**
 * Wires the pull to `scroller` and writes the distance on `indicator`.
 * Returns the state for PullIndicator.
 */
export function usePull(scroller: HTMLElement | null, indicator: RefObject<HTMLElement | null>, { onRefresh, onReload, enabled = true }: PullOptions): PullState {
  const [state, setState] = useState<PullState>("idle");
  const latest = useRef({ onRefresh, onReload });
  useLayoutEffect(() => {
    latest.current = { onRefresh, onReload };
  });
  const busy = useRef(false);
  const on = !!onRefresh && enabled;

  useEffect(() => {
    if (!scroller || !on) return;
    let phase: "none" | "deciding" | "pulling" = "none";
    let x0 = 0;
    let y0 = 0;
    let dist = 0;
    let shown: PullState = "idle";
    const timers: number[] = [];
    const later = (fn: () => void, ms: number) => timers.push(window.setTimeout(fn, ms));
    const show = (next: PullState) => {
      if (next === shown) return;
      shown = next;
      setState(next);
    };
    const write = (d: number) => {
      const el = indicator.current;
      if (!el) return;
      el.style.setProperty("--pull", d.toFixed(1));
      el.style.setProperty("--pull-p", Math.min(1, d / PULL_REFRESH).toFixed(3));
    };
    const settle = () => {
      show("settling");
      write(0);
      later(() => {
        busy.current = false;
        show("idle");
      }, 400);
    };

    const start = (e: TouchEvent) => {
      phase = "none";
      if (busy.current || e.touches.length !== 1 || !canPullFrom(e.target, scroller)) return;
      phase = "deciding";
      x0 = e.touches[0]!.clientX;
      y0 = e.touches[0]!.clientY;
    };
    const move = (e: TouchEvent) => {
      if (phase === "none" || e.touches.length !== 1) return;
      const dx = e.touches[0]!.clientX - x0;
      const dy = e.touches[0]!.clientY - y0;
      if (phase === "deciding") {
        if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return;
        if (dy <= 0 || dy < Math.abs(dx) * 1.4 || scroller.scrollTop > 0) {
          phase = "none";
          return;
        }
        phase = "pulling";
      }
      // Back up past where it started, or the page scrolled after all: the pull is off.
      if (dy <= 0 || scroller.scrollTop > 0) {
        phase = "none";
        dist = 0;
        write(0);
        show("idle");
        return;
      }
      const deep = !!latest.current.onReload;
      dist = pullDistance(dy, deep);
      write(dist);
      const next: PullState = deep && dist >= PULL_RELOAD ? "deep" : dist >= PULL_REFRESH ? "armed" : "pulling";
      if (next !== shown && (next === "armed" || next === "deep") && shown !== "deep") tick(next === "deep" ? 14 : 8);
      show(next);
    };
    const end = () => {
      if (phase !== "pulling") {
        phase = "none";
        return;
      }
      phase = "none";
      const { onRefresh: refresh, onReload: reload } = latest.current;
      if (reload && dist >= PULL_RELOAD) {
        busy.current = true;
        show("reloading");
        write(PARKED);
        void Promise.resolve(reload()).finally(settle);
        return;
      }
      if (refresh && dist >= PULL_REFRESH) {
        busy.current = true;
        show("refreshing");
        write(PARKED);
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          show("done");
          later(settle, 450);
        };
        void refresh().then(finish, finish);
        later(finish, MAX_WAIT);
        return;
      }
      settle();
    };
    const cancel = () => {
      if (phase === "pulling") settle();
      phase = "none";
    };

    scroller.addEventListener("touchstart", start, { passive: true });
    scroller.addEventListener("touchmove", move, { passive: true });
    scroller.addEventListener("touchend", end, { passive: true });
    scroller.addEventListener("touchcancel", cancel, { passive: true });
    return () => {
      scroller.removeEventListener("touchstart", start);
      scroller.removeEventListener("touchmove", move);
      scroller.removeEventListener("touchend", end);
      scroller.removeEventListener("touchcancel", cancel);
      timers.forEach((t) => window.clearTimeout(t));
      busy.current = false;
      write(0);
      setState("idle");
    };
  }, [scroller, on, indicator]);

  return on ? state : "idle";
}
