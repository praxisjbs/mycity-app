/**
 * @component SkylineHero
 * @group Shell
 * @summary The public site's hero, glass teal in light and Deep Green in dark: the page's heading over the drawn Lagos skyline. `index` fills the first screen under the header, the skyline blurred and slowly breathing, with a pill, one yellow accent word, a lede, a search and figures that count up; `role` heads a vacancy, All Roles at its top left and its foot fading into the page. l, m and pane are the earlier panels, lit as Lagos is lit right now.
 * @use size index for the site's front door (the careers index) and size role for a vacancy (the team as a gold pill, the role's facts as chips, its actions and a note), size page for an inner page's short head (Help: its title, at a role's size), each inside PublicPage layout full. l, m and pane stay for the pages not yet moved to the approved design.
 * @avoid The staff app; decoration under a page that has its own heading already; text more than a line.
 * @phone Edge to edge. index: still the first screen, 16 px at the sides, the search's button full width under its box, the figures closer; its lede is hidden (a page subtitle is desktop only). role: All Roles stays at the top left, the actions and the note are left off (the page's bar carries Apply). l and m: the heading 24 px, the skyline shorter, the line under the heading hidden. The pane becomes a compact band above the card (from 1040 px down), its `wide` part left off.
 * @a11y The heading is the page's h1 (data-ui page-title, or content when it names a record); the skyline, the scrim and the street grid are decorative (aria-hidden) and still under reduced motion, when the parts no longer rise and the figures show their value at once. A counting figure is read as its final value. All Roles is a link. index and role take the page's theme, their inks AA on its ground (tokens.css --site-*); the earlier panels take the dark theme's tokens, so they keep AA on Deep Green whatever the page's theme.
 * @status beta
 * @example <SkylineHero eyebrow="Careers at MyCityApp" title="Work With Us" text="Building the app that knows every Nigerian city." />
 * @example <SkylineHero size="m" eyebrow="Marketing & Sales" title="Partnerships Associate" facts={[{ icon: "pin", text: "Lagos" }]} />
 * @example <SkylineHero size="pane" record eyebrow="Your Application" title="Partnerships Associate" text="This link is yours until 12/11/2026." />
 * @example <SkylineHero size="index" eyebrow="Hiring in Lagos and Abuja" title="Work With Us" accent="Us" text="Building the app that knows every Nigerian city." stats={[{ value: 12, label: "Open Roles" }]}><SiteSearch tone="hero" ... /></SkylineHero>
 * @example <SkylineHero size="page" title="Here to Guide" />
 * @example <SkylineHero size="role" record back={{ label: "All Roles", href: "/jobs" }} eyebrow="Marketing & Sales" title="Head, Sales & Revenue" facts={facts} note="12 people have applied">{actions}</SkylineHero>
 */
import { lazy, Suspense, type ReactNode, type Ref } from "react";
import { cn } from "../lib/cn";
import { lagosHour, LAGOS_OFFSET, useMinute } from "../lib/lagos";
import { useMediaQuery } from "../lib/media";
import { content } from "../lib/slots";
import { Icon, type IconName } from "../icons/Icon";
import { CountUp } from "../display/CountUp";
import { Skyline } from "./Skyline.draw";
import { useSiteLink } from "./site-link";

const CityScene = lazy(() => import("../illustrations/CityShowcase.draw"));

