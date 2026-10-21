/**
 * The window's history, with one owner (FRONTEND_FOUNDATION F29).
 *
 * The browser's own history is the only record of where a person has been, so
 * Android's Back, the iPhone's edge swipe, a mouse's side buttons, Alt and an
 * arrow key, and the app's own controls always agree. Every entry written here
 * carries a mark in `history.state.mc`: the step it belongs to (kept across a
 * reload), its place in the window's history (to tell Back from Forward), and
 * the overlays open over it.
 *
 *   startHistory()          once, by the app's router: marks the entry it
 *                           opened on and listens for Back and Forward. Until
 *                           it runs nothing here acts, so the gallery, the
 *                           tests and the public site see plain overlays.
 *   pushStep(url)           a new step. On an open or spent overlay's entry the
 *                           entry itself becomes the step, so none is left over.
 *   replaceStep(url)        the same step at a new address. Under an open
 *                           overlay the step underneath takes the address too
 *                           when Back closes the overlay.
 *   onHistory(fn)           told after every change, with what changed.
 *   useBackClose(open, onClose)
 *                           on a phone, an open overlay's own entry, so Back
 *                           closes it before it leaves the screen.
 *
 * An overlay that closes any other way (its close button, Esc, a drag, a
 * choice) leaves its entry spent instead of stepping back through it: a
 * history.back() still in flight would race the navigation that so often
 * follows (a tile in More, a row in a sheet). Back from a spent entry lands on
 * the same step, and a move that changes nothing on screen is carried on one
 * entry further in the same direction, so no press is ever wasted.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useIsPhone } from "./media";

/** What changed in the window's history. */
export interface HistoryChange {
  /** push: a new step; replace: the same step at a new address; pop: Back or Forward reached another step. */
  kind: "push" | "replace" | "pop";
  /** The step's key, the same across a reload. */
  key: string;
  /** Its address: path and query. */
  url: string;
  /** The entry's place in this window's history, overlay entries counted: what a jump through the trail moves by. */
  pos: number;
}

interface Mark {
  /** The step this entry belongs to. */
  key: string;
  /** Its place in this window's history, overlay entries counted. */
  pos: number;
  /** The overlays open over the step, oldest first. */
  layers?: string[];
  /** An overlay's entry whose overlay has closed: the step again. */
  spent?: boolean;
}

let started = false;
let fresh = false;
let current: Mark = { key: "", pos: 0 };
/** Each open overlay's layer, and what closes it when Back takes its entry away. */
const layers = new Map<string, () => void>();
const listeners = new Set<(change: HistoryChange) => void>();
/** The address a step was given while an overlay was open over it. */
let pending: { key: string; url: string } | null = null;
let count = 0;

