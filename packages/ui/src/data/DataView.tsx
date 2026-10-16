/**
 * @component DataView
 * @group Data
 * @summary THE shared list: a dense table on desktop and a card list on a phone from the same rows, with the pager, server sort, selection, bulk actions and Export.
 * @use Every list of records a person reads or acts on: employees, leave requests, expenses, candidates, partners.
 * @avoid A second table of your own; sorting or filtering the 25 rows on screen; a column chooser; a visible table on a phone.
 * @phone The columns become cards: the first value is the card's title, the next three are label and value pairs, and sort moves into an action sheet. There is never a <table> (gate 11).
 * @a11y The table has a caption, sortable headers carry aria-sort and are buttons, a clickable row is reachable by Tab and Enter, and a reloading list says aria-busy.
 * @status stable
 * @exports LoadingRows
 * @example <DataView list={list} columns={columns} rowKey={(r) => r.employee_id} caption="Employees" noun="employee" search="Search People" />
 * @example <DataView rows={rows} columns={columns} rowKey={(r) => r.id} caption="Approval Steps" bare />
 */
import { useId, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "../lib/cn";
import { content, slot } from "../lib/slots";
import { useIsPhone } from "../lib/media";
import { Button, IconButton } from "../actions/Button";
import { Icon, type IconName } from "../icons/Icon";
import { CardHeader } from "../layout/Card";
import { EmptyState } from "../display/EmptyState";
import { EmptyValue } from "../display/EmptyValue";
import { Skeleton } from "../display/Skeleton";
import { ErrorState } from "../feedback/ErrorState";
import { Menu, type MenuItem } from "../overlay/Menu";
import { SearchInput } from "../form/SearchInput";
import { Tick } from "../form/Tick";
import { ApiError, type PageMeta } from "./createApi";
import { ExportButton } from "./ExportButton";
import { Pager } from "./Pager";

/** One column of a list. */
export interface DataViewColumn<R> {
  /** Its own key, and the server's sort field when `sortable` (F20: the contract allow-lists it). */
  key: string;
  /** The column header, Title Case, at most 4 words. Empty for a column of actions. */
  label: ReactNode;
  /** `n` right-aligns a number or an amount, with tabular figures. */
  align?: "n";
  /** Draws one row's cell. An empty value draws the shared marker by itself. */
  render: (row: R, index: number) => ReactNode;
  /** The column header offers the server's sort on `key`, ascending then descending then off. */
  sortable?: boolean;
  /** Dropped on a phone, decided per screen in the feature guide's §10 (gate 11). */
  desktop?: boolean;
  /** Layout classes only (width, alignment). */
  className?: string;
}

/**
 * What a list hook hands over: a `usePaged()` result fits as it is. Pass this
 * or plain `rows`.
 */
export interface DataViewList<R> {
  /** The server's current page of rows, never more than 25. */
  rows: R[];
  /** The server's page object; the pager reads the true total from it. */
  page?: PageMeta;
  /** A request is in flight. */
  loading?: boolean;
  /** The last error, shown in place of an empty state. */
  error?: ApiError | null;
  /** Asks for a page number. */
  setPage?: (n: number) => void;
  /** The search text as typed. */
  q?: string;
  /** Changes the search text (the hook debounces and goes back to page 1). */
  setQ?: (q: string) => void;
  /** The current sort key, a field name with a leading `-` for descending. */
  sort?: string;
  /** Changes the sort (and goes back to page 1). */
  setSort?: (sort: string | undefined) => void;
  /** Asks for the page again, behind Try Again when a read fails. */
  reload?: () => void;
}

/** Row selection and what may be done with the rows picked. */
export interface DataViewSelection {
  /** The row keys picked, held by the screen. */
  keys: string[];
  /** The new set after a tick, an untick, or the header's select all. */
  onChange: (keys: string[]) => void;
  /**
   * What may be done with them: Buttons or a Menu. They act on the rows
   * PICKED ON THIS PAGE (F20), so a bulk action never silently reaches rows
   * the person has not seen.
   */
  actions: ReactNode;
}

export interface DataViewProps<R> {
  /** The columns, left to right. The first is the card's title on a phone. */
  columns: DataViewColumn<R>[];
  /** Names one row for the key, the pager's count and screen readers. */
  rowKey: (row: R) => string;
  /** A server-paged list (a `usePaged()` result). Pass this or `rows`. */
  list?: DataViewList<R>;
  /** A set already in hand (a record's own steps, a sheet's rows). Pass this or `list`. */
  rows?: R[];
  /** Names the table for screen readers; the title unless set. Required when there is no title. */
  caption?: string;
  /** The card's title above the list, at most 4 words. */
  title?: ReactNode;
  /** Support text behind the title, at most 35 words. */
  help?: ReactNode;
  /** What sits at the right of the title row: a button, a menu, a pill. */
  actions?: ReactNode;
  /** The merged name for `actions`; kept so screens move by an import change. */
  right?: ReactNode;
  /** A search box above the list, with this as its placeholder (at most 3 words). Needs `list.setQ`. */
  search?: string;
  /** Opens a row. A phone card becomes one tap target; a desktop row is reachable by Tab. */
  onRowClick?: (row: R) => void;
  /** The row drawn as the one being looked at (a desktop list beside a panel). */
  selectedKey?: string | null;
  /** Row selection and its bulk actions. */
  selection?: DataViewSelection;
  /** Queues the export of the whole filtered list on the server. */
  onExport?: () => Promise<unknown>;
  /** What one row is, for the pager's count ("employee"). */
  noun?: string;
  /** The plural, when it is not the noun with an s. */
  nounPlural?: string;
  /** What to show when there are no rows. */
  empty?: { title: ReactNode; text?: ReactNode; icon?: IconName };
  /** A wide table scrolls inside its own card rather than squeezing its columns. */
  wide?: boolean;
  /** Anything under the pager. */
  footer?: ReactNode;
  /** Draw it without its card, inside one that is already there. */
  bare?: boolean;
  /** Layout classes only (spacing). */
  className?: string;
}

/** The empty-value marker for a cell that has nothing in it. */
const cell = (value: ReactNode) => (value == null || value === "" ? <EmptyValue /> : value);

/** `-field` is descending, `field` ascending, nothing at all is the list's own order. */
function readSort(sort: string | undefined) {
  if (!sort) return { field: undefined, dir: "asc" as const };
  return sort.startsWith("-") ? { field: sort.slice(1), dir: "desc" as const } : { field: sort, dir: "asc" as const };
}

/** Ascending, then descending, then back to the list's own order. */
function nextSort(current: string | undefined, key: string): string | undefined {
  const { field, dir } = readSort(current);
  if (field !== key) return key;
  return dir === "asc" ? `-${key}` : undefined;
}

export function DataView<R>({
  columns,
  rowKey,
  list,
  rows: given,
  caption,
  title,
  help,
  actions,
  right,
  search,
  onRowClick,
  selectedKey,
  selection,
  onExport,
  noun,
  nounPlural,
  empty,
  wide,
  footer,
  bare,
  className,
}: DataViewProps<R>) {
  const phone = useIsPhone();
  const captionId = useId();
  const rows = list ? list.rows : (given ?? []);
  const loading = list?.loading ?? false;
  const error = list?.error ?? null;
  const sort = list?.sort;
  const setSort = list?.setSort;
  const sorted = readSort(sort);
  const name = caption ?? (typeof title === "string" ? title : undefined);
  const end = actions ?? right;

  /* ───── selection ───── */

  const keys = selection?.keys ?? [];
  const pageKeys = rows.map(rowKey);
  const allPicked = pageKeys.length > 0 && pageKeys.every((k) => keys.includes(k));
  const togglePage = () => selection?.onChange(allPicked ? keys.filter((k) => !pageKeys.includes(k)) : [...new Set([...keys, ...pageKeys])]);
  const toggleRow = (key: string) => selection?.onChange(keys.includes(key) ? keys.filter((k) => k !== key) : [...keys, key]);


  /* ───── sort, as an action sheet where there is no table header ───── */

  const sortable = columns.filter((c) => c.sortable);
  const sortItems: MenuItem[] = sortable.flatMap((c) => [
    { label: `${c.label} Up`, icon: "up" as IconName, onSelect: () => setSort?.(c.key) },
    { label: `${c.label} Down`, icon: "down" as IconName, onSelect: () => setSort?.(`-${c.key}`) },
  ]);

  /* ───── the rows, two ways ───── */

  const phoneColumns = columns.filter((c) => !c.desktop);
  const [head, ...rest] = phoneColumns;

  const cards = (
    <ul {...content} aria-busy={loading || undefined} className={cn("m-0 flex list-none flex-col p-0", loading && rows.length > 0 && "opacity-60 transition-opacity")}>
      {rows.map((row, i) => {
        const key = rowKey(row);
        const headCell = head && cell(head.render(row, i));
        /*
         * A card that opens its row is one button stretched over the whole card,
         * named by its first value; the other values let taps through to it,
         * while a control among them (a PDF, a quick action) stays its own
         * target, never a button inside a button.
         */
        return (
          <li
            key={key}
            className={cn(
              "relative flex w-full items-start gap-2.5 border-b border-border px-3.5 py-3 text-left last:border-b-0",
              (selectedKey === key || keys.includes(key)) && "bg-muted",
            )}
          >
            {selection && <Tick checked={keys.includes(key)} onChange={() => toggleRow(key)} label={`Select ${typeof headCell === "string" ? headCell : "row"}`} />}
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="text-sm font-semibold wrap-any">
                {onRowClick ? (
                  <button type="button" onClick={() => onRowClick(row)} className="stretch-link text-left">
                    {headCell}
                  </button>
                ) : (
                  headCell
                )}
              </span>
              {rest.slice(0, 3).map((c) => (
                <span
                  key={c.key}
                  className={cn("flex min-w-0 items-baseline gap-2 text-xs", onRowClick && "pointer-events-none relative [&_a]:pointer-events-auto [&_button]:pointer-events-auto")}
                >
                  <span className="flex-none text-subtle-foreground">{c.label}</span>
                  <span className="min-w-0 wrap-any">{cell(c.render(row, i))}</span>
                </span>
              ))}
            </span>
            {onRowClick && <Icon name="right" size="s" className="mt-0.5 flex-none text-subtle-foreground" />}
          </li>
        );
      })}
    </ul>
  );

  const onRowKeyDown = (e: KeyboardEvent<HTMLTableRowElement>, row: R) => {
    if (onRowClick && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      onRowClick(row);
    }
  };

  const table = (
    <div className="overflow-x-auto" tabIndex={0} role="region" aria-labelledby={captionId}>
      <table className={cn("w-full border-collapse text-sm", wide && "table-wide")}>
        <caption id={captionId} className="sr-only">
          {name ?? "List"}
        </caption>
        <thead>
          <tr>
            {selection && (
              <th scope="col" className="w-10 border-b border-border bg-muted px-3 py-2">
                <Tick checked={allPicked} onChange={togglePage} label="Select Page" />
              </th>
            )}
            {columns.map((c) => {
              const active = sorted.field === c.key;
              const canSort = Boolean(c.sortable && setSort);
              return (
                <th
                  key={c.key}
                  scope="col"
                  aria-sort={canSort ? (active ? (sorted.dir === "asc" ? "ascending" : "descending") : "none") : undefined}
                  className={cn(
                    "border-b border-border bg-muted px-3 py-2 text-left text-2xs font-strong tracking-caps whitespace-nowrap text-subtle-foreground uppercase",
                    c.align === "n" && "text-right",
                    c.desktop && "max-md:hidden",
                  )}
                >
                  {!c.label ? (
                    <span className="sr-only">Actions</span>
                  ) : canSort ? (
                    <button
                      type="button"
                      {...slot("header")}
                      onClick={() => setSort?.(nextSort(sort, c.key))}
                      className={cn("inline-flex items-center gap-1 uppercase hover:text-foreground", active && "text-foreground")}
                    >
                      {c.label}
                      <Icon name={active ? (sorted.dir === "asc" ? "up" : "down") : "sort"} size="s" className={cn(!active && "opacity-40")} />
                    </button>
                  ) : (
                    <span {...slot("header")}>{c.label}</span>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody aria-busy={loading || undefined} className={cn(loading && rows.length > 0 && "opacity-60 transition-opacity")}>
          {rows.map((row, i) => {
            const key = rowKey(row);
            return (
              <tr
                key={key}
                tabIndex={onRowClick ? 0 : undefined}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                onKeyDown={onRowClick ? (e) => onRowKeyDown(e, row) : undefined}
                className={cn(
                  "transition-colors hover:bg-muted [&:last-child>td]:border-b-0",
                  onRowClick && "cursor-pointer hover:bg-accent focus-visible:-outline-offset-2",
                  (selectedKey === key || keys.includes(key)) && "[&>td]:bg-muted",
                )}
              >
                {selection && (
                  <td className="border-b border-border px-3 py-2">
                    <Tick checked={keys.includes(key)} onChange={() => toggleRow(key)} label={`Select row ${i + 1}`} />
                  </td>
                )}
                {columns.map((c) => (
                  <td key={c.key} className={cn("border-b border-border px-3 py-2", c.align === "n" && "text-right tabular-nums", c.desktop && "max-md:hidden", c.className)}>
                    {cell(c.render(row, i))}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  /* ───── what sits above the rows ───── */

  const controls = (search && list?.setQ) || onExport || (phone && sortItems.length > 0) ? (
    <div className="mb-2.5 flex flex-wrap items-center gap-2 px-3.5 phone:flex-col phone:items-stretch">
      {search && list?.setQ && <SearchInput value={list.q ?? ""} onChange={list.setQ} placeholder={search} className="w-56 phone:w-full" />}
      {phone && sortItems.length > 0 && (
        <Menu label="Sort" items={sortItems} trigger={(p) => <Button {...p} icon="sort">Sort</Button>} />
      )}
      {onExport && <ExportButton onExport={onExport} className="desk:ml-auto" />}
    </div>
  ) : null;

  const picked = selection && keys.length > 0 && (
    <div className="mx-3.5 mb-2.5 flex flex-wrap items-center gap-2 rounded-box bg-accent px-3 py-2 phone:flex-col phone:items-stretch">
      <span aria-live="polite" className="text-xs font-semibold text-accent-foreground">
        {keys.length} Selected
      </span>
      <span className="flex flex-wrap items-center gap-2 desk:ml-auto">
        {selection.actions}
        <IconButton label="Clear Selection" icon="x" onClick={() => selection.onChange([])} />
      </span>
    </div>
  );

  const body = (
    <>
      {(title || end) && <CardHeader title={title} help={help} actions={end} className="mb-2.5 px-3.5 pt-3.5" />}
      {controls}
      {picked}
      {rows.length > 0 && (phone ? cards : table)}
      {rows.length === 0 && loading && <LoadingRows />}
      {rows.length === 0 && !loading && error && <ErrorState error={error} onRetry={list?.reload} />}
      {rows.length === 0 && !loading && !error && (
        <EmptyState bare icon={empty?.icon ?? "rows"} title={empty?.title ?? (list?.q ? "Nothing Matches" : "Nothing Here Yet")} text={empty?.text ?? (list?.q ? "Try another search." : undefined)} />
      )}
      {list?.page && list.setPage && <Pager page={list.page} onPage={list.setPage} noun={noun} nounPlural={nounPlural} />}
      {footer}
    </>
  );

  if (bare) return <div className={className}>{body}</div>;
  return <div className={cn("max-w-full min-w-0 overflow-hidden rounded-card border border-border bg-card shadow-1", className)}>{body}</div>;
}

export interface LoadingRowsProps {
  /** How many lines to draw; 4 unless set. */
  count?: number;
}

/** Placeholder lines while a list's first page is on its way. */
export function LoadingRows({ count = 4 }: LoadingRowsProps) {
  return (
    <div className="flex flex-col gap-2 p-3.5" role="status" aria-busy="true" aria-label="Loading">
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} className={cn("h-4", i === 0 ? "w-11/12" : i === 1 ? "w-4/5" : i === 2 ? "w-2/3" : "w-1/2")} />
      ))}
    </div>
  );
}
