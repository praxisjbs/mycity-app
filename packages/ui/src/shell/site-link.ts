import { createContext, useCallback, useContext, type MouseEvent } from "react";

/**
 * How the public site moves between its pages without a reload. PublicPage provides the site's own
 * `navigate` (its router's); every link it and the heroes inside it draw (the brand, the nav, the
 * menu, the footer, All Roles) is a real <a href>, so it can be shared or opened in a new tab, and a
 * plain click on one of the site's own paths goes through `navigate` instead. A path with a #part
 * ("/#hire") scrolls to that part once the page is there. Without a navigate, links load as links.
 */
export const SiteNavigate = createContext<((href: string) => void) | undefined>(undefined);

/** The site's own path, with no scheme or host ("/jobs", "/#build"). */
const own = (href: string) => href.startsWith("/") && !href.startsWith("//");

/** Scrolls to the part a link names, once the page it opens has drawn it. */
function scrollToPart(href: string) {
  const hash = href.split("#")[1];
  if (!hash) return;
  window.setTimeout(() => document.getElementById(decodeURIComponent(hash))?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
}

/** The click handler for one of the public site's links: `onClick={go("/jobs")}`. */
export function useSiteLink(after?: () => void) {
  const navigate = useContext(SiteNavigate);
  return useCallback(
    (href: string) => (e: MouseEvent<HTMLAnchorElement>) => {
      after?.();
      if (!navigate || !own(href) || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      navigate(href);
      scrollToPart(href);
    },
    [navigate, after],
  );
}
