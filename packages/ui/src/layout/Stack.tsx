/**
 * @component Stack
 * @group Layout
 * @summary A vertical run of blocks with an even gap; Inline is the horizontal run that wraps.
 * @use Spacing blocks inside a card or a sheet (Stack), and a row of pills, buttons or figures (Inline), on the token spacing scale.
 * @avoid Page columns (use Grid); hand-written margins between siblings.
 * @phone The same; Inline wraps rather than scrolling the page sideways.
 * @a11y A plain container (a list when as="ul"); reading order is the source order.
 * @status stable
 * @exports Inline
 * @example <Stack gap={3}><KeyValue items={rows} /><Banner tone="info">Payroll closes Friday</Banner></Stack>
 * @example <Inline gap={2}><Pill tone="ok">Approved</Pill><Pill>Annual Leave</Pill></Inline>
 */
import type { HTMLAttributes } from "react";
import { cn } from "../lib/cn";

/** A gap on the 4 px scale: 0, 1 (4 px), 1.5, 2, 3 (12 px, the default), 4, 5, 6. */
export type Space = 0 | 1 | 1.5 | 2 | 3 | 4 | 5 | 6;

const GAP: Record<Space, string> = { 0: "gap-0", 1: "gap-1", 1.5: "gap-1.5", 2: "gap-2", 3: "gap-3", 4: "gap-4", 5: "gap-5", 6: "gap-6" };
const ALIGN = { start: "items-start", center: "items-center", end: "items-end", stretch: "items-stretch", baseline: "items-baseline" } as const;
const JUSTIFY = { start: "justify-start", center: "justify-center", end: "justify-end", between: "justify-between" } as const;

export interface StackProps extends HTMLAttributes<HTMLElement> {
  /** Space between the blocks; 3 (12 px) unless set. */
  gap?: Space;
  /** Cross-axis alignment: stretch (the default) fills the width. */
  align?: keyof typeof ALIGN;
  /** The element: a div, or a list when the blocks are list items. */
  as?: "div" | "section" | "ul" | "ol";
}

export function Stack({ gap = 3, align = "stretch", as: Comp = "div", className, ...rest }: StackProps) {
  return <Comp className={cn("flex min-w-0 flex-col", GAP[gap], ALIGN[align], (Comp === "ul" || Comp === "ol") && "m-0 list-none p-0", className)} {...rest} />;
}

export interface InlineProps extends HTMLAttributes<HTMLElement> {
  /** Space between the items; 2 (8 px) unless set. */
  gap?: Space;
  /** Cross-axis alignment: center unless set. */
  align?: keyof typeof ALIGN;
  /** Main-axis distribution: start unless set; `between` pushes the last item to the end. */
  justify?: keyof typeof JUSTIFY;
  /** Keep everything on one line (it then truncates rather than wrapping). */
  nowrap?: boolean;
  /** The element: a div, or a list when the items are list items. */
  as?: "div" | "span" | "ul" | "ol";
}

/** A horizontal row that wraps: pills, buttons, figures. */
export function Inline({ gap = 2, align = "center", justify = "start", nowrap, as: Comp = "div", className, ...rest }: InlineProps) {
  return (
    <Comp
      className={cn(
        "flex min-w-0",
        nowrap ? "flex-nowrap overflow-hidden" : "flex-wrap",
        GAP[gap],
        ALIGN[align],
        JUSTIFY[justify],
        (Comp === "ul" || Comp === "ol") && "m-0 list-none p-0",
        className,
      )}
      {...rest}
    />
  );
}
