import type { KeyboardEvent, ReactNode } from "react";
import { Button, cn, formatCount, Icon } from "@mycity/ui";
import type { ApiError } from "@/api/client";
import type { PageMeta } from "@/api/types/common";
import { CardHeader } from "./layout";
import { EmptyState } from "./data";

export interface Column<R> {
  key: string;
  label: ReactNode;
  /** "n" right-aligns a number or an amount. */
  align?: "n";
  render: (row: R, index: number) => ReactNode;
  className?: string;
  /** Drop this column on a phone (decided per screen, gate 11). */
  desktop?: boolean;
}

interface TableProps<R> {
  columns: Column<R>[];
  rows: R[];
  rowKey: (row: R) => string;
  title?: ReactNode;
  right?: ReactNode;
  onRowClick?: (row: R) => void;
  selectedKey?: string | null;
  loading?: boolean;
  error?: ApiError | null;
  empty?: { title: ReactNode; text?: ReactNode; icon?: Parameters<typeof EmptyState>[0]["icon"] };
  /** Wide tables scroll sideways on a phone instead of squeezing. */
  wide?: boolean;
  footer?: ReactNode;
  bare?: boolean;
}

/**
 * The dense desktop table. It shows exactly the rows it is given: the server's
 * page. It never sorts, filters or slices them (FRONTEND_GUIDE §4).
 */
export function Table<R>({ columns, rows, rowKey, title, right, onRowClick, selectedKey, loading, error, empty, wide, footer, bare }: TableProps<R>) {
  const onKey = (e: KeyboardEvent<HTMLTableRowElement>, row: R) => {
    if (onRowClick && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      onRowClick(row);
    }
  };
  const body = (
    <>
      {(title || right) && <CardHeader title={title} right={right} className="mb-2.5 px-[14px] pt-[14px]" />}
      <div className="overflow-x-auto">
        <table className={cn("w-full border-collapse text-[13px] max-md:min-w-[560px]", wide && "min-w-[1080px] max-md:min-w-[980px]")}>
          <thead>
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={cn(
                    "border-b border-border bg-muted px-3 py-[9px] text-left text-[10.5px] font-[650] tracking-[.09em] whitespace-nowrap text-subtle-foreground uppercase",
                    c.align === "n" && "text-right",
                    c.desktop && "max-md:hidden",
                  )}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className={cn(loading && rows.length > 0 && "opacity-60 transition-opacity")}>
            {rows.map((row, i) => {
              const k = rowKey(row);
              return (
                <tr
                  key={k}
                  tabIndex={onRowClick ? 0 : undefined}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  onKeyDown={onRowClick ? (e) => onKey(e, row) : undefined}
                  className={cn(
                    "transition-colors hover:bg-muted [&:last-child>td]:border-b-0",
                    onRowClick && "cursor-pointer hover:bg-accent focus-visible:outline-offset-[-2px]",
                    selectedKey === k && "[&>td]:bg-accent",
                  )}
                >
                  {columns.map((c) => (
                    <td key={c.key} className={cn("border-b border-border px-3 py-[9px]", c.align === "n" && "text-right", c.desktop && "max-md:hidden", c.className)}>
                      {c.render(row, i)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows.length === 0 && loading && <LoadingRows />}
      {rows.length === 0 && !loading && error && <ErrorBlock error={error} />}
      {rows.length === 0 && !loading && !error && (
        <EmptyState bare icon={empty?.icon ?? "ok"} title={empty?.title ?? "Nothing here yet"} text={empty?.text} />
      )}
      {footer}
    </>
  );
  if (bare) return body;
  return <div className="max-w-full min-w-0 overflow-hidden rounded-card border border-border bg-card shadow-1">{body}</div>;
}

export function LoadingRows({ count = 4 }: { count?: number }) {
  return (
    <div className="space-y-2 p-[14px]" aria-busy="true" aria-label="Loading">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="h-[18px] animate-pulse rounded-md bg-muted" style={{ width: `${90 - i * 12}%` }} />
      ))}
    </div>
  );
}

export function ErrorBlock({ error, onRetry }: { error: ApiError; onRetry?: () => void }) {
  return (
    <div className="px-4 py-[26px] text-center" role="alert">
      <span className="mx-auto mb-[11px] flex size-[46px] items-center justify-center rounded-[14px] bg-destructive-soft text-destructive">
        <Icon name="alert" size="m" />
      </span>
      <h3 className="text-[13.5px]">{error.status === 403 ? "You do not have access to this" : "This did not load"}</h3>
      <p className="mx-auto mt-[5px] max-w-[48ch] text-[11.5px] text-subtle-foreground">
        {error.message}
        {error.reference ? ` Reference ${error.reference}.` : ""}
      </p>
      {onRetry && (
        <Button className="mt-3" icon="right" onClick={onRetry}>
          Try Again
        </Button>
      )}
    </div>
  );
}

/**
 * Page controls under a list. Shows the TRUE total from the server
 * ("312 employees"), never "showing 25".
 */
export function Pager({ page, onPage, noun = "record", nounPlural, className }: { page: PageMeta | undefined; onPage: (n: number) => void; noun?: string; nounPlural?: string; className?: string }) {
  if (!page) return null;
  const from = page.total === 0 ? 0 : (page.number - 1) * page.size + 1;
  const to = Math.min(page.number * page.size, page.total);
  const word = page.total === 1 ? noun : (nounPlural ?? `${noun}s`);
  return (
    <div className={cn("flex flex-wrap items-center gap-2.5 px-[14px] py-3", className)}>
      <span className="text-[11.5px] text-subtle-foreground">
        {page.total === 0 ? `0 ${word}` : `${formatCount(from)} to ${formatCount(to)} of ${formatCount(page.total)} ${word}`}
      </span>
      {page.pages > 1 && (
        <span className="ml-auto flex items-center gap-2">
          <Button disabled={page.number <= 1} onClick={() => onPage(page.number - 1)}>
            Previous
          </Button>
          <span className="text-[11.5px] text-subtle-foreground">
            Page {page.number} of {page.pages}
          </span>
          <Button disabled={!page.has_next} onClick={() => onPage(page.number + 1)}>
            Next
          </Button>
        </span>
      )}
    </div>
  );
}

/** The row of controls above a list. */
export function Toolbar({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("mb-3 flex flex-wrap items-end gap-2", className)}>{children}</div>;
}

/** Filter chips: one choice from a few. */
export function Chips<V extends string>({ value, onChange, options, className }: { value: V; onChange: (v: V) => void; options: Array<[V, ReactNode]>; className?: string }) {
  return (
    <div className={cn("mb-3 flex flex-wrap gap-1.5 max-md:no-scrollbar max-md:flex-nowrap max-md:overflow-x-auto", className)} role="group">
      {options.map(([v, label]) => (
        <button
          key={v}
          type="button"
          aria-pressed={v === value}
          onClick={() => onChange(v)}
          className={cn(
            "inline-flex h-[30px] flex-none items-center gap-1.5 rounded-full border px-3 text-[12px] font-semibold",
            v === value ? "border-secondary bg-secondary text-secondary-foreground" : "border-border bg-card text-muted-foreground hover:border-subtle-foreground hover:text-foreground",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
