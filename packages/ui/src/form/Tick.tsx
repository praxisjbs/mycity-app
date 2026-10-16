/**
 * @component Tick
 * @group Forms
 * @summary A checkbox with no label beside it, named by what it picks: the tick on a list's row.
 * @use Row selection in DataView, and the one in a list's header that picks the whole page.
 * @avoid A yes or no answer in a form (use CheckboxField, which carries its label); a tick with no name; a tick that submits something on its own.
 * @phone A 44 px target around the box, so the tick is hittable without hitting the row it sits on.
 * @a11y A real checkbox with its own name, so a screen reader says what is being picked, and it stops a press reaching the row underneath.
 * @status stable
 * @example <Tick checked={picked} onChange={toggle} label="Select Ada Obi" />
 */
import * as Checkbox from "@radix-ui/react-checkbox";
import { cn } from "../lib/cn";
import { Icon } from "../icons/Icon";

export interface TickProps {
  /** Ticked or not. */
  checked: boolean;
  /** Called with the new state. */
  onChange: (checked: boolean) => void;
  /** What it picks, as words ("Select Page", "Select Ada Obi"): its accessible name. */
  label: string;
  /** Nothing can be picked. */
  disabled?: boolean;
  /** Layout classes only (alignment). */
  className?: string;
}

export function Tick({ checked, onChange, label, disabled, className }: TickProps) {
  return (
    <Checkbox.Root
      checked={checked}
      onCheckedChange={(value) => onChange(value === true)}
      disabled={disabled}
      aria-label={label}
      /*
       * A row that opens a record sits under this, so a press here must not
       * also open it.
       */
      onClick={(e) => e.stopPropagation()}
      className={cn("group flex size-tap flex-none items-center justify-center rounded-ctl disabled:opacity-50", className)}
    >
      <span className="flex size-4.5 items-center justify-center rounded-sm border border-input bg-background group-data-[state=checked]:border-secondary group-data-[state=checked]:bg-secondary group-data-[state=checked]:text-secondary-foreground">
        <Checkbox.Indicator>
          <Icon name="ok" size="s" />
        </Checkbox.Indicator>
      </span>
    </Checkbox.Root>
  );
}
