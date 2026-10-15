/**
 * @component Card
 * @group Layout
 * @summary The raised panel every section sits in, with an optional title row (CardHeader) and one Details row at its foot.
 * @use A section of a page: a KPI group, a record's fields, a list, a chart. One idea per card.
 * @avoid Cards inside cards; an explainer card (a title starting How, Why or What is tier 3 and never reaches a screen); a list on a phone (a card list comes from DataView).
 * @phone Full width with the same padding; the actions in CardHeader keep their 44 px targets and wrap under the title when there is no room.
 * @a11y A plain container. CardHeader's title is a heading (h2 unless set: a card is a section of the page under its h1) marked data-ui="title"; give a card that is itself clickable a role and a name, or better, put a Button inside it.
 * @status stable
 * @exports CardHeader
 * @example <Card><CardHeader title="Leave Requests" actions={<Button size="sm">View All</Button>} />...</Card>
 * @example <Card details={<Details>...</Details>}>...</Card>
 */
import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "../lib/cn";
import { HelpTerm } from "../help/HelpTerm";

export interface CardProps extends HTMLAttributes<HTMLElement> {
  /** Inner padding (the default). `false` lets a table, a list or an image run to the card's edges. */
  pad?: boolean;
  /** The element: `section` when the card has its own heading in a long page, `article` for one record. */
  as?: "div" | "section" | "article";
  /** The one Details row at the foot of the card (a Details from @mycity/ui), closed by default. */
  details?: ReactNode;
  /** The card's content. */
  children?: ReactNode;
}

export const Card = forwardRef<HTMLElement, CardProps>(function Card({ pad = true, as: Comp = "div", details, className, children, ...rest }, ref) {
  return (
    <Comp
      ref={ref as never}
      data-card=""
      className={cn("max-w-full min-w-0 rounded-card border border-border bg-card text-card-foreground shadow-1", pad ? "p-3.5" : "overflow-hidden", className)}
      {...rest}
    >
      {children}
      {details != null && <div className={cn("mt-3 border-t border-border pt-1", !pad && "mx-3.5 mb-1")}>{details}</div>}
    </Comp>
  );
});

export interface CardHeaderProps {
  /** The card's title: a noun phrase of at most 4 words, Title Case (Leave Requests). */
  title?: ReactNode;
  /** Support text behind the title, at most 35 words: the title becomes a HelpTerm. */
  help?: ReactNode;
  /** The title is record content (a person's name, a document number), not interface copy: the copy gates skip it. */
  record?: boolean;
  /** What sits at the right: a small button, a menu, a pill or a count. */
  actions?: ReactNode;
  /** The merged name for `actions`; kept so screens move by an import change. */
  right?: ReactNode;
  /** The heading level; h2 (a section of the page) unless the card sits inside another section, where it is h3. */
  level?: 2 | 3 | 4;
  /** Anything else after the title (a pill, a count). */
  children?: ReactNode;
  /** Layout classes only (spacing). */
  className?: string;
}

/** A card's title row: the title (data-ui="title"), its help, and the card's actions on the right. */
export function CardHeader({ title, help, record, actions, right, level = 2, children, className }: CardHeaderProps) {
  const H = `h${level}` as "h2" | "h3" | "h4";
  const end = actions ?? right;
  return (
    <div className={cn("mb-3 flex min-w-0 flex-wrap items-center gap-2", className)}>
      {title != null && (
        <H {...(record ? { "data-copy": "content" } : { "data-ui": "title" })} className="min-w-0 text-base font-strong">
          {help ? <HelpTerm help={help}>{title}</HelpTerm> : title}
        </H>
      )}
      {children}
      {end != null && <div className="ml-auto flex flex-wrap items-center gap-1.5">{end}</div>}
    </div>
  );
}
