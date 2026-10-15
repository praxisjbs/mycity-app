/**
 * Which way the shell's page is scrolling, shared by the phone shell's parts:
 * PhoneShell measures its scroller and provides it; PhoneHeader slides its
 * title away and FloatingButton tucks itself away while the page scrolls down,
 * and both come back on scrolling up (F18, the title rail of PR 2 question 3).
 * Outside a PhoneShell (the gallery, a test) the page is at rest, at the top.
 */
import { createContext, useCallback, useContext, useRef, useState, type UIEvent } from "react";

export interface ShellScroll {
  /** The last clear direction; "up" at rest. */
  direction: "up" | "down";
  /** Within a few pixels of the top. */
  atTop: boolean;
}

export const ShellScrollContext = createContext<ShellScroll>({ direction: "up", atTop: true });

export const useShellScroll = (): ShellScroll => useContext(ShellScrollContext);

/** The floating button tells the phone shell its fan is open, so the shell dims the page behind it. */
export const FanContext = createContext<(open: boolean) => void>(() => undefined);

/** Movement under this many pixels is a wobble, not a direction. */
const STEP = 8;

/** The scroller's onScroll handler and the state it feeds; `reset` returns to rest (a new page). */
export function useScrollDirection() {
  const [state, setState] = useState<ShellScroll>({ direction: "up", atTop: true });
  const last = useRef(0);
  const onScroll = useCallback((e: UIEvent<HTMLElement>) => {
    const el = e.currentTarget;
    const top = el.scrollTop;
    const delta = top - last.current;
    if (Math.abs(delta) < STEP && top > STEP) return;
    last.current = top;
    // At the bottom edge, a move up is the browser pulling the page back as the header slid away
    // and the page grew, not the person scrolling up: taking it as one would bounce the header.
    if (delta < 0 && top > STEP && top + el.clientHeight >= el.scrollHeight - 2) return;
    const next: ShellScroll = { direction: delta > 0 && top > STEP ? "down" : "up", atTop: top <= STEP };
    setState((s) => (s.direction === next.direction && s.atTop === next.atTop ? s : next));
  }, []);
  const reset = useCallback(() => {
    last.current = 0;
    setState({ direction: "up", atTop: true });
  }, []);
  return { state, onScroll, reset };
}
