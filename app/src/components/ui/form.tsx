import { useCallback, useMemo, useState, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/cn";
import { Icon } from "./Icon";
import { InfoButton, InfoText, useInfo } from "./Info";

/**
 * Forms validate as they are filled (gate 12): a field is checked on every
 * change once it has been touched, and the signal is a mark on the field (its
 * border and an icon) with a few words, never a dialog and never only on submit.
 * The server's 422 `fields` land on the same marks.
 */
type Validator<V> = (value: V, all: Record<string, unknown>) => string | null | undefined;

export function useForm<T extends Record<string, unknown>>(initial: T, rules: Partial<{ [K in keyof T]: Validator<T[K]> }> = {}) {
  const [values, setValues] = useState<T>(initial);
  const [touched, setTouched] = useState<Partial<Record<keyof T, boolean>>>({});
  const [server, setServer] = useState<Record<string, string[]>>({});

  const errorOf = useCallback(
    (k: keyof T): string | null => {
      const rule = rules[k];
      const local = rule ? rule(values[k], values) : null;
      return local || server[k as string]?.[0] || null;
    },
    [rules, values, server],
  );

  const errors = useMemo(() => {
    const out: Partial<Record<keyof T, string>> = {};
    (Object.keys(values) as Array<keyof T>).forEach((k) => {
      const e = errorOf(k);
      if (e) out[k] = e;
    });
    return out;
  }, [values, errorOf]);

  const set = useCallback(<K extends keyof T>(k: K, v: T[K]) => {
    setValues((s) => ({ ...s, [k]: v }));
    setTouched((s) => ({ ...s, [k]: true }));
    setServer((s) => {
      if (!(k in s)) return s;
      const next = { ...s };
      delete next[k as string];
      return next;
    });
  }, []);

  /** Props for a field: its mark, message and change handler. */
  const field = <K extends keyof T>(k: K) => ({
    value: values[k],
    onChange: (v: T[K]) => set(k, v),
    onBlur: () => setTouched((s) => ({ ...s, [k]: true })),
    state: (touched[k] || server[k as string] ? (errors[k] ? "bad" : values[k] !== "" && values[k] != null ? "good" : undefined) : undefined) as "bad" | "good" | undefined,
    message: touched[k] || server[k as string] ? errors[k] : undefined,
  });

  /** Mark every field touched; true when the form is clean. */
  const check = () => {
    setTouched(Object.fromEntries(Object.keys(values).map((k) => [k, true])) as Partial<Record<keyof T, boolean>>);
    return Object.keys(errors).length === 0;
  };

  return { values, setValues, set, field, errors, check, setServerErrors: setServer, valid: Object.keys(errors).length === 0 };
}

/** Label, the control, its ⓘ (optional) and its inline mark. */
export function Field({ label, info, state, message, children, className, htmlFor }: { label: ReactNode; info?: ReactNode; state?: "bad" | "good"; message?: ReactNode; children: ReactNode; className?: string; htmlFor?: string }) {
  const help = useInfo();
  return (
    <div className={cn("mb-[14px]", className)} data-state={state}>
      <span className="mb-1.5 flex items-center gap-1">
        <label htmlFor={htmlFor} className="block text-[12px] font-semibold text-muted-foreground">
          {label}
        </label>
        {info && <InfoButton {...help} label={`About ${typeof label === "string" ? label.toLowerCase() : "this field"}`} />}
      </span>
      {info && (
        <InfoText {...help} className={help.open ? "mt-0" : undefined}>
          {info}
        </InfoText>
      )}
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

export function Input({ value, onChange, onBlur, state, className, ...rest }: Ctl<string> & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) {
  return (
    <span className="relative flex items-center">
      <input
        className={cn(control(state), "h-9", state && "pr-9", className)}
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

export function Textarea({ value, onChange, onBlur, state, className, ...rest }: Ctl<string> & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange">) {
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

export function Select({ value, onChange, onBlur, state, options, placeholder, className, ...rest }: Ctl<string> & { options: Array<[string, string]>; placeholder?: string } & Omit<SelectHTMLAttributes<HTMLSelectElement>, "value" | "onChange">) {
  return (
    <select
      className={cn(control(state), "h-9", className)}
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

/** Segmented choice inside a form (one of a few). */
export function Seg<V extends string>({ value, onChange, options, disabled }: { value: V; onChange: (v: V) => void; options: Array<[V, ReactNode]>; disabled?: V[] }) {
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
          className={cn("h-[30px] flex-1 rounded-full px-2.5 text-[12.5px] font-semibold whitespace-nowrap disabled:opacity-45", v === value ? "bg-secondary text-secondary-foreground" : "text-muted-foreground")}
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
    <div className={cn("inline-flex items-center overflow-hidden rounded-full border border-input bg-background", small ? "h-7" : "h-[34px]")} role="radiogroup">
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

/** On or off. */
export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn("relative h-[22px] w-[38px] flex-none rounded-full transition-colors disabled:opacity-50", checked ? "bg-secondary" : "bg-border")}
    >
      <span className={cn("absolute top-[3px] left-[3px] size-4 rounded-full bg-white transition-transform", checked && "translate-x-4")} />
    </button>
  );
}

/** A setting row: what it is, a line about it, and its switch. */
export function ToggleRow({ title, text, checked, onChange, changed }: { title: ReactNode; text?: ReactNode; checked: boolean; onChange: (v: boolean) => void; changed?: boolean }) {
  return (
    <div className={cn("flex items-center justify-between gap-3 border-b border-border py-2.5 last:border-b-0", changed && "-mx-[14px] bg-warning-soft px-[14px]")}>
      <div>
        <div className="text-[13px] font-[550]">{title}</div>
        {text && <div className="text-[11.5px] text-subtle-foreground">{text}</div>}
      </div>
      <Switch checked={checked} onChange={onChange} label={typeof title === "string" ? title : "Toggle"} />
    </div>
  );
}

/** Two fields side by side on a desktop, stacked on a phone. */
export const FormRow = ({ children }: { children: ReactNode }) => <div className="grid grid-cols-1 gap-x-2.5 md:grid-cols-2">{children}</div>;

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
