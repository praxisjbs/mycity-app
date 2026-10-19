/**
 * @component ProfileHeader
 * @group Display
 * @summary The head of a record page: who or what it is, in their photo or big initials, with its chips and its actions.
 * @use A 360 page (an employee, a partner, a candidate, a vacancy), above the tabs or sections of that record.
 * @avoid A page title (use PageHeader); a list row (use DataView); more than four chips or three actions.
 * @phone The photo or initials and the name sit together with the actions full width under them, so nothing is squeezed.
 * @a11y The name is the page's own heading, and the initials are decorative, since the name is right beside them.
 * @status stable
 * @exports BackButton
 * @example <ProfileHeader name={employee.display_name} role={employee.job_title} chips={pills} actions={buttons} />
 */
import type { ReactNode } from "react";
import { cn } from "../lib/cn";
import { content } from "../lib/slots";
import { initials } from "../lib/format";
import { Icon } from "../icons/Icon";

export interface ProfileHeaderProps {
  /** The record's own name, as the organisation holds it. */
  name: string;
  /** What it is: a job title, a sector, a stage. */
  role?: ReactNode;
  /** Up to four pills: status, department, grade. */
  chips?: ReactNode;
  /** Up to three actions, the primary last. */
  actions?: ReactNode;
  /** Draw the initials in the brand yellow instead of City Green (a partner, not a person). */
  brand?: boolean;
  /** A picture instead of the initials. */
  avatar?: ReactNode;
  /** The person's photo, ready for an image (fetched with the session); the initials show while there is none. */
  photo?: string | null;
  /** The heading level; h1 on a record's own page, h2 inside one. */
  level?: 1 | 2;
  /** Layout classes only (spacing). */
  className?: string;
}

export function ProfileHeader({ name, role, chips, actions, brand, avatar, photo, level = 2, className }: ProfileHeaderProps) {
  const H = `h${level}` as "h1" | "h2";
  return (
    <div className={cn("mb-3 flex flex-wrap items-start gap-4 rounded-card border border-border bg-card p-4 shadow-1 phone:gap-3 phone:p-3.5", className)}>
      {avatar ?? (
        <span
          aria-hidden="true"
          className={cn(
            "flex size-16 flex-none items-center justify-center rounded-sheet text-2xl font-bold phone:size-13 phone:text-xl",
            brand ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground",
          )}
        >
          {photo ? <img src={photo} alt="" className="size-full rounded-sheet object-cover" /> : initials(name)}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <H {...content} className="text-xl">
          {name}
        </H>
        {role != null && (
          <div {...content} className="mt-0.5 text-sm text-muted-foreground">
            {role}
          </div>
        )}
        {chips != null && <div className="mt-2 flex flex-wrap gap-1.5">{chips}</div>}
      </div>
      {actions != null && <div className="flex flex-wrap gap-2 phone:w-full">{actions}</div>}
    </div>
  );
}

export interface BackButtonProps {
  /** Where it goes back to, Title Case, at most 3 words ("Back to Employees"). */
  label: string;
  /** Goes back. */
  onBack: () => void;
  /** Layout classes only (spacing). */
  className?: string;
}

/** The way out of a record page, above its header. */
export function BackButton({ label, onBack, className }: BackButtonProps) {
  return (
    <button
      type="button"
      onClick={onBack}
      className={cn(
        "mb-3 inline-flex items-center gap-1.5 rounded-full border border-border bg-card py-1 pr-3 pl-2 text-xs font-semibold text-muted-foreground hover:border-subtle-foreground hover:text-foreground phone:min-h-tap",
        className,
      )}
    >
      <Icon name="left" size="s" />
      {label}
    </button>
  );
}
