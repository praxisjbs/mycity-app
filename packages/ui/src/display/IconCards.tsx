/**
 * @component IconCards
 * @group Display
 * @summary A grid of phone icon cards, two to a row; each IconCard is an icon, a title and a line, and opens a sheet with that section.
 * @use On a phone, in place of stacked sections (FRONTEND_GUIDE §5.5): Password, Devices, Payslips, each opening its own sheet.
 * @avoid Desktop pages, which show the sections themselves (wrap in PhoneOnly); navigation between modules (that is the More sheet); a card with no destination.
 * @phone Two to a row (three from the wide breakpoint with cols={3}), each at least 96 px tall, the whole card is the tap target.
 * @a11y Each IconCard is a native button named by its title; its line is read as the description. The chevron and the icon are decorative. The caller opens the sheet (useModal) in onClick.
 * @status stable
 * @exports IconCard
 * @example <IconCards><IconCard icon="shield" title="Password" text="Changed 02/10/2026" onClick={openPassword} /></IconCards>
 */
import { useId, type ReactNode } from "react";
import { cn } from "../lib/cn";
import { Icon, type IconName } from "../icons/Icon";
import { CountBadge } from "./CountBadge";

export interface IconCardsProps {
  /** The IconCard elements. */
  children: ReactNode;
  /** Two to a row (the default), or three from the wide breakpoint. */
  cols?: 2 | 3;
  /** Layout classes only (spacing). */
  className?: string;
}

export function IconCards({ children, cols = 2, className }: IconCardsProps) {
  return <div className={cn("mb-3 grid grid-cols-2 gap-2.5", cols === 3 && "lg:grid-cols-3", className)}>{children}</div>;
}

export interface IconCardProps {
  /** The glyph in the soft square. */
  icon: IconName;
  /** The section it opens, at most 4 words, Title Case: its accessible name. */
  title: ReactNode;
  /** One short line of the section's state (Changed 02/10/2026, 2 active). */
  text?: ReactNode;
  /** A count of things waiting inside, shown at the top right. */
  count?: number;
  /** Opens the section, usually as a sheet (useModal). */
  onClick: () => void;
  /** Layout classes only. */
  className?: string;
}

export function IconCard({ icon, title, text, count, onClick, className }: IconCardProps) {
  const lineId = useId();
  const hasText = text != null && text !== "";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-describedby={hasText ? lineId : undefined}
      className={cn(
        "relative flex min-h-24 min-w-0 flex-col items-start gap-1.5 rounded-card border border-border bg-card p-3 text-left shadow-1 transition-colors duration-(--dur-fast) hover:border-subtle-foreground active:bg-muted",
        className,
      )}
    >
      <span aria-hidden="true" className="flex size-9 flex-none items-center justify-center rounded-box bg-accent text-accent-foreground">
        <Icon name={icon} size="m" />
      </span>
      <span data-ui="title" className="text-sm font-strong">
        {title}
      </span>
      {hasText && (
        <span id={lineId} className="text-2xs text-muted-foreground">
          {text}
        </span>
      )}
      <span aria-hidden="true" className="absolute top-3.5 right-3 flex items-center gap-1 text-subtle-foreground">
        {count != null && <CountBadge count={count} />}
        <Icon name="right" />
      </span>
    </button>
  );
}
