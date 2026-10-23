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
 *
 * A screen with a second action for everyone (Home's Add Work Site beside New)
 * registers it with `{ second: true }`: the fan offers it after the first, and
 * `?action=new` never runs it.
 */
export interface ScreenAction {
  /** Verb Noun, at most 3 words (New Task). */
  label: string;
  /** Its glyph; plus unless set. */
  icon?: IconName;
  /** What it does. */
  onSelect: () => void;
}

type Slot = (a: ScreenAction | null) => void;
const Ctx = createContext<{ action: ScreenAction | null; set: Slot; second: ScreenAction | null; setSecond: Slot }>({
  action: null,
  set: () => undefined,
  second: null,
  setSecond: () => undefined,
});

export function ScreenActionProvider({ children }: { children: ReactNode }) {
  const [action, set] = useState<ScreenAction | null>(null);
  const [second, setSecond] = useState<ScreenAction | null>(null);
  const value = useMemo(() => ({ action, set, second, setSecond }), [action, second]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** The registered action, for the floating button. */
export const useRegisteredAction = (): ScreenAction | null => useContext(Ctx).action;

/** The screen's second action, offered after the first. */
export const useRegisteredSecond = (): ScreenAction | null => useContext(Ctx).second;

/** Runs `run` once the address carries `key=value` and `run` is ready, taking the key out first. */
function useAddressAsk(key: string, value: string, run: (() => void) | null | undefined): void {
  const [params, setParams] = useSearchParams();
  const asked = params.get(key) === value;
  const latest = useRef(run);
  latest.current = run;
  const ready = Boolean(run);
  useEffect(() => {
    if (!asked || !ready || !latest.current) return;
    const go = latest.current;
    setParams({ [key]: null }, { replace: true });
    go();
  }, [asked, ready, setParams, key]);
}

/**
 * Runs `run` once when the address asks for this action (`?action=<word>`), then
 * takes the word out of the address, so Back and a reload do not run it again.
 * It waits while `run` is not ready yet (a screen still loading what it needs).
 */
export function useUrlAction(word: string, run: (() => void) | null | undefined): void {
  useAddressAsk("action", word, run);
}

/**
 * Runs `run` once when the address carries `new=1`, the way the AI manifests' routes open a
 * screen's form (docs/guides/praxis-ai.md §6.4), then takes it out. For a screen whose New action
 * is registered with useScreenAction; Workspace and Staff Community read `new=1` themselves.
 */
export function useNewLink(run: (() => void) | null | undefined): void {
  useAddressAsk("new", "1", run);
}

/**
 * Registers this screen's New action while the screen is mounted, or with
 * `second` its second one. What is registered calls the screen's latest
 * `onSelect`, so an inline arrow does not register again on every render
 * (which re-rendered the screen, and looped).
 */
export function useScreenAction(action: ScreenAction | null, { second = false }: { second?: boolean } = {}): void {
  const ctx = useContext(Ctx);
  const set = second ? ctx.setSecond : ctx.set;
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
  useUrlAction("new", ready && !second ? run : null);
}

/** A contract schema an address's values are checked by: an object whose fields each take one value. */
export interface PrefillSchema {
  shape: Record<string, { safeParse(value: unknown): { success: boolean } }>;
}

/**
 * The values the address fills a form with as it opens (docs/guides/praxis-ai.md §6.4): the
 * assistant's screen button opens Request Leave on `?new=1&starts_on=2026-10-26`. Each field of
 * the contract's prefill schema that the address carries, and that the field takes on its own, is
 * read once as the form mounts and taken out of the address, so Back and a reload do not fill it
 * again. A list field arrives comma-separated and is handed over as it came. The person still
 * presses the form's own button.
 *
 *   const filled = useAddressPrefill(leave.LeaveRequestPrefill);
 *   const f = useContractForm({ ...blank, ...filled }, leave.LeaveRequestCreate);
 *
 * `enabled` false (an edit form) reads and removes nothing.
 */
export function useAddressPrefill<S extends PrefillSchema>(schema: S, enabled = true): Partial<Record<keyof S["shape"] & string, string>> {
  const [params, setParams] = useSearchParams();
  const [values] = useState(() => {
    const out: Record<string, string> = {};
    if (enabled)
      for (const [key, field] of Object.entries(schema.shape)) {
        const v = params.get(key);
        // A list field (New Event's attendees) comes as one comma-separated value.
        if (v && (field.safeParse(v).success || field.safeParse(v.split(",")).success)) out[key] = v;
      }
    return out as Partial<Record<keyof S["shape"] & string, string>>;
  });
  const done = useRef(!enabled);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    const present = Object.keys(schema.shape).filter((key) => params.has(key));
    if (present.length) setParams(Object.fromEntries(present.map((key) => [key, null])), { replace: true });
  }, [params, setParams, schema]);
  return values;
}
