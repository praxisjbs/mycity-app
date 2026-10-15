import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { formatDate, monthName, parseDayFirst, todayIso } from "@/lib/format";
import { Icon } from "@/components/ui/Icon";

/**
 * Day-first date entry (gate 15): never <input type="date">, whose format
 * follows the browser's locale. The person types 13/10/2026 or picks a day;
 * the value is ISO ("2026-10-13") for the wire.
 */
export function DateField({ value, onChange, onBlur, state, min, max, id, placeholder = "dd/mm/yyyy" }: {
  value: string;
  onChange: (iso: string) => void;
  onBlur?: () => void;
  state?: "bad" | "good";
  min?: string;
  max?: string;
  id?: string;
  placeholder?: string;
}) {
  const [text, setText] = useState(formatDate(value));
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);

  useEffect(() => setText(formatDate(value)), [value]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !wrap.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const commit = (t: string) => {
    setText(t);
    const iso = parseDayFirst(t);
    if (iso) onChange(iso);
    else if (!t.trim()) onChange("");
  };

  const typedBad = text.trim() !== "" && !parseDayFirst(text);
  const shown = typedBad ? "bad" : state;

  return (
    <span ref={wrap} className="relative block">
      <span className="relative flex items-center">
        <input
          id={id}
          inputMode="numeric"
          autoComplete="off"
          className={cn(
            "h-9 w-full min-w-0 rounded-ctl border bg-background pr-10 max-md:h-11 pl-3 outline-none focus:border-ring focus:shadow-[0_0_0_3px_var(--accent)]",
            shown === "bad" ? "border-destructive" : shown === "good" ? "border-success" : "border-input",
          )}
          placeholder={placeholder}
          value={text}
          onChange={(e) => commit(e.target.value)}
          onBlur={onBlur}
          aria-invalid={shown === "bad" || undefined}
        />
        <button type="button" aria-label="Pick a date" className="absolute right-1.5 flex size-7 items-center justify-center rounded-md text-subtle-foreground hover:bg-muted" onClick={() => setOpen((o) => !o)}>
          <Icon name="check" />
        </button>
      </span>
      {open && <MonthPicker value={value} min={min} max={max} onPick={(iso) => (onChange(iso), setOpen(false))} />}
    </span>
  );
}

function MonthPicker({ value, min, max, onPick }: { value: string; min?: string; max?: string; onPick: (iso: string) => void }) {
  const base = value || todayIso();
  const [ym, setYm] = useState<[number, number]>([Number(base.slice(0, 4)), Number(base.slice(5, 7)) - 1]);
  const [y, m] = ym;
  const first = new Date(Date.UTC(y, m, 1));
  const lead = (first.getUTCDay() + 6) % 7;
  const days = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const iso = (d: number) => `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const step = (n: number) => setYm(([yy, mm]) => (mm + n < 0 ? [yy - 1, 11] : mm + n > 11 ? [yy + 1, 0] : [yy, mm + n]));
  const today = todayIso();
  return (
    <div className="absolute top-[42px] left-0 z-[79] w-[260px] animate-rise rounded-xl border border-border bg-popover p-2.5 shadow-3">
      <div className="mb-2 flex items-center">
        <button type="button" aria-label="Previous month" className="flex size-7 items-center justify-center rounded-md hover:bg-muted" onClick={() => step(-1)}>
          <Icon name="left" />
        </button>
        <b className="flex-1 text-center text-[13px]">
          {monthName(m)} {y}
        </b>
        <button type="button" aria-label="Next month" className="flex size-7 items-center justify-center rounded-md hover:bg-muted" onClick={() => step(1)}>
          <Icon name="right" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center">
        {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((d) => (
          <span key={d} className="py-1 text-[10px] font-[650] text-subtle-foreground uppercase">
            {d}
          </span>
        ))}
        {Array.from({ length: lead }, (_, i) => (
          <span key={`l${i}`} />
        ))}
        {Array.from({ length: days }, (_, i) => {
          const d = iso(i + 1);
          const off = (min && d < min) || (max && d > max);
          return (
            <button
              key={d}
              type="button"
              disabled={!!off}
              onClick={() => onPick(d)}
              className={cn(
                "h-8 rounded-md text-[12.5px] disabled:opacity-30 max-md:h-11",
                d === value ? "bg-secondary font-bold text-secondary-foreground" : "hover:bg-accent",
                d === today && d !== value && "font-bold text-accent-foreground",
              )}
            >
              {i + 1}
            </button>
          );
        })}
      </div>
    </div>
  );
}
