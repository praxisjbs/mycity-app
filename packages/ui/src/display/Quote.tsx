/**
 * @component Quote
 * @group Display
 * @summary A quoted passage a person wrote or received, with the yellow rule at its left; `look="feature"` is the public site's Deep Green statement, its lead line large over the rest.
 * @use A manager's comment on a request, a line of an announcement, a reason given for a decision; on a vacancy's page, What We Are Looking For (look feature, its first sentence as `lead`).
 * @avoid Interface copy or help (use HelpTerm or Details); a whole message thread (use the messaging components).
 * @phone Full width, the same rule.
 * @a11y A blockquote; its text is content (data-copy="content"), not interface copy. Pass cite to name who said it.
 * @status stable
 * @example <Quote cite="Adaeze Okafor, Line Manager">Approved, enjoy the break.</Quote>
 * @example <Quote look="feature" lead="A commercial leader, not simply a sales administrator.">Someone who can find opportunities and close deals.</Quote>
 */
import type { ReactNode } from "react";
import { cn } from "../lib/cn";

export interface QuoteProps {
  /** The quoted words, as the person wrote them. */
  children: ReactNode;
  /** Who said it, shown under the quote. */
  cite?: ReactNode;
  /** `feature`: the public site's Deep Green statement, `lead` large and the words under it smaller. */
  look?: "default" | "feature";
  /** feature: the statement's first line, in its large type. */
  lead?: ReactNode;
  /** Layout classes only (spacing). */
  className?: string;
}

export function Quote({ children, cite, look = "default", lead, className }: QuoteProps) {
  if (look === "feature")
    return (
      <figure data-copy="content" className={cn("m-0", className)}>
        <blockquote className="ps-quote" data-theme="dark">
          {lead}
          {children != null && <div className="ps-quote-more">{children}</div>}
        </blockquote>
        {cite != null && <figcaption className="mt-1 pl-4 text-2xs text-muted-foreground">{cite}</figcaption>}
      </figure>
    );
  return (
    <figure data-copy="content" className={cn("m-0", className)}>
      <blockquote className="m-0 rounded-r-ctl border-l-3 border-primary bg-muted px-3.5 py-2 text-sm text-muted-foreground">{children}</blockquote>
      {cite != null && <figcaption className="mt-1 pl-4 text-2xs text-muted-foreground">{cite}</figcaption>}
    </figure>
  );
}
