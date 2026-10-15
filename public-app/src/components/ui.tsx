import type { ReactNode } from "react";
import { cn, Icon, type IconName } from "@mycity/ui";

/*
 * The public site's remaining display parts (fields are in ./form). Button and
 * Icon come from @mycity/ui; these move there in PR 1's display and feedback
 * work (scripts/check/components.js, LEGACY).
 */

const TONE = {
  ok: "bg-success-soft text-success",
  warn: "bg-warning-soft text-warning",
  err: "bg-destructive-soft text-destructive",
  info: "bg-info-soft text-info",
  neutral: "border border-border bg-muted text-muted-foreground",
} as const;
export type Tone = keyof typeof TONE;

/** Status pill: tone AND text, never colour alone. */
export function Pill({ tone = "neutral", children, dot = true }: { tone?: Tone; children: ReactNode; dot?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-[5px] rounded-full px-[9px] py-[3px] text-[11px] font-[650] whitespace-nowrap", TONE[tone])}>
      {dot && <i className="size-[5px] flex-none rounded-full bg-current" />}
      {children}
    </span>
  );
}

/** A one-line notice inside a page. */
export function Notice({ tone = "info", icon = "alert", children }: { tone?: "info" | "warn" | "err" | "ok"; icon?: IconName; children: ReactNode }) {
  return (
    <div className={cn("flex items-start gap-2.5 rounded-box px-3.5 py-3 text-[12.5px] leading-[1.55]", tone === "info" && "bg-info-soft text-info", tone === "warn" && "bg-warning-soft text-warning", tone === "err" && "bg-destructive-soft text-destructive", tone === "ok" && "bg-success-soft text-success")} role={tone === "err" ? "alert" : undefined}>
      <Icon name={icon} className="mt-0.5" />
      <span>{children}</span>
    </div>
  );
}

/** Shimmering placeholder lines while a page loads. */
export function Loading({ lines = 4 }: { lines?: number }) {
  return (
    <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading">
      {Array.from({ length: lines }, (_, i) => (
        <span key={i} className="block h-3.5 animate-pulse rounded-full bg-muted" style={{ width: `${[72, 100, 88, 56, 94][i % 5]}%` }} />
      ))}
    </div>
  );
}

/** The demo's small grey line under a heading. */
export const Sub = ({ children, className }: { children: ReactNode; className?: string }) => <p className={cn("text-[12.5px] text-subtle-foreground", className)}>{children}</p>;
