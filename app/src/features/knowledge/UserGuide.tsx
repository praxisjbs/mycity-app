import { useEffect, useMemo, useState } from "react";
import { useApi } from "@/api/hooks";
import { fetchBlob } from "@/api/download";
import { useRouter, useSearchParams } from "@/lib/router";
import { hrefFor, moduleKeyOf } from "@/lib/routes";
import type { GuideChapter, GuideContents } from "@mycity/contract/contract.gen.ts";
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Grid,
  GuideBody,
  Icon,
  ICON_NAMES,
  ImageViewer,
  LoadingRows,
  PageHeader,
  Pill,
  Reader,
  SegmentedControl,
  useModal,
  type GuideBlock,
  type GuideLinkFrom,
  type GuidePicture,
  type IconName,
} from "@mycity/ui";
import { clearGuideReturn, setGuideReturn } from "./guide/return";
import { GuideSearch } from "./guide/GuideSearch";

/**
 * Knowledge Hub · User Guide (`user-guide`, M0; docs/guides/user-guide.md). Two views of the same
 * guide: Quick Start, illustrated cards by role, and Full Guide, every chapter a reader may read
 * with its sections, tasks, steps and pictures. The server has already cut both to this person,
 * down to the step (§6.3), so nothing here decides who sees what.
 *
 * A step that names a screen opens it and leaves a marker (guide/return.ts); the shell's Back to
 * Guide chip brings the person back to the same step (`?id=<section or task>&step=<n>`). Help on
 * the floating button and User Guide in the account menu open it at the screen in view
 * (`?screen=<module>/<tab>`).
 *
 * Above both, the guide's search (guide/GuideSearch.tsx): its results take the guide's place while
 * a search is typed, and a result opens the Full Guide at its section or task, at the step.
 */
const MOCK = import.meta.env.VITE_API_MODE === "mock";

/** A picture that needs the session; the in-browser mock answers from the files beside the chapters. */
const fetchImage = MOCK
  ? (url: string) => import("@/api/mock/modules/user_guide").then((m) => m.mockPicture(url))
  : fetchBlob;

const imageUrl = (chapter: string, shot: string, device: "desktop" | "phone") =>
  `/api/v1/user-guide/images/${chapter}/${shot}.${device}.png`;

type View = "quick" | "full";
const VIEWS: Array<[View, string]> = [
  ["quick", "Quick Start"],
  ["full", "Full Guide"],
];

/** The Quick Start's role groups, in the order a new starter meets them. */
const ROLES = ["Everyone", "Line Managers", "People & HR", "Administrators"];

/** Where a slug sits: its chapter and its section (a task's slug sits in its section). */
function locate(contents: GuideContents | undefined, slug: string | null) {
  if (!contents || !slug) return null;
  for (const c of contents.chapters)
    for (const s of c.sections)
      if (s.slug === slug || s.tasks.some((t) => t.slug === slug)) return { chapter: c.slug, section: s.slug };
  return null;
}

/** The section about a screen (`people/employees`), for Help where you are. */
function sectionFor(contents: GuideContents | undefined, screen: string | null) {
  if (!contents || !screen) return null;
  for (const c of contents.chapters) for (const s of c.sections) if (s.screen === screen) return { chapter: c.slug, section: s.slug };
  return null;
}

export function UserGuide({ id }: { id: string | null }) {
  const [params, setParams] = useSearchParams();
  const contents = useApi("GET /api/v1/user-guide");
  const screen = params.get("screen");
  const asked = params.get("view") as View | null;
  const view: View = asked === "quick" || asked === "full" ? asked : id || screen ? "full" : "quick";

  return (
    <>
      <PageHeader title="User Guide" subtitle="How to use every screen">
        <SegmentedControl label="Guide View" value={view} onChange={(v) => setParams({ view: v })} options={VIEWS} />
      </PageHeader>
      {contents.error ? (
        <ErrorState error={contents.error} onRetry={contents.reload} />
      ) : !contents.data ? (
        <LoadingRows count={6} />
      ) : contents.data.chapters.length === 0 && contents.data.quick_start.length === 0 ? (
        <EmptyState title="Nothing To Read Yet" text="The guide's chapters appear here." icon="book" />
      ) : (
        <GuideSearch
          answers={contents.data.answers}
          voice={contents.data.voice}
          closeOn={view}
          onOpen={(hit) => setParams({ view: "full", id: hit.anchor, step: hit.step === null ? null : String(hit.step), screen: null })}
        >
          {view === "quick" ? <QuickStart /> : <FullGuide contents={contents.data} id={id} screen={screen} step={Number(params.get("step")) || null} />}
        </GuideSearch>
      )}
    </>
  );
}

