/**
 * @component RecordPicker
 * @group Forms
 * @summary Picks records the server searches: one page of 25, narrowed as the person types, never a dropdown of everything.
 * @use A field that points at another record: a worksite, a department, a partner, a vacancy, an expense category.
 * @avoid Fetching every record to fill a `<select>` (FRONTEND_GUIDE §4); a picker over a list short enough to be a SelectField; filtering the 25 rows on screen.
 * @phone The search box and the results are full width, each result a 44 px row; the picked chips wrap above it.
 * @a11y A search box with a listbox of options, each saying whether it is picked, and the count of what matched announced politely.
 * @status stable
 * @example <RecordPicker list={worksites} value={picked} onChange={setPicked} id={(w) => w.worksite_id} title={(w) => w.name} />
 */
import { useState, type ReactNode } from "react";
import { cn } from "../lib/cn";
import { formatCount } from "../lib/format";
import { Icon } from "../icons/Icon";
import type { DataViewList } from "../data/DataView";
import { SearchInput } from "./SearchInput";

export interface RecordPickerProps<R> {
  /** The server-paged records to pick from (a `usePaged()` result); the picker drives its search. */
  list: DataViewList<R>;
  /** What is picked, held by the form. */
  value: R[];
  /** Called with the new set. */
  onChange: (value: R[]) => void;
  /** Names one record, for the key and for what is already picked. */
  id: (row: R) => string;
  /** The record's own words (a name, a number). */
  title: (row: R) => ReactNode;
  /** The line under it (a department, a date, an amount). */
  sub?: (row: R) => ReactNode;
  /** What sits at the left of a row (an avatar, a glyph). */
  lead?: (row: R) => ReactNode;
  /** Pick several; one only unless set. */
  multiple?: boolean;
  /** A format example of at most 3 words; "Search" otherwise. */
  placeholder?: string;
  /** How a picked record reads on its chip; the title unless set. */
  chip?: (row: R) => string;
  /** Layout classes only (spacing). */
  className?: string;
}

export function RecordPicker<R>({ list, value, onChange, id, title, sub, lead, multiple, placeholder = "Search", chip, className }: RecordPickerProps<R>) {
  const [open, setOpen] = useState(false);
  const picked = (row: R) => value.some((v) => id(v) === id(row));
  const label = (row: R) => chip?.(row) ?? (typeof title(row) === "string" ? (title(row) as string) : id(row));

  const toggle = (row: R) => {
    if (!multiple) {
      onChange([row]);
      setOpen(false);
      return;
    }
    onChange(picked(row) ? value.filter((v) => id(v) !== id(row)) : [...value, row]);
  };

  const setQ = list.setQ;
  const total = list.page?.total ?? list.rows.length;
  /*
   * A picker for several stays open, because the person is still choosing. One
   * for a single record closes behind its chip, and typing opens it again.
   */
  const showing = multiple || value.length === 0 || open;

  return (
    <div className={className}>
      {value.length > 0 && (
        <ul className="m-0 mb-2 flex list-none flex-wrap gap-1.5 p-0">
          {value.map((row) => (
            <li key={id(row)} className="inline-flex items-center gap-1 rounded-full bg-accent py-0.5 pr-1 pl-2.5 text-xs">
              {label(row)}
              <button
                type="button"
                aria-label={`Remove ${label(row)}`}
                onClick={() => onChange(value.filter((v) => id(v) !== id(row)))}
                className="flex size-5 items-center justify-center rounded-full hover:bg-card phone:size-tap"
              >
                <Icon name="x" size="s" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {setQ && (
        <SearchInput
          value={list.q ?? ""}
          onChange={(q) => {
            setQ(q);
            setOpen(true);
          }}
          placeholder={placeholder}
          className="mb-2"
        />
      )}

      {showing && (
        <>
          {/*
           * The options are the buttons themselves, owned directly by the
           * listbox: a button inside a role="option" would be a control inside
           * a control, and the row would not be where the tap lands.
           */}
          <div role="listbox" aria-label={placeholder} className="max-h-64 overflow-y-auto rounded-box border border-border">
            {list.rows.map((row) => {
              const on = picked(row);
              return (
                <button
                  key={id(row)}
                  type="button"
                  role="option"
                  aria-selected={on}
                  onClick={() => toggle(row)}
                  className="flex w-full items-center gap-2.5 border-b border-border px-3 py-2 text-left last:border-b-0 hover:bg-muted phone:min-h-tap"
                >
                  {lead?.(row)}
                  <span className="min-w-0 flex-1 text-sm">
                    <b className="block font-semibold wrap-any">{title(row)}</b>
                    {sub && <span className="block text-2xs text-subtle-foreground">{sub(row)}</span>}
                  </span>
                  <span className={cn("flex size-5 flex-none items-center justify-center rounded-full border text-secondary-foreground", on ? "border-secondary bg-secondary" : "border-input")}>
                    {on && <Icon name="tick" size="s" />}
                  </span>
                </button>
              );
            })}
            {list.rows.length === 0 && !list.loading && <p className="px-3 py-3 text-xs text-subtle-foreground">Nothing matches</p>}
          </div>
          {total > list.rows.length && (
            <p aria-live="polite" className="px-3 py-1.5 text-2xs text-subtle-foreground">
              First {formatCount(list.rows.length)} of {formatCount(total)}. Type to narrow.
            </p>
          )}
        </>
      )}
    </div>
  );
}
