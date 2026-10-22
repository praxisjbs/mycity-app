/**
 * @component TextField
 * @group Forms
 * @summary The text input of the form system, with its typed relatives: password, whole number, phone and long text.
 * @use Any typed value in a form, inside a Field, bound with form.field(name).
 * @avoid A date, an amount or a person (use DateField, MoneyField, PersonPicker); a raw <input> anywhere outside packages/ui/src/form (gate 12).
 * @phone 44 px tall with 16 px text so iOS never zooms; the keyboard matches the value (numeric, tel, email).
 * @a11y Takes its id, label and error links from the Field around it; aria-invalid follows the mark; the mark is an icon plus words, never colour alone.
 * @status stable
 * @exports PasswordField, NumberField, PhoneField, TextAreaField
 * @example <TextField type="email" placeholder="ada@mycity.app" {...form.field("work_email")} />
 */
import { useState, type InputHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { Eye, EyeOff } from "lucide-react";
import { cn } from "../lib/cn";
import { Icon } from "../icons/Icon";
import type { FieldState } from "./binding";
import { useFieldControl } from "./Field";

/** The control look every field shares: the border carries the mark. */
export const controlClass = (state?: FieldState) =>
  cn(
    "w-full min-w-0 rounded-ctl border bg-background px-3 text-field outline-none transition-colors focus:border-ring disabled:opacity-60",
    state === "bad" ? "border-destructive" : state === "good" ? "border-success" : "border-input",
  );

type NativeInput = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "onBlur" | "type">;

interface BoundProps {
  /** The value, from form.field(name). */
  value: string;
  /** Called with the new value. */
  onChange: (value: string) => void;
  /** Called when the person leaves the field. */
  onBlur?: () => void;
  /** The mark; the Field around it supplies one otherwise. */
  state?: FieldState;
  /** Unused here (the Field shows it); accepted so {...form.field(name)} spreads cleanly. */
  message?: string;
  /** Unused here (a typed value these controls hold is always the form's); accepted so {...form.field(name)} spreads cleanly instead of reaching the element. */
  onProblem?: (message: string | undefined, now?: boolean) => void;
}

function Mark({ state }: { state: FieldState }) {
  if (state === "bad") return <Icon name="alert" size="s" className="pointer-events-none absolute right-3 text-destructive" />;
  if (state === "good") return <Icon name="ok" size="s" className="pointer-events-none absolute right-3 text-success" />;
  return null;
}

export interface TextFieldProps extends BoundProps, NativeInput {
  /** text, email, url, search or tel (a phone number typed in any format). */
  type?: "text" | "email" | "url" | "search" | "tel";
}

export function TextField({ value, onChange, onBlur, state, message: _message, onProblem: _onProblem, type = "text", className, id, ...rest }: TextFieldProps) {
  const a = useFieldControl({ id, state });
  return (
    <span className="relative flex items-center">
      <input
        {...rest}
        {...a}
        type={type}
        className={cn(controlClass(a.state), "h-control", a.state && "pr-9", className)}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
      />
      <Mark state={a.state} />
    </span>
  );
}

export interface PasswordFieldProps extends BoundProps, NativeInput {
  /** new-password on sign-up and change, current-password on sign-in. */
  autoComplete?: "current-password" | "new-password";
  /** What the show and hide button names: password (the default), or key for an API key. */
  noun?: "password" | "key";
}

export function PasswordField({ value, onChange, onBlur, state, message: _message, onProblem: _onProblem, className, id, autoComplete = "current-password", noun = "password", ...rest }: PasswordFieldProps) {
  const a = useFieldControl({ id, state });
  const [shown, setShown] = useState(false);
  return (
    <span className="relative flex items-center">
      <input
        {...rest}
        {...a}
        type={shown ? "text" : "password"}
        autoComplete={autoComplete}
        className={cn(controlClass(a.state), "h-control pr-12", className)}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
      />
      <button
        type="button"
        aria-label={`${shown ? "Hide" : "Show"} ${noun}`}
        aria-pressed={shown}
        onClick={() => setShown((s) => !s)}
        className="absolute right-0 flex h-control min-h-tap w-11 items-center justify-center text-subtle-foreground hover:text-foreground"
      >
        {shown ? <EyeOff size={16} aria-hidden /> : <Eye size={16} aria-hidden />}
      </button>
    </span>
  );
}

export interface NumberFieldProps extends BoundProps, NativeInput {
  /** Allow a decimal point. Off: whole numbers only. */
  decimal?: boolean;
}

/** A count or quantity, kept as the string typed so the form never meets a float. */
export function NumberField({ value, onChange, onBlur, state, message: _message, onProblem: _onProblem, decimal, className, id, ...rest }: NumberFieldProps) {
  const a = useFieldControl({ id, state });
  const clean = (s: string) => (decimal ? s.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1") : s.replace(/\D/g, ""));
  return (
    <span className="relative flex items-center">
      <input
        {...rest}
        {...a}
        inputMode={decimal ? "decimal" : "numeric"}
        className={cn(controlClass(a.state), "h-control text-right tabular-nums", a.state && "pr-9", className)}
        value={value ?? ""}
        onChange={(e) => onChange(clean(e.target.value))}
        onBlur={onBlur}
      />
      <Mark state={a.state} />
    </span>
  );
}

export interface PhoneFieldProps extends BoundProps, NativeInput {
  /** The country code shown before the number. */
  countryCode?: string;
}

/** A Nigerian number: +234 shown, the rest as typed; the contract normalises it to E.164. */
export function PhoneField({ value, onChange, onBlur, state, message: _message, onProblem: _onProblem, countryCode = "+234", className, id, ...rest }: PhoneFieldProps) {
  const a = useFieldControl({ id, state });
  return (
    <span className="relative flex items-center">
      <span aria-hidden className="pointer-events-none absolute left-3 text-field text-muted-foreground tabular-nums">
        {countryCode}
      </span>
      <input
        {...rest}
        {...a}
        type="tel"
        inputMode="tel"
        autoComplete="tel-national"
        className={cn(controlClass(a.state), "h-control pl-14 tabular-nums", a.state && "pr-9", className)}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value.replace(/[^\d\s()+-]/g, ""))}
        onBlur={onBlur}
      />
      <Mark state={a.state} />
    </span>
  );
}

export interface TextAreaFieldProps extends BoundProps, Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange" | "onBlur"> {
  /** Visible lines before it scrolls; 4. */
  rows?: number;
}

export function TextAreaField({ value, onChange, onBlur, state, message: _message, onProblem: _onProblem, rows = 4, className, id, ...rest }: TextAreaFieldProps) {
  const a = useFieldControl({ id, state });
  return (
    <textarea
      {...rest}
      {...a}
      rows={rows}
      className={cn(controlClass(a.state), "min-h-24 resize-y py-2 leading-normal", className)}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
    />
  );
}
