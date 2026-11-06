/**
 * @component FeatureGrid
 * @group Display
 * @summary What a company builds, as one Deep Green feature card (its own words and an action, the pin drawn faint behind) beside a grid of tiles, each a yellow glyph on Deep Green, a title and a line; the feature slides in from the left and the tiles rise in turn.
 * @use The public index's What We Build: About MyCityApp with Visit MyCityApp, and four tiles (Discover Places, Find What's On, Grow Businesses, City Services).
 * @avoid Figures (use KpiGrid or StatStrip); links to records (use RoleTile); more than six tiles; the staff app.
 * @phone One column: the feature first, then each tile full width; nothing slides in from a side.
 * @a11y The feature's title and each tile's are h3s under the section's h2; the glyphs and the pin are decorative. The feature's words are content (the company text from Careers Settings). Under reduced motion everything simply shows.
 * @status beta
 * @example <FeatureGrid feature={{ title: "About MyCityApp", body: <RichText blocks={about} />, action: visit }} tiles={[{ icon: "pin", title: "Discover Places", text: "Restaurants, experiences and the places worth knowing." }]} />
 */
import type { ReactNode } from "react";
import { cn } from "../lib/cn";
import { content } from "../lib/slots";
import { Icon, type IconName } from "../icons/Icon";
import { Reveal } from "../layout/Reveal";

export interface FeatureGridTile {
  /** The glyph on its Deep Green tile. */
  icon: IconName;
  /** The tile's title, Title Case, at most 4 words. */
  title: string;
  /** One line under it, a sentence of at most 20 words. */
  text: string;
}

export interface FeatureGridProps {
  /** The Deep Green card at the left, two rows tall: its title, its words and its action (Visit MyCityApp). */
  feature: { title: string; body: ReactNode; action?: ReactNode };
  /** The tiles beside it, two to a row. */
  tiles: ReadonlyArray<FeatureGridTile>;
  /** Layout classes only (spacing). */
  className?: string;
}

/** The pin, as the brand draws it, faint in the feature's corner. */
const PIN = "M12 2a7.5 7.5 0 0 0-7.5 7.5c0 5.4 6.5 11.6 6.8 11.9a1 1 0 0 0 1.4 0c.3-.3 6.8-6.5 6.8-11.9A7.5 7.5 0 0 0 12 2zm0 10.2a2.7 2.7 0 1 1 0-5.4 2.7 2.7 0 0 1 0 5.4z";

export function FeatureGrid({ feature, tiles, className }: FeatureGridProps) {
  return (
    <div className={cn("ps-build", className)}>
      <Reveal as="article" from="left" className="ps-build-feature">
        <div className="ps-feature" data-theme="dark">
          <h3 {...content}>{feature.title}</h3>
          <div className="ps-feature-text" {...content}>
            {feature.body}
          </div>
          {feature.action != null && <div className="ps-feature-act">{feature.action}</div>}
          <svg className="ps-feature-pin" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
            <path d={PIN} />
          </svg>
        </div>
      </Reveal>
      {tiles.map((t, i) => (
        <Reveal key={t.title} as="article" delay={i % 2 ? 200 : 80} lift>
          <div className="ps-tile">
            <span aria-hidden="true" className="ps-tile-ic">
              <Icon name={t.icon} className="size-6" />
            </span>
            <h3 data-ui="title">{t.title}</h3>
            <p>{t.text}</p>
          </div>
        </Reveal>
      ))}
    </div>
  );
}
