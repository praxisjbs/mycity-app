/**
 * @component Grid
 * @group Layout
 * @summary The page grid: 2, 3 or 4 equal columns, or a wide and a narrow column, collapsing to one column on a phone.
 * @use Laying out cards on a page: KPI tiles (4), two cards side by side (2), a list beside its detail ("1.4/1").
 * @avoid Laying out controls inside a card (use Stack or Inline); a table's columns.
 * @phone One column, except `phoneCols={2}` (or the merged "4m2"), which keeps KPI tiles two to a row.
 * @a11y A plain container; reading order is the source order at every width.
 * @status stable
 * @example <Grid cols={4} phoneCols={2}>{kpis}</Grid>
 * @example <Grid cols="1.4/1"><Card /><Card /></Grid>
 */
import type { HTMLAttributes } from "react";
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

export interface GridProps extends HTMLAttributes<HTMLDivElement> {
  /** How many columns on desktop; see GridCols. */
  cols: GridCols;
  /** Columns on a phone: 1 (the default) or 2 (KPI tiles). */
  phoneCols?: 1 | 2;
  /** Space between cells: `md` 12 px (the default) or `sm` 8 px. */
  gap?: "sm" | "md";
  /** Drop the 12 px space under the grid (the merged grids carry it so blocks stack apart). */
  flush?: boolean;
}

export function Grid({ cols, phoneCols, gap = "md", flush, className, ...rest }: GridProps) {
  const two = phoneCols === 2 || cols === "4m2";
  const key = cols === "4m2" ? 4 : cols;
  return (
    <div
      data-grid={String(cols)}
      className={cn(
        "grid min-w-0",
        gap === "md" ? "gap-3" : "gap-2",
        COLS[key],
        two && "grid-cols-2 phone:gap-2.5",
        !flush && "mb-3",
        className,
      )}
      {...rest}
    />
  );
}
