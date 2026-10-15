/**
 * @component EmptyState
 * @group Display
 * @summary Nothing to show, said plainly: a drawing, a title, one short line and at most one action.
 * @use A list, a search or a page with nothing in it yet; a filter that matched nothing; a first visit.
 * @avoid An explanation of the feature (tier 3); more than one action; a screen that has data on it.
 * @phone Centred, the drawing at the smaller size; the action is full width within thumb reach.
 * @a11y The title is a heading (data-ui="title"), at most 4 words; the line (data-ui="empty-text") at most 8. The drawing is decorative.
 * @status stable
 * @example <EmptyState illustration="Search" title="No Matches" text="Try another name or department" />
 * @example <EmptyState title="No Requests Yet" action={<Button variant="primary">Request Leave</Button>} />
 */
import type { ReactNode } from "react";
import { cn } from "../lib/cn";
import { Icon, type IconName } from "../icons/Icon";
import { Illustration, type IllustrationName } from "../illustrations/Illustration";
import { Card } from "../layout/Card";

export interface EmptyStateProps {
  /** The drawing, by name; Empty unless set (or unless the merged `icon` is given). */
  illustration?: IllustrationName;
  /** The merged glyph in a soft square, used when no illustration is named. */
  icon?: IconName;
  /** What is empty, at most 4 words, Title Case (No Requests Yet). */
  title: ReactNode;
  /** One line, at most 8 words: what the person can do about it. */
  text?: ReactNode;
  /** At most one action, usually a primary Button. */
  action?: ReactNode;
  /** Draw it without its card (inside a card or a sheet that already has one). */
  bare?: boolean;
  /** Layout classes only (spacing). */
  className?: string;
}

export function EmptyState({ illustration, icon, title, text, action, bare, className }: EmptyStateProps) {
  const art =
    illustration || !icon ? (
      <Illustration name={illustration ?? "Empty"} className="mx-auto mb-3 phone:w-18" />
    ) : (
      <span className="mx-auto mb-3 flex size-12 items-center justify-center rounded-card bg-accent text-accent-foreground">
        <Icon name={icon} size="m" />
      </span>
    );
  const body = (
    <div data-empty-state="" className={cn("flex flex-col items-center px-4 py-8 text-center", bare && className)}>
      {art}
      <h3 data-ui="title" className="text-base font-strong">
        {title}
      </h3>
      {text != null && text !== "" && (
        <p data-ui="empty-text" className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
          {text}
        </p>
      )}
      {action != null && <div className="mt-4 flex justify-center phone:w-full phone:*:w-full">{action}</div>}
    </div>
  );
  return bare ? (
    body
  ) : (
    <Card pad={false} className={className}>
      {body}
    </Card>
  );
}
