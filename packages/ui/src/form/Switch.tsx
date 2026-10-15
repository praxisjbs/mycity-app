/**
 * @component Switch
 * @group Forms
 * @summary On or off: a Switch for a setting that applies at once, a CheckboxField for a yes or no inside a form, and the ToggleRow that lays a setting out.
 * @use Switch when the change saves on its own (with a toast); CheckboxField when the form's own button saves it; ToggleRow for a list of settings.
 * @avoid A Switch inside a form that has a save button; a checkbox for something that applies at once.
 * @phone The switch and the checkbox sit in a 44 px tap area; ToggleRow keeps the words on the left, the switch on the right.
 * @a11y Switch has role switch and needs a label; CheckboxField's label is its own; both work with Space.
 * @status stable
 * @exports ToggleRow, CheckboxField
 * @example <ToggleRow title="Late Alerts" checked={on} onChange={save} />
 */
import type { ReactNode } from "react";
import * as RadixSwitch from "@radix-ui/react-switch";
import * as Checkbox from "@radix-ui/react-checkbox";
import { cn } from "../lib/cn";
import { useControlIds } from "../lib/ids";
import { Icon } from "../icons/Icon";
import type { FieldState } from "./binding";
import { useFieldControl } from "./Field";

export interface SwitchProps {
  /** On or off. */
  checked: boolean;
  /** Called with the new state. */
  onChange: (checked: boolean) => void;
  /** What it switches, for assistive technology when no visible label names it. */
  label: string;
  /** Not switchable now. */
  disabled?: boolean;
  /** Layout classes only. */
  className?: string;
}

export function Switch({ checked, onChange, label, disabled, className }: SwitchProps) {
  return (
    <span className={cn("inline-flex min-h-tap min-w-tap items-center justify-center", className)}>
      <RadixSwitch.Root
        checked={checked}
        onCheckedChange={onChange}
        aria-label={label}
        disabled={disabled}
        className="relative h-5.5 w-9.5 flex-none rounded-full bg-border transition-colors disabled:opacity-50 data-[state=checked]:bg-secondary"
      >
        <RadixSwitch.Thumb className="block size-4 translate-x-0.75 rounded-full bg-background shadow-1 transition-transform data-[state=checked]:translate-x-4.75" />
      </RadixSwitch.Root>
    </span>
  );
}

export interface ToggleRowProps {
  /** What the setting is, Title Case, at most 4 words. */
  title: ReactNode;
  /** One short line about it, when the title is not enough. */
  text?: ReactNode;
  /** On or off. */
  checked: boolean;
  /** Called with the new state. */
  onChange: (checked: boolean) => void;
  /** Marks a row changed but not yet published (a policy draft). */
  changed?: boolean;
  /** Not switchable now. */
  disabled?: boolean;
}

/** A setting row: what it is, a line about it, and its switch. */
export function ToggleRow({ title, text, checked, onChange, changed, disabled }: ToggleRowProps) {
  return (
    <div className={cn("flex items-center justify-between gap-3 border-b border-border py-2 last:border-b-0", changed && "-mx-3.5 bg-warning-soft px-3.5")}>
      <div>
        <div className="text-sm font-semibold">{title}</div>
        {text && <div className="text-xs text-subtle-foreground">{text}</div>}
      </div>
      <Switch checked={checked} onChange={onChange} label={typeof title === "string" ? title : "Switch"} disabled={disabled} />
    </div>
  );
}

export interface CheckboxFieldProps {
  /** Ticked or not. */
  value: boolean;
  /** Called with the new state. */
  onChange: (value: boolean) => void;
  /** Called when the person leaves it. */
  onBlur?: () => void;
  /** Its own label, beside the box: a short phrase. */
  label: ReactNode;
  /** The mark; the Field supplies one otherwise. */
  state?: FieldState;
  /** Unused here (a Field around it shows it). */
  message?: string;
  /** Not tickable now. */
  disabled?: boolean;
}

/** A yes or no inside a form. */
export function CheckboxField({ value, onChange, onBlur, label, state, message: _message, disabled }: CheckboxFieldProps) {
  const ids = useControlIds("check");
  const a = useFieldControl({ id: ids.id, state });
  return (
    <span className="flex min-h-tap items-center gap-2.5">
      <Checkbox.Root
        id={ids.id}
        checked={value}
        onCheckedChange={(v) => onChange(v === true)}
        onBlur={onBlur}
        disabled={disabled}
        aria-describedby={a["aria-describedby"]}
        aria-invalid={a["aria-invalid"]}
        className={cn(
          "flex size-4.5 flex-none items-center justify-center rounded-sm border bg-background disabled:opacity-50 data-[state=checked]:border-secondary data-[state=checked]:bg-secondary data-[state=checked]:text-secondary-foreground",
          a.state === "bad" ? "border-destructive" : "border-input",
        )}
      >
        <Checkbox.Indicator>
          <Icon name="ok" size="s" />
        </Checkbox.Indicator>
      </Checkbox.Root>
      <label htmlFor={ids.id} className="text-sm">
        {label}
      </label>
    </span>
  );
}
