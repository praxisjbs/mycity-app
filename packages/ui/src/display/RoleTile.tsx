/**
 * @component RoleTile
 * @group Display
 * @summary A role in a few lines, as a card that is one link: its team in gold, its title, one line (its place and closing date, or its place and arrangement). RoleTiles lays them three to a row, rising in turn and lifting under the pointer.
 * @use The index's Closing Soon (the three roles closing soonest) and a vacancy's More Roles (others of its department).
 * @avoid The careers list itself (use RoleRow); a role's own page; more than a handful (the careers list has them all).
 * @phone One to a row, full width; two to a row from 761 to 1040 px.
 * @a11y A list of links, each named by its title and described by its team and line; the words are content. It goes through PublicPage's navigate. Under reduced motion they simply show.
 * @status beta
 * @exports RoleTiles
 * @example <RoleTiles><RoleTile href="/jobs/operations-intern-lagos" team="Operations & People" title="Operations Intern" line="Lekki Phase 1, Lagos. Closes 11/11/2026." /></RoleTiles>
 */
import { Children, useId, type ReactNode } from "react";
import { cn } from "../lib/cn";
import { content } from "../lib/slots";
import { Reveal } from "../layout/Reveal";
import { useSiteLink } from "../shell/site-link";

export interface RoleTileProps {
  /** The role's own page. */
  href: string;
  /** The role's title. */
  title: string;
  /** Its department, in gold over the title. */
  team?: string | null;
  /** One line under the title (Lekki Phase 1, Lagos. Closes 11/11/2026.). */
  line?: string | null;
}

export function RoleTile({ href, title, team, line }: RoleTileProps) {
  const go = useSiteLink();
  const id = useId();
  return (
    <a className="ps-mini" href={href} onClick={go(href)} aria-labelledby={`${id}-t`} aria-describedby={team || line ? `${id}-d` : undefined}>
      {team && <span {...content}>{team}</span>}
      <b id={`${id}-t`} {...content}>
        {title}
      </b>
      {line && <small {...content}>{line}</small>}
      {(team || line) && (
        <span id={`${id}-d`} className="sr-only">
          {[team, line].filter(Boolean).join(". ")}
        </span>
      )}
    </a>
  );
}

export interface RoleTilesProps {
  /** The tiles, each a RoleTile. */
  children: ReactNode;
  /** Names the list (Closing Soon, More Roles). */
  label?: string;
  /** How long the first tile waits once in view, in ms; 60 unless set. */
  start?: number;
  /** Layout classes only (spacing). */
  className?: string;
}

/** Tiles three to a row, rising in turn as they come into view. */
export function RoleTiles({ children, label, start = 60, className }: RoleTilesProps) {
  return (
    <ul className={cn("ps-tiles", className)} aria-label={label}>
      {Children.toArray(children).map((child, i) => (
        <Reveal key={i} as="li" delay={start + i * 120} lift>
          {child}
        </Reveal>
      ))}
    </ul>
  );
}
