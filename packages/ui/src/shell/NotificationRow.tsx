/**
 * @component NotificationRow
 * @group Shell
 * @summary One notification in the pane: who or what it is about (initials or the category's glyph), its title, two lines of its text, when it came, and a dot while unread; the whole row opens it.
 * @use The notification pane (NotificationCenter): each notification from GET /api/v1/notifications, newest first, grouped by day.
 * @avoid Alerts, which are conditions to act on (Home · Alerts); a toast or the banner (something that just happened in front of the person); a list of records (DataView).
 * @phone The same row, 44 px and up; swiping it to the left marks it read (the row slides back and the dot goes); a tap opens it.
 * @a11y The row is one button named by its title, its text and its time; unread is said in words as well as by the dot. Mark Read is a named button on desktop (shown on hover or focus) and the swipe has that button's job on a phone.
 * @status stable
 * @example <NotificationRow title="Tom-Blake Asaah" body="Re: Test mail" when="05:33" avatar="Tom-Blake Asaah" unread onOpen={open} onMarkRead={markRead} />
 */
import { useRef, type MouseEvent, type PointerEvent, type ReactNode } from "react";
import { cn } from "../lib/cn";
import { useIsPhone } from "../lib/media";
import { Icon, type IconName } from "../icons/Icon";
import { IconButton } from "../actions/Button";
import { Avatar } from "../display/Avatar";

/** The tones a notification takes. */
export type NotificationTone = "ok" | "warn" | "err" | "info";

export interface NotificationRowProps {
  /** What happened, or who it is from, as the notification says it. */
  title: ReactNode;
  /** Its text, as the notification says it; two lines show. */
  body?: ReactNode;
  /** When it came, formatted (formatWhen). */
  when: string;
  /** A person's name: their initials stand for the notification instead of a glyph (mail, a message). */
  avatar?: string | null;
  /** Its glyph, from its category, when there is no person; the bell unless set. */
  icon?: IconName;
  /** The glyph's tone; info unless set. */
  tone?: NotificationTone;
  /** Not read yet: a dot, the title in strong type, and the word Unread for screen readers. */
  unread?: boolean;
  /** Opens it: the record it is about, or marks it read when it has none. Hands back its work. */
  onOpen?: () => unknown;
  /** Marks it read without opening it: hover on desktop, a swipe to the left on a phone. */
  onMarkRead?: () => unknown;
}

const TONE: Record<NotificationTone, string> = {
  ok: "bg-success-soft text-success",
  warn: "bg-warning-soft text-warning",
  err: "bg-destructive-soft text-destructive",
  info: "bg-accent text-accent-foreground",
};

/** How far left a swipe must travel to mark the row read. */
const SWIPE_MARK = 72;
const SWIPE_MAX = 112;

/** A swipe to the left on a phone, with the row following the finger. */
function useSwipe(enabled: boolean, onDone: () => void) {
  const row = useRef<HTMLDivElement | null>(null);
  const start = useRef<{ x: number; y: number; dx: number; on: boolean | null } | null>(null);
  // A swipe ends with a click on the row underneath; that click must not open it.
  const swiped = useRef(false);
  const place = (dx: number, animate: boolean) => {
    const el = row.current;
    if (!el) return;
    el.style.transition = animate ? "transform var(--dur) var(--ease-spring)" : "";
    el.style.transform = dx ? `translate3d(${dx}px, 0, 0)` : "";
  };
  if (!enabled) return { row, handlers: {} };
  return {
    row,
    handlers: {
      onPointerDown: (e: PointerEvent<HTMLDivElement>) => {
        if (e.pointerType === "mouse") return;
        start.current = { x: e.clientX, y: e.clientY, dx: 0, on: null };
      },
      onPointerMove: (e: PointerEvent<HTMLDivElement>) => {
        const s = start.current;
        if (!s) return;
        const dx = e.clientX - s.x;
        const dy = e.clientY - s.y;
        // Decide once: sideways is a swipe, up or down is the list scrolling.
        if (s.on === null && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) s.on = Math.abs(dx) > Math.abs(dy) && dx < 0;
        if (!s.on) return;
        swiped.current = true;
        s.dx = Math.max(-SWIPE_MAX, Math.min(0, dx));
        place(s.dx, false);
      },
      onPointerUp: () => {
        const s = start.current;
        start.current = null;
        if (!s || !s.on) return;
        if (s.dx <= -SWIPE_MARK) {
          if (typeof navigator !== "undefined") navigator.vibrate?.(10);
          onDone();
        }
        place(0, true);
      },
      onPointerCancel: () => {
        start.current = null;
        place(0, true);
      },
      onClickCapture: (e: MouseEvent<HTMLDivElement>) => {
        if (!swiped.current) return;
        swiped.current = false;
        e.preventDefault();
        e.stopPropagation();
      },
    },
  };
}

export function NotificationRow({ title, body, when, avatar, icon = "bell", tone = "info", unread = false, onOpen, onMarkRead }: NotificationRowProps) {
  const phone = useIsPhone();
  const canMark = unread && !!onMarkRead;
  const swipe = useSwipe(phone && canMark, () => void onMarkRead?.());
  return (
    <article className="group relative overflow-hidden" data-unread={unread || undefined}>
      {phone && canMark && (
        <div aria-hidden="true" className="absolute inset-0 flex items-center justify-end gap-1.5 bg-primary px-5 text-sm font-strong text-primary-foreground">
          <Icon name="check" size="s" />
          Mark Read
        </div>
      )}
      <div ref={swipe.row} {...swipe.handlers} className="relative touch-pan-y bg-card">
        <button
          type="button"
          onClick={() => void onOpen?.()}
          className={cn(
            "flex w-full items-start gap-3 px-4 py-3 text-left outline-none transition-colors duration-(--dur-fast) hover:bg-muted focus-visible:bg-muted phone:min-h-tap",
            canMark && !phone && "pr-12",
          )}
        >
          {avatar ? (
            <Avatar name={avatar} size="lg" className="flex-none" />
          ) : (
            <span className={cn("flex size-10 flex-none items-center justify-center rounded-full", TONE[tone])}>
              <Icon name={icon} />
            </span>
          )}
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="flex items-baseline gap-2">
              <b className={cn("min-w-0 flex-1 truncate text-sm", unread ? "font-strong text-foreground" : "font-normal text-muted-foreground")} data-copy="content">
                {title}
                <span className="sr-only">{unread ? ", Unread, " : ", "}</span>
              </b>
              <span className={cn("flex-none text-xs", unread ? "font-strong text-foreground" : "text-subtle-foreground")} data-copy="content">
                {when}
              </span>
            </span>
            {body != null && body !== "" && (
              <span className="line-clamp-2 whitespace-pre-line text-sm text-subtle-foreground" data-copy="content">
                <span className="sr-only">, </span>
                {body}
              </span>
            )}
          </span>
          {unread && <span aria-hidden="true" className="mt-1.5 size-2.5 flex-none rounded-full bg-primary" />}
        </button>
        {canMark && !phone && (
          <span className="absolute top-2.5 right-2 opacity-0 transition-opacity duration-(--dur-fast) group-focus-within:opacity-100 group-hover:opacity-100">
            <IconButton icon="check" label="Mark Read" size="sm" onClick={() => onMarkRead?.()} />
          </span>
        )}
      </div>
    </article>
  );
}
