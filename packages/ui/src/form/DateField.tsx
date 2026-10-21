/**
 * @component DateField
 * @group Forms
 * @summary Day-first date entry: type 13/10/2026 or pick a day; the value is ISO for the wire. With DateRangeField and TimeField.
 * @use Every date a person enters (gate 15); DateRangeField for a from and to pair (a report period); TimeField for a 24-hour time.
 * @avoid <input type="date"> (its format follows the browser's locale); a date shown and not entered (use formatDate).
 * @phone The calendar opens as a bottom sheet; days are 44 px targets; the keyboard is numeric.
 * @a11y The typed field carries its Field's label; the calendar button says what it does; days are buttons named by their date.
 * @status stable
 * @exports DateRangeField, TimeField
 * @example <DateField min={todayIso()} {...form.field("start_date")} />
 */
import { useEffect, useRef, useState } from "react";
import { cn } from "../lib/cn";
import { formatDate, monthName, parseDayFirst, todayIso } from "../lib/format";
import { Icon } from "../icons/Icon";
import { Popover } from "../overlay/Popover";
import type { FieldState } from "./binding";
import { useFieldControl } from "./Field";
import { controlClass } from "./TextField";

export interface DateFieldProps {
  /** ISO date (YYYY-MM-DD), or "" for none. */
  value: string;
  /** Called with the ISO date the text shows, or "" while it shows none: cleared, half typed, or outside min and max. */
  onChange: (iso: string) => void;
  /** Called when the person leaves the field. */
  onBlur?: () => void;
  /** Told what is wrong with what was typed ("Not a real date", "Pick 21/10/2026 or later"), or undefined once it is right. */
  onProblem?: (message: string | undefined, now?: boolean) => void;
  /** The earliest date that may be picked or typed, ISO. */
  min?: string;
  /** The latest date that may be picked or typed, ISO. */
  max?: string;
  /** The mark; the Field supplies one otherwise. */
  state?: FieldState;
  /** Unused here (the Field shows it). */
  message?: string;
  /** The control's id; the Field supplies one otherwise. */
  id?: string;
  /** The field's name, so a failed submit can focus it. */
  name?: string;
  /** The format example; DD/MM/YYYY. */
  placeholder?: string;
}

/**
 * What typed text holds: the ISO date when it is a whole date within min and max, else "" and
 * what is wrong. `final` once nothing more can be typed onto it (a four-digit year); a two-digit
 * year may still be on its way to four, so it waits for the pause like any half-typed value.
 */
function readTyped(text: string, min?: string, max?: string): { iso: string; problem?: string; final?: boolean } {
  if (!text.trim()) return { iso: "" };
  const iso = parseDayFirst(text);
  if (!iso) return { iso: "", problem: "Not a real date" };
  const final = /\d{4}\s*$/.test(text);
  if (min && iso < min) return { iso: "", problem: `Pick ${formatDate(min)} or later`, final };
  if (max && iso > max) return { iso: "", problem: `Pick ${formatDate(max)} or earlier`, final };
  return { iso };
}

export function DateField({ value, onChange, onBlur, onProblem, min, max, state, message: _message, id, name, placeholder = "DD/MM/YYYY" }: DateFieldProps) {
  const a = useFieldControl({ id, state });
  const [text, setText] = useState(formatDate(value));
  const [problem, setProblem] = useState<string | undefined>();
  const [open, setOpen] = useState(false);
  // The value this field last handed over. Its echo is not a change from outside, so the text stays
  // as typed: rewritten from it, "28/10/20" became 28/10/2020 and the year never reached 2026.
  const sent = useRef<string | null>(null);
  const problemRef = useRef(onProblem);
  problemRef.current = onProblem;

  useEffect(() => {
    if (value === sent.current) return;
    sent.current = null;
    setText(formatDate(value));
    setProblem(undefined);
    problemRef.current?.(undefined);
  }, [value]);

  const commit = (t: string) => {
    setText(t);
    const typed = readTyped(t, min, max);
    setProblem(typed.problem);
    onProblem?.(typed.problem, typed.final);
    if (typed.iso !== value) {
      sent.current = typed.iso;
      onChange(typed.iso);
    }
  };

  /** Leaving the field shows a whole date as it is kept: 1.2.26 reads 01/02/2026. */
  const leave = () => {
    if (value && parseDayFirst(text) === value) setText(formatDate(value));
    onBlur?.();
  };

  const shown: FieldState = problem ? "bad" : a.state;

  return (
    <span className="relative flex w-full items-center desk:max-w-48">
      <input
        {...a}
        aria-invalid={shown === "bad" || undefined}
        name={name}
        inputMode="numeric"
        autoComplete="off"
        className={cn(controlClass(shown), "h-control pr-11 tabular-nums")}
        placeholder={placeholder}
        value={text}
        onChange={(e) => commit(e.target.value)}
        onBlur={leave}
      />
      <Popover
        title="Pick a Date"
        open={open}
        onOpenChange={setOpen}
        align="end"
        trigger={
          <button type="button" aria-label="Pick a date" className="absolute right-0 flex h-control min-h-tap w-11 items-center justify-center text-subtle-foreground hover:text-foreground">
            <Icon name="check" size="s" />
          </button>
        }
      >
        <MonthGrid
          value={value}
          min={min}
          max={max}
          onPick={(iso) => {
            onChange(iso);
            setOpen(false);
          }}
        />
      </Popover>
    </span>
  );
}

