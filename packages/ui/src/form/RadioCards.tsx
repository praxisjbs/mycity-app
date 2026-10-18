/**
 * @component RadioCards
 * @group Forms
 * @summary Pick one of two to five options shown as stacked rows, each with an optional glyph before its words: the radio cards of FRONTEND_GUIDE §8.2.
 * @use Two to five options a person should read together before choosing, each worth a full row or a small glyph: an access level, a leave type, a pay basis.
 * @avoid Short options that fit one line (use ChoiceField); more than five (use SelectField); a yes or no (use CheckboxField or Switch); a setting that applies at once (use Switch).
 * @phone Every row is full width and 52 px tall (44 px on desktop), so each option is its own thumb target; the rows stack and never scroll sideways.
 * @a11y A radio group with arrow-key movement; each row is a radio named by its words, and the glyph is hidden so it is never read twice. Inside a Field its label names the group and the error is linked; alone, pass label.
 * @status stable
 * @example <Field label="Payroll Access" {...form.status("payroll_access")}><RadioCards options={[{ value: "view", label: "View" }, { value: "edit", label: "Edit" }]} {...form.field("payroll_access")} /></Field>
 * @example <RadioCards label="Payroll Access" value={level} onChange={setLevel} options={levels.map((l) => ({ value: l.code, label: l.name, leading: <LevelMeter value={l.rank} label={l.name} decorative /> }))} />
 */
import type { FocusEvent, ReactNode } from "react";
import * as RadioGroup from "@radix-ui/react-radio-group";
import { cn } from "../lib/cn";
import type { FieldState } from "./binding";
import { useFieldControl } from "./Field";

export interface RadioCardOption<V extends string = string> {
  /** The value it stands for. */
  value: V;
  /** Its words, Title Case, at most 3 words. */
  label: string;
  /** A small glyph before the words (a LevelMeter, an Icon). */
  leading?: ReactNode;
  /** Shown but not choosable. */
  disabled?: boolean;
}

export interface RadioCardsProps<V extends string = string> {
  /** The chosen value; null when none is chosen yet. */
  value: V | null;
  /** Called with the chosen value. */
  onChange: (value: V) => void;
  /** Called when focus leaves the group. */
  onBlur?: () => void;
  /** Two to five options. */
  options: ReadonlyArray<RadioCardOption<V>>;
  /** Names the group when no Field label sits above it. */
  label?: string;
  /** The mark; the Field supplies one otherwise. */
  state?: FieldState;
  /** Unused here (the Field shows it). */
  message?: string;
  /** Layout classes only. */
  className?: string;
}

export function RadioCards<V extends string = string>({ value, onChange, onBlur, options, label, state, message: _message, className }: RadioCardsProps<V>) {
  const a = useFieldControl({ state, group: true });
  /* Moving between rows is not leaving the group: onBlur fires only when focus goes elsewhere. */
  const leave = (e: FocusEvent<HTMLDivElement>) => {
    if (!onBlur) return;
    const next = e.relatedTarget;
    if (next instanceof Node && e.currentTarget.contains(next)) return;
    onBlur();
  };
  return (
    <RadioGroup.Root
      /* "" matches no option, so nothing is checked while the group stays controlled. */
      value={value ?? ""}
      onValueChange={(v) => onChange(v as V)}
      onBlur={leave}
      aria-label={label}
      aria-labelledby={label ? undefined : a["aria-labelledby"]}
      aria-describedby={a["aria-describedby"]}
      aria-invalid={a["aria-invalid"]}
      orientation="vertical"
      className={cn("flex flex-col rounded-box border border-input bg-card", a.state === "bad" && "border-destructive", className)}
    >
      {options.map((o) => (
        <RadioGroup.Item
          key={o.value}
          value={o.value}
          disabled={o.disabled}
          data-ui="button"
          className="group flex min-h-11 w-full items-center gap-3 border-t border-border px-3 py-2 text-left text-sm font-semibold text-foreground first:rounded-t-box first:border-t-0 last:rounded-b-box focus-visible:-outline-offset-2 disabled:opacity-45 data-[state=checked]:bg-accent data-[state=checked]:text-accent-foreground data-[state=unchecked]:enabled:hover:bg-muted phone:min-h-13"
        >
          <span
            aria-hidden="true"
            className="flex size-4.5 flex-none items-center justify-center rounded-full border border-input bg-background group-data-[state=checked]:border-current"
          >
            <RadioGroup.Indicator className="block size-2 rounded-full bg-current" />
          </span>
          {o.leading != null && (
            <span aria-hidden="true" className="flex flex-none items-center">
              {o.leading}
            </span>
          )}
          <span className="min-w-0 flex-1">{o.label}</span>
        </RadioGroup.Item>
      ))}
    </RadioGroup.Root>
  );
}
