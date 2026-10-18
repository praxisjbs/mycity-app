/**
 * @component ItemChip
 * @group Display
 * @summary A rounded chip naming one item (a module in a role), tapped to open it, with small marks after the name.
 * @use A wrapped set of items a person opens one at a time: the modules a role reaches at one level, each opening its detail, with letters after the name for what applies to it.
 * @avoid Narrowing a list (use Chips); a status on a record (use Pill); records with more to say than a name (use TapList, or DataView for a server list).
 * @phone The name is a 44 px tap target; a row of chips wraps onto new lines and never scrolls the page sideways. Marks that are help terms open their sheet on a tap.
 * @a11y With onSelect the name is a button that opens a dialog (aria-haspopup), with aria-current on the item open now; pass `label` when the name alone is not enough. The marks sit beside the button, never inside it, so each can be a control of its own. The name is marked as content (data-copy).
 * @status stable
 * @example <ItemChip onSelect={() => open("payroll")} label="Payroll, View, Team">Payroll</ItemChip>
 * @example <ItemChip selected onSelect={() => open("people")} marks={<HelpTerm help={teamHelp}>T</HelpTerm>}>People</ItemChip>
 */
import type { ReactNode } from "react";
import { cn } from "../lib/cn";
import { content } from "../lib/slots";

export interface ItemChipProps {
  /** The item's name as the screen shows it; record content, not interface copy. */
  children: ReactNode;
  /** Opens the item. Without it the chip is a plain label, not a control. */
  onSelect?: () => void;
  /** Small marks after the name, such as letters behind help terms; they sit outside the chip's button so each can be a control of its own. */
  marks?: ReactNode;
  /** The item open now: drawn in the accent. */
  selected?: boolean;
  /** An item that is off (no access): drawn muted. */
  muted?: boolean;
  /** The button's accessible name when the visible name is not enough ("Payroll, View, Team"). */
  label?: string;
  /** Layout classes only (spacing). */
  className?: string;
}

/* The name: 32 px on desktop, a 44 px target on a phone. */
const NAME = "inline-flex h-8 items-center text-sm font-semibold whitespace-nowrap phone:h-tap";

export function ItemChip({ children, onSelect, marks, selected = false, muted = false, label, className }: ItemChipProps) {
  const hasMarks = marks != null && marks !== false;
  const pad = cn("pl-3", hasMarks ? "pr-1.5" : "pr-3");
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center rounded-full border transition-colors duration-(--dur-fast)",
        selected
          ? "border-secondary bg-accent text-accent-foreground dark:border-accent-foreground"
          : muted
            ? "border-border bg-muted text-subtle-foreground"
            : "border-border bg-card text-foreground",
        onSelect && !selected && "has-[button:hover]:border-subtle-foreground",
        className,
      )}
    >
      {onSelect ? (
        <button
          {...content}
          type="button"
          onClick={onSelect}
          aria-label={label}
          aria-current={selected ? "true" : undefined}
          aria-haspopup="dialog"
          className={cn(NAME, pad, "rounded-full phone:min-w-tap phone:justify-center")}
        >
          {children}
        </button>
      ) : (
        <span {...content} className={cn(NAME, pad)}>
          {children}
        </span>
      )}
      {hasMarks && <span className="inline-flex items-center gap-1 pr-3 text-2xs font-bold">{marks}</span>}
    </span>
  );
}
