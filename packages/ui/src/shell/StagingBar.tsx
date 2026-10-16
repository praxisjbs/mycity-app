/**
 * @component StagingBar
 * @group Shell
 * @summary The amber bar across the top of every staging page, sign-in included, so nobody mistakes staging for the live system.
 * @use Once per app, at the top, rendered only when useEnvironment() says staging (MILESTONES §6, A4). The staff app fixes it above everything; the public site lets it stick.
 * @avoid Any other notice (use Banner or ShellNotice); production, where it never renders; dismissing it (it has no close).
 * @phone The short line only; it takes the status bar inset on a notched phone, so its text is never under the notch.
 * @a11y A status region, read once when the page opens. Its height is --env-bar, which every full-screen layer starts below.
 * @status stable
 * @example <StagingBar message="For training and testing. Every feature works and mail reaches real people." short="Mail here is real" />
 */
import { cn } from "../lib/cn";
import { Icon } from "../icons/Icon";

export interface StagingBarProps {
  /** The line on desktop, after the word Staging: one sentence, at most 20 words. */
  message: string;
  /** The line on a phone: at most 5 words. */
  short: string;
  /** `fixed` above everything (the staff app, the default), `sticky` while the page scrolls (the public site), `inline` in the flow (the gallery). */
  placement?: "fixed" | "sticky" | "inline";
  /** Layout classes only (spacing). */
  className?: string;
}

const PLACE = {
  fixed: "fixed inset-x-0 top-0 z-50 h-(--env-bar) pt-safe",
  sticky: "sticky top-0 z-50 h-(--env-bar) pt-safe",
  inline: "h-7",
} as const;

export function StagingBar({ message, short, placement = "fixed", className }: StagingBarProps) {
  return (
    <div role="status" data-staging-bar="" className={cn("flex items-center justify-center gap-2 bg-warning px-3 text-xs font-semibold text-background", PLACE[placement], className)}>
      <Icon name="alert" />
      <span>
        <b className="tracking-wider uppercase">Staging</b>
        <span className="phone:hidden"> · {message}</span>
        <span className="desk:hidden"> · {short}</span>
      </span>
    </div>
  );
}
