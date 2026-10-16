/**
 * @component Toolbar
 * @group Data
 * @summary The row of controls above a list: its search box, filter selects and actions, wrapping on a narrow screen.
 * @use Above a list or a board, holding the search box and the list's filters; DataView puts its own search and sort in one.
 * @avoid Page-level actions (they belong in PageHeader); a column chooser; more than four filters on one list.
 * @phone The controls stack full width in the order given, so the search box is first under the thumb; each is 44 px.
 * @a11y A group named for the list it controls, so a screen reader can skip past the filters to the rows.
 * @status stable
 * @example <Toolbar label="Employees"><SearchInput value={list.q} onChange={list.setQ} /></Toolbar>
 */
import type { ReactNode } from "react";
import { cn } from "../lib/cn";

export interface ToolbarProps {
  /** What the controls filter, for screen readers ("Employees"); "List controls" unless set. */
  label?: string;
  /** The controls, left to right: the search box first, then filters, then actions. */
  children: ReactNode;
  /** Layout classes only (spacing). */
  className?: string;
}

export function Toolbar({ label = "List controls", children, className }: ToolbarProps) {
  return (
    <div role="group" aria-label={label} className={cn("mb-3 flex flex-wrap items-end gap-2 phone:flex-col phone:items-stretch", className)}>
      {children}
    </div>
  );
}
