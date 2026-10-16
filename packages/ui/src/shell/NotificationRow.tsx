/**
 * @component NotificationRow
 * @group Shell
 * @summary One notification in the bell's list: its glyph in a tone, its title and line, when it came, a dot while unread, and Open.
 * @use The bell's list (the app's Bell): each notification from GET /api/v1/notifications, newest first, under the shared pager.
 * @avoid Alerts, which are conditions to act on (Home · Alerts); a toast (something that just happened in front of the person); a list of records (DataView).
 * @phone The same row; Open drops under the text when there is no room, a 44 px target.
 * @a11y An article; unread is said in words as well as by the dot; the title, line and time are content, read as written.
 * @status stable
 * @example <NotificationRow title="Expense request waiting on you" body="Bashir Lawal · ₦185,000.00" when="08:41" tone="warn" icon="check" unread action={<Button size="sm">Open</Button>} />
 */
import type { ReactNode } from "react";
import { cn } from "../lib/cn";
import { Icon, type IconName } from "../icons/Icon";

/** The tones a notification takes. */
export type NotificationTone = "ok" | "warn" | "err" | "info";

export interface NotificationRowProps {
  /** What happened, as the notification says it. */
  title: ReactNode;
  /** Its line, as the notification says it. */
  body?: ReactNode;
  /** When it came, formatted (formatWhen). */
  when: string;
  /** Its glyph, from its category; the bell unless set. */
  icon?: IconName;
  /** Its tone; info unless set. */
  tone?: NotificationTone;
  /** Not read yet: a dot before the title, and the word Unread for screen readers. */
  unread?: boolean;
  /** Open, when it links to a record. */
  action?: ReactNode;
}

const TONE: Record<NotificationTone, string> = {
  ok: "bg-success-soft text-success",
  warn: "bg-warning-soft text-warning",
  err: "bg-destructive-soft text-destructive",
  info: "bg-accent text-accent-foreground",
};

export function NotificationRow({ title, body, when, icon = "bell", tone = "info", unread = false, action }: NotificationRowProps) {
  return (
    <article className="flex flex-wrap items-center gap-2.5 border-b border-border py-2.5 last:border-b-0">
      <span className={cn("flex size-8 flex-none items-center justify-center rounded-ctl", TONE[tone])}>
        <Icon name={icon} />
      </span>
      <span className="flex min-w-44 flex-1 flex-col gap-0.5">
        <b className="text-sm font-semibold" data-copy="content">
          {unread && <span aria-hidden="true" className="mr-1.5 inline-block size-2 rounded-full bg-primary align-middle" />}
          {title}
          {unread && <span className="sr-only"> Unread</span>}
        </b>
        {body != null && (
          <span className="text-xs text-subtle-foreground" data-copy="content">
            {body}
          </span>
        )}
        <span className="text-xs text-subtle-foreground" data-copy="content">
          {when}
        </span>
      </span>
      {action}
    </article>
  );
}
