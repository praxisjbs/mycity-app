import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { IconName } from "@mycity/ui";
import { useSearchParams } from "@/lib/router";

/**
 * A screen's own New action, which the phone's floating button offers first
 * (F18): New Task on Tasks, New Request on My Requests. A screen registers it
 * while it is mounted:
 *
 *   useScreenAction({ label: "New Task", icon: "plus", onSelect: openNewTask });
 *
 * On desktop the same action stays in the page header; only the phone's fan
 * reads this. A screen without one leaves the fan to Clock In or Out, Praxis AI
 * and Help.
 *
 * Search reaches it too (docs/guides/foundation.md §6.7): ⌘K lists every New
 * action (src/shared/search/actions.js; the search coverage gate fails a label
 * it does not list) and opens the screen with `?action=new`, which runs it once
 * the screen has registered it. Another action a screen can be opened on
 * (Change Password, Set PIN) uses useUrlAction with its own word.
 */
export interface ScreenAction {
  /** Verb Noun, at most 3 words (New Task). */
  label: string;
  /** Its glyph; plus unless set. */
  icon?: IconName;
  /** What it does. */
  onSelect: () => void;
}

const Ctx = createContext<{ action: ScreenAction | null; set: (a: ScreenAction | null) => void }>({ action: null, set: () => undefined });

export function ScreenActionProvider({ children }: { children: ReactNode }) {
  const [action, set] = useState<ScreenAction | null>(null);
  const value = useMemo(() => ({ action, set }), [action]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** The registered action, for the floating button. */
export const useRegisteredAction = (): ScreenAction | null => useContext(Ctx).action;

/**
 * Runs `run` once when the address asks for this action (`?action=<word>`), then
 * takes the word out of the address, so Back and a reload do not run it again.
 * It waits while `run` is not ready yet (a screen still loading what it needs).
 */
export function useUrlAction(word: string, run: (() => void) | null | undefined): void {
  const [params, setParams] = useSearchParams();
  const asked = params.get("action") === word;
  const latest = useRef(run);
  latest.current = run;
  const ready = Boolean(run);
  useEffect(() => {
    if (!asked || !ready || !latest.current) return;
    const go = latest.current;
    setParams({ action: null }, { replace: true });
    go();
  }, [asked, ready, setParams]);
}

/**
 * Registers this screen's New action while the screen is mounted. What is
 * registered calls the screen's latest `onSelect`, so an inline arrow does not
 * register again on every render (which re-rendered the screen, and looped).
 */
export function useScreenAction(action: ScreenAction | null): void {
  const { set } = useContext(Ctx);
  const label = action?.label;
  const icon = action?.icon;
  const latest = useRef(action?.onSelect);
  latest.current = action?.onSelect;
  const ready = Boolean(label && action?.onSelect);
  const run = useCallback(() => latest.current?.(), []);
  useEffect(() => {
    if (!label || !ready) return;
    set({ label, icon, onSelect: run });
    return () => set(null);
  }, [label, icon, ready, run, set]);
  useUrlAction("new", ready ? run : null);
}
