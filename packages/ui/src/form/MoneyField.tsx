/**
 * @component MoneyField
 * @group Forms
 * @summary An amount in Naira: ₦ before it, digits and commas as typed, sent as a two-place decimal string, never a float. A minus is kept and refused, never dropped.
 * @use Every amount a person enters (an expense, a salary, a threshold); turn what was typed into the wire value with toMoneyString.
 * @avoid A number field for money (gate 20); showing an amount (use Money).
 * @phone The decimal keypad; 16 px text; right-aligned figures.
 * @a11y Labelled by its Field; the ₦ sign is visual, the label says it is an amount.
 * @status stable
 * @example <MoneyField {...form.field("amount")} />
 */
import { useEffect, useRef } from "react";
import { cn } from "../lib/cn";
import type { FieldState } from "./binding";
import { useFieldControl } from "./Field";
import { controlClass } from "./TextField";

export interface MoneyFieldProps {
  /** What the person typed ("250,000" or "250000.5"). */
  value: string;
  /** Called with what they type: digits, commas and points, and a leading minus when they typed one. */
  onChange: (value: string) => void;
  /** Called when the person leaves the field. */
  onBlur?: () => void;
  /** Told what is wrong with the amount as typed ("Not below zero", "Two decimals at most"), or undefined once it is right. */
  onProblem?: (message: string | undefined, now?: boolean) => void;
  /** The mark; the Field supplies one otherwise. */
  state?: FieldState;
  /** Unused here (the Field shows it). */
  message?: string;
  /** The control's id; the Field supplies one otherwise. */
  id?: string;
  /** The field's name, so a failed submit can focus it. */
  name?: string;
}

/** A minus, or an accounting bracket, before the figures: "-100", "₦-100", "−100", "(100)". */
const MINUS = /^[^\d.,]*[-\u2212\u2013(]/;
/** numeric(18,2) holds 16 digits before the point. */
const WHOLE_DIGITS = 16;

/**
 * What typed or pasted text holds as an amount: the text the field keeps (digits, commas, points,
 * and a leading minus when there was one) and what is wrong with it. Nothing is turned into
 * another amount: a minus is kept and refused, never dropped (a salary of -100 once became 100),
 * and a second point, a comma out of place or a third decimal is refused rather than cut.
 * `final` when typing more cannot put it right.
 */
export function readMoney(typed: string): { text: string; problem?: string; final?: boolean } {
  const figures = typed.replace(/[^\d.,]/g, "");
  if (MINUS.test(typed)) return { text: `-${figures}`, problem: "Not below zero", final: true };
  if (!figures) return { text: "" };
  const [whole = "", ...rest] = figures.split(".");
  const fraction = rest[0] ?? "";
  if (rest.length > 1 || fraction.includes(",")) return { text: figures, problem: "Check the amount", final: true };
  if (whole.includes(",") && !/^\d{1,3}(,\d{3})+$/.test(whole)) return { text: figures, problem: "Check the amount" };
  if (fraction.length > 2) return { text: figures, problem: "Two decimals at most", final: true };
  if (whole.replace(/,/g, "").replace(/^0+(?=\d)/, "").length > WHOLE_DIGITS) return { text: figures, problem: "Too large", final: true };
  return { text: figures };
}

export function MoneyField({ value, onChange, onBlur, onProblem, state, message: _message, id, name }: MoneyFieldProps) {
  const a = useFieldControl({ id, state });
  const read = readMoney(value ?? "");
  // The form hears of the problem whenever it changes, typed, pasted or set from outside.
  const told = useRef(onProblem);
  told.current = onProblem;
  useEffect(() => told.current?.(read.problem, read.final), [read.problem, read.final]);
  const shown: FieldState = read.problem ? "bad" : a.state;
  return (
    <span className="relative flex items-center desk:max-w-64">
      <span aria-hidden className="pointer-events-none absolute left-3 text-field text-muted-foreground">
        ₦
      </span>
      <input
        {...a}
        aria-invalid={shown === "bad" || undefined}
        name={name}
        inputMode="decimal"
        autoComplete="off"
        className={cn(controlClass(shown), "h-control pl-7 text-right tabular-nums")}
        value={value ?? ""}
        onChange={(e) => onChange(readMoney(e.target.value).text)}
        onBlur={onBlur}
      />
    </span>
  );
}

/** "250,000" or "250000.5" as typed, to "250000.50" for the wire (gate 20: strings, two places); a minus stays, for the contract to refuse. */
export function toMoneyString(typed: string): string {
  const s = typed.replace(/,/g, "").trim();
  if (!s) return "";
  const minus = s.startsWith("-");
  const [w, f = ""] = (minus ? s.slice(1) : s).split(".");
  return `${minus ? "-" : ""}${w || "0"}.${(f + "00").slice(0, 2)}`;
}
