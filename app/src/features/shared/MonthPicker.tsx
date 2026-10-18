import { useState } from "react";
import { cn, formatMonth, IconButton, Icon, monthName, Popover } from "@mycity/ui";

const shift = (ym: string, n: number) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1 + n, 1)).toISOString().slice(0, 7);

/**
 * One month, stepped back and forward with the arrows, or picked directly: the month's name
 * opens a year and its twelve months. `min` and `max` are YYYY-MM and bound both ways.
 * My Attendance and My Leave's calendar use it.
 */
export function MonthPicker({ value, onChange, min, max, className }: { value: string; onChange: (ym: string) => void; min: string; max: string; className?: string }) {
  const [year, setYear] = useState(Number(value.slice(0, 4)));
  const minYear = Number(min.slice(0, 4));
  const maxYear = Number(max.slice(0, 4));
  return (
    <div role="group" aria-label="Month" className={cn("flex items-center rounded-ctl border border-input bg-background", className)}>
      <IconButton icon="left" label="Previous Month" disabled={value <= min} onClick={() => onChange(shift(value, -1))} />
      <Popover
        title="Pick a Month"
        align="center"
        onOpenChange={(open) => open && setYear(Number(value.slice(0, 4)))}
        trigger={
          <button type="button" className="flex min-w-36 flex-1 items-center justify-center gap-1 rounded-ctl px-2 py-1 text-sm font-semibold hover:bg-muted">
            <span aria-live="polite">{formatMonth(value)}</span>
            <Icon name="down" size="s" />
          </button>
        }
      >
        {(close) => (
          <div className="w-64 phone:w-full">
            <div className="mb-2 flex items-center justify-between">
              <IconButton icon="left" label="Previous Year" disabled={year <= minYear} onClick={() => setYear(year - 1)} />
              <span className="text-sm font-semibold">{year}</span>
              <IconButton icon="right" label="Next Year" disabled={year >= maxYear} onClick={() => setYear(year + 1)} />
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {Array.from({ length: 12 }, (_, i) => {
                const ym = `${year}-${String(i + 1).padStart(2, "0")}`;
                const here = ym === value;
                return (
                  <button
                    key={ym}
                    type="button"
                    aria-pressed={here}
                    aria-label={formatMonth(ym)}
                    disabled={ym < min || ym > max}
                    onClick={() => {
                      onChange(ym);
                      close();
                    }}
                    className={cn(
                      "h-control rounded-ctl border text-sm disabled:cursor-not-allowed disabled:opacity-40",
                      here ? "border-primary bg-primary text-primary-foreground font-semibold" : "border-input bg-background hover:bg-muted",
                    )}
                  >
                    {monthName(i).slice(0, 3)}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </Popover>
      <IconButton icon="right" label="Next Month" disabled={value >= max} onClick={() => onChange(shift(value, 1))} />
    </div>
  );
}
