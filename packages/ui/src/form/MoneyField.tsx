/**
 * @component MoneyField
 * @group Forms
 * @summary An amount in Naira: ₦ before it, digits and commas as typed, sent as a two-place decimal string, never a float.
 * @use Every amount a person enters (an expense, a salary, a threshold); turn what was typed into the wire value with toMoneyString.
 * @avoid A number field for money (gate 20); showing an amount (use Money).
 * @phone The decimal keypad; 16 px text; right-aligned figures.
 * @a11y Labelled by its Field; the ₦ sign is visual, the label says it is an amount.
 * @status stable
 * @example <MoneyField {...form.field("amount")} />
 */
import { cn } from "../lib/cn";
import type { FieldState } from "./binding";
import { useFieldControl } from "./Field";
import { controlClass } from "./TextField";

export interface MoneyFieldProps {
  /** What the person typed ("250,000" or "250000.5"). */
  value: string;
  /** Called with what they type, digits, commas and one point only. */
  onChange: (value: string) => void;
  /** Called when the person leaves the field. */
  onBlur?: () => void;
  /** The mark; the Field supplies one otherwise. */
  state?: FieldState;
  /** Unused here (the Field shows it). */
  message?: string;
  /** The control's id; the Field supplies one otherwise. */
  id?: string;
  /** The field's name, so a failed submit can focus it. */
  name?: string;
}

export function MoneyField({ value, onChange, onBlur, state, message: _message, id, name }: MoneyFieldProps) {
  const a = useFieldControl({ id, state });
  return (
    <span className="relative flex items-center desk:max-w-64">
      <span aria-hidden className="pointer-events-none absolute left-3 text-field text-muted-foreground">
        ₦
      </span>
      <input
        {...a}
        name={name}
        inputMode="decimal"
        autoComplete="off"
        className={cn(controlClass(a.state), "h-control pl-7 text-right tabular-nums")}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value.replace(/[^\d.,]/g, ""))}
        onBlur={onBlur}
      />
    </span>
  );
}

/** "250,000" or "250000.5" as typed, to "250000.50" for the wire (gate 20: strings, two places). */
export function toMoneyString(typed: string): string {
  const s = typed.replace(/,/g, "").trim();
  if (!s) return "";
  const [w, f = ""] = s.split(".");
  return `${w || "0"}.${(f + "00").slice(0, 2)}`;
}
