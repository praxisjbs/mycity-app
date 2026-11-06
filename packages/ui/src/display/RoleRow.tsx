/**
 * @component RoleRow
 * @group Display
 * @summary One open role in the careers list as a whole-row link: its team in gold, its title, its place, arrangement and type with their glyphs, its closing date at the right and a round arrow that turns yellow and nudges right under the pointer. RoleListTop heads the list with Showing n of m and its order.
 * @use The careers list (/jobs), one row per role of the server's page, under RoleListTop.
 * @avoid A role in a few lines on the index or under a vacancy (use RoleTile); the staff app's vacancies (DataView); a list a person filters on the client.
 * @phone The closing date and the arrow move under the facts, at either end of the row; the row is still one link.
 * @a11y A link named by the role's title and described by its team, facts and closing date; the glyphs and the arrow are decorative. The role's words are content (data-copy). It goes through PublicPage's navigate.
 * @status beta
 * @exports RoleListTop
 * @example <RoleListTop shown={12} total={12} order="Closing soonest first" />
 * @example <RoleRow href="/jobs/head-sales-revenue-lagos" team="Marketing & Sales" title="Head, Sales & Revenue" facts={facts} closes="18/11/2026" />
 */
import { useId } from "react";
import { content } from "../lib/slots";
import { Icon, type IconName } from "../icons/Icon";
import { useSiteLink } from "../shell/site-link";

export interface RoleRowProps {
  /** The role's own page. */
  href: string;
  /** The role's title. */
  title: string;
  /** Its department, in gold over the title. */
  team?: string | null;
  /** Its place, arrangement and type, each a glyph and a few words. */
  facts?: ReadonlyArray<{ icon: IconName; text: string }>;
  /** Its closing date, day-first, at the right under Closes. */
  closes?: string | null;
}

export function RoleRow({ href, title, team, facts = [], closes }: RoleRowProps) {
  const go = useSiteLink();
  const id = useId();
  return (
    <a className="ps-role" href={href} onClick={go(href)} aria-labelledby={`${id}-t`} aria-describedby={`${id}-d`}>
      <span>
        {team && (
          <span className="ps-role-team" {...content}>
            {team}
          </span>
        )}
        <span id={`${id}-t`} className="ps-role-title" {...content}>
          {title}
        </span>
        {facts.length > 0 && (
          <span className="ps-facts">
            {facts.map((f) => (
              <span key={`${f.icon}-${f.text}`} {...content}>
                <Icon name={f.icon} className="size-4.25" />
                {f.text}
              </span>
            ))}
          </span>
        )}
      </span>
      <span className="ps-role-end">
        {closes && (
          <span className="ps-closes">
            Closes
            <b>{closes}</b>
          </span>
        )}
        <span aria-hidden="true" className="ps-go">
          <Icon name="arrowright" className="size-5.5" />
        </span>
      </span>
      <span id={`${id}-d`} className="sr-only">
        {[team, ...facts.map((f) => f.text), closes ? `Closes ${closes}` : null].filter(Boolean).join(". ")}
      </span>
    </a>
  );
}

export interface RoleListTopProps {
  /** How many roles the list shows now. */
  shown: number;
  /** How many there are in all. */
  total: number;
  /** The list's order, at the right (Closing soonest first). */
  order?: string;
}

/** The head of the careers list: Showing n of m, and its order. */
export function RoleListTop({ shown, total, order }: RoleListTopProps) {
  return (
    <div className="ps-list-top" aria-live="polite">
      <span>
        Showing <b>{shown}</b> of {total}
      </span>
      {order && <span>{order}</span>}
    </div>
  );
}
