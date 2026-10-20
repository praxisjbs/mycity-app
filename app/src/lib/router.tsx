import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type AnchorHTMLAttributes, type MouseEvent, type ReactNode } from "react";
import { onHistory, pushStep, replaceStep, startHistory } from "@mycity/ui";

/**
 * The one URL shape the backend produces for a screen or a record
 * (src/shared/route-map.js, FRONTEND_GUIDE §9.2):
 *
 *   /<module>?tab=<tab>&id=<id>
 *
 * The module segment is the permission key with "_" as "-" ("praxis_ai" →
 * "/praxis-ai"); the tab is the screen's slug from docs/PROGRESS.md; `id` asks
 * the screen to open that record. Any other query keys are the screen's own
 * (filters, prefill from an AI deep link) and are passed through untouched.
 *
 * Small on purpose: the app has one route shape, so it needs no routing library.
 *
 * The window's history has one owner, @mycity/ui's history (FRONTEND_FOUNDATION
 * F29), so Android's Back, the iPhone's edge swipe, a mouse's side buttons and
 * the hub's own controls agree. `navigate` decides what a step is: another
 * screen (the path or `tab`) or another record (`id`) adds one; any other key
 * (filters, `q`, `sort`, `page`, a modal's own) changes the step in place, so
 * Back returns to a list as it was left. A caller that knows better passes
 * `replace`.
 */
export interface Location {
  path: string;
  module: string | null;
  tab: string | null;
  id: string | null;
  params: URLSearchParams;
}

function read(): Location {
  const { pathname, search } = window.location;
  const params = new URLSearchParams(search);
  const seg = pathname.replace(/^\/+|\/+$/g, "").split("/")[0] || null;
  return { path: pathname, module: seg, tab: params.get("tab"), id: params.get("id"), params };
}

interface RouterValue {
  location: Location;
  /** Opens an address: a new step for another screen or record, in place otherwise; `replace` decides when given. */
  navigate: (to: string, opts?: { replace?: boolean }) => void;
  /** Sets or clears the question asked before leaving this screen (useLeaveGuard). */
  setGuard: (ask: LeaveGuard | null) => void;
  /**
   * Before the whole app reloads (F28): asks the screen holding unsaved work, if
   * any, as leaving it would; resolves true to go, and the browser then does not
   * ask a second time.
   */
  confirmLeave: () => Promise<boolean>;
}

/** Asks whether to leave the screen; resolves true to go. */
export type LeaveGuard = () => Promise<boolean>;

/** Set once the person has agreed to leave for a reload, so the browser's own question stays away. */
let leavingOnPurpose = false;

const RouterContext = createContext<RouterValue | null>(null);

/** Another screen (path or tab) or another record (id): a step of its own. */
function isStep(from: { pathname: string; search: string }, to: URL): boolean {
  const was = new URLSearchParams(from.search);
  return to.pathname !== from.pathname || to.searchParams.get("tab") !== was.get("tab") || to.searchParams.get("id") !== was.get("id");
}

export function RouterProvider({ children }: { children: ReactNode }) {
  // The history is started before the first render reads the address, so the entry it opens on is marked.
  const [location, setLocation] = useState(() => {
    startHistory();
    return read();
  });

  // Back and Forward (the phone's own included), a jump through the trail, and the device's last session put back.
  useEffect(() => onHistory((change) => change.kind === "pop" && setLocation(read())), []);

  const guard = useRef<LeaveGuard | null>(null);
  const setGuard = useCallback((ask: LeaveGuard | null) => {
    guard.current = ask;
  }, []);

  const navigate = useCallback((to: string, opts: { replace?: boolean } = {}) => {
    const url = new URL(to, window.location.origin);
    const next = url.pathname + url.search;
    if (next === window.location.pathname + window.location.search) return;
    const step = opts.replace === undefined ? isStep(window.location, url) : !opts.replace;
    const go = () => {
      if (step) pushStep(next);
      else replaceStep(next);
      setLocation(read());
    };
    // Another screen (path or tab) while one holds unsaved work: it asks first.
    const leaves = url.pathname !== window.location.pathname || url.searchParams.get("tab") !== new URLSearchParams(window.location.search).get("tab");
    const ask = guard.current;
    if (ask && leaves) {
      void ask().then((ok) => {
        if (!ok) return;
        guard.current = null;
        go();
      });
      return;
    }
    go();
  }, []);

  const confirmLeave = useCallback(async () => {
    const ask = guard.current;
    const ok = !ask || (await ask());
    // Only for the reload about to happen: if the page stays after all, the browser asks again next time.
    leavingOnPurpose = ok;
    if (ok) window.setTimeout(() => (leavingOnPurpose = false), 5000);
    return ok;
  }, []);

  const value = useMemo(() => ({ location, navigate, setGuard, confirmLeave }), [location, navigate, setGuard, confirmLeave]);
  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

export function useRouter(): RouterValue {
  const ctx = useContext(RouterContext);
  if (!ctx) throw new Error("useRouter outside RouterProvider");
  return ctx;
}

export { hrefFor, moduleKeyOf, segmentOf } from "./routes";

/**
 * While `active`, leaving this screen inside the app asks `ask` first, and
 * closing or reloading the tab asks through the browser. A screen with unsaved
 * work that is not inside a modal (a modal asks for itself) uses it.
 */
export function useLeaveGuard(active: boolean, ask: LeaveGuard): void {
  const { setGuard } = useRouter();
  const latest = useRef(ask);
  latest.current = ask;
  useEffect(() => {
    if (!active) return;
    setGuard(() => latest.current());
    const onUnload = (e: BeforeUnloadEvent) => {
      if (!leavingOnPurpose) e.preventDefault();
    };
    window.addEventListener("beforeunload", onUnload);
    return () => {
      setGuard(null);
      window.removeEventListener("beforeunload", onUnload);
    };
  }, [active, setGuard]);
}

/** Change some query keys on the current screen, keeping the rest. `null` removes a key. */
export function useSearchParams() {
  const { location, navigate } = useRouter();
  const set = useCallback(
    (changes: Record<string, string | null | undefined>, opts: { replace?: boolean } = {}) => {
      const params = new URLSearchParams(location.params);
      for (const [k, v] of Object.entries(changes)) {
        if (v == null || v === "") params.delete(k);
        else params.set(k, v);
      }
      const qs = params.toString();
      navigate(`${location.path}${qs ? `?${qs}` : ""}`, opts);
    },
    [location, navigate],
  );
  return [location.params, set] as const;
}

/** An in-app link: a real <a href> (open in new tab works), handled without a reload. */
export function Link({ to, onClick, ...rest }: { to: string } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  const { navigate } = useRouter();
  const handle = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(to);
  };
  return <a href={to} onClick={handle} {...rest} />;
}
