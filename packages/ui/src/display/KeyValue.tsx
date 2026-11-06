/**
 * @component KeyValue
 * @group Display
 * @summary Label and value pairs for a record: two columns on desktop, label over value on a phone; a value that is not set shows EmptyValue.
 * @use A record's fields in a card or a sheet (Personal, Employment, a request's detail). On the public site: `rows` (the label at the left, the value bold at the right, a hairline between: The Role, a verified document) and `tiles` (three figures on soft tiles: an assessment's Type, Time and Questions).
 * @avoid A list of many records (use DataView); prose; a label that explains how the system works (tier 3).
 * @phone One column, the label above its value, so nothing is squeezed. `rows` keeps each label and value on one line; `tiles` stacks its tiles.
 * @a11y A description list (dl, dt, dd). Labels are interface copy, at most 4 words, Title Case; values are the record's data (data-copy="content"). A label's help goes in a HelpTerm passed as the label.
 * @status stable
 * @example <KeyValue items={[["Department", "Field Sales"], ["Line Manager", null]]} />
 * @example <KeyValue items={[{ label: "Start Date", value: "13/10/2026" }]} />
 */
import type { ReactNode } from "react";
import { cn } from "../lib/cn";
import { EmptyValue, isEmptyValue } from "./EmptyValue";

/** One pair: a [label, value] tuple (the merged shape) or an object with an optional key. */
export type KeyValueItem = readonly [ReactNode, ReactNode] | { label: ReactNode; value: ReactNode; key?: string };

export interface KeyValueProps {
  /** The pairs, in reading order. A value of null, undefined, "" or false shows EmptyValue. */
  items: ReadonlyArray<KeyValueItem>;
  /** `columns` (the default) puts labels in a narrow column on desktop; `stacked` puts each label above its value everywhere; `rows` (the public site's) a row each, the label left and the value bold at the right; `tiles` (the public site's) up to three soft tiles, the value large. */
  layout?: "columns" | "stacked" | "rows" | "tiles";
  /** Layout classes only (spacing). */
  className?: string;
}

const pair = (item: KeyValueItem, i: number) =>
  Array.isArray(item) ? { key: String(i), label: item[0], value: item[1] } : { key: (item as { key?: string }).key ?? String(i), ...(item as { label: ReactNode; value: ReactNode }) };

export function KeyValue({ items, layout = "columns", className }: KeyValueProps) {
  if (layout === "rows" || layout === "tiles")
    return (
      <dl className={cn(layout === "rows" ? "ps-kv" : "ps-kv-tiles", className)}>
        {items.map((item, i) => {
          const { key, label, value } = pair(item, i);
          return (
            <div key={key}>
              <dt>{label}</dt>
              <dd data-copy="content">{isEmptyValue(value) ? <EmptyValue /> : value}</dd>
            </div>
          );
        })}
      </dl>
    );
  const columns = layout === "columns";
  return (
    <dl className={cn("m-0 grid grid-cols-1 items-baseline gap-x-4 text-sm", columns ? "desk:grid-cols-5 desk:gap-y-2" : "gap-y-0.5", className)}>
      {items.map((item, i) => {
        const { key, label, value } = pair(item, i);
        return (
          <div key={key} className="contents">
            <dt className={cn("min-w-0 text-xs wrap-anywhere text-muted-foreground", columns && "desk:col-span-2")}>{label}</dt>
            <dd data-copy="content" className={cn("m-0 mb-2 min-w-0 font-medium wrap-anywhere", columns && "desk:col-span-3 desk:mb-0")}>
              {isEmptyValue(value) ? <EmptyValue /> : value}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
