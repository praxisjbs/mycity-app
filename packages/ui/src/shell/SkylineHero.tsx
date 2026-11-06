/**
 * @component SkylineHero
 * @group Shell
 * @summary The public site's Deep Green panel: the page's heading over the drawn Lagos skyline, lit as Lagos is lit right now (day, dusk, night, its windows coming on after dark). A hero across the top, or the context pane beside a form.
 * @use The head of a public page that invites a stranger in: Careers (size l, with the search under the heading) and a Vacancy (size m, with the role's facts as chips). size pane is the context pane PublicPage stands beside a page a person works through (Apply, an Assessment): its identity, its facts, and for a running assessment the clock and the progress.
 * @avoid The staff app; decoration under a page that has its own heading already; text more than a line.
 * @phone Edge to edge, the heading 24 px, the skyline shorter so the first screen still shows the page under it; the line under the heading is hidden (a page subtitle is desktop only). The pane becomes a compact band above the card (from 1040 px down), its `wide` part left off.
 * @a11y The heading is the page's h1 (data-ui page-title, or content when it names a record); the skyline and the street grid are decorative (aria-hidden) and still under reduced motion. The panel takes the dark theme's tokens, so what sits on it (a clock, a progress bar) keeps AA on Deep Green whatever the page's theme.
 * @status beta
 * @example <SkylineHero eyebrow="Careers at MyCityApp" title="Work With Us" text="Building the app that knows every Nigerian city." />
 * @example <SkylineHero size="m" eyebrow="Marketing & Sales" title="Partnerships Associate" facts={[{ icon: "pin", text: "Lagos" }]} />
 * @example <SkylineHero size="pane" record eyebrow="Your Application" title="Partnerships Associate" text="This link is yours until 12/11/2026." />
 */
import { lazy, Suspense, type ReactNode, type Ref } from "react";
import { cn } from "../lib/cn";
import { lagosHour, LAGOS_OFFSET, useMinute } from "../lib/lagos";
import { useMediaQuery } from "../lib/media";
import { content } from "../lib/slots";
import { Icon, type IconName } from "../icons/Icon";

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
  /** `l` (the default) for a page's front door, `m` for a record's page (a role), `pane` for the context pane beside a form (PublicPage `pane`). */
  size?: "l" | "m" | "pane";
  /** The title names a record (a role, an assessment), so it is content, not interface copy: the copy gates skip it. */
  record?: boolean;
  /** The heading, for a page that moves focus to it (an assessment's next question). It takes focus without a ring. */
  titleRef?: Ref<HTMLHeadingElement>;
  /** Draws the skyline without motion even where motion is on (the gallery, a still picture). */
  still?: boolean;
  /** Layout classes only (spacing). */
  className?: string;
}

const SCENE = {
  l: "h-80 phone:h-48",
  m: "h-64 phone:h-40",
  pane: "h-20 lg:h-2/5",
} as const;
const BODY = {
  l: "px-8 pt-12 pb-56 phone:px-4 phone:pt-8 phone:pb-40",
  m: "px-8 pt-9 pb-44 phone:px-4 phone:pt-6 phone:pb-36",
  pane: "px-8 pt-7 pb-16 phone:px-4 phone:pt-5 lg:px-9 lg:pt-10 lg:pb-52",
} as const;
const TITLE = {
  l: "text-4xl phone:text-3xl",
  m: "text-3xl phone:text-2xl",
  pane: "text-3xl phone:text-2xl lg:text-4xl",
} as const;

export function SkylineHero({ title, eyebrow, text, facts, children, wide, size = "l", record, titleRef, still, className }: SkylineHeroProps) {
  const now = useMinute();
  const reduced = useMediaQuery("(prefers-reduced-motion: reduce)");
  const calm = still || reduced;
  const pane = size === "pane";
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
      <div aria-hidden="true" className={cn("absolute inset-x-0 bottom-0 -z-10 animate-enter enter-delay-2", SCENE[size])}>
        <Suspense fallback={null}>
          <CityScene city="lagos" hour={lagosHour(now)} offset={LAGOS_OFFSET} now={now} active still={calm} />
        </Suspense>
        {/* The sky's top edge fades into Deep Green, so the heading reads at any hour and the skyline keeps its own light. */}
        <div className={cn("absolute inset-x-0 top-0 bg-linear-to-b from-deep to-deep/0", pane ? "h-2/5" : "h-1/2 phone:h-2/5")} />
      </div>
      <div className={cn("relative flex flex-col gap-2", BODY[size])}>
        {eyebrow != null && <p className="animate-enter text-xs font-strong tracking-wide text-on-deep-faint uppercase">{eyebrow}</p>}
        <h1
          ref={titleRef}
          tabIndex={titleRef ? -1 : undefined}
          {...(record ? content : { "data-ui": "page-title" })}
          className={cn("animate-enter font-heading leading-tight tracking-tight text-on-deep outline-none enter-delay-1", TITLE[size])}
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
