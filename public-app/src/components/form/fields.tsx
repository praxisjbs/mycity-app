import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/cn";
import { Icon } from "@/components/Icon";

/** Label, control and its inline mark (gate 12: a mark on the field, never a dialog). */
export function Field({ label, htmlFor, state, message, children, hint }: { label: ReactNode; htmlFor?: string; state?: "bad" | "good"; message?: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <div data-state={state}>
      <label htmlFor={htmlFor} className="mb-[5px] block text-[12.5px] font-semibold text-muted-foreground">
        {label}
      </label>
      {children}
      {state === "bad" && message ? (
        <p className="mt-[5px] flex items-center gap-[5px] text-[11.5px] text-destructive" role="alert">
          <Icon name="alert" className="size-[13px]" />
          {message}
        </p>
      ) : (
        hint && <p className="mt-[5px] text-[11.5px] text-subtle-foreground">{hint}</p>
      )}
    </div>
  );
}

const control = (state?: "bad" | "good") =>
  cn(
    "w-full min-w-0 rounded-ctl border bg-background px-3 text-[14px] transition-[border-color,box-shadow] outline-none focus:border-ring focus:shadow-[0_0_0_3px_var(--accent)]",
    state === "bad" ? "border-destructive" : state === "good" ? "border-success" : "border-input",
  );

type Ctl = { value: string; onChange: (v: string) => void; state?: "bad" | "good" };

export function Input({ value, onChange, state, className, ...rest }: Ctl & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) {
  return (
    <span className="relative flex items-center">
      <input className={cn(control(state), "h-10", state && "pr-9", className)} value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={state === "bad" || undefined} {...rest} />
      {state === "bad" && <Icon name="alert" className="pointer-events-none absolute right-3 text-destructive" />}
      {state === "good" && <Icon name="ok" className="pointer-events-none absolute right-3 text-success" />}
    </span>
  );
}

export function Textarea({ value, onChange, state, className, ...rest }: Ctl & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange">) {
  return <textarea className={cn(control(state), "min-h-[76px] resize-y px-3 py-[10px] leading-normal", className)} value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={state === "bad" || undefined} {...rest} />;
}
