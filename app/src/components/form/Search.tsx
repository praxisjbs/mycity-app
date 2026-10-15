import { cn } from "@/lib/cn";
import { Icon } from "@/components/ui/Icon";

/** Search box for a list. The text goes to the server as `q`. */
export function SearchBox({ value, onChange, placeholder = "Search", className, label }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string; label?: string }) {
  return (
    <label className={cn("flex h-[34px] min-w-0 items-center gap-2 rounded-full border border-input bg-background px-3 text-[13px] focus-within:border-ring", className)}>
      <Icon name="srch" className="text-subtle-foreground" />
      <input
        className="min-w-0 flex-1 border-0 bg-transparent outline-none"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={label ?? placeholder}
        type="search"
      />
    </label>
  );
}

/** A labelled select in a filter row. Each value is sent to the server as a filter. */
export function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: Array<[string, string]> }) {
  return (
    <label className="flex flex-col gap-1 text-[11px] font-semibold text-subtle-foreground">
      {label}
      <select
        className="h-8 w-auto max-w-[220px] min-w-[130px] rounded-ctl border border-input bg-background px-3 text-[13px] font-normal text-foreground"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}