function MonthGrid({ value, min, max, onPick }: { value: string; min?: string; max?: string; onPick: (iso: string) => void }) {
  const base = value || todayIso();
  const [ym, setYm] = useState<[number, number]>([Number(base.slice(0, 4)), Number(base.slice(5, 7)) - 1]);
  const [y, m] = ym;
  const lead = (new Date(Date.UTC(y, m, 1)).getUTCDay() + 6) % 7;
  const days = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const iso = (d: number) => `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const step = (n: number) => setYm(([yy, mm]) => (mm + n < 0 ? [yy - 1, 11] : mm + n > 11 ? [yy + 1, 0] : [yy, mm + n]));
  const today = todayIso();
  return (
    <div className="w-full desk:w-64">
      <div className="mb-2 flex items-center">
        <button type="button" aria-label="Previous month" className="flex size-tap items-center justify-center rounded-md hover:bg-muted" onClick={() => step(-1)}>
          <Icon name="left" size="s" />
        </button>
        <b className="flex-1 text-center text-sm" aria-live="polite">
          {monthName(m)} {y}
        </b>
        <button type="button" aria-label="Next month" className="flex size-tap items-center justify-center rounded-md hover:bg-muted" onClick={() => step(1)}>
          <Icon name="right" size="s" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center">
        {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((d) => (
          <span key={d} aria-hidden className="py-1 text-2xs font-semibold text-subtle-foreground uppercase">
            {d}
          </span>
        ))}
        {Array.from({ length: lead }, (_, i) => (
          <span key={`l${i}`} />
        ))}
        {Array.from({ length: days }, (_, i) => {
          const d = iso(i + 1);
          const off = (!!min && d < min) || (!!max && d > max);
          return (
            <button
              key={d}
              type="button"
              disabled={off}
              aria-label={formatDate(d)}
              aria-pressed={d === value}
              onClick={() => onPick(d)}
              className={cn(
                "h-8 rounded-md text-sm tabular-nums disabled:opacity-30 phone:h-tap",
                d === value ? "bg-secondary font-bold text-secondary-foreground" : "hover:bg-accent hover:text-accent-foreground",
                d === today && d !== value && "font-bold underline underline-offset-4",
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

/** A period: two ISO dates. */
export interface DateRange {
  from: string;
  to: string;
}

export interface DateRangeFieldProps {
  /** The period; "" for an end not chosen. */
  value: DateRange;
  /** Called with the period. */
  onChange: (value: DateRange) => void;
  /** Called when the person leaves either end. */
  onBlur?: () => void;
  /** Told what is wrong with either end as typed, or undefined once both are right (as DateField's). */
  onProblem?: (message: string | undefined, now?: boolean) => void;
  /** The earliest date either end may take, ISO. */
  min?: string;
  /** The latest date either end may take, ISO. */
  max?: string;
  /** The mark; the Field supplies one otherwise. */
  state?: FieldState;
  /** Unused here (the Field shows it). */
  message?: string;
}

/** From and to, each day-first; the to date can never be before the from date. */
export function DateRangeField({ value, onChange, onBlur, onProblem, min, max, state }: DateRangeFieldProps) {
  // Each end's own problem: the period reports the first, so fixing one end never hides the other's.
  const ends = useRef<{ from?: string; to?: string }>({});
  const told = (end: "from" | "to") => (message: string | undefined, now?: boolean) => {
    ends.current = { ...ends.current, [end]: message };
    onProblem?.(ends.current.from ?? ends.current.to, now);
  };
  return (
    <span className="flex flex-col gap-2 desk:flex-row desk:items-center">
      <DateField value={value.from} onChange={(from) => onChange({ ...value, from })} onBlur={onBlur} onProblem={told("from")} min={min} max={value.to || max} state={state} />
      <span className="hidden text-sm text-muted-foreground desk:inline" aria-hidden>
        to
      </span>
      <DateField value={value.to} onChange={(to) => onChange({ ...value, to })} onBlur={onBlur} onProblem={told("to")} min={value.from || min} max={max} state={state} />
    </span>
  );
}

export interface TimeFieldProps {
  /** 24-hour time HH:MM, Africa/Lagos, or "" for none. */
  value: string;
  /** Called with HH:MM once it is a real time, or "" when cleared. */
  onChange: (value: string) => void;
  /** Called when the person leaves the field. */
  onBlur?: () => void;
  /** The mark; the Field supplies one otherwise. */
  state?: FieldState;
  /** Unused here (the Field shows it). */
  message?: string;
  /** The control's id; the Field supplies one otherwise. */
  id?: string;
}

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** A 24-hour time, typed as 0930 or 09:30. */
export function TimeField({ value, onChange, onBlur, state, message: _message, id }: TimeFieldProps) {
  const a = useFieldControl({ id, state });
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const commit = (t: string) => {
    const digits = t.replace(/\D/g, "").slice(0, 4);
    const shownText = digits.length > 2 ? `${digits.slice(0, 2)}:${digits.slice(2)}` : digits;
    setText(shownText);
    if (TIME.test(shownText)) onChange(shownText);
    else if (!digits) onChange("");
  };
  const typedBad = text.length === 5 && !TIME.test(text);
  const shown: FieldState = typedBad ? "bad" : a.state;
  return (
    <input
      {...a}
      aria-invalid={shown === "bad" || undefined}
      inputMode="numeric"
      autoComplete="off"
      placeholder="HH:MM"
      className={cn(controlClass(shown), "h-control w-full tabular-nums desk:max-w-28")}
      value={text}
      onChange={(e) => commit(e.target.value)}
      onBlur={onBlur}
    />
  );
}
