/**
 * @component TapList
 * @group Display
 * @summary A stack of rows that each open something: the phone's way into a record when a table would be wrong.
 * @use On a phone, a short list a person taps into (a payslip per month, a device, a worksite, a leave request).
 * @avoid A server-paged list of records (use DataView, which draws the card list itself); a row that opens nothing; more than about ten rows without paging.
 * @phone This is the phone layout: each row is at least 44 px with a chevron, and `flat` lets it run to the screen's edges.
 * @a11y A list whose rows are buttons named by their own words, with the chevron decorative.
 * @status stable
 * @example <TapList items={[{ key: "p1", title: "September 2026", sub: "Paid 25/09/2026", onSelect: open }]} />
 */
import type { ReactNode } from "react";
import { cn } from "../lib/cn";
import { content } from "../lib/slots";
import { Icon } from "../icons/Icon";

/** One row. */
export interface TapListItem {
  /** Its own key. */
  key: string;
  /** The row's own words, usually a record's name or month. */
  title: ReactNode;
  /** The line under it: a date, a status, an amount. */
  sub?: ReactNode;
  /** What sits before the chevron: a pill, an amount. */
  end?: ReactNode;
  /** Opens the record. */
  onSelect?: () => void;
}

export interface TapListProps {
  /** The rows, top to bottom. */
  items: TapListItem[];
  /** Names the list for screen readers. */
  label?: string;
  /** Run to the screen's edges, with a rule above, instead of sitting in a rounded card. */
  flat?: boolean;
  /** Layout classes only (spacing). */
  className?: string;
}

export function TapList({ items, label, flat, className }: TapListProps) {
  return (
    <ul
      {...content}
      aria-label={label}
      className={cn("m-0 mb-3 flex list-none flex-col overflow-hidden bg-card p-0", flat ? "-mx-3.5 border-t border-border" : "rounded-card border border-border", className)}
    >
      {items.map((item) => (
        <li key={item.key} className="border-b border-border last:border-b-0">
          <button type="button" data-row-open={item.onSelect ? "" : undefined} onClick={item.onSelect} className="flex w-full items-center gap-2.5 px-3.5 py-3 text-left phone:min-h-tap">
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <b className="text-sm font-semibold wrap-any">{item.title}</b>
              {item.sub != null && <span className="text-2xs text-subtle-foreground">{item.sub}</span>}
            </span>
            {item.end}
            <Icon name="right" size="s" aria-hidden className="flex-none text-subtle-foreground" />
          </button>
        </li>
      ))}
    </ul>
  );
}
