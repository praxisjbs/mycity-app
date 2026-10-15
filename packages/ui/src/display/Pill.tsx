/**
 * @component Pill
 * @group Display
 * @summary A small rounded label in a status tone, with a dot; StatusPill draws one from a status record ({ tone, text }).
 * @use A record's status (Approved, Pending, Late), a category tag on a card or a row.
 * @avoid A colour with no word (never colour alone); a count (use CountBadge); an action (use Button or Chips).
 * @phone The same size; a pill is never a tap target on its own.
 * @a11y The text carries the meaning; the dot and the tint are decorative. Its text is marked as content (data-copy), because it is the record's value.
 * @status stable
 * @exports StatusPill
 * @example <Pill tone="ok">Approved</Pill>
 * @example <StatusPill status={leave.status} />
 */
import type { ReactNode } from "react";
import { cn } from "../lib/cn";

/** The status tones: ok (green), warn (amber), err (red), info (blue), neutral (grey). */
export type StatusTone = "ok" | "warn" | "err" | "info" | "neutral";

/** A status as the API sends it: its tone and its words. */
export interface StatusValue {
  /** The tone. */
  tone: StatusTone;
  /** The words (Approved, Awaiting Manager). */
  text: string;
}

const TONE: Record<StatusTone, string> = {
  ok: "border-transparent bg-success-soft text-success",
  warn: "border-transparent bg-warning-soft text-warning",
  err: "border-transparent bg-destructive-soft text-destructive",
  info: "border-transparent bg-info-soft text-info",
  neutral: "border-border bg-muted text-muted-foreground",
};

export interface PillProps {
  /** The status tone; neutral unless set. */
  tone?: StatusTone;
  /** The dot before the words (on unless false). */
  dot?: boolean;
  /** The words: one to three, Title Case. */
  children: ReactNode;
  /** Layout classes only (spacing). */
  className?: string;
}

export function Pill({ tone = "neutral", dot = true, children, className }: PillProps) {
  return (
    <span
      data-copy="content"
      data-tone={tone}
      className={cn("inline-flex max-w-full items-center gap-1.5 rounded-full border px-2 py-0.5 text-2xs font-strong whitespace-nowrap", TONE[tone], className)}
    >
      {dot && <span aria-hidden="true" className="size-1.5 flex-none rounded-full bg-current" />}
      <span className="truncate">{children}</span>
    </span>
  );
}

export interface StatusPillProps {
  /** The status record ({ tone, text }); nothing is drawn when it is null. */
  status?: StatusValue | null;
  /** The merged name for `status`; kept so screens move by an import change. */
  s?: StatusValue | null;
  /** Layout classes only (spacing). */
  className?: string;
}

/** A Pill from a status record, as the API sends it. Draws nothing for a record with no status. */
export function StatusPill({ status, s, className }: StatusPillProps) {
  const value = status ?? s;
  if (!value) return null;
  return (
    <Pill tone={value.tone} className={className}>
      {value.text}
    </Pill>
  );
}