const here = () => window.location.pathname + window.location.search;
const newKey = () => `${Date.now().toString(36)}${(count++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function markOf(state: unknown): Mark | null {
  const mc = state && typeof state === "object" ? (state as { mc?: Partial<Mark> }).mc : undefined;
  return mc && typeof mc.key === "string" && typeof mc.pos === "number" ? (mc as Mark) : null;
}

function write(mark: Mark, url: string | null, how: "push" | "replace"): void {
  const kept = how === "replace" && window.history.state && typeof window.history.state === "object" ? window.history.state : {};
  const state = { ...kept, mc: mark };
  if (how === "push") window.history.pushState(state, "", url ?? undefined);
  else window.history.replaceState(state, "", url ?? undefined);
  current = mark;
}

const tell = (change: HistoryChange) => listeners.forEach((fn) => fn(change));

function onPop(e: PopStateEvent): void {
  const was = current;
  let mark = markOf(e.state);
  if (!mark) {
    // An entry written before anything here ran: it becomes a step of its own, with no overlay on it.
    write({ key: newKey(), pos: was.pos - 1 }, null, "replace");
    mark = current;
  }
  current = mark;
  // The overlays whose layer this entry no longer holds were closed by the move: newest first.
  const held = new Set(mark.layers ?? []);
  const shut = [...layers.keys()].filter((t) => !held.has(t)).reverse();
  for (const t of shut) {
    const close = layers.get(t);
    layers.delete(t);
    close?.();
  }
  let moved = false;
  if (pending && pending.key === mark.key && !mark.layers?.length) {
    // Back closed an overlay that changed this step's address (a filter sheet): the step keeps it.
    const url = pending.url;
    pending = null;
    if (url !== here()) {
      write({ ...mark }, url, "replace");
      moved = true;
    }
  }
  if (!shut.length && !moved && mark.key === was.key) {
    // The same step again (a spent overlay's entry): nothing changed on screen, so go one further.
    if (mark.pos < was.pos) window.history.back();
    else if (mark.pos > was.pos) window.history.forward();
    return;
  }
  if (moved || mark.key !== was.key) tell({ kind: "pop", key: mark.key, url: here(), pos: mark.pos });
}

/** Once, by the app's router, before its first render. Marks the entry the window opened on. */
export function startHistory(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  const mark = markOf(window.history.state);
  fresh = !mark;
  // A reload with an overlay open: the overlay is gone, so its entry is spent.
  if (!mark) write({ key: newKey(), pos: 0 }, null, "replace");
  else if (mark.layers?.length) write({ key: mark.key, pos: mark.pos, spent: true }, null, "replace");
  else current = mark;
  window.addEventListener("popstate", onPop);
}

/** Whether the window opened on an entry nothing had marked: a new window or a cold start of the app, never a reload. */
export const historyStartedFresh = (): boolean => fresh;

/** The step on screen, and the place of the entry it is on. */
export const currentStep = (): { key: string; pos: number } => ({ key: current.key, pos: current.pos });

/** A new step at this address. */
export function pushStep(url: string): HistoryChange {
  startHistory();
  // An open overlay's entry, or a spent one, becomes the step: Back then skips nothing.
  const over = !!current.layers?.length || !!current.spent;
  write({ key: newKey(), pos: over ? current.pos : current.pos + 1 }, url, over ? "replace" : "push");
  pending = null;
  const change: HistoryChange = { kind: "push", key: current.key, url: here(), pos: current.pos };
  tell(change);
  return change;
}

/** The step on screen at a new address: a filter, a search, a sort, a page. */
export function replaceStep(url: string): HistoryChange {
  startHistory();
  write({ ...current }, url, "replace");
  if (current.layers?.length) pending = { key: current.key, url: here() };
  const change: HistoryChange = { kind: "replace", key: current.key, url: here(), pos: current.pos };
  tell(change);
  return change;
}

/** Told after every change to the window's history; returns the way to stop. */
export function onHistory(fn: (change: HistoryChange) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Moves through the window's history by entries: -1 is Back, 1 is Forward; a trail jump passes the difference of two places. */
export function goHistory(delta: number): void {
  if (delta) window.history.go(delta);
}

/**
 * Rebuilds the window's history from a trail kept on the device, the oldest
 * first and the last one on screen, so Back works after the app was closed.
 * Only on an entry nothing had marked (startedFresh), before the first render
 * reads the address; returns the steps as they now stand.
 */
export function restoreSteps(urls: string[]): HistoryChange[] {
  startHistory();
  if (!urls.length) return [];
  const out: HistoryChange[] = [];
  urls.forEach((url, i) => {
    write({ key: newKey(), pos: current.pos + (i === 0 ? 0 : 1) }, url, i === 0 ? "replace" : "push");
    out.push({ kind: i === 0 ? "replace" : "push", key: current.key, url: here(), pos: current.pos });
  });
  // The address changed under the app, as Back would change it: whoever reads it reads it again.
  tell({ kind: "pop", key: current.key, url: here(), pos: current.pos });
  return out;
}

/**
 * On a phone, while `open`, the overlay holds an entry of its own, so Back
 * closes it (`onClose`) before it leaves the screen. When its owner refuses
 * (unsaved work, asked first) the entry comes back. `hold` swallows Back
 * instead: a prompt that must be answered stays, and so does the screen.
 */
export function useBackClose(open: boolean, onClose: () => void, opts: { enabled?: boolean; hold?: boolean } = {}): void {
  const { enabled = true, hold = false } = opts;
  const phone = useIsPhone();
  const close = useRef(onClose);
  const holding = useRef(hold);
  useLayoutEffect(() => {
    close.current = onClose;
    holding.current = hold;
  });
  const [armed, setArmed] = useState(0);

  useEffect(() => {
    if (!open || !enabled || !phone || !started) return;
    const t = newKey();
    layers.set(t, () => {
      if (!holding.current) close.current();
      setArmed((n) => n + 1);
    });
    write({ key: current.key, pos: current.pos + 1, layers: [...(current.layers ?? []), t] }, null, "push");
    return () => {
      // Back took its entry already.
      if (!layers.delete(t)) return;
      // Closed some other way: its entry, while still the one on top, is spent.
      const on = current.layers ?? [];
      if (on[on.length - 1] !== t) return;
      const rest = on.slice(0, -1);
      write(rest.length ? { ...current, layers: rest } : { key: current.key, pos: current.pos, spent: true }, null, "replace");
    };
  }, [open, enabled, phone, armed]);
}

/** Tests only: back to a window nothing has marked. */
export function resetHistoryForTest(): void {
  if (started) window.removeEventListener("popstate", onPop);
  started = false;
  fresh = false;
  current = { key: "", pos: 0 };
  layers.clear();
  listeners.clear();
  pending = null;
}