export interface SkylineHeroProps {
  /** The page's heading: what the page is (Work With Us, the role's title, Question 2 of 7). */
  title: ReactNode;
  /** One short line over the heading: whose it is (Careers at MyCityApp, the role's department). */
  eyebrow?: ReactNode;
  /** One line under the heading. On l and m at most 8 words, desktop only; on the pane, a line the person needs (the link's expiry, a greeting), shown everywhere. */
  text?: ReactNode;
  /** The record's facts as chips on the panel, each a glyph and a few words (Lagos, Hybrid, Full Time). */
  facts?: ReadonlyArray<{ icon: IconName; text: string }>;
  /** What sits under the heading: a search field; on the pane, the clock and the progress. */
  children?: ReactNode;
  /** The pane only: what it adds where it stands beside the page (1041 px and wider), such as the steps; left off the compact band. */
  wide?: ReactNode;
  /** `index`: the site's front door, the first screen. `role`: a vacancy's head. `page`: a short head for an inner page, its title at a role's size and an optional line (Help). `l` (the default), `m` and `pane`: the earlier panels (a front door, a record's page, the context pane PublicPage stands beside a form). */
  size?: "index" | "role" | "page" | "l" | "m" | "pane";
  /** index and role: the word of a string `title` drawn in the brand yellow (Work With Us, accent Us). */
  accent?: string;
  /** index: the figures under the search, each counting up from 0 as the hero opens (Open Roles, Teams Hiring, Cities). */
  stats?: ReadonlyArray<{ value: number; label: string }>;
  /** role: the link back at the top left (All Roles); it goes through PublicPage's navigate. */
  back?: { label: string; href: string };
  /** role: a short line under the actions (12 people have applied); desktop only. */
  note?: ReactNode;
  /** The title names a record (a role, an assessment), so it is content, not interface copy: the copy gates skip it. */
  record?: boolean;
  /** The heading, for a page that moves focus to it (an assessment's next question). It takes focus without a ring. */
  titleRef?: Ref<HTMLHeadingElement>;
  /** Draws the skyline without motion even where motion is on (the gallery, a still picture). */
  still?: boolean;
  /** Layout classes only (spacing). */
  className?: string;
}

type PanelSize = "l" | "m" | "pane";

const SCENE: Record<PanelSize, string> = {
  l: "h-80 phone:h-48",
  m: "h-64 phone:h-40",
  pane: "h-20 lg:h-2/5",
};
const BODY: Record<PanelSize, string> = {
  l: "px-8 pt-12 pb-56 phone:px-4 phone:pt-8 phone:pb-40",
  m: "px-8 pt-9 pb-44 phone:px-4 phone:pt-6 phone:pb-36",
  pane: "px-8 pt-7 pb-16 phone:px-4 phone:pt-5 lg:px-9 lg:pt-10 lg:pb-52",
};
const TITLE: Record<PanelSize, string> = {
  l: "text-4xl phone:text-3xl",
  m: "text-3xl phone:text-2xl",
  pane: "text-3xl phone:text-2xl lg:text-4xl",
};

export function SkylineHero(props: SkylineHeroProps) {
  return props.size === "index" || props.size === "role" || props.size === "page" ? <SiteHero {...props} /> : <Panel {...props} />;
}

/** The title, with its accent word in the brand yellow. */
function withAccent(title: ReactNode, accent?: string): ReactNode {
  if (typeof title !== "string" || !accent) return title;
  const at = title.lastIndexOf(accent);
  if (at < 0) return title;
  return (
    <>
      {title.slice(0, at)}
      <em>{accent}</em>
      {title.slice(at + accent.length)}
    </>
  );
}

/**
 * The approved design's heroes: the drawn skyline under a scrim, the head centred over it, on the site's ground of the
 * page's theme (a deeper glass teal in light, Deep Green in dark; public.css maps --deep and the inks to it).
 */
