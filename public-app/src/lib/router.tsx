import { createContext, useCallback, useContext, useEffect, useState, type AnchorHTMLAttributes, type MouseEvent, type ReactNode } from "react";

/**
 * The public site's addresses (MILESTONES §6), short because a stranger reads them:
 *
 *   /                      the index (Work With Us), indexable
 *   /jobs                  careers list, indexable; ?q= and ?department=<code> narrow it
 *   /jobs/<slug>           one vacancy, readable slug, shareable
 *   /apply/<token>         opaque, one person, not indexable
 *   /assess/<token>        opaque
 *   /sign/<token>          opaque
 *   /verify/<number>       a reference, not a secret
 *   /verify/t/<token>      the QR on a sealed document: the record and the document itself
 *   /proposal/<token>      opaque, one proposal, not indexable (M7)
 *
 * The header's links reach every page, so the four a person is sent to by a link of their own
 * have a guidance screen when opened without one: /vacancy (and /jobs/), /apply, /assess, /sign.
 */
export type Route =
  | { page: "home" }
  | { page: "careers" }
  | { page: "vacancy"; slug: string }
  | { page: "guide"; of: "vacancy" | "apply" | "assess" | "sign" }
  | { page: "apply"; token: string }
  | { page: "assess"; token: string }
  | { page: "sign"; token: string }
  | { page: "verify"; number: string | null }
  | { page: "verify-qr"; token: string }
  | { page: "proposal"; token: string }
  | { page: "not-found" };

export function parse(path: string): Route {
  if (path === "/jobs/") return { page: "guide", of: "vacancy" };
  const p = path.replace(/\/+$/, "") || "/";
  if (p === "/") return { page: "home" };
  if (p === "/jobs") return { page: "careers" };
  if (p === "/vacancy") return { page: "guide", of: "vacancy" };
  if (p === "/apply" || p === "/assess" || p === "/sign") return { page: "guide", of: p.slice(1) as "apply" | "assess" | "sign" };
  if (p === "/verify") return { page: "verify", number: null };
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

/** The header's six links, left to right, and the one each page marks as current. */
export const NAV = [
  { label: "Careers", href: "/jobs" },
  { label: "Vacancy", href: "/vacancy" },
  { label: "Apply", href: "/apply" },
  { label: "Assessment", href: "/assess" },
  { label: "Sign Offer", href: "/sign" },
  { label: "Verify Document", href: "/verify" },
] as const;

/** Which header link a route belongs to; the index belongs to none. */
export function sectionOf(r: Route): (typeof NAV)[number]["label"] | null {
  switch (r.page) {
    case "careers": return "Careers";
    case "vacancy": return "Vacancy";
    case "guide": return ({ vacancy: "Vacancy", apply: "Apply", assess: "Assessment", sign: "Sign Offer" } as const)[r.of];
    case "apply": return "Apply";
    case "assess": return "Assessment";
    case "sign": return "Sign Offer";
    case "verify":
    case "verify-qr": return "Verify Document";
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
