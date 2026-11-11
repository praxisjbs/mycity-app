/**
 * @component MonthField
 * @group Forms
 * @summary A month picked from a year's twelve, bound to a form: the field reads "October 2026" and the value is the month's first day for the wire.
 * @use Every month a person enters in a form: a payroll run's month (New Run), a period that is a whole month. The contract's `monthStart` is the rule it meets.
 * @avoid A day (use DateField); a month stepped through on a screen that is not a form, such as a calendar's month (a screen's own switch); <input type="month"> (the browser draws it, gate 21).
 * @phone The months open in a bottom sheet titled by the field's label, three to a row, each a 44 px target; the year switch sits above them.
 * @a11y The button is named by its Field's label and the month it holds, and says it opens a dialog. Each month is a button named by its month and year, pressed when it is the value; months outside min and max are disabled, and the year arrows stop at their years.
 * @status beta
 * @example <Field label="Month" {...form.status("period")}><MonthField min="2024-01-01" max={todayIso()} {...form.field("period")} /></Field>
 */
import { useId, useState } from "react";
import { cn } from "../lib/cn";
import { formatMonth, monthName, todayIso } from "../lib/format";
import { Icon } from "../icons/Icon";
import { Popover } from "../overlay/Popover";
import type { FieldState } from "./binding";
import { useFieldControl, useFieldLabelId } from "./Field";
import { controlClass } from "./TextField";

export interface MonthFieldProps {
  /** The month as its first day, ISO (2026-10-01), or "" for none. */
  value: string;
  /** Called with the first day of the month picked. */
  onChange: (iso: string) => void;
  /** Called when the months close, so the form checks the field as it would on leaving an input. */
  onBlur?: () => void;
  /** The earliest month that may be picked: any ISO date in it. */
  min?: string;
  /** The latest month that may be picked: any ISO date in it. */
  max?: string;
  /** The mark; the Field supplies one otherwise. */
  state?: FieldState;
  /** Unused here (the Field shows it). */
  message?: string;
  /** The control's id; the Field supplies one otherwise. */
  id?: string;
  /** The field's name, so a failed submit can focus it. */
  name?: string;
  /** What the button reads with no month: a format example, at most 3 words. */
  placeholder?: string;
  /** Shown and not changed: the months do not open. */
  disabled?: boolean;
  /** Layout classes only (spacing, width); the look is the component's own. */
  className?: string;
}

/** "2026-10-01" or "2026-10" → "2026-10", the month a date falls in. */
const monthOf = (iso: string | undefined) => (iso ? iso.slice(0, 7) : undefined);

export function MonthField({ value, onChange, onBlur, min, max, state, message: _message, id, name, placeholder = "Month Year", disabled, className }: MonthFieldProps) {
  const a = useFieldControl({ id, state });
  const labelId = useFieldLabelId();
  const textId = useId();
  const [open, setOpen] = useState(false);
  const title = (labelId && typeof document !== "undefined" && document.getElementById(labelId)?.textContent?.trim()) || "Pick a Month";
  const toggle = (next: boolean) => {
    if (disabled) return;
    setOpen(next);
    if (!next) onBlur?.();
  };
  return (
    <span className={cn("relative flex w-full desk:max-w-56", className)}>
      <Popover
        title={title}
        open={open && !disabled}
        onOpenChange={toggle}
        align="start"
        trigger={
          <button
            type="button"
            id={a.id}
            name={name}
            value={value}
            disabled={disabled}
            aria-labelledby={labelId ? `${labelId} ${textId}` : undefined}
            aria-describedby={a["aria-describedby"]}
            aria-invalid={a["aria-invalid"]}
            className={cn(controlClass(a.state), "flex h-control items-center justify-between gap-2 text-left")}
          >
            <span id={textId} className={cn("min-w-0 flex-1 truncate", !value && "text-subtle-foreground")} data-copy={value ? "content" : undefined}>
              {value ? formatMonth(value) : placeholder}
            </span>
            <Icon name="calendar" size="s" className="flex-none text-subtle-foreground" />
          </button>
        }
      >
        <MonthGrid
          value={value}
          min={monthOf(min)}
          max={monthOf(max)}
          onPick={(iso) => {
            onChange(iso);
            toggle(false);
          }}
        />
      </Popover>
    </span>
  );
}

/** A year's twelve months under a switch between years; `min` and `max` are YYYY-MM. */
function MonthGrid({ value, min, max, onPick }: { value: string; min?: string; max?: string; onPick: (iso: string) => void }) {
  const now = monthOf(todayIso())!;
  // The year it opens on: the value's, else this year held within min and max.
  const start = monthOf(value) ?? (max && max < now ? max : min && min > now ? min : now);
  const [year, setYear] = useState(Number(start.slice(0, 4)));
  const minYear = min ? Number(min.slice(0, 4)) : -Infinity;
  const maxYear = max ? Number(max.slice(0, 4)) : Infinity;
  const picked = monthOf(value);
  return (
    <div className="w-full desk:w-64">
      <div className="mb-2 flex items-center">
        <button
          type="button"
          aria-label="Previous Year"
          disabled={year <= minYear}
          className="flex size-tap items-center justify-center rounded-md hover:bg-muted disabled:opacity-30"
          onClick={() => setYear(year - 1)}
        >
          <Icon name="left" size="s" />
        </button>
        <b className="flex-1 text-center text-sm tabular-nums" aria-live="polite">
          {year}
        </b>
        <button
          type="button"
          aria-label="Next Year"
          disabled={year >= maxYear}
          className="flex size-tap items-center justify-center rounded-md hover:bg-muted disabled:opacity-30"
          onClick={() => setYear(year + 1)}
        >
          <Icon name="right" size="s" />
        </button>
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {Array.from({ length: 12 }, (_, i) => {
          const ym = `${year}-${String(i + 1).padStart(2, "0")}`;
          const off = (!!min && ym < min) || (!!max && ym > max);
          const here = ym === picked;
          return (
            <button
              key={ym}
              type="button"
              disabled={off}
              aria-label={formatMonth(ym)}
              aria-pressed={here}
              onClick={() => onPick(`${ym}-01`)}
              className={cn(
                "h-control rounded-ctl text-sm disabled:cursor-not-allowed disabled:opacity-30 phone:h-tap",
                here ? "bg-secondary font-bold text-secondary-foreground" : "hover:bg-accent hover:text-accent-foreground",
                ym === now && !here && "font-bold underline underline-offset-4",
              )}
            >
              {monthName(i).slice(0, 3)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
