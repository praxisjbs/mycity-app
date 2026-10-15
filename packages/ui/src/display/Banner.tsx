/**
 * @component Banner
 * @group Display
 * @summary One line across a page or a card in a status tone, with an icon and at most one action.
 * @use Something the person must know or do now: a policy to acknowledge, a run that is locked, a device limit reached.
 * @avoid Reassurance or explanation (tier 3); a result after an action (use a toast); more than one line or more than one action; several banners stacked.
 * @phone Full width; the action drops under the line, 44 px tall.
 * @a11y A status region, or an alert for tone="err", so it is announced when it appears. The icon is decorative; the words carry the meaning, at most 20.
 * @status stable
 * @example <Banner tone="warn" action={<Button size="sm">Read Policy</Button>}>Attendance policy updated</Banner>
 */
import type { ReactNode } from "react";
import { cn } from "../lib/cn";
import { Icon, type IconName } from "../icons/Icon";

/** The banner tones: the status tones without neutral. */
export type BannerTone = "ok" | "warn" | "err" | "info";

const TONE: Record<BannerTone, { box: string; icon: IconName }> = {
  ok: { box: "bg-success-soft text-success", icon: "ok" },
  warn: { box: "bg-warning-soft text-warning", icon: "alert" },
  err: { box: "bg-destructive-soft text-destructive", icon: "alert" },
  info: { box: "bg-info-soft text-info", icon: "info" },
};

export interface BannerProps {
  /** The tone; warn unless set (the merged default). */
  tone?: BannerTone;
  /** The glyph; the tone's own unless set. */
  icon?: IconName;
  /** The line: one sentence, at most 20 words. */
  children: ReactNode;
  /** One action, usually a small Button. */
  action?: ReactNode;
  /** The merged name for `action`; kept so screens move by an import change. */
  actions?: ReactNode;
  /** Layout classes only (spacing). */
  className?: string;
}

export function Banner({ tone = "warn", icon, children, action, actions, className }: BannerProps) {
  const t = TONE[tone];
  const end = action ?? actions;
  return (
    <div
      role={tone === "err" ? "alert" : "status"}
      data-tone={tone}
      className={cn("mb-3 flex flex-wrap items-center gap-x-2.5 gap-y-2 rounded-box px-3 py-2.5 text-sm", t.box, className)}
    >
      <Icon name={icon ?? t.icon} />
      <span className="min-w-0 flex-1 text-foreground">{children}</span>
      {end != null && <span className="flex flex-wrap gap-1.5 phone:w-full">{end}</span>}
    </div>
  );
}
