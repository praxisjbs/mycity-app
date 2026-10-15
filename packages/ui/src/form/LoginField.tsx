/**
 * @component LoginField
 * @group Forms
 * @summary The sign-in screen's larger field: label, control, its mark, and a message that shakes on a failed try.
 * @use The sign-in and password reset screens only.
 * @avoid Any other form (use Field with TextField or PasswordField).
 * @phone 46 px tall with 16 px text; full width.
 * @a11y The label is linked by htmlFor; the message is linked by aria-describedby and announced.
 * @status stable
 * @example <LoginField id="email" label="Work Email" type="email" autoComplete="username" value={email} onChange={setEmail} onBlur={touch} error={err} good={ok} buzz={tries} />
 */
import { cn } from "../lib/cn";
import { Icon } from "../icons/Icon";

export interface LoginFieldProps {
  /** The control's id. */
  id: string;
  /** Title Case, at most 4 words. */
  label: string;
  /** email, password or text. */
  type: string;
  /** username, current-password and so on. */
  autoComplete: string;
  /** The value. */
  value: string;
  /** Called on each key. */
  onChange: (value: string) => void;
  /** Called when the person leaves the field. */
  onBlur: () => void;
  /** The error, at most 4 words; empty when none. */
  error: string;
  /** Shows the tick when the value is right. */
  good: boolean;
  /** Bumped on each failed try: the field shakes once. */
  buzz: number;
}

export function LoginField({ id, label, type, autoComplete, value, onChange, onBlur, error, good, buzz }: LoginFieldProps) {
  return (
    <div className="mt-4.5">
      <label htmlFor={id} className="mb-1.5 block text-sm font-semibold text-muted-foreground">
        {label}
      </label>
      <div key={buzz} className={cn("relative flex items-center", buzz > 0 && "animate-buzz")}>
        <input
          id={id}
          type={type}
          autoComplete={autoComplete}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          aria-invalid={!!error || undefined}
          aria-describedby={`e-${id}`}
          className={cn(
            "h-11.5 w-full rounded-box border-2 bg-background pr-10.5 pl-3.5 text-lg transition-colors outline-none focus:border-ring",
            error ? "border-destructive" : "border-input",
          )}
        />
        {error && <Icon name="alert" size="s" className="pointer-events-none absolute right-3 text-destructive" />}
        {!error && good && value && <Icon name="ok" size="s" className="pointer-events-none absolute right-3 text-success" />}
      </div>
      <p id={`e-${id}`} role="alert" className={cn("mt-1.5 items-center gap-1 text-sm text-destructive", error ? "flex" : "hidden")}>
        <Icon name="alert" size="s" />
        <span>{error}</span>
      </p>
    </div>
  );
}
