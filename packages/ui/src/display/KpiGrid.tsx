/**
 * @component KpiGrid
 * @group Display
 * @summary The row of KPI cards: four across on desktop, two to a row on a phone.
 * @use Above a list or at the top of a tab, holding the three or four figures that tab is about.
 * @avoid More than four figures in one row; mixing KPI cards with other cards inside it; a grid of one (use the card).
 * @phone Two to a row with tighter spacing, as the feature guides' §10 lays Home out.
 * @a11y A list, so a screen reader hears how many figures there are before reading them.
 * @status stable
 * @example <KpiGrid items={[{ key: "in", title: "Clocked In Today", value: "22 of 25", onOpen: open }]} />
 * @example <KpiGrid>{figures.map((f) => <KpiCard key={f.key} {...f} />)}</KpiGrid>
 */
import { Children, type ReactNode } from "react";
import { cn } from "../lib/cn";
import { KpiCard, type KpiCardProps } from "./KpiCard";

/** One figure in the grid: a KpiCard's props with a key. */
export interface KpiGridItem extends KpiCardProps {
  /** Its own key, usually the KPI's catalogue key. */
  key: string;
}

export interface KpiGridProps {
  /** The figures, left to right. Pass this or `children`. */
  items?: KpiGridItem[];
  /** The cards themselves, when a screen builds each one. Pass this or `items`. */
  children?: ReactNode;
  /** Cards across on desktop: 4 unless the tab has three figures. */
  cols?: 2 | 3 | 4;
  /** Layout classes only (spacing). */
  className?: string;
}

const COLS = {
  2: "desk:grid-cols-2",
  3: "desk:grid-cols-3",
  4: "md:grid-cols-2 xl:grid-cols-4",
} as const;

export function KpiGrid({ items, children, cols = 4, className }: KpiGridProps) {
  return (
    <ul className={cn("mb-3 grid list-none grid-cols-2 gap-2.5 p-0 desk:gap-3", COLS[cols], className)}>
      {items
        ? items.map(({ key, ...card }) => (
            <li key={key} className="min-w-0">
              <KpiCard {...card} />
            </li>
          ))
        : Children.map(children, (child) => <li className="min-w-0">{child}</li>)}
    </ul>
  );
}
