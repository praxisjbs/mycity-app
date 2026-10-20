/**
 * Press and hold, one gesture for a mouse, a pen and a finger (FRONTEND_FOUNDATION
 * F28, F29): the refresh button's ring, an arrow's trail, the pin's trail.
 *
 * A press that lasts `ms` is a hold, and the click that follows it is
 * swallowed, so the control's own click (Back, Refresh, Home) never runs as
 * well. A shorter press stays a plain click, so the keyboard and a screen
 * reader keep the control's ordinary action. A right click, the menu key, or
 * the long press a phone turns into a context menu is a hold at once, and the
 * phone's own menu or link preview never shows.
 */
import { useEffect, useLayoutEffect, useRef, type MouseEvent, type PointerEvent } from "react";

export interface HoldOptions {
  /** The hold: what the press does once it has lasted `ms`. */
  onHold: () => void;
  /** How long a press lasts before it is a hold, in ms. Default 450. */
  ms?: number;
  /** After this long a press starts to show that it is becoming a hold (a ring closing). Default: no showing. */
  showAfter?: number;
  /** The press has lasted `showAfter`: start showing the hold coming. */
  onHoldStart?: () => void;
  /** The press ended, or wandered off, before the hold: stop showing it. */
  onHoldCancel?: () => void;
}

/** The handlers to spread on the control. */
export interface HoldHandlers {
  onPointerDown: (e: PointerEvent<HTMLElement>) => void;
  onPointerUp: () => void;
  onPointerCancel: () => void;
  onContextMenu: (e: MouseEvent<HTMLElement>) => void;
  onClickCapture: (e: MouseEvent<HTMLElement>) => void;
}

export function useHold({ onHold, ms = 450, showAfter, onHoldStart, onHoldCancel }: HoldOptions): HoldHandlers {
  const latest = useRef({ onHold, onHoldStart, onHoldCancel });
  useLayoutEffect(() => {
    latest.current = { onHold, onHoldStart, onHoldCancel };
  });
  const timers = useRef<number[]>([]);
  const showing = useRef(false);
  const held = useRef(false);
  const down = useRef(false);
  const clear = () => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  };
  useEffect(() => clear, []);

  const fire = () => {
    clear();
    showing.current = false;
    held.current = true;
    latest.current.onHold();
  };
  const stop = () => {
    down.current = false;
    const was = timers.current.length > 0;
    clear();
    if (was && showing.current) latest.current.onHoldCancel?.();
    showing.current = false;
  };

  return {
    onPointerDown: (e) => {
      if (e.button !== 0) return;
      held.current = false;
      down.current = true;
      clear();
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* a synthetic event has no pointer to capture */
      }
      if (showAfter === undefined) {
        timers.current.push(window.setTimeout(fire, ms));
        return;
      }
      timers.current.push(
        window.setTimeout(() => {
          showing.current = true;
          latest.current.onHoldStart?.();
          timers.current.push(window.setTimeout(fire, Math.max(0, ms - showAfter)));
        }, showAfter),
      );
    },
    onPointerUp: stop,
    onPointerCancel: stop,
    onContextMenu: (e) => {
      e.preventDefault();
      // A long press the phone also calls a context menu: the hold has fired, or fires now.
      if (down.current) {
        if (!held.current) fire();
        return;
      }
      // A right click or the menu key: no click follows, so nothing is swallowed after it.
      latest.current.onHold();
    },
    onClickCapture: (e) => {
      if (!held.current) return;
      held.current = false;
      e.preventDefault();
      e.stopPropagation();
    },
  };
}
