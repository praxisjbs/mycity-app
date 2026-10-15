/**
 * @component EmptyValue
 * @group Display
 * @summary The marker for a value that is not set: the only dash a screen shows, muted.
 * @use A field, a cell or a figure with no value (no end date, no manager, no amount). KeyValue and Money draw it for you.
 * @avoid Typing a dash, "N/A", "None" or "null" into copy (gate 17); a value that is zero (show 0 or ₦0.00).
 * @phone The same.
 * @a11y An image named "Not set" (or the label given), so a screen reader says the words, not "dash".
 * @status stable
 * @example <EmptyValue />
 */
import { cn } from "../lib/cn";

/** The one dash a screen may show (FRONTEND_GUIDE §6). Written as an escape so no dash sits in source copy. */
const MARK = "\u2014";

export interface EmptyValueProps {
  /** What assistive technology says; "Not set" unless a field needs something plainer ("No end date"). */
  label?: string;
  /** Layout classes only (alignment). */
  className?: string;
}

export function EmptyValue({ label = "Not set", className }: EmptyValueProps) {
  return (
    <span role="img" aria-label={label} data-empty="" className={cn("text-subtle-foreground", className)}>
      {MARK}
    </span>
  );
}

/** true for a value that is not set: null, undefined, an empty or blank string, or false. Zero is a value. */
export function isEmptyValue(value: unknown): boolean {
  return value == null || value === false || (typeof value === "string" && value.trim() === "");
}
