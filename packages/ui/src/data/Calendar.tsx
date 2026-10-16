/**
 * @component Calendar
 * @group Data
 * @summary A month at a glance, Monday first, with what happens on each day.
 * @use Leave across a month, a shift pattern, interviews, a payroll calendar, anything a person reads by date.
 * @avoid A list of dated records (use DataView); a date to type into a form (use DateField); more than three events on one day without opening it.
 * @phone The same seven columns at a shorter height; a day's events are one tap each, and the page never scrolls sideways.
 * @a11y A table of weeks with the weekdays as real headers, so a screen reader can say "Wednesday 14"; Sundays are marked in words, not only by their shade.
 * @status stable
 * @example <Calendar year={2026} month={9} events={[{ date: "2026-10-14", label: "Ada on leave" }]} />
 */
import type { ReactNode } from "react";
import { cn } from "../lib/cn";
import { content } from "../lib/slots";
import { monthName } from "../lib/format";
import { Card, CardHeader } from "../layout/Card";

/** One thing happening on a day. */
export interface CalendarEvent {
  /** Its day, ISO on the wire (`2026-10-14`). */
  date: string;
  /** What it is, as short as it can be: it sits inside one day's box. */
  label: string;
  /** Draw it in the brand yellow rather than the soft accent: the day that matters most. */
  highlight?: boolean;
  /** Opens it. */
  onSelect?: () => void;
}

export interface CalendarProps {
  /** The year. */
  year: number;
  /** The month, 0 for January, as `Date` counts them. */
  month: number;
  /** Everything happening that month; days outside it are ignored. */
  events: CalendarEvent[];
  /** What sits at the right of the title row (the month's own controls); the time zone otherwise. */
  actions?: ReactNode;
  /** Layout classes only (spacing). */
  className?: string;
}

const WEEKDAYS = [
  { short: "Mon", full: "Monday" },
  { short: "Tue", full: "Tuesday" },
  { short: "Wed", full: "Wednesday" },
  { short: "Thu", full: "Thursday" },
  { short: "Fri", full: "Friday" },
  { short: "Sat", full: "Saturday" },
  { short: "Sun", full: "Sunday" },
];

export function Calendar({ year, month, events, actions, className }: CalendarProps) {
  // Monday first: the working week is Monday to Saturday, so Sunday closes the row.
  const lead = (new Date(Date.UTC(year, month, 1)).getUTCDay() + 6) % 7;
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

  const byDay = new Map<number, CalendarEvent[]>();
  for (const event of events) {
    const [y, m, d] = event.date.split("-").map(Number);
    if (y === year && m === month + 1 && d) byDay.set(d, [...(byDay.get(d) ?? []), event]);
  }

  const cells: Array<number | null> = [...Array.from({ length: lead }, () => null), ...Array.from({ length: days }, (_, i) => i + 1)];
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks = Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7));

  return (
    <Card className={className}>
      <CardHeader title={`${monthName(month)} ${year}`} actions={actions ?? <span className="text-2xs text-subtle-foreground">Africa/Lagos</span>} />
      <table {...content} className="w-full table-fixed border-separate border-spacing-1">
        <caption className="sr-only">{`${monthName(month)} ${year}`}</caption>
        <thead>
          <tr>
            {WEEKDAYS.map((day) => (
              <th key={day.short} scope="col" className="overflow-hidden py-1 text-center text-2xs font-strong tracking-caps text-subtle-foreground uppercase">
                <abbr title={day.full} className="no-underline">
                  {day.short}
                </abbr>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week, w) => (
            <tr key={w}>
              {week.map((day, i) => {
                const sunday = i === 6;
                if (day === null) return <td key={i} className="h-16 rounded-box border border-border bg-muted phone:h-13" />;
                return (
                  <td
                    key={i}
                    className={cn("h-16 min-w-0 overflow-hidden rounded-box border border-border p-1 align-top text-2xs phone:h-13", sunday ? "bg-muted text-subtle-foreground" : "bg-card")}
                  >
                    <b className="mb-0.5 block text-2xs font-strong tabular-nums">
                      {day}
                      {sunday && <span className="sr-only">, Sunday, not a working day</span>}
                    </b>
                    {(byDay.get(day) ?? []).map((event, j) =>
                      event.onSelect ? (
                        <button
                          key={j}
                          type="button"
                          onClick={event.onSelect}
                          title={event.label}
                          className={cn("mb-0.5 block w-full truncate rounded-sm px-1 text-left text-2xs font-semibold", event.highlight ? "bg-primary text-primary-foreground" : "bg-accent text-accent-foreground")}
                        >
                          {event.label}
                        </button>
                      ) : (
                        <span
                          key={j}
                          title={event.label}
                          className={cn("mb-0.5 block w-full truncate rounded-sm px-1 text-left text-2xs font-semibold", event.highlight ? "bg-primary text-primary-foreground" : "bg-accent text-accent-foreground")}
                        >
                          {event.label}
                        </span>
                      ),
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