/* ───────────── shared: links, pictures ───────────── */

/** What a link in the guide does: another section, or a screen to open and come back from. */
function useFollow(titleOf: (slug: string) => string) {
  const [, setParams] = useSearchParams();
  const { navigate } = useRouter();
  return (href: string, from: GuideLinkFrom) => {
    if (href.startsWith("#")) {
      setParams({ view: "full", id: href.slice(1), step: null, screen: null });
      return;
    }
    setGuideReturn({ id: from.anchor, step: from.step, title: titleOf(from.anchor) });
    navigate(href);
  };
}

/** A chapter's pictures by shot, with the files GuideBody draws. */
function picturesOf(chapter: GuideChapter) {
  const by = new Map(chapter.pictures.map((p) => [p.shot, p]));
  return (shot: string): GuidePicture | null => {
    const p = by.get(shot);
    if (!p) return null;
    return {
      desktop: p.devices.includes("desktop") ? imageUrl(chapter.slug, shot, "desktop") : null,
      phone: p.devices.includes("phone") ? imageUrl(chapter.slug, shot, "phone") : null,
      legend: p.legend,
    };
  };
}

/** A picture full size, fetched with the session. */
function Zoomed({ url, alt }: { url: string; alt: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let made: string | null = null;
    let live = true;
    fetchImage(url)
      .then((blob) => {
        if (!live) return;
        made = URL.createObjectURL(blob);
        setSrc(made);
      })
      .catch(() => live && setSrc(null));
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [url]);
  return src ? <ImageViewer src={src} alt={alt} height="lg" noOpen /> : <LoadingRows count={3} />;
}

function useZoom(chapter: GuideChapter | undefined) {
  const modal = useModal();
  return (shot: string) => {
    if (!chapter) return;
    const p = chapter.pictures.find((x) => x.shot === shot);
    if (!p) return;
    const device = p.devices.includes("desktop") ? "desktop" : "phone";
    modal.open({ title: "Picture", wide: true, body: <Zoomed url={imageUrl(chapter.slug, shot, device)} alt={shot} /> });
  };
}

/* ───────────── Full Guide ───────────── */

