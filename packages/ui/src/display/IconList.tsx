/**
 * @component IconList
 * @group Display
 * @summary A short list of things, each on its own tile with one glyph before its words, two to a row.
 * @use What a role is measured on (its Key Performance Indicators), on a vacancy's page; any handful of short items that read better as tiles than as bullets.
 * @avoid Figures with values (KpiGrid, StatStrip); long sentences (RichText); a list a person acts on (TapList).
 * @phone One to a row, full width.
 * @a11y A list named by `label`; the glyph is decorative; the items are content (data-copy), as a role's own words.
 * @status beta
 * @example <IconList icon="trend" label="Key Performance Indicators (KPIs)" items={["Revenue against target", "Value of closed deals"]} />
 */
import type { ReactNode } from "react";
import { cn } from "../lib/cn";
import { content } from "../lib/slots";
import { Icon, type IconName } from "../icons/Icon";

export interface IconListProps {
  /** The items, each a few words. */
  items: ReadonlyArray<ReactNode>;
  /** The glyph before each. */
  icon: IconName;
  /** Names the list. */
  label: string;
  /** Layout classes only (spacing). */
  className?: string;
}

export function IconList({ items, icon, label, className }: IconListProps) {
  return (
    <ul className={cn("ps-kpis", className)} aria-label={label}>
      {items.map((item, i) => (
        <li key={i} {...content}>
          <Icon name={icon} className="size-5" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}
