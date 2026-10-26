/**
 * @component StatStrip
 * @group Display
 * @summary A strip of labelled figures across the top of a record: smaller than KPI cards, for a record's own counts.
 * @use At the head of a record (an expense claim's totals, a payroll run's counts, a vacancy's pipeline).
 * @avoid A role's dashboard figures (use KpiGrid); more than six figures; a figure with a sentence under it.
 * @phone Two to a row, and only the first four show unless a figure is marked `desktop` (gate 11).
 * @a11y A list named for what the figures are about, so a screen reader hears how many there are; a figure that opens something is a button named by its label and value. A figure's help is a help term on its label (hover on a computer, tap on a phone), never inside a button.
 * @status stable
 * @example <StatStrip items={[{ label: "Submitted", value: 18 }, { label: "Approved", value: 14, tone: "ok" }]} />
 */
import type { ReactNode } from "react";
import { cn } from "../lib/cn";
import { HelpTerm } from "../help/HelpTerm";
import { slot } from "../lib/slots";
import type { StatusTone } from "./Pill";

const INK: Record<StatusTone, string> = {
  ok: "text-success",
  warn: "text-warning",
  err: "text-destructive",
  info: "text-info",
  neutral: "",
};

/** One figure in the strip. */
export interface StatStripItem {
  /** Its name, Title Case, at most 4 words. */
  label: string;
  /** The figure: a count, a Money, a fraction. */
  value: ReactNode;
  /** The figure's tone, when it is good or bad news. */
  tone?: StatusTone;
  /** Dropped on a phone, decided per screen in the feature guide's §10. */
  desktop?: boolean;
  /** Opens what is behind the figure. */
  onOpen?: () => void;
  /** The line under the figure when it opens something, at most 3 words (View All). */
  action?: string;
  /** What the figure counts, behind its label as a help term, at most 35 words. Not with `onOpen`. */
  help?: string;
}

export interface StatStripProps {
  /** The figures, left to right. */
  items: StatStripItem[];
  /** Names the strip for screen readers; "Figures" unless set. */
  label?: string;
  /** Layout classes only (spacing). */
  className?: string;
}

export function StatStrip({ items, label = "Figures", className }: StatStripProps) {
  return (
    <ul aria-label={label} className={cn("mb-3 flex list-none flex-wrap overflow-hidden rounded-card border border-border bg-card p-0", className)}>
      {items.map((item, i) => {
        const inner = (
          <>
            <span {...slot("title")} className="text-2xs font-semibold tracking-caps text-subtle-foreground uppercase">
              {item.help && !item.onOpen ? <HelpTerm help={item.help}>{item.label}</HelpTerm> : item.label}
            </span>
            <b className={cn("mt-0.5 block text-xl font-bold", item.tone && INK[item.tone])}>{item.value}</b>
            {item.action && <span className="mt-0.5 block text-2xs font-semibold text-accent-foreground">{item.action}</span>}
          </>
        );
        // Beyond the fourth, a figure is desktop only: a phone shows two rows of two, not five.
        const hidden = item.desktop || i >= 4;
        return (
          <li
            key={item.label}
            className={cn(
              "border-border desk:min-w-32 desk:flex-1 desk:border-r desk:last:border-r-0 phone:w-1/2 phone:border-b",
              hidden && "phone:hidden",
            )}
          >
            {item.onOpen ? (
              <button type="button" className="block h-full w-full px-3.5 py-3 text-left hover:bg-accent" onClick={item.onOpen}>
                {inner}
              </button>
            ) : (
              <div className="px-3.5 py-3">{inner}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
