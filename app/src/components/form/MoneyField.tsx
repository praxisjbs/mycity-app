import { cn } from "@/lib/cn";

/** Amount entry. Keeps what the person typed; the value sent is a two-place decimal string. */
export function AmountInput({ value, onChange, onBlur, state, id }: { value: string; onChange: (v: string) => void; onBlur?: () => void; state?: "bad" | "good"; id?: string }) {
  return (
    <span className="relative flex items-center">
      <span className="pointer-events-none absolute left-3 text-muted-foreground">₦</span>
      <input
        id={id}
        inputMode="decimal"
        className={cn(
          "h-9 w-full min-w-0 rounded-ctl border bg-background pr-3 pl-7 text-right tabular-nums outline-none focus:border-ring focus:shadow-[0_0_0_3px_var(--accent)]",
          state === "bad" ? "border-destructive" : state === "good" ? "border-success" : "border-input",
        )}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^\d.,]/g, ""))}
        onBlur={onBlur}
        aria-invalid={state === "bad" || undefined}
      />
    </span>
  );
}

/** "250,000" or "250000.5" as typed → "250000.50" for the wire. */
export function toMoneyString(typed: string): string {
  const s = typed.replace(/,/g, "").trim();
  if (!s) return "";
  const [w, f = ""] = s.split(".");
  return `${w || "0"}.${(f + "00").slice(0, 2)}`;
}
