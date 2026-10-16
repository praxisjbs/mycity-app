import { useEffect, type ReactNode } from "react";
import { Brand, PublicPage } from "@mycity/ui";
import { Link } from "@/lib/router";
import { DemoLinks } from "./DemoLinks";

/**
 * Every public page (go.mycityapp.io), on PublicPage from @mycity/ui: the mark
 * linking to the careers list, the page on its card, the footer links. `index`
 * decides whether search engines may list the page: only the careers list and
 * an open vacancy may (MILESTONES §6); every token page says noindex.
 * `brandInCard`: the page draws the mark inside its card, so the header leaves it out.
 */
export function Page({ title, index = false, brandInCard = false, children, below }: { title: string; index?: boolean; brandInCard?: boolean; children: ReactNode; below?: ReactNode }) {
  useEffect(() => {
    document.title = `${title} · MyCity App`;
    let meta = document.querySelector<HTMLMetaElement>('meta[name="robots"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "robots";
      document.head.appendChild(meta);
    }
    meta.content = index ? "index, follow" : "noindex, nofollow";
  }, [title, index]);
  return (
    <PublicPage
      brand={
        brandInCard ? undefined : (
          <Link to="/jobs" aria-label="MyCityApp careers" className="no-underline">
            <Brand name="MyCityApp" />
          </Link>
        )
      }
      below={below}
      links={
        <>
          <Link to="/jobs" className="hover:text-foreground">
            Careers
          </Link>
          <Link to="/verify" className="hover:text-foreground">
            Verify a Document
          </Link>
        </>
      }
      foot={import.meta.env.VITE_API_MODE === "mock" ? <DemoLinks /> : undefined}
    >
      {children}
    </PublicPage>
  );
}
