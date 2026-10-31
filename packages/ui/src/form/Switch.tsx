/**
 * @component Switch
 * @group Forms
 * @summary On or off: a Switch for a setting that applies at once, a CheckboxField for a yes or no inside a form, and the ToggleRow that lays a setting out.
 * @use Switch when the change saves on its own (with a toast); CheckboxField when the form's own button saves it; ToggleRow for a list of settings.
 * @avoid A Switch inside a form that has a save button; a checkbox for something that applies at once.
 * @phone The switch and the checkbox sit in a 44 px tap area; ToggleRow keeps the words on the left, the switch on the right.
 * @a11y Switch has role switch and needs a label; CheckboxField's label is its own; both work with Space. A switch whose change hands back its work (F26) says aria-busy and refuses another change until the work settles.
 * @status stable
 * @exports ToggleRow, CheckboxField
 * @example <ToggleRow title="Late Alerts" checked={on} onChange={save} />
 */
import { useState, type ReactNode } from "react";
import * as RadixSwitch from "@radix-ui/react-switch";
import * as Checkbox from "@radix-ui/react-checkbox";
import { cn } from "../lib/cn";
import { useControlIds } from "../lib/ids";
import { Icon } from "../icons/Icon";
import type { FieldState } from "./binding";
import { useFieldControl } from "./Field";
import { isThenable, whenSettled } from "../actions/press";

export interface SwitchProps {
  /** On or off. */
  checked: boolean;
  /** Called with the new state. Hand back the work it starts (onChange={save}) and the switch is busy until it settles (F26). */
  onChange: (checked: boolean) => unknown;
  /** What it switches, for assistive technology when no visible label names it. */
  label: string;
  /** Not switchable now. */
  disabled?: boolean;
  /** Layout classes only. */
  className?: string;
}

export function Switch({ checked, onChange, label, disabled, className }: SwitchProps) {
  const [busy, setBusy] = useState(false);
  // One change at a time: while the last one's work is out, another is refused, never sent twice.
  const change = (next: boolean) => {
    if (busy) return;
    const work = onChange(next);
    if (!isThenable(work)) return;
    setBusy(true);
    whenSettled(work, () => setBusy(false));
  };
  return (
    <RadixSwitch.Root
      checked={checked}
      onCheckedChange={change}
      aria-label={label}
      aria-busy={busy || undefined}
      disabled={disabled}
      data-press={busy ? "busy" : undefined}
      className={cn("group inline-flex min-h-tap min-w-tap flex-none items-center justify-center rounded-ctl disabled:opacity-50 data-[press=busy]:cursor-progress data-[press=busy]:opacity-75", className)}
    >
      <span className="flex h-5.5 w-9.5 items-center rounded-full bg-border transition-colors group-data-[state=checked]:bg-secondary">
        <RadixSwitch.Thumb className="block size-4 translate-x-0.75 rounded-full bg-background shadow-1 transition-transform data-[state=checked]:translate-x-4.75" />
      </span>
    </RadixSwitch.Root>
  );
}

export interface ToggleRowProps {
  /** What the setting is, Title Case, at most 4 words. */
  title: ReactNode;
  /** One short line about it, when the title is not enough. */
  text?: ReactNode;
  /** On or off. */
  checked: boolean;
  /** Called with the new state; hand back its work and the switch is busy until it settles. */
  onChange: (checked: boolean) => unknown;
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
    <span className="flex min-h-tap items-center">
      <Checkbox.Root
        id={ids.id}
        checked={value}
        onCheckedChange={(v) => onChange(v === true)}
        onBlur={onBlur}
        disabled={disabled}
        aria-describedby={a["aria-describedby"]}
        aria-invalid={a["aria-invalid"]}
        className="group -ml-3 flex min-h-tap min-w-tap flex-none items-center justify-center rounded-ctl disabled:opacity-50"
      >
        <span
          className={cn(
            "flex size-4.5 items-center justify-center rounded-sm border bg-background group-data-[state=checked]:border-secondary group-data-[state=checked]:bg-secondary group-data-[state=checked]:text-secondary-foreground",
            a.state === "bad" ? "border-destructive" : "border-input",
          )}
        >
          <Checkbox.Indicator>
            <Icon name="ok" size="s" />
          </Checkbox.Indicator>
        </span>
      </Checkbox.Root>
      <label htmlFor={ids.id} className="text-sm">
        {label}
      </label>
    </span>
  );
}
