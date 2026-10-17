/**
 * @component Grid
 * @group Layout
 * @summary The page grid: 2, 3 or 4 equal columns, or a wide and a narrow column, collapsing to one column on a phone.
 * @use Laying out cards on a page: KPI tiles (4), two cards side by side (2), a list beside its detail ("1.4/1"). On desktop two columns side by side each stop at the window's height and scroll on their own, as the mailbox's panes do; `scroll={false}` lets them grow with the page.
 * @avoid Laying out controls inside a card (use Stack or Inline); a table's columns.
 * @phone One column, except `phoneCols={2}` (or the merged "4m2"), which keeps KPI tiles two to a row. Nothing scrolls on its own.
 * @a11y A plain container; reading order is the source order at every width.
 * @status stable
 * @example <Grid cols={4} phoneCols={2}>{kpis}</Grid>
 * @example <Grid cols="1.4/1"><Card /><Card /></Grid>
 */
import { useEffect, useRef, type HTMLAttributes } from "react";
import { cn } from "../lib/cn";

/** Equal columns (1 to 4), or an uneven pair: "1.4/1" wide then narrow, "1/1.5" narrow then wide. "4m2" is the merged name for 4 with two on a phone. */
export type GridCols = 1 | 2 | 3 | 4 | "4m2" | "1.4/1" | "1/1.5";

/*
 * The uneven pairs sit on a 12-column track: 7 + 5 for wide then narrow,
 * 5 + 7 for narrow then wide (odd children take the first width, even the
 * second), so no arbitrary column template is written.
 */
const COLS: Record<Exclude<GridCols, "4m2">, string> = {
  1: "grid-cols-1",
  2: "grid-cols-1 lg:grid-cols-2",
  3: "grid-cols-1 xl:grid-cols-3",
  4: "grid-cols-1 md:grid-cols-2 xl:grid-cols-4",
  "1.4/1": "grid-cols-1 xl:grid-cols-12 xl:*:odd:col-span-7 xl:*:even:col-span-5",
  "1/1.5": "grid-cols-1 xl:grid-cols-12 xl:*:odd:col-span-5 xl:*:even:col-span-7",
};

/*
 * Two columns scroll on their own from the width they sit side by side; stacked, the page
 * scrolls as one. Scrolling chains to the page at a card's end, because the page around
 * them scrolls too (unlike the mailbox, a fit page).
 */
const PANES: Partial<Record<Exclude<GridCols, "4m2">, string>> = {
  2: "lg:*:max-h-card-pane lg:*:overflow-y-auto",
  "1.4/1": "xl:*:max-h-card-pane xl:*:overflow-y-auto",
  "1/1.5": "xl:*:max-h-card-pane xl:*:overflow-y-auto",
};

const FOCUSABLE = 'a[href], button, input, select, textarea, summary, [tabindex]:not([tabindex="-1"])';

/*
 * A column that scrolls must be reachable from the keyboard. One with a button or a field
 * inside already is; one of text alone becomes a tab stop while it overflows, named by its
 * card's title, and stops being one when it no longer scrolls.
 */
function useKeyboardScroll(on: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const grid = ref.current;
    if (!on || !grid || typeof ResizeObserver === "undefined") return;
    const mark = () => {
      for (const col of Array.from(grid.children) as HTMLElement[]) {
        const scrolls = getComputedStyle(col).overflowY === "auto" && col.scrollHeight > col.clientHeight + 1;
        const own = col.dataset.paneStop === "1";
        const needs = scrolls && !col.querySelector(FOCUSABLE);
        if (needs && !own) {
          col.tabIndex = 0;
          col.dataset.paneStop = "1";
          const title = col.querySelector<HTMLElement>('[data-ui="title"]');
          if (title) {
            if (!title.id) title.id = `pane-${Math.random().toString(36).slice(2, 9)}`;
            col.setAttribute("aria-labelledby", title.id);
          }
        } else if (!needs && own) {
          col.removeAttribute("tabindex");
          col.removeAttribute("aria-labelledby");
          delete col.dataset.paneStop;
        }
      }
    };
    mark();
    const resized = new ResizeObserver(mark);
    resized.observe(grid);
    for (const col of Array.from(grid.children)) resized.observe(col);
    const changed = new MutationObserver(mark);
    changed.observe(grid, { childList: true, subtree: true });
    return () => (resized.disconnect(), changed.disconnect());
  }, [on]);
  return ref;
}

export interface GridProps extends HTMLAttributes<HTMLDivElement> {
  /** How many columns on desktop; see GridCols. */
  cols: GridCols;
  /** Columns on a phone: 1 (the default) or 2 (KPI tiles). */
  phoneCols?: 1 | 2;
  /** Space between cells: `md` 12 px (the default) or `sm` 8 px. */
  gap?: "sm" | "md";
  /** Drop the 12 px space under the grid (the merged grids carry it so blocks stack apart). */
  flush?: boolean;
  /** Two columns side by side scroll on their own on desktop (the default); `false` lets them grow with the page. */
  scroll?: boolean;
}

export function Grid({ cols, phoneCols, gap = "md", flush, scroll = true, className, ...rest }: GridProps) {
  const two = phoneCols === 2 || cols === "4m2";
  const key = cols === "4m2" ? 4 : cols;
  const ref = useKeyboardScroll(Boolean(scroll && PANES[key]));
  return (
    <div
      ref={ref}
      data-grid={String(cols)}
      className={cn(
        "grid min-w-0",
        gap === "md" ? "gap-3" : "gap-2",
        COLS[key],
        scroll && PANES[key],
        two && "grid-cols-2 phone:gap-2.5",
        !flush && "mb-3",
        className,
      )}
      {...rest}
    />
  );
}
