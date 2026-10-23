/**
 * @component Calendar
 * @group Data
 * @summary A month at a glance, Monday first, with what happens on each day.
 * @use Leave across a month, a shift pattern, interviews, a payroll calendar, anything a person reads by date.
 * @avoid A list of dated records (use DataView); a date to type into a form (use DateField); more than three events on one day without opening it.
 * @phone The same seven columns at a shorter height; a day's events are one tap each, an empty day a 44 px tap that adds to it, and the page never scrolls sideways.
 * @a11y A table of weeks with the weekdays as real headers, so a screen reader can say "Wednesday 14"; Sundays are marked in words, not only by their shade. An empty day that adds is a button named by what it adds and the day ("Add Task, Friday 23 October").
 * @status stable
 * @example <Calendar year={2026} month={9} events={[{ date: "2026-10-14", label: "Ada on leave" }]} />
 */
import type { ReactNode } from "react";
import { cn } from "../lib/cn";
import { content } from "../lib/slots";
import { monthName } from "../lib/format";
import { Card, CardHeader } from "../layout/Card";
import { Icon } from "../icons/Icon";
import { Tooltip } from "../overlay/Tooltip";

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
  /** An empty day becomes a button that hands its date (ISO) here: New Task for that day, say. */
  onAddDay?: (date: string) => void;
  /** What an empty day adds, Verb Noun (Add Task): its name and its hover label. Default `Add`. */
  addLabel?: string;
  /** The first day that can be added to (ISO, usually today); days before it, and Sundays, stay plain. */
  addFrom?: string;
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

export function Calendar({ year, month, events, actions, onAddDay, addLabel = "Add", addFrom, className }: CalendarProps) {
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
              <th key={day.short} scope="col" aria-label={day.full} className="overflow-hidden py-1 text-center text-2xs font-strong tracking-caps text-subtle-foreground uppercase">
                {day.short}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week, w) => (
            <tr key={w}>
              {week.map((day, i) => {
                const sunday = i === 6;
                const iso = day === null ? "" : `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                // Sunday is not a working day, so nothing is added to it from here.
                const adds = day !== null && !sunday && onAddDay && !byDay.get(day) && (!addFrom || iso >= addFrom);
                if (day === null) return <td key={i} className="h-16 rounded-box border border-border bg-muted phone:h-13" />;
                return (
                  <td
                    key={i}
                    className={cn("h-16 min-w-0 overflow-hidden rounded-box border border-border p-1 align-top text-2xs phone:h-13", sunday ? "bg-muted text-subtle-foreground" : "bg-card")}
                  >
                    {adds ? (
                      <Tooltip label={addLabel}>
                        <button
                          type="button"
                          onClick={() => onAddDay(iso)}
                          aria-label={`${addLabel}, ${WEEKDAYS[i]!.full} ${day} ${monthName(month)}`}
                          className="group flex h-14 w-full flex-col items-start rounded-sm text-left transition-colors duration-(--dur-fast) hover:bg-accent focus-visible:bg-accent phone:h-11"
                        >
                          <b className="block text-2xs font-strong tabular-nums">{day}</b>
                          <Icon name="plus" className="mt-1 text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100" />
                        </button>
                      </Tooltip>
                    ) : (
                      <b className="mb-0.5 block text-2xs font-strong tabular-nums">
                        {day}
                        {sunday && <span className="sr-only">, Sunday, not a working day</span>}
                      </b>
                    )}
                    {(byDay.get(day) ?? []).map((event, j) =>
                      event.onSelect ? (
                        <Tooltip key={j} label={event.label}>
                          <button
                            type="button"
                            onClick={event.onSelect}
                            className={cn("mb-0.5 block w-full truncate rounded-sm px-1 text-left text-2xs font-semibold", event.highlight ? "bg-primary text-primary-foreground" : "bg-accent text-accent-foreground")}
                          >
                            {event.label}
                          </button>
                        </Tooltip>
                      ) : (
                        <Tooltip key={j} label={event.label}>
                          <span
                            className={cn("mb-0.5 block w-full truncate rounded-sm px-1 text-left text-2xs font-semibold", event.highlight ? "bg-primary text-primary-foreground" : "bg-accent text-accent-foreground")}
                          >
                            {event.label}
                          </span>
                        </Tooltip>
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
