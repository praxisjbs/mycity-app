/**
 * @component CountBadge
 * @group Display
 * @summary A small round number: how many unread, waiting or new things sit behind a tab, a nav item or a tile.
 * @use Beside a tab label, a More tile, a nav item, an icon button (unread messages, approvals waiting).
 * @avoid A status (use Pill); a figure that matters on its own (use a KPI); a zero, which draws nothing unless showZero.
 * @phone The same size; it rides on its tile or tab and is never a tap target.
 * @a11y With label it says the whole thing ("3 approvals waiting") to assistive technology; without one the number is read as it is. Counts above max read as max+ on screen and in full to a screen reader.
 * @status stable
 * @example <CountBadge count={3} label="approvals waiting" />
 * @example <CountBadge count={120} tone="err" />
 */
import { cn } from "../lib/cn";
import { formatCount } from "../lib/format";

const TONE = {
  primary: "bg-primary text-primary-foreground",
  err: "bg-destructive text-background",
  neutral: "bg-muted text-muted-foreground",
} as const;

export interface CountBadgeProps {
  /** The number; 0 or less draws nothing unless showZero. */
  count: number;
  /** Above this it shows as max+ (99+). */
  max?: number;
  /** `primary` (yellow, the default), `err` for something overdue, `neutral` for a quiet total. */
  tone?: keyof typeof TONE;
  /** What is counted, lower case, for assistive technology ("unread messages"). */
  label?: string;
  /** Draw a zero rather than nothing. */
  showZero?: boolean;
  /** Layout classes only (spacing, position). */
  className?: string;
}

export function CountBadge({ count, max = 99, tone = "primary", label, showZero, className }: CountBadgeProps) {
  if (count <= 0 && !showZero) return null;
  const shown = count > max ? `${formatCount(max)}+` : formatCount(Math.max(0, count));
  const spoken = label ? `${formatCount(count)} ${label}` : count > max ? formatCount(count) : undefined;
  return (
    <span
      data-count={count}
      className={cn("inline-flex h-4.5 min-w-4.5 flex-none items-center justify-center rounded-full px-1.5 text-2xs leading-none font-strong tabular-nums", TONE[tone], className)}
    >
      <span aria-hidden={spoken ? true : undefined}>{shown}</span>
      {spoken && <span className="sr-only">{spoken}</span>}
    </span>
  );
}
