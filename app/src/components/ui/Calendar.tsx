import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { monthName } from "@/lib/format";
import { Card, CardHeader } from "./layout";

export interface CalEvent {
  date: string; // ISO day
  label: string;
  highlight?: boolean;
  onClick?: () => void;
}

/** A month grid, Monday first, Sundays shaded (the working week is Monday to Saturday). */
export function MonthCalendar({ year, month, events, right }: { year: number; month: number; events: CalEvent[]; right?: ReactNode }) {
  const lead = (new Date(Date.UTC(year, month, 1)).getUTCDay() + 6) % 7;
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const byDay = new Map<number, CalEvent[]>();
  for (const e of events) {
    const [y, m, d] = e.date.split("-").map(Number);
    if (y === year && m === month + 1) byDay.set(d, [...(byDay.get(d) ?? []), e]);
  }
  return (
    <Card>
      <CardHeader title={`${monthName(month)} ${year}`} right={right ?? <span className="text-[11.5px] text-subtle-foreground">Africa/Lagos</span>} />
      <div data-copy="content" className="grid grid-cols-7 gap-1">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <div key={d} className="min-w-0 overflow-hidden py-1 text-center text-[10px] font-[650] tracking-[.08em] text-subtle-foreground uppercase">
            {d}
          </div>
        ))}
        {Array.from({ length: lead }, (_, i) => (
          <div key={`l${i}`} className="min-h-[66px] rounded-lg border border-border bg-muted max-md:min-h-[52px]" />
        ))}
        {Array.from({ length: days }, (_, i) => {
          const d = i + 1;
          const sunday = (lead + i) % 7 === 6;
          return (
            <div key={d} className={cn("min-h-[66px] min-w-0 overflow-hidden rounded-lg border border-border p-[5px] text-[11px] max-md:min-h-[52px] max-md:text-[10px]", sunday ? "bg-muted text-subtle-foreground" : "bg-card")}>
              <b className="mb-[3px] block text-[11px] font-[650]">{d}</b>
              {(byDay.get(d) ?? []).map((e, j) => (
                <button
                  key={j}
                  type="button"
                  onClick={e.onClick}
                  title={e.label}
                  className={cn("mb-0.5 block w-full truncate rounded px-1 py-0.5 text-left text-[9.5px] font-semibold", e.highlight ? "bg-primary text-primary-foreground" : "bg-accent text-accent-foreground")}
                >
                  {e.label}
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
