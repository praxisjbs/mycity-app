/**
 * @component PageIntro
 * @group Layout
 * @summary An inner public page's opening: a spaced capital eyebrow, a large headline with one accent word in the brand green, a lede, an optional part at the right (a search), and a hairline under it all; each part rises in turn as the page opens.
 * @use The head of an inner page of the public site (Open Roles), inside PublicPage layout full, where the index has its SkylineHero.
 * @avoid The staff app (use PageHeader); a page that opens on a hero; a record's own page (a role: SkylineHero size role); a sign-in page (PublicPage layout split carries its title).
 * @phone The right-hand part moves under the headline (from 1040 px down), the eyebrow's spacing tightens, and the lede is left off (a page subtitle is desktop only).
 * @a11y The headline is the page's h1 (data-ui page-title, at most 3 words); the accent word is part of it, not a separate name. The hairline is a separator. Under reduced motion the parts are simply there.
 * @status beta
 * @example <PageIntro eyebrow="Careers at MyCityApp" title="Open Roles" accent="Roles" text="12 roles across 7 teams, in Lagos and Abuja." aside={<SiteSearch tone="intro" ... />} />
 */
import type { ReactNode } from "react";
import { cn } from "../lib/cn";

export interface PageIntroProps {
  /** The page's headline, Title Case, at most 3 words (Open Roles). */
  title: string;
  /** The word of the title drawn in the brand green (Roles). */
  accent?: string;
  /** The short spaced line over the headline (Careers at MyCityApp). */
  eyebrow?: ReactNode;
  /** One line under the headline, at most 8 words; desktop only. */
  text?: ReactNode;
  /** What stands at the right of the headline, level with its foot: a search (SiteSearch tone intro). */
  aside?: ReactNode;
  /** Layout classes only (spacing). */
  className?: string;
}

/** The title, with its accent word in the brand green. */
function withAccent(title: string, accent?: string): ReactNode {
  const at = accent ? title.lastIndexOf(accent) : -1;
  if (!accent || at < 0) return title;
  return (
    <>
      {title.slice(0, at)}
      <em className="ps-accent">{accent}</em>
      {title.slice(at + accent.length)}
    </>
  );
}

export function PageIntro({ title, accent, eyebrow, text, aside, className }: PageIntroProps) {
  return (
    <>
      <section className={cn("ps-intro", className)}>
        <div className="public-wrap ps-intro-in">
          <div>
            {eyebrow != null && <p className="ps-eyebrow ps-rise ps-rise-1">{eyebrow}</p>}
            <h1 data-ui="page-title" className="ps-rise ps-rise-2">
              {withAccent(title, accent)}
            </h1>
            {text != null && (
              <p data-ui="page-subtitle" className="ps-intro-lede ps-rise ps-rise-3 phone:hidden">
                {text}
              </p>
            )}
          </div>
          {aside != null && <div className="ps-rise ps-rise-4">{aside}</div>}
        </div>
      </section>
      <div className="public-wrap ps-rule">
        <hr />
      </div>
    </>
  );
}
