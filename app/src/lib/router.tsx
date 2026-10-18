import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type AnchorHTMLAttributes, type MouseEvent, type ReactNode } from "react";

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
  navigate: (to: string, opts?: { replace?: boolean }) => void;
  /** Sets or clears the question asked before leaving this screen (useLeaveGuard). */
  setGuard: (ask: LeaveGuard | null) => void;
}

/** Asks whether to leave the screen; resolves true to go. */
export type LeaveGuard = () => Promise<boolean>;

const RouterContext = createContext<RouterValue | null>(null);

export function RouterProvider({ children }: { children: ReactNode }) {
  const [location, setLocation] = useState(read);

  useEffect(() => {
    const onPop = () => setLocation(read());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const guard = useRef<LeaveGuard | null>(null);
  const setGuard = useCallback((ask: LeaveGuard | null) => {
    guard.current = ask;
  }, []);

  const navigate = useCallback((to: string, opts: { replace?: boolean } = {}) => {
    const url = new URL(to, window.location.origin);
    const next = url.pathname + url.search;
    if (next === window.location.pathname + window.location.search) return;
    const go = () => {
      if (opts.replace) window.history.replaceState(null, "", next);
      else window.history.pushState(null, "", next);
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

  const value = useMemo(() => ({ location, navigate, setGuard }), [location, navigate, setGuard]);
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
    const onUnload = (e: BeforeUnloadEvent) => e.preventDefault();
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
