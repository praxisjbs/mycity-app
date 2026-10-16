/**
 * @component Timeline
 * @group Display
 * @summary What happened to a record, newest or oldest first: a rail of dated events, each with its own dot.
 * @use A record's trail (an expense claim's steps, a query's history, a candidate's stages), an audit list on a record page.
 * @avoid An approval route that has not happened yet (use Chain); a list of records (use DataView); more than about a dozen events without paging them.
 * @phone The same rail, full width; the text wraps rather than truncating, since it is content.
 * @a11y An ordered list, so a screen reader hears how many events there are and reads them in order; the dots are decorative.
 * @status stable
 * @example <Timeline items={[{ title: "Approved by Ada Obi", when: "13/10/2026 09:41", tone: "done" }]} />
 */
import type { ReactNode } from "react";
import { cn } from "../lib/cn";
import { content } from "../lib/slots";

/** One event on the rail. */
export interface TimelineItem {
  /** What happened, as words a person wrote or the system recorded. */
  title: ReactNode;
  /** When, already formatted day-first. */
  when: ReactNode;
  /** Anything more about it, one short line. */
  text?: ReactNode;
  /** The dot: `now` is the step in hand (yellow), `done` is finished (green), unset is plain. */
  tone?: "now" | "done";
}

export interface TimelineProps {
  /** The events, in the order they should be read. */
  items: TimelineItem[];
  /** Names the trail for screen readers; "History" unless set. */
  label?: string;
  /** Layout classes only (spacing). */
  className?: string;
}

export function Timeline({ items, label = "History", className }: TimelineProps) {
  return (
    <ol {...content} aria-label={label} className={cn("timeline m-0 list-none", className)}>
      {items.map((item, i) => (
        <li
          key={i}
          className={cn(
            "timeline-dot relative pb-3.5 last:pb-0",
            item.tone === "now" && "timeline-dot-now",
            item.tone === "done" && "timeline-dot-done",
          )}
        >
          <b className="block text-xs font-semibold">{item.title}</b>
          <span className="text-2xs text-subtle-foreground">{item.when}</span>
          {item.text != null && <p className="mt-0.5 text-xs text-muted-foreground">{item.text}</p>}
        </li>
      ))}
    </ol>
  );
}
