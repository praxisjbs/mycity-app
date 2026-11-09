import { useEffect } from "react";
import { PublicPage, type PublicPageProps } from "@mycity/ui";
import { NAV, parse, sectionOf, useRouter } from "@/lib/router";
import { DemoLinks } from "./DemoLinks";

/**
 * Every public page (go.mycityapp.io), on PublicPage from @mycity/ui: the header's three public
 * links (the current page marked), the brand opening the index, the site's router for its links, and
 * in mock mode the demo links at the foot. `title` names the tab and, in the split layout, is the
 * page's small h1. `index` decides whether search engines may list the page: only the index, the
 * careers list and an open vacancy may (MILESTONES §6); every token page says noindex.
 */
export function Page({ title, index = false, ...rest }: { title: string; index?: boolean } & Omit<PublicPageProps, "title" | "nav" | "navigate" | "brandSub" | "foot">) {
  const { path, navigate } = useRouter();
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
  const here = sectionOf(parse(path));
  return (
    <PublicPage
      {...rest}
      title={title}
      navigate={navigate}
      brandSub="Careers"
      nav={NAV.map((n) => ({ ...n, current: n.label === here }))}
      foot={import.meta.env.VITE_API_MODE === "mock" ? <DemoLinks /> : undefined}
    />
  );
}
