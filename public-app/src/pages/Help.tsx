import { useEffect, useMemo } from "react";
import { Card, ErrorState, GuideBody, Icon, ICON_NAMES, SectionNav, Skeleton, SkylineHero, StickyColumns, type GuideBlock, type GuideLinkFrom, type GuidePicture, type IconName, type SectionNavItem } from "@mycity/ui";
import type { GuideChapter } from "@mycity/contract/contract.gen.ts";
import { useApi } from "@/api/hooks";
import { useRouter } from "@/lib/router";
import { Page } from "@/shell/Page";

const MOCK = import.meta.env.VITE_API_MODE === "mock";

/** The site's own address, as the chapter links it: those links open here, not in a new tab. */
const HOME = "https://go.mycityapp.io";

/** A picture's file: public, so the page draws its address; the in-browser mock answers from the files beside the chapter. */
const fetchImage = MOCK ? (url: string) => import("@/api/mock/help").then((m) => m.mockPicture(url)) : undefined;
const imageUrl = (shot: string, device: "desktop" | "phone") => `/api/public/v1/help/images/${shot}.${device}.png`;

const iconOf = (name: string | null): IconName => (ICON_NAMES.includes(name as IconName) ? (name as IconName) : "help");

/** The chapter's pictures by shot: the computer's on a computer, the phone's on a phone. */
function picturesOf(chapter: GuideChapter) {
  const by = new Map(chapter.pictures.map((p) => [p.shot, p]));
  return (shot: string): GuidePicture | null => {
    const p = by.get(shot);
    if (!p) return null;
    return {
      desktop: p.devices.includes("desktop") ? imageUrl(shot, "desktop") : null,
      phone: p.devices.includes("phone") ? imageUrl(shot, "phone") : null,
      legend: p.legend,
    };
  };
}

/** Where a part of the page is, under the header (and the contents row on a phone). */
const scrollToPart = (id: string) => {
  document.getElementById(id)?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  window.history.replaceState(window.history.state, "", `#${id}`);
};

/**
 * Help (`/help`, #108): how the site works, for anyone outside MyCity. The User Guide's public
 * chapter (docs/manual/public-site.md, `kind: public-help`), as the API sends it: Here to Guide over
 * the skyline at a role's title size, then its sections, each a card of numbered steps with the site's own pictures. On desktop
 * the contents stand at the left and mark the section being read; on a phone they are a row under the
 * header. A link to another section scrolls to it, a link to a page of the site opens it here.
 */
export function Help() {
  const help = useApi("GET /api/public/v1/help");
  const { navigate } = useRouter();
  const d = help.data;
  const picture = useMemo(() => (d ? picturesOf(d) : undefined), [d]);
  const items: SectionNavItem[] = useMemo(() => (d?.sections ?? []).map((s) => ({ id: s.slug, label: s.title, icon: iconOf(s.icon) })), [d]);

  /* Opened at a section (/help#public-apply): scroll to it once the chapter is drawn. */
  useEffect(() => {
    const at = decodeURIComponent(window.location.hash.slice(1));
    if (d && at) document.getElementById(at)?.scrollIntoView?.({ block: "start" });
  }, [d]);

  const follow = (href: string, _from: GuideLinkFrom) => {
    if (href.startsWith("#")) return scrollToPart(href.slice(1));
    if (href.startsWith("/help#")) return scrollToPart(href.slice(6));
    navigate(href);
  };

  return (
    <Page title="Help" index>
      <SkylineHero size="page" title="Here to Guide" />
      <section aria-label="Help" className="pt-9 pb-24 phone:pt-0 phone:pb-18">
        <div className="public-wrap">
          {help.error ? (
            <ErrorState error={help.error} onRetry={help.reload} />
          ) : !d ? (
            <div aria-busy="true" className="flex flex-col gap-6 py-6">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} lines={4} />
              ))}
            </div>
          ) : (
            <>
              <SectionNav variant="bar" label="Help Sections" items={items} />
              <StickyColumns layout="aside">
                <SectionNav label="Help Contents" title="On This Page" items={items} />
                <div data-copy="content" className="flex flex-col gap-6 max-lg:pt-6">
                  {d.intro.length > 0 && <GuideBody blocks={d.intro as GuideBlock[]} anchor={d.slug} onLink={follow} home={HOME} className="text-base" />}
                  {d.sections.map((s) => (
                    <Card key={s.slug} as="section" aria-labelledby={s.slug}>
                      <div className="mb-4 flex items-center gap-3">
                        <span aria-hidden="true" className="flex size-10 flex-none items-center justify-center rounded-box bg-accent text-accent-foreground">
                          <Icon name={iconOf(s.icon)} size="m" />
                        </span>
                        <h2 id={s.slug} className="scroll-mt-24 text-2xl max-lg:scroll-mt-40 phone:text-xl">
                          {s.title}
                        </h2>
                      </div>
                      <GuideBody blocks={s.blocks as GuideBlock[]} anchor={s.slug} picture={picture} fetchImage={fetchImage} onLink={follow} home={HOME} className="text-base" />
                      {s.tasks.map((t) => (
                        <section key={t.slug} aria-labelledby={t.slug} className="mt-6">
                          <h3 id={t.slug} className="mb-2 scroll-mt-24 text-lg font-strong text-foreground max-lg:scroll-mt-40">
                            {t.title}
                          </h3>
                          <GuideBody blocks={t.blocks as GuideBlock[]} anchor={t.slug} picture={picture} fetchImage={fetchImage} onLink={follow} home={HOME} className="text-base" />
                        </section>
                      ))}
                    </Card>
                  ))}
                </div>
              </StickyColumns>
            </>
          )}
        </div>
      </section>
    </Page>
  );
}