function FullGuide({ contents, id, screen, step }: { contents: GuideContents; id: string | null; screen: string | null; step: number | null }) {
  const [, setParams] = useSearchParams();
  const { navigate } = useRouter();
  const target = locate(contents, id) ?? sectionFor(contents, screen) ?? (contents.chapters[0]?.sections[0] ? { chapter: contents.chapters[0].slug, section: contents.chapters[0].sections[0].slug } : null);
  const chapter = useApi("GET /api/v1/user-guide/chapters/:slug", { params: { slug: target?.chapter ?? "" }, enabled: Boolean(target) });
  const zoom = useZoom(chapter.data);

  const titles = useMemo(() => {
    const out = new Map<string, string>();
    for (const c of contents.chapters)
      for (const s of c.sections) {
        out.set(s.slug, s.title);
        for (const t of s.tasks) out.set(t.slug, t.title);
      }
    return out;
  }, [contents]);
  const follow = useFollow((slug) => titles.get(slug) ?? "User Guide");

  /* Opened at a step: scroll to it once the chapter is drawn, and the way back is spent. */
  const anchor = id && step ? `${id}-step-${step}` : id;
  useEffect(() => {
    if (!chapter.data || !anchor) return;
    clearGuideReturn();
    document.getElementById(anchor)?.scrollIntoView?.({ block: "center" });
  }, [chapter.data, anchor]);

  if (!target) return <EmptyState title="Nothing To Read Yet" text="The guide's chapters appear here." icon="book" />;
  const groups = contents.chapters.map((c) => ({ label: c.title, items: c.sections.map((s) => ({ key: s.slug, title: s.title })) }));
  const section = chapter.data?.sections.find((s) => s.slug === target.section) ?? null;
  const picture = chapter.data ? picturesOf(chapter.data) : undefined;

  const openScreen = (slug: string, at: string) => {
    const [module, tab] = at.split("/");
    setGuideReturn({ id: slug, step: null, title: titles.get(slug) ?? "User Guide" });
    navigate(hrefFor(moduleKeyOf(module), tab));
  };

  return (
    <Reader groups={groups} selected={target.section} onSelect={(key) => setParams({ id: key, step: null, screen: null })} label="Chapters">
      {chapter.error ? (
        <ErrorState error={chapter.error} onRetry={chapter.reload} />
      ) : !section || !chapter.data ? (
        <LoadingRows count={6} />
      ) : (
        <div data-copy="content">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-border pb-4">
            <div className="min-w-0">
              <Pill tone="info">{chapter.data.title}</Pill>
              <h2 id={section.slug} className="mt-2 scroll-mt-24 text-2xl">
                {section.title}
              </h2>
            </div>
            {section.screen && (
              <Button icon="external" onClick={() => openScreen(section.slug, section.screen as string)}>
                Open Screen
              </Button>
            )}
          </div>
          <GuideBody blocks={section.blocks as GuideBlock[]} anchor={section.slug} picture={picture} fetchImage={fetchImage} onLink={follow} onZoom={zoom} highlight={id === section.slug ? step : null} />
          {section.tasks.map((t) => (
            <section key={t.slug} className="mt-6">
              <h3 id={t.slug} className="mb-2 scroll-mt-24 text-lg font-strong text-foreground">
                {t.title}
              </h3>
              <GuideBody blocks={t.blocks as GuideBlock[]} anchor={t.slug} picture={picture} fetchImage={fetchImage} onLink={follow} onZoom={zoom} highlight={id === t.slug ? step : null} />
            </section>
          ))}
        </div>
      )}
    </Reader>
  );
}

/* ───────────── Quick Start ───────────── */

function QuickStart() {
  const quick = useApi("GET /api/v1/user-guide/quick-start");
  const zoom = useZoom(quick.data);
  const titles = useMemo(() => new Map((quick.data?.sections ?? []).map((s) => [s.slug, s.title])), [quick.data]);
  const follow = useFollow((slug) => titles.get(slug) ?? "Quick Start");
  if (quick.error) return <ErrorState error={quick.error} onRetry={quick.reload} />;
  if (!quick.data) return <LoadingRows count={6} />;
  if (quick.data.sections.length === 0) return <EmptyState title="Nothing To Read Yet" text="The Quick Start's cards appear here." icon="book" />;
  const data = quick.data;
  const picture = picturesOf(data);
  const roles = [...ROLES, ...data.sections.map((s) => s.role ?? "").filter((r) => r && !ROLES.includes(r))];
  return (
    <div data-copy="content">
      {roles.map((role) => {
        const cards = data.sections.filter((s) => (s.role ?? "Everyone") === role);
        if (!cards.length) return null;
        return (
          <section key={role} className="mb-6">
            <h2 className="mb-3 text-lg font-strong text-foreground">{role}</h2>
            <Grid cols={2}>
              {cards.map((s) => (
                <Card key={s.slug}>
                  <div className="mb-3 flex items-center gap-3">
                    <span className="flex size-10 flex-none items-center justify-center rounded-box bg-accent text-accent-foreground">
                      <Icon name={ICON_NAMES.includes(s.icon as IconName) ? (s.icon as IconName) : "book"} size="m" />
                    </span>
                    <h3 id={s.slug} className="text-md font-strong text-foreground">
                      {s.title}
                    </h3>
                  </div>
                  <GuideBody blocks={s.blocks as GuideBlock[]} anchor={s.slug} picture={picture} fetchImage={fetchImage} onLink={follow} onZoom={zoom} />
                </Card>
              ))}
            </Grid>
          </section>
        );
      })}
    </div>
  );
}
