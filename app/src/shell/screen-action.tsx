import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { IconName } from "@mycity/ui";

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

/** Registers this screen's New action while the screen is mounted. */
export function useScreenAction(action: ScreenAction | null): void {
  const { set } = useContext(Ctx);
  const label = action?.label;
  const icon = action?.icon;
  const onSelect = action?.onSelect;
  useEffect(() => {
    if (!label || !onSelect) return;
    set({ label, icon, onSelect });
    return () => set(null);
  }, [label, icon, onSelect, set]);
}
