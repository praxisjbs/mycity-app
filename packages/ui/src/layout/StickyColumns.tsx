/**
 * @component StickyColumns
 * @group Layout
 * @summary Two columns side by side that both stick: the shorter waits while the longer scrolls, and both finish together at the foot of the row.
 * @use A page with two columns of unequal height on desktop: the public site's context pane beside its form (`pane`), a vacancy's text beside The Role card (`main-side`).
 * @avoid A list and the record it opens (use ListDetail); panes that scroll on their own at the height of the screen (use SplitPanes); a phone, where there are no columns.
 * @phone No columns and nothing sticks: the columns stack, `phoneFirst` coming first.
 * @a11y Layout only: the reading order is the order the columns are given; nothing is hidden or moved for assistive technology.
 * @status beta
 * @example <StickyColumns layout="pane">{pane}{form}</StickyColumns>
 * @example <StickyColumns layout="main-side" phoneFirst={1}>{article}{roleCard}</StickyColumns>
 */
import { Children, useContext, useLayoutEffect, useRef, type ReactNode } from "react";
import { cn } from "../lib/cn";
import { StickyTop } from "./sticky";

export interface StickyColumnsProps {
  /** The columns, left to right: each child is one column. */
  children: ReactNode;
  /** `pane` (the default): a 400 px pane beside the rest, side by side from 1041 px. `main-side`: two thirds and one third, from 761 px. */
  layout?: "pane" | "main-side";
  /** The column, counted from 0, that comes first where the columns stack (a vacancy's Role card above its text on a phone). */
  phoneFirst?: number;
  /** The space kept above a column stuck at the top (under PublicPage's header, which it reads), and below one waiting at its foot, in px; 24 unless set. */
  gap?: number;
  /** Layout classes only (spacing). */
  className?: string;
}

const GRID = {
  pane: "grid grid-cols-1 items-start gap-6 lg:cols-pane lg:gap-10",
  "main-side": "grid grid-cols-1 items-start gap-10 md:cols-main-side phone:gap-6",
} as const;
/* Where the columns stand side by side, each sticks at the offset it measured (sticky-col, base.css). */
const COLUMN = { pane: "min-w-0 lg:sticky-col", "main-side": "min-w-0 md:sticky-col" } as const;
const FIRST = { pane: "max-lg:order-first", "main-side": "max-md:order-first" } as const;

/**
 * Where a column sticks: at the top, `gap` below the screen's edge (or below a header that sticks, `head`
 * px tall), when it fits the screen; otherwise where its foot rests `gap` above the screen's bottom (a
 * negative top), so it scrolls until its foot is in view and waits there. Written to the column as --stick-top.
 */
function stickTop(columnHeight: number, viewportHeight: number, gap: number, head: number): number {
  return columnHeight <= viewportHeight - head - 2 * gap ? head + gap : viewportHeight - columnHeight - gap;
}

export function StickyColumns({ children, layout = "pane", phoneFirst, gap = 24, className }: StickyColumnsProps) {
  const root = useRef<HTMLDivElement>(null);
  const head = useContext(StickyTop);
  const columns = Children.toArray(children);

  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const cols = Array.from(el.children) as HTMLElement[];
    const place = () => {
      const vh = window.innerHeight;
      for (const c of cols) c.style.setProperty("--stick-top", `${stickTop(c.offsetHeight, vh, gap, head)}px`);
    };
    place();
    window.addEventListener("resize", place);
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(place);
    for (const c of cols) ro?.observe(c);
    return () => {
      window.removeEventListener("resize", place);
      ro?.disconnect();
    };
  }, [gap, head, columns.length]);

  return (
    <div ref={root} data-sticky-columns={layout} className={cn(GRID[layout], className)}>
      {columns.map((c, i) => (
        <div key={i} className={cn(COLUMN[layout], i === phoneFirst && FIRST[layout])}>
          {c}
        </div>
      ))}
    </div>
  );
}
