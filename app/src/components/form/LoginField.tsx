import { cn } from "@/lib/cn";
import { Icon } from "@/components/ui/Icon";

/** The sign-in screen's larger field: label, control, its mark and a message that shakes on a failed try. */
export function LoginField({ id, label, type, autoComplete, value, onChange, onBlur, error, good, buzz }: {
  id: string; label: string; type: string; autoComplete: string; value: string; onChange: (v: string) => void; onBlur: () => void; error: string; good: boolean; buzz: number;
}) {
  return (
    <div className="mt-[18px]">
      <label htmlFor={id} className="mb-1.5 block text-[12.5px] font-semibold text-muted-foreground">
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
            "h-[46px] w-full rounded-box border-[1.5px] bg-background pr-[42px] pl-[14px] transition-[border-color,box-shadow] outline-none focus:border-ring focus:shadow-[0_0_0_3px_var(--accent)]",
            error ? "border-destructive" : "border-input",
          )}
        />
        {error && <Icon name="alert" className="pointer-events-none absolute right-3 text-destructive" />}
        {!error && good && value && <Icon name="ok" className="pointer-events-none absolute right-3 text-success" />}
      </div>
      <p id={`e-${id}`} role="alert" className={cn("mt-1.5 items-center gap-[5px] text-[12.5px] text-destructive", error ? "flex" : "hidden")}>
        <Icon name="alert" />
        <span>{error}</span>
      </p>
    </div>
  );
}
