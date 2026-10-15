/**
 * @component PageHeader
 * @group Layout
 * @summary A page's title, its one-line subtitle (desktop only) and the page's actions.
 * @use Once, at the top of every screen.
 * @avoid A second title further down (use CardHeader); a subtitle that explains how the page works (tier 3); more than one primary action.
 * @phone The subtitle is not shown (FRONTEND_GUIDE §7: less text); the actions wrap under the title with 44 px targets.
 * @a11y The title is the page's only h1 (data-ui="page-title"); the subtitle is a paragraph (data-ui="page-subtitle"). Title at most 3 words, subtitle at most 8.
 * @status stable
 * @example <PageHeader title="My Leave" subtitle="2026 entitlement" actions={<Button variant="primary" icon="plus">Request Leave</Button>} />
 */
import type { ReactNode } from "react";
import { cn } from "../lib/cn";

export interface PageHeaderProps {
  /** The page's name, at most 3 words, Title Case (My Attendance). Something beside it, such as a Pill, may follow as children of the title. */
  title: ReactNode;
  /** One line under the title, at most 8 words; desktop only. */
  subtitle?: ReactNode;
  /** The merged name for `subtitle`; kept so screens move by an import change. */
  sub?: ReactNode;
  /** The page's actions, at the right on desktop: at most one primary Button. */
  actions?: ReactNode;
  /** Anything between the title and the actions (a filter, a period switch). */
  children?: ReactNode;
  /** Layout classes only (spacing). */
  className?: string;
}

export function PageHeader({ title, subtitle, sub, actions, children, className }: PageHeaderProps) {
  const line = subtitle ?? sub;
  return (
    <div className={cn("mb-4 flex flex-wrap items-end gap-3", className)}>
      <div className="min-w-0">
        <h1 data-ui="page-title" className="flex items-center gap-1.5 text-2xl phone:text-xl">
          {title}
        </h1>
        {line != null && line !== "" && (
          <p data-ui="page-subtitle" className="mt-0.5 text-sm text-muted-foreground phone:hidden">
            {line}
          </p>
        )}
      </div>
      {children}
      {actions != null && <div className="flex flex-wrap gap-2 desk:ml-auto phone:w-full">{actions}</div>}
    </div>
  );
}
