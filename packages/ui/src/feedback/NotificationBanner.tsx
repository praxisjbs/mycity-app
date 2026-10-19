/**
 * @component NotificationBanner
 * @group Feedback
 * @summary The banner for a notification that arrives while the app is open: who or what it is about, its title and two lines, dropping in at the top for 3 seconds; notify() shows one from anywhere.
 * @use A new notification over realtime or from the service worker while the app is on screen (the app's Bell calls notify), never for the record already on screen.
 * @avoid The confirmation after an action (toast, at the bottom); something a person must act on before going on (a Banner or a dialog); the list of notifications (NotificationCenter).
 * @phone Full width at the top, under the status bar, as a phone's own notifications arrive; swipe it up to dismiss, tap it to open; 44 px targets.
 * @a11y Shown in a polite live region named New Notifications, so it is read without moving focus; the banner is one button named by its title and text, with a named Dismiss button. It stays while hovered or touched, and fades only when motion is allowed.
 * @status beta
 * @example notify({ id, title: "Tom-Blake Asaah", body: "Re: Test mail", avatar: "Tom-Blake Asaah", onOpen: () => navigate(path) })
 */
import { toast as sonner } from "sonner";
import { cn } from "../lib/cn";
import { Icon, type IconName } from "../icons/Icon";
import { IconButton } from "../actions/Button";
import { Avatar } from "../display/Avatar";

/** The Toaster that shows banners (the app's Toaster mounts it at the top). */
export const NOTICES_TOASTER = "notices";
/** How long a banner shows (TB, 19/10/2026). */
export const NOTICE_MS = 3000;

export type NoticeTone = "ok" | "warn" | "err" | "info";

export interface NotificationBannerProps {
  /** Who it is from, or what happened. */
  title: string;
  /** Its text; two lines show. */
  body?: string | null;
  /** A person's name: their initials stand for it. */
  avatar?: string | null;
  /** The category's glyph when there is no person. */
  icon?: IconName;
  /** The glyph's tone; info unless set. */
  tone?: NoticeTone;
  /** Opens what it is about. */
  onOpen?: () => unknown;
  /** Dismisses it (the × button). */
  onDismiss?: () => unknown;
}

const TONE: Record<NoticeTone, string> = {
  ok: "bg-success-soft text-success",
  warn: "bg-warning-soft text-warning",
  err: "bg-destructive-soft text-destructive",
  info: "bg-accent text-accent-foreground",
};

export function NotificationBanner({ title, body, avatar, icon = "bell", tone = "info", onOpen, onDismiss }: NotificationBannerProps) {
  return (
    <div className="flex w-full items-start gap-3 rounded-card border border-border bg-popover py-3 pr-2 pl-3.5 text-popover-foreground shadow-3 desk:w-96">
      <button type="button" onClick={() => void onOpen?.()} className="flex min-w-0 flex-1 items-start gap-3 text-left outline-none phone:min-h-tap">
        {avatar ? (
          <Avatar name={avatar} size="lg" className="flex-none" />
        ) : (
          <span className={cn("flex size-10 flex-none items-center justify-center rounded-full", TONE[tone])}>
            <Icon name={icon} />
          </span>
        )}
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <b className="truncate text-sm font-strong" data-copy="content">
            {title}
          </b>
          {body ? (
            <span className="line-clamp-2 whitespace-pre-line text-sm text-muted-foreground" data-copy="content">
              {body}
            </span>
          ) : null}
        </span>
      </button>
      {onDismiss && <IconButton icon="x" label="Dismiss" size="sm" onClick={() => onDismiss()} />}
    </div>
  );
}

/** What notify() shows. */
export interface Notice extends Omit<NotificationBannerProps, "onDismiss"> {
  /** The notification's id: the same one never shows twice at once. */
  id: string;
}

/**
 * Shows the banner for a notification that just arrived, at the top, for 3 seconds
 * (held while hovered or touched). A tap opens it and a swipe up or × dismisses it.
 */
export function notify(n: Notice, { duration = NOTICE_MS, toasterId = NOTICES_TOASTER }: { duration?: number; toasterId?: string } = {}): string | number {
  const { id, onOpen, ...banner } = n;
  return sonner.custom(
    (t) => (
      <NotificationBanner
        {...banner}
        onOpen={() => {
          sonner.dismiss(t);
          return onOpen?.();
        }}
        onDismiss={() => sonner.dismiss(t)}
      />
    ),
    { id, duration, toasterId },
  );
}
