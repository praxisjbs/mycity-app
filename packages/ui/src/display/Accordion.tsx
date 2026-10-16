/**
 * @component Accordion
 * @group Display
 * @summary Questions and their answers, each closed until it is opened.
 * @use A set of FAQs (the Knowledge Hub), a policy's clauses, a long list of named notes a person reads one of.
 * @avoid Support text on a screen (use HelpTerm or Details); hiding something a person needs to act (that is tier 1, and belongs open); one item on its own (use Details).
 * @phone The same rows, each at least 44 px tall, opening in place rather than in a sheet.
 * @a11y Native disclosures, so the keyboard and screen readers work without any script; the + marker is decorative.
 * @status stable
 * @example <Accordion items={[{ title: "How do I claim overtime?", body: "Open My Attendance and ..." }]} />
 */
import type { ReactNode } from "react";
import { cn } from "../lib/cn";
import { content } from "../lib/slots";

/** One question and its answer. */
export interface AccordionItem {
  /** The question, as a person would ask it. */
  title: ReactNode;
  /** The answer. */
  body: ReactNode;
  /** Open on arrival; only ever the first, and only where the screen is about that one thing. */
  open?: boolean;
}

export interface AccordionProps {
  /** The items, in the order they should be read. */
  items: AccordionItem[];
  /** Layout classes only (spacing). */
  className?: string;
}

export function Accordion({ items, className }: AccordionProps) {
  return (
    <div className={className}>
      {items.map((item, i) => (
        <details key={i} {...content} open={item.open} className="plus-marker mb-2 overflow-hidden rounded-box border border-border bg-card last:mb-0">
          <summary className={cn("flex cursor-pointer items-center gap-2 px-3.5 py-3 text-sm font-semibold phone:min-h-tap")}>{item.title}</summary>
          <div className="pr-3.5 pb-3.5 pl-8.5 text-xs text-muted-foreground">{item.body}</div>
        </details>
      ))}
    </div>
  );
}
