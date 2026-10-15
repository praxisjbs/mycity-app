import { type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/cn";
import { Icon } from "@/components/ui/Icon";
import { HelpTerm } from "@/components/ui/Help";

/**
 * Label above the control, and its inline mark (§8.2, §8.3). `info` makes the
 * label a help term (§5.2). An optional field carries an "Optional" tag after
 * its label, never an asterisk: pass `optional`, or end a label with
 * "(Optional)" and the tag is drawn from it.
 */
export function Field({ label, info, optional, state, message, children, className, htmlFor }: { label: ReactNode; info?: ReactNode; optional?: boolean; state?: "bad" | "good"; message?: ReactNode; children: ReactNode; className?: string; htmlFor?: string }) {
  let text = label;
  let opt = optional;
  if (typeof label === "string" && /\s*\(Optional\)$/.test(label)) {
    text = label.replace(/\s*\(Optional\)$/, "");
    opt = true;
  }
  return (
    <div className={cn("mb-[14px]", className)} data-state={state}>
      <label htmlFor={htmlFor} className="mb-1.5 flex items-center gap-1.5 text-[12px] font-semibold text-muted-foreground">
        <span>{info ? <HelpTerm text={info}>{text}</HelpTerm> : text}</span>
        {opt && <span className="rounded-full bg-muted px-[7px] py-px text-[10.5px] font-semibold text-subtle-foreground">Optional</span>}
      </label>
      {children}
      {state === "bad" && message && (
        <p className="mt-[5px] flex items-center gap-[5px] text-[11.5px] text-destructive" role="alert">
          <Icon name="alert" className="size-[13px]" />
          {message}
        </p>
      )}
    </div>
  );
}

const control = (state?: "bad" | "good") =>
  cn(
    "w-full min-w-0 rounded-ctl border bg-background px-3 transition-[border-color,box-shadow] outline-none focus:border-ring focus:shadow-[0_0_0_3px_var(--accent)]",
    state === "bad" ? "border-destructive" : state === "good" ? "border-success" : "border-input",
  );

type Ctl<V> = { value: V; onChange: (v: V) => void; onBlur?: () => void; state?: "bad" | "good" };

export function TextField({ value, onChange, onBlur, state, className, ...rest }: Ctl<string> & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) {
  return (
    <span className="relative flex items-center">
      <input
        className={cn(control(state), "h-9 max-md:h-11", state && "pr-9", className)}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        aria-invalid={state === "bad" || undefined}
        {...rest}
      />
      {state === "bad" && <Icon name="alert" className="pointer-events-none absolute right-3 text-destructive" />}
      {state === "good" && <Icon name="ok" className="pointer-events-none absolute right-3 text-success" />}
    </span>
  );
}

export function TextAreaField({ value, onChange, onBlur, state, className, ...rest }: Ctl<string> & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange">) {
  return (
    <textarea
      className={cn(control(state), "min-h-[84px] resize-y px-3 py-[9px] leading-normal", className)}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      aria-invalid={state === "bad" || undefined}
      {...rest}
    />
  );
}

export function SelectField({ value, onChange, onBlur, state, options, placeholder, className, ...rest }: Ctl<string> & { options: Array<[string, string]>; placeholder?: string } & Omit<SelectHTMLAttributes<HTMLSelectElement>, "value" | "onChange">) {
  return (
    <select
      className={cn(control(state), "h-9 max-md:h-11", className)}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      aria-invalid={state === "bad" || undefined}
      {...rest}
    >
      {placeholder && (
        <option value="" disabled>
          {placeholder}
        </option>
      )}
      {options.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  );
}

/** One of up to five, as a segmented control (§8.2: more than five is a SelectField). */
export function ChoiceField<V extends string>({ value, onChange, options, disabled }: { value: V; onChange: (v: V) => void; options: Array<[V, ReactNode]>; disabled?: V[] }) {
  return (
    <div className="flex flex-wrap gap-[3px] rounded-full border border-input p-[3px]" role="radiogroup">
      {options.map(([v, l]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={v === value}
          disabled={disabled?.includes(v)}
          onClick={() => onChange(v)}
          className={cn("h-[30px] flex-1 rounded-full px-2.5 max-md:h-11 text-[12.5px] font-semibold whitespace-nowrap disabled:opacity-45", v === value ? "bg-secondary text-secondary-foreground" : "text-muted-foreground")}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

/** The compact segmented control in toolbars (view switchers, year pickers). */
export function SegBar<V extends string>({ value, onChange, options, small }: { value: V; onChange: (v: V) => void; options: Array<[V, ReactNode]>; small?: boolean }) {
  return (
    <div className={cn("inline-flex items-center overflow-hidden rounded-full border border-input bg-background", small ? "h-7 max-md:h-[46px]" : "h-[34px] max-md:h-[46px]")} role="radiogroup">
      {options.map(([v, l], i) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={v === value}
          onClick={() => onChange(v)}
          className={cn(
            "inline-flex h-full items-center gap-1.5 font-semibold",
            small ? "px-2.5 text-[11.5px]" : "px-3 text-[12.5px]",
            i > 0 && "border-l border-border",
            v === value ? "bg-secondary text-secondary-foreground" : "text-muted-foreground",
          )}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

/** On or off, for a setting that applies at once (§8.1). Inside a form, a yes or no is a CheckboxField. */
export function SwitchField({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="group flex flex-none items-center justify-center disabled:opacity-50 max-md:size-11"
    >
      <span className={cn("relative h-[22px] w-[38px] rounded-full transition-colors", checked ? "bg-secondary" : "bg-border")}>
        <span className={cn("absolute top-[3px] left-[3px] size-4 rounded-full bg-white transition-transform", checked && "translate-x-4")} />
      </span>
    </button>
  );
}

/** A setting row: what it is (a help term when it needs a line about it) and its switch. Saves on change (§8.1). */
export function ToggleRow({ title, text, checked, onChange, changed }: { title: ReactNode; text?: ReactNode; checked: boolean; onChange: (v: boolean) => void; changed?: boolean }) {
  return (
    <div className={cn("flex items-center justify-between gap-3 border-b border-border py-2.5 last:border-b-0", changed && "-mx-[14px] bg-warning-soft px-[14px]")}>
      <div className="text-[13px] font-[550]">{text ? <HelpTerm text={text}>{title}</HelpTerm> : title}</div>
      <SwitchField checked={checked} onChange={onChange} label={typeof title === "string" ? title : "Toggle"} />
    </div>
  );
}


/** Common rules. Messages are a few words (gate 12). */
export const rules = {
  required: (msg = "Required") => (v: unknown) => (v == null || String(v).trim() === "" ? msg : null),
  email: (v: unknown) => {
    const s = String(v ?? "");
    if (!s.trim()) return "Enter an email";
    if (!s.includes("@")) return "Needs an @";
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s) ? null : "Check the spelling";
  },
  min: (n: number, msg?: string) => (v: unknown) => (String(v ?? "").length < n ? (msg ?? `At least ${n} characters`) : null),
  amount: (v: unknown) => {
    const s = String(v ?? "").replace(/,/g, "");
    if (!s.trim()) return "Enter an amount";
    return /^\d{1,16}(\.\d{1,2})?$/.test(s) ? null : "Numbers only, up to 2 decimals";
  },
};

/** A Nigerian phone number: the country code is shown, digits only are kept. */
export function PhoneField({ value, onChange, onBlur, state, id }: Ctl<string> & { id?: string }) {
  return (
    <span className="relative flex items-center">
      <span className="pointer-events-none absolute left-3 text-[13px] text-muted-foreground">+234</span>
      <input
        id={id}
        type="tel"
        inputMode="tel"
        autoComplete="tel-national"
        placeholder="803 123 4567"
        className={cn(control(state), "h-9 pl-[52px] max-md:h-11")}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value.replace(/[^\d ]/g, ""))}
        onBlur={onBlur}
        aria-invalid={state === "bad" || undefined}
      />
    </span>
  );
}

/** Yes or no inside a form (§8.2). The whole row is the target. */
export function CheckboxField({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; disabled?: boolean }) {
  return (
    <label className="mb-[14px] flex min-h-9 cursor-pointer items-center gap-2.5 text-[13px] max-md:min-h-11">
      <input type="checkbox" className="size-[18px] flex-none accent-(--secondary)" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}
