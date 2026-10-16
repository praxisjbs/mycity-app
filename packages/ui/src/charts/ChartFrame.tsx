/**
 * @component ChartFrame
 * @group Charts
 * @summary The card every chart sits in: its title, its help, the desktop-only caption, and the values as text for anyone who cannot see it.
 * @use Inside a chart component, around its drawing; a screen uses the chart itself, not this.
 * @avoid Wrapping a chart in a second Card; a caption that explains how the figures are worked out (that is the guide's).
 * @phone No caption at all (gate 8), and a wide drawing scrolls inside the card rather than the page.
 * @a11y The drawing is one image named by the title, and every value is also a hidden list, so a chart is never a dead end for a screen reader.
 * @status stable
 * @example <ChartFrame title="Attendance" caption="14 working days" values={points}>{drawing}</ChartFrame>
 */
import type { ReactNode } from "react";
import { cn } from "../lib/cn";
import { slot } from "../lib/slots";
import { Card, CardHeader } from "../layout/Card";

/** One value a chart draws, as words for the hidden list. */
export interface ChartValue {
  /** What it is (a day, a month, a stage, a grade). */
  label: string;
  /** Its figure, already formatted (₦1.3M, 22, 94%). */
  value: string;
}

export interface ChartFrameProps {
  /** The chart's title, Title Case, at most 4 words. */
  title?: ReactNode;
  /** Support text behind the title, at most 35 words: what the chart measures. */
  help?: ReactNode;
  /** What sits at the right of the title row: a filter, a pill, a menu. */
  actions?: ReactNode;
  /** The line under the chart, at most 8 words, desktop only ("Dips are Saturdays, a half day"). */
  caption?: ReactNode;
  /** The drawing's accessible name, when the title is not enough or there is no title. */
  label?: string;
  /** Every value the chart draws, read out in order by a screen reader. */
  values?: ChartValue[];
  /** The drawing. */
  children: ReactNode;
  /** The drawing scrolls inside the card on a narrow screen (a chart with many points). */
  scrolls?: boolean;
  /** Layout classes only (spacing). */
  className?: string;
}

export function ChartFrame({ title, help, actions, caption, label, values, children, scrolls, className }: ChartFrameProps) {
  const name = label ?? (typeof title === "string" ? title : "Chart");
  return (
    <Card className={className}>
      {(title != null || actions != null) && <CardHeader title={title} help={help} actions={actions} />}
      <div role="img" aria-label={name} className={cn(scrolls && "overflow-x-auto")} {...(scrolls ? { tabIndex: 0 } : {})}>
        {children}
      </div>
      {values && values.length > 0 && (
        <ul className="sr-only">
          {values.map((v) => (
            <li key={v.label}>{`${v.label}: ${v.value}`}</li>
          ))}
        </ul>
      )}
      {caption != null && (
        <p {...slot("chart-caption")} className="mt-2 text-2xs text-subtle-foreground phone:hidden">
          {caption}
        </p>
      )}
    </Card>
  );
}
