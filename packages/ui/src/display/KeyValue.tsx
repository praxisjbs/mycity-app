/**
 * @component KeyValue
 * @group Display
 * @summary Label and value pairs for a record: two columns on desktop, label over value on a phone; a value that is not set shows EmptyValue.
 * @use A record's fields in a card or a sheet (Personal, Employment, a request's detail).
 * @avoid A list of many records (use DataView); prose; a label that explains how the system works (tier 3).
 * @phone One column, the label above its value, so nothing is squeezed.
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
  /** `columns` (the default) puts labels in a narrow column on desktop; `stacked` puts each label above its value everywhere. */
  layout?: "columns" | "stacked";
  /** Layout classes only (spacing). */
  className?: string;
}

const pair = (item: KeyValueItem, i: number) =>
  Array.isArray(item) ? { key: String(i), label: item[0], value: item[1] } : { key: (item as { key?: string }).key ?? String(i), ...(item as { label: ReactNode; value: ReactNode }) };

export function KeyValue({ items, layout = "columns", className }: KeyValueProps) {
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
