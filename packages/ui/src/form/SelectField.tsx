/**
 * @component SelectField
 * @group Forms
 * @summary Pick one value: a select list, or for five options or fewer a segmented choice (ChoiceField).
 * @use SelectField for more than five options; ChoiceField for two to five, so every option is visible at once.
 * @avoid Long or server-held lists (people, records): use the server-searching picker; a yes or no (use CheckboxField or Switch).
 * @phone SelectField opens the phone's own picker; ChoiceField segments are 44 px tall and wrap rather than scroll.
 * @a11y SelectField is a native select labelled by its Field; ChoiceField is a radio group with arrow-key movement.
 * @status stable
 * @exports ChoiceField
 * @example <ChoiceField options={[["remote", "Remote"], ["hybrid", "Hybrid"], ["on_site", "On Site"]]} {...form.field("work_pattern")} />
 */
import type { ReactNode, SelectHTMLAttributes } from "react";
import * as RadioGroup from "@radix-ui/react-radio-group";
import { cn } from "../lib/cn";
import type { FieldState } from "./binding";
import { useFieldControl } from "./Field";
import { controlClass } from "./TextField";

/** An option: the merged tuple [value, label], or { value, label }. */
export type Option<V extends string = string> = readonly [V, ReactNode] | { value: V; label: ReactNode; disabled?: boolean };

const optionOf = <V extends string>(o: Option<V>) => (Array.isArray(o) ? { value: o[0] as V, label: o[1] as ReactNode, disabled: false } : (o as { value: V; label: ReactNode; disabled?: boolean }));

export interface SelectFieldProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "value" | "onChange" | "onBlur"> {
  /** The chosen value; "" for none. */
  value: string;
  /** Called with the chosen value. */
  onChange: (value: string) => void;
  /** Called when the person leaves the field. */
  onBlur?: () => void;
  /** The options. */
  options: ReadonlyArray<Option>;
  /** A first, unchoosable line shown while nothing is chosen (Choose One). */
  placeholder?: string;
  /** The mark; the Field supplies one otherwise. */
  state?: FieldState;
  /** Unused here (the Field shows it). */
  message?: string;
}

export function SelectField({ value, onChange, onBlur, options, placeholder, state, message: _message, className, id, ...rest }: SelectFieldProps) {
  const a = useFieldControl({ id, state });
  return (
    <select
      {...rest}
      {...a}
      className={cn(controlClass(a.state), "h-control", className)}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
    >
      {placeholder && (
        <option value="" disabled>
          {placeholder}
        </option>
      )}
      {options.map((o) => {
        const { value: v, label, disabled } = optionOf(o);
        return (
          <option key={v} value={v} disabled={disabled}>
            {typeof label === "string" ? label : v}
          </option>
        );
      })}
    </select>
  );
}

export interface ChoiceFieldProps<V extends string = string> {
  /** The chosen value. */
  value: V;
  /** Called with the chosen value. */
  onChange: (value: V) => void;
  /** Called when focus leaves the group. */
  onBlur?: () => void;
  /** Two to five options. */
  options: ReadonlyArray<Option<V>>;
  /** Values shown but not choosable (the merged `disabled`). */
  disabled?: readonly V[];
  /** Names the group when no Field label sits above it. */
  label?: string;
  /** The mark; the Field supplies one otherwise. */
  state?: FieldState;
  /** Unused here (the Field shows it). */
  message?: string;
  /** Layout classes only. */
  className?: string;
}

/** Two to five options as one segmented row (the merged Seg). */
export function ChoiceField<V extends string = string>({ value, onChange, onBlur, options, disabled, label, state, message: _message, className }: ChoiceFieldProps<V>) {
  const a = useFieldControl({ state });
  return (
    <RadioGroup.Root
      value={value}
      onValueChange={(v) => onChange(v as V)}
      onBlur={onBlur}
      aria-label={label}
      aria-labelledby={label ? undefined : a["aria-labelledby"]}
      aria-describedby={a["aria-describedby"]}
      aria-invalid={a["aria-invalid"]}
      orientation="horizontal"
      className={cn("flex flex-wrap gap-1 rounded-box border border-input p-1", a.state === "bad" && "border-destructive", className)}
    >
      {options.map((o) => {
        const { value: v, label: text, disabled: off } = optionOf(o);
        return (
          <RadioGroup.Item
            key={v}
            value={v}
            disabled={off || disabled?.includes(v)}
            data-ui="button"
            className="h-8 min-h-tap flex-1 rounded-ctl px-2.5 text-sm font-semibold whitespace-nowrap text-muted-foreground disabled:opacity-45 data-[state=checked]:bg-secondary data-[state=checked]:text-secondary-foreground phone:h-tap"
          >
            {text}
          </RadioGroup.Item>
        );
      })}
    </RadioGroup.Root>
  );
}
