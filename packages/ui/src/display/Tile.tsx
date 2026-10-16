/**
 * @component Tile
 * @group Display
 * @summary A small bordered tile: a heading, a line, and whatever sits under them.
 * @use A grid of named things that are not records (a report to run, a letter template, a setting group).
 * @avoid A figure (use KpiCard); a record (use DataView or TapList); a card with its own sections (use Card and CardHeader).
 * @phone Full width in a one-column grid, or two to a row inside a Grid; the pills wrap under the line.
 * @a11y Its heading is a real heading at the level the page needs, so the tiles form part of the outline.
 * @status stable
 * @example <Tile title="Attendance Month" text="Every clocking for one month."><Pill>Excel</Pill></Tile>
 */
import type { ReactNode } from "react";
import { cn } from "../lib/cn";
import { slot } from "../lib/slots";

export interface TileProps {
  /** The tile's name, Title Case, at most 4 words. */
  title: ReactNode;
  /** One line about it, at most 20 words. */
  text?: ReactNode;
  /** What sits under the line: pills, a small button. */
  children?: ReactNode;
  /** The heading level; h2 unless the tile sits inside a section, where it is h3. */
  level?: 2 | 3 | 4;
  /** Layout classes only (spacing). */
  className?: string;
}

export function Tile({ title, text, children, level = 2, className }: TileProps) {
  const H = `h${level}` as "h2" | "h3" | "h4";
  return (
    <div className={cn("rounded-box border border-border bg-card p-3.5", className)}>
      <H {...slot("title")} className="mb-1 text-sm font-strong">
        {title}
      </H>
      {text != null && <p className="text-xs text-muted-foreground">{text}</p>}
      {children != null && <div className="mt-2.5 flex flex-wrap gap-1.5">{children}</div>}
    </div>
  );
}