function SiteHero({ title, eyebrow, text, facts, children, size, record, titleRef, still, className, accent, stats, back, note }: SkylineHeroProps) {
  const reduced = useMediaQuery("(prefers-reduced-motion: reduce)");
  const go = useSiteLink();
  const index = size === "index";
  const page = size === "page";
  const calm = still || reduced;
  return (
    <section data-size={size} data-still={calm || undefined} className={cn("ps-hero", index ? "ps-hero-index" : "ps-hero-role", page && "ps-hero-page", className)}>
      <div aria-hidden="true" className="ps-hero-art">
        <Skyline still={calm} />
      </div>
      <div aria-hidden="true" className="ps-hero-scrim" />
      {!index && back != null && (
        <div className="ps-role-top">
          <a className="ps-back ps-rise ps-rise-1" href={back.href} onClick={go(back.href)}>
            <Icon name="arrowleft" className="size-4.5" />
            {back.label}
          </a>
        </div>
      )}
      <div className="ps-hero-in">
        {eyebrow != null && (
          <span className={cn("ps-pill ps-rise ps-rise-1", !index && "ps-pill-gold")} {...(record ? content : {})}>
            {index && <span aria-hidden="true" className="ps-dot" />}
            {eyebrow}
          </span>
        )}
        <h1
          ref={titleRef}
          tabIndex={titleRef ? -1 : undefined}
          {...(record ? content : { "data-ui": "page-title" })}
          className="ps-rise ps-rise-2 outline-none"
        >
          {withAccent(title, accent)}
        </h1>
        {(index || page) && text != null && (
          <p data-ui="page-subtitle" className="ps-lede ps-rise ps-rise-3 phone:hidden">
            {text}
          </p>
        )}
        {!index && facts != null && facts.length > 0 && (
          <ul className="ps-chips ps-rise ps-rise-3" aria-label="About the role">
            {facts.map((f) => (
              <li key={`${f.icon}-${f.text}`} {...content} className="ps-chip">
                <Icon name={f.icon} />
                {f.text}
              </li>
            ))}
          </ul>
        )}
        {children != null && <div className={cn("ps-rise ps-rise-4", index ? "ps-hero-slot" : "ps-hero-acts")}>{children}</div>}
        {!index && note != null && <p className="ps-applied ps-rise ps-rise-5">{note}</p>}
        {index && stats != null && stats.length > 0 && (
          <dl className="ps-stats ps-rise ps-rise-5">
            {stats.map((s, k) => (
              <div key={s.label} className="ps-stat">
                <dt>{s.label}</dt>
                <dd>
                  <CountUp value={s.value} delay={500 + k * 120} />
                </dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </section>
  );
}

/** The earlier panels (l, m, pane): the heading over the skyline lit as Lagos is lit now. */
function Panel({ title, eyebrow, text, facts, children, wide, size = "l", record, titleRef, still, className }: SkylineHeroProps) {
  const now = useMinute();
  const reduced = useMediaQuery("(prefers-reduced-motion: reduce)");
  const calm = still || reduced;
  const pane = size === "pane";
  const panel: PanelSize = size === "m" || size === "pane" ? size : "l";
  return (
    <section
      data-size={size}
      data-theme="dark"
      className={cn(
        "on-dark relative isolate overflow-hidden rounded-sheet bg-deep text-on-deep phone:rounded-none",
        pane && "lg:flex lg:min-h-public-pane lg:flex-col",
        className,
      )}
    >
      <div aria-hidden="true" className="map-grid absolute inset-0 -z-20" />
      <div aria-hidden="true" className={cn("absolute inset-x-0 bottom-0 -z-10 animate-enter enter-delay-2", SCENE[panel])}>
        <Suspense fallback={null}>
          <CityScene city="lagos" hour={lagosHour(now)} offset={LAGOS_OFFSET} now={now} active still={calm} />
        </Suspense>
        {/* The sky's top edge fades into Deep Green, so the heading reads at any hour and the skyline keeps its own light. */}
        <div className={cn("absolute inset-x-0 top-0 bg-linear-to-b from-deep to-deep/0", pane ? "h-2/5" : "h-1/2 phone:h-2/5")} />
      </div>
      <div className={cn("relative flex flex-col gap-2", BODY[panel])}>
        {eyebrow != null && <p className="animate-enter text-xs font-strong tracking-wide text-on-deep-faint uppercase">{eyebrow}</p>}
        <h1
          ref={titleRef}
          tabIndex={titleRef ? -1 : undefined}
          {...(record ? content : { "data-ui": "page-title" })}
          className={cn("animate-enter font-heading leading-tight tracking-tight text-on-deep outline-none enter-delay-1", TITLE[panel])}
        >
          {title}
        </h1>
        {text != null && (
          <p
            {...(pane ? {} : { "data-ui": "page-subtitle" })}
            className={cn("max-w-prose animate-enter text-md text-on-deep-muted enter-delay-2", !pane && "phone:hidden")}
          >
            {text}
          </p>
        )}
        {facts != null && facts.length > 0 && (
          <ul className="mt-2 flex animate-enter list-none flex-wrap gap-2 p-0 enter-delay-3" aria-label="About the role">
            {facts.map((f) => (
              <li key={`${f.icon}-${f.text}`} {...content} className="inline-flex items-center gap-1.5 rounded-full border border-on-deep/20 bg-on-deep/10 px-3 py-1 text-xs font-strong text-on-deep">
                <Icon name={f.icon} className="text-on-deep-faint" />
                {f.text}
              </li>
            ))}
          </ul>
        )}
        {children != null && <div className={cn("mt-3 animate-enter enter-delay-3", pane && "lg:mt-6")}>{children}</div>}
        {pane && wide != null && <div className="mt-8 hidden animate-enter enter-delay-4 lg:block">{wide}</div>}
      </div>
    </section>
  );
}
