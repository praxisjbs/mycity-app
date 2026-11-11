import { createContext, useCallback, useContext, useEffect, useState, type AnchorHTMLAttributes, type MouseEvent, type ReactNode } from "react";

/**
 * The public site's addresses (MILESTONES §6), short because a stranger reads them:
 *
 *   /                      the index (Work With Us), indexable
 *   /jobs                  every open role (the header's Vacancy), indexable; ?q= and ?department=<code> narrow it
 *   /vacancy, /jobs/       the same list: the address is put back to /jobs
 *   /jobs/<slug>           one vacancy, readable slug, shareable
 *   /apply/<token>         opaque, one person, not indexable
 *   /assess/<token>        opaque
 *   /sign/<token>          opaque
 *   /verify/<number>       a reference, not a secret
 *   /verify/t/<token>      the QR on a sealed document: the record and the document itself
 *   /proposal/<token>      opaque, one proposal, not indexable (M7)
 *   /help                  how the site works, indexable (the User Guide's public chapter)
 *
 * Apply, assessment and signing are reached from personal links, not the header. Their tokenless
 * paths retain guidance screens when opened directly: /apply, /assess, /sign. Vacancy's link opens
 * the open roles, and a role opened from them stays under Vacancy.
 */
export type Route =
  | { page: "home" }
  | { page: "careers" }
  | { page: "vacancy"; slug: string }
  | { page: "guide"; of: "apply" | "assess" | "sign" }
  | { page: "apply"; token: string }
  | { page: "assess"; token: string }
  | { page: "sign"; token: string }
  | { page: "verify"; number: string | null }
  | { page: "verify-qr"; token: string }
  | { page: "proposal"; token: string }
  | { page: "help" }
  | { page: "not-found" };

export function parse(path: string): Route {
  const p = path.replace(/\/+$/, "") || "/";
  if (p === "/") return { page: "home" };
  if (p === "/jobs" || p === "/vacancy") return { page: "careers" };
  if (p === "/apply" || p === "/assess" || p === "/sign") return { page: "guide", of: p.slice(1) as "apply" | "assess" | "sign" };
  if (p === "/verify") return { page: "verify", number: null };
  if (p === "/help") return { page: "help" };
  const qr = /^\/verify\/t\/([^/]+)$/.exec(p);
  if (qr) return { page: "verify-qr", token: decodeURIComponent(qr[1]!) };
  const m = /^\/(jobs|apply|assess|sign|verify|proposal)\/([^/]+)$/.exec(p);
  if (!m) return { page: "not-found" };
  const v = decodeURIComponent(m[2]!);
  switch (m[1]) {
    case "jobs": return { page: "vacancy", slug: v };
    case "apply": return { page: "apply", token: v };
    case "assess": return { page: "assess", token: v };
    case "sign": return { page: "sign", token: v };
    case "proposal": return { page: "proposal", token: v };
    default: return { page: "verify", number: v };
  }
}

/** The header's public entry points, left to right. */
export const NAV = [
  { label: "Vacancy", href: "/jobs" },
  { label: "Verify Document", href: "/verify" },
  { label: "Help", href: "/help" },
] as const;

type Section = "Vacancy" | "Apply" | "Assessment" | "Sign Offer" | "Verify Document" | "Help";

/** Which header section a route belongs to; token pages may have no visible header link. */
export function sectionOf(r: Route): Section | null {
  switch (r.page) {
    case "careers":
    case "vacancy": return "Vacancy";
    case "guide": return ({ apply: "Apply", assess: "Assessment", sign: "Sign Offer" } as const)[r.of];
    case "apply": return "Apply";
    case "assess": return "Assessment";
    case "sign": return "Sign Offer";
    case "verify":
    case "verify-qr": return "Verify Document";
    case "help": return "Help";
    default: return null;
  }
}

type Nav = (to: string, opts?: { replace?: boolean }) => void;
const Ctx = createContext<{ path: string; search: string; navigate: Nav }>({ path: "/", search: "", navigate: () => {} });

/** Scrolls to the part a #fragment names, once the page it opens has drawn it. */
const scrollToPart = (hash: string) =>
  window.setTimeout(() => document.getElementById(decodeURIComponent(hash))?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);

export function RouterProvider({ children }: { children: ReactNode }) {
  const [where, setWhere] = useState(() => ({ path: window.location.pathname, search: window.location.search }));
  useEffect(() => {
    const on = () => setWhere({ path: window.location.pathname, search: window.location.search });
    window.addEventListener("popstate", on);
    return () => window.removeEventListener("popstate", on);
  }, []);
  const navigate = useCallback<Nav>((to, opts = {}) => {
    if (opts.replace) window.history.replaceState({}, "", to);
    else window.history.pushState({}, "", to);
    setWhere({ path: window.location.pathname, search: window.location.search });
    window.scrollTo(0, 0);
    const hash = to.split("#")[1];
    if (hash) scrollToPart(hash);
  }, []);
  return <Ctx.Provider value={{ ...where, navigate }}>{children}</Ctx.Provider>;
}

export const useRouter = () => useContext(Ctx);

/** One value of the address's query (?q=, ?department=), read as the page opens. */
export function useSearchParam(name: string): string | null {
  const { search } = useRouter();
  return new URLSearchParams(search).get(name);
}

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
