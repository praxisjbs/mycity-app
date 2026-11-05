/**
 * @component SkylineHero
 * @group Shell
 * @summary The public site's top panel: the page's heading on Deep Green over the drawn Lagos skyline, lit as Lagos is lit right now (day, dusk, night, its windows coming on after dark).
 * @use The head of a public page that invites a stranger in: Careers (size l, with the search under the heading) and a Vacancy (size m, with the role's facts as chips).
 * @avoid The staff app; a page a person is working through (Apply, an Assessment: they keep their card); decoration under a page that has its own heading already; text more than a line.
 * @phone Edge to edge, the heading 24 px, the skyline shorter so the first screen still shows the list under it; the line under the heading is hidden (a page subtitle is desktop only).
 * @a11y The heading is the page's h1 (data-ui page-title); the skyline is decorative (aria-hidden) and still under reduced motion. The heading sits on Deep Green whatever the hour, so it keeps AA over a pale midday sky.
 * @status beta
 * @example <SkylineHero eyebrow="Careers at MyCityApp" title="Work With Us" text="Building the app that knows every Nigerian city." />
 * @example <SkylineHero size="m" eyebrow="Marketing & Sales" title="Partnerships Associate" facts={[{ icon: "pin", text: "Lagos" }]} />
 */
import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { cn } from "../lib/cn";
import { useMediaQuery } from "../lib/media";
import { content } from "../lib/slots";
import { Icon, type IconName } from "../icons/Icon";

const CityScene = lazy(() => import("../illustrations/CityShowcase.draw"));

export interface SkylineHeroProps {
  /** The page's heading: what the page is (Work With Us, the role's title). */
  title: ReactNode;
  /** One short line over the heading: whose it is (Careers at MyCityApp, the role's department). */
  eyebrow?: ReactNode;
  /** One line under the heading, at most 8 words, desktop only. */
  text?: ReactNode;
  /** The record's facts as chips on the panel, each a glyph and a few words (Lagos, Hybrid, Full Time). */
  facts?: ReadonlyArray<{ icon: IconName; text: string }>;
  /** What sits under the heading: a search field. */
  children?: ReactNode;
  /** `l` (the default) for a page's front door, `m` for a record's page (a role). */
  size?: "l" | "m";
  /** Draws the skyline without motion even where motion is on (the gallery, a still picture). */
  still?: boolean;
  /** Layout classes only (spacing). */
  className?: string;
}

/** Lagos keeps UTC+1 all year, so its hour comes straight from the clock. */
const LAGOS_OFFSET = 1;
const lagosHour = (now: Date) => (now.getUTCHours() + LAGOS_OFFSET + now.getUTCMinutes() / 60) % 24;

/** The time now, read again each minute: the sky moves on with the city. */
function useMinute(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(t);
  }, []);
  return now;
}

export function SkylineHero({ title, eyebrow, text, facts, children, size = "l", still, className }: SkylineHeroProps) {
  const now = useMinute();
  const reduced = useMediaQuery("(prefers-reduced-motion: reduce)");
  const calm = still || reduced;
  return (
    <section
      data-size={size}
      className={cn("relative isolate overflow-hidden rounded-sheet bg-deep text-on-deep phone:rounded-none", className)}
    >
      <div aria-hidden="true" className={cn("absolute inset-x-0 bottom-0 -z-10", size === "l" ? "h-64 phone:h-48" : "h-56 phone:h-40")}>
        <Suspense fallback={null}>
          <CityScene city="lagos" hour={lagosHour(now)} offset={LAGOS_OFFSET} now={now} active still={calm} />
        </Suspense>
        {/* The sky's top edge fades into Deep Green, so the heading reads at any hour and the skyline keeps its own light. */}
        <div className="absolute inset-x-0 top-0 h-2/5 bg-linear-to-b from-deep to-deep/0" />
      </div>
      <div
        className={cn(
          "relative flex flex-col gap-2 px-8 phone:px-4",
          size === "l" ? "pt-12 pb-56 phone:pt-8 phone:pb-40" : "pt-9 pb-44 phone:pt-6 phone:pb-36",
        )}
      >
        {eyebrow != null && <p className="text-xs font-strong tracking-wide text-on-deep-faint uppercase">{eyebrow}</p>}
        <h1
          data-ui="page-title"
          className={cn("font-heading leading-tight tracking-tight text-on-deep", size === "l" ? "text-4xl phone:text-3xl" : "text-3xl phone:text-2xl")}
        >
          {title}
        </h1>
        {text != null && (
          <p data-ui="page-subtitle" className="max-w-prose text-md text-on-deep-muted phone:hidden">
            {text}
          </p>
        )}
        {facts != null && facts.length > 0 && (
          <ul className="mt-2 flex list-none flex-wrap gap-2 p-0" aria-label="About the role">
            {facts.map((f) => (
              <li key={`${f.icon}-${f.text}`} {...content} className="inline-flex items-center gap-1.5 rounded-full border border-on-deep/20 bg-on-deep/10 px-3 py-1 text-xs font-strong text-on-deep">
                <Icon name={f.icon} className="text-on-deep-faint" />
                {f.text}
              </li>
            ))}
          </ul>
        )}
        {children != null && <div className="mt-3">{children}</div>}
      </div>
    </section>
  );
}
