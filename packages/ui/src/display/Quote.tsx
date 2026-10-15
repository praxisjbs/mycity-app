/**
 * @component Quote
 * @group Display
 * @summary A quoted passage a person wrote or received, with the yellow rule at its left.
 * @use A manager's comment on a request, a line of an announcement, a reason given for a decision.
 * @avoid Interface copy or help (use HelpTerm or Details); a whole message thread (use the messaging components).
 * @phone Full width, the same rule.
 * @a11y A blockquote; its text is content (data-copy="content"), not interface copy. Pass cite to name who said it.
 * @status stable
 * @example <Quote cite="Adaeze Okafor, Line Manager">Approved, enjoy the break.</Quote>
 */
import type { ReactNode } from "react";
import { cn } from "../lib/cn";

export interface QuoteProps {
  /** The quoted words, as the person wrote them. */
  children: ReactNode;
  /** Who said it, shown under the quote. */
  cite?: ReactNode;
  /** Layout classes only (spacing). */
  className?: string;
}

export function Quote({ children, cite, className }: QuoteProps) {
  return (
    <figure data-copy="content" className={cn("m-0", className)}>
      <blockquote className="m-0 rounded-r-ctl border-l-3 border-primary bg-muted px-3.5 py-2 text-sm text-muted-foreground">{children}</blockquote>
      {cite != null && <figcaption className="mt-1 pl-4 text-2xs text-muted-foreground">{cite}</figcaption>}
    </figure>
  );
}
