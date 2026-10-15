import { createContext, useCallback, useContext, useEffect, useState, type AnchorHTMLAttributes, type MouseEvent, type ReactNode } from "react";

/**
 * The public site's addresses (MILESTONES §6), short because a stranger reads them:
 *
 *   /jobs                  careers list, indexable
 *   /jobs/<slug>           one vacancy, readable slug, shareable
 *   /apply/<token>         opaque, one person, not indexable
 *   /assess/<token>        opaque
 *   /sign/<token>          opaque
 *   /verify/<number>       a reference, not a secret
 */
export type Route =
  | { page: "careers" }
  | { page: "vacancy"; slug: string }
  | { page: "apply"; token: string }
  | { page: "assess"; token: string }
  | { page: "sign"; token: string }
  | { page: "verify"; number: string | null }
  | { page: "not-found" };

export function parse(path: string): Route {
  const p = path.replace(/\/+$/, "") || "/";
  if (p === "/" || p === "/jobs") return { page: "careers" };
  if (p === "/verify") return { page: "verify", number: null };
  const m = /^\/(jobs|apply|assess|sign|verify)\/([^/]+)$/.exec(p);
  if (!m) return { page: "not-found" };
  const v = decodeURIComponent(m[2]);
  switch (m[1]) {
    case "jobs": return { page: "vacancy", slug: v };
    case "apply": return { page: "apply", token: v };
    case "assess": return { page: "assess", token: v };
    case "sign": return { page: "sign", token: v };
    default: return { page: "verify", number: v };
  }
}

const Ctx = createContext<{ path: string; navigate: (to: string, opts?: { replace?: boolean }) => void }>({ path: "/", navigate: () => {} });

export function RouterProvider({ children }: { children: ReactNode }) {
  const [path, setPath] = useState(() => window.location.pathname);
  useEffect(() => {
    const on = () => setPath(window.location.pathname);
    window.addEventListener("popstate", on);
    return () => window.removeEventListener("popstate", on);
  }, []);
  const navigate = useCallback((to: string, opts: { replace?: boolean } = {}) => {
    if (opts.replace) window.history.replaceState({}, "", to);
    else window.history.pushState({}, "", to);
    setPath(window.location.pathname);
    window.scrollTo(0, 0);
  }, []);
  return <Ctx.Provider value={{ path, navigate }}>{children}</Ctx.Provider>;
}

export const useRouter = () => useContext(Ctx);

/** An in-site link: a real <a href> (shareable, opens in a new tab) that navigates without a reload. */
export function Link({ to, onClick, ...rest }: { to: string } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  const { navigate } = useRouter();
  const go = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(to);
  };
  return <a href={to} onClick={go} {...rest} />;
}
