/**
 * @component Result
 * @group Display
 * @summary The outcome of something a person just did: clocking in, signing, a check that passed or failed.
 * @use Straight after an action, at the top of the screen or sheet that shows what happened.
 * @avoid A notice about the system (use Banner); an error from a read (use ErrorState); a confirmation a toast already gave.
 * @phone Full width at the top of the sheet, with the glyph beside the words rather than above them.
 * @a11y A live region, so the outcome is heard without the person going looking for it; the tone is always carried by words too.
 * @status stable
 * @example <Result tone="ok" label="Clocked In" title="07:52, On Site" text="Lekki Office" />
 */
import type { ReactNode } from "react";
import { cn } from "../lib/cn";
import { Icon, type IconName } from "../icons/Icon";

/** How it went. */
export type ResultTone = "ok" | "warn" | "err" | "info";

const TONE: Record<ResultTone, { box: string; icon: IconName }> = {
  ok: { box: "bg-success-soft text-success", icon: "ok" },
  warn: { box: "bg-warning-soft text-warning", icon: "alert" },
  err: { box: "bg-destructive-soft text-destructive", icon: "alert" },
  info: { box: "bg-info-soft text-info", icon: "info" },
};

export interface ResultProps {
  /** How it went: ok, warn, err or info. */
  tone: ResultTone;
  /** The outcome itself, at most 4 words ("07:52, On Site"). */
  title: ReactNode;
  /** The small line above it, Title Case, at most 3 words ("Clocked In"). */
  label?: string;
  /** One line under it, at most 20 words. */
  text?: ReactNode;
  /** A glyph instead of the tone's own. */
  icon?: IconName;
  /** Layout classes only (spacing). */
  className?: string;
}

export function Result({ tone, title, label, text, icon, className }: ResultProps) {
  const t = TONE[tone];
  return (
    <div role="status" className={cn("mb-3 flex items-start gap-2.5 rounded-box px-3.5 py-3", t.box, className)}>
      <Icon name={icon ?? t.icon} size="m" className="mt-0.5 flex-none" />
      <span className="min-w-0">
        {label && <span className="block text-2xs font-strong tracking-caps uppercase">{label}</span>}
        <b className="block text-md">{title}</b>
        {text != null && <p className="mt-0.5 text-xs text-muted-foreground">{text}</p>}
      </span>
    </div>
  );
}
