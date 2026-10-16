/**
 * @component Sub
 * @group Display
 * @summary The faint line under a heading or beside a value: the smallest secondary text there is.
 * @use A line under a card's title, a unit beside a figure, who last changed a record.
 * @avoid A page subtitle (PageHeader draws one); support text (use HelpTerm); a sentence longer than the thing it sits under.
 * @phone The same size; secondary lines are what a phone drops first, so check the guide's §10 before adding one.
 * @a11y Plain text in the reading order; where it is a record's own value it is marked as content, so the copy gates skip it.
 * @status stable
 * @example <Sub>Updated 13/10/2026</Sub>
 * @example <Sub as="p" record>{employee.job_title}</Sub>
 */
import type { ReactNode } from "react";
import { cn } from "../lib/cn";
import { content } from "../lib/slots";

export interface SubProps {
  /** The words. */
  children: ReactNode;
  /** `span` (the default) inside a line, `p` on its own. */
  as?: "span" | "p";
  /** The words are a record's own value, not interface copy: the copy gates skip them. */
  record?: boolean;
  /** Layout classes only (spacing, alignment). */
  className?: string;
}

export function Sub({ children, as: Comp = "span", record, className }: SubProps) {
  return (
    <Comp {...(record ? content : {})} className={cn("text-2xs text-subtle-foreground", className)}>
      {children}
    </Comp>
  );
}
