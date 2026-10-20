/**
 * @component NotificationCenter
 * @group Shell
 * @summary The bell's pane: All and Unread, the notifications grouped Today, Yesterday and Earlier, Mark All Read and the settings gear; a page from the right on a phone, a panel under the bell on desktop.
 * @use Once, in each shell's top bar, around the bell (the app's Bell wires it to GET /api/v1/notifications and the read marks).
 * @avoid Alerts that need clearing (Home · Alerts); a record's own activity (Timeline); confirming an action (a toast).
 * @phone A full-screen PhonePage that slides in from the right: Back, Mark All Read and the gear in its header, All and Unread under it, rows with swipe to mark read, pull down to refresh, more rows as you near the end.
 * @a11y On desktop a non-modal panel named Notifications under the bell (Radix popover: Esc or a click outside closes it, focus returns to the bell); on a phone a modal page. All and Unread is a radio group; the groups are headed lists; each row is one button.
 * @status beta
 * @example <NotificationCenter open={open} onOpenChange={setOpen} trigger={bell} view="all" onView={setView} unread={3} items={rows} onOpenItem={open} onMarkRead={read} onMarkAllRead={readAll} onSettings={settings} />
 */
import { useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import * as Radix from "@radix-ui/react-popover";
import { Slot } from "@radix-ui/react-slot";
import { formatWhen } from "../lib/format";
import { useIsPhone } from "../lib/media";
import { IconButton } from "../actions/Button";
import { ActionGroup } from "../actions/ActionGroup";
import { Icon, type IconName } from "../icons/Icon";
import { EmptyState } from "../display/EmptyState";
import { Skeleton } from "../display/Skeleton";
import { SegmentedControl } from "../navigation/SegmentedControl";
import { PhonePage } from "../overlay/PhonePage";
import { NotificationRow, type NotificationTone } from "./NotificationRow";

/** One notification as the pane shows it. */
export interface NotificationItem {
  id: string;
  title: string;
  body?: string | null;
  /** When it came (ISO): its day group and its time. */
  at: string;
  unread: boolean;
  /** A person's name: their initials stand for it (mail, a message). */
  avatar?: string | null;
  /** The category's glyph when there is no person. */
  icon?: IconName;
  tone?: NotificationTone;
}

export type NotificationView = "all" | "unread";

export interface NotificationCenterProps {
  /** Whether the pane is open. */
  open: boolean;
  /** Called to open or close it: the bell, Back, Esc, a click outside. */
  onOpenChange: (open: boolean) => void;
  /** The bell button: the desktop panel hangs under it; on a phone it opens the page. */
  trigger: ReactElement;
  /** All, or only the unread. */
  view: NotificationView;
  /** Called with the view chosen. */
  onView: (view: NotificationView) => void;
  /** How many are unread, for the Unread choice. */
  unread: number;
  /** The rows loaded so far, newest first. */
  items: NotificationItem[];
  /** The first page is loading. */
  loading?: boolean;
  /** There are more rows to load (pages of 25). */
  more?: boolean;
  /** Loads the next page; called as the list nears its end. */
  onMore?: () => unknown;
  /** Reloads the list: pull down on a phone. */
  onRefresh?: () => Promise<unknown>;
  /** Opens one: its record (the pane closes), or marks it read when it has none. */
  onOpenItem: (item: NotificationItem) => unknown;
  /** Marks one read without opening it (hover on desktop, a swipe on a phone). */
  onMarkRead: (item: NotificationItem) => unknown;
  /** Marks every one read. Hands back its work. */
  onMarkAllRead: () => unknown;
  /** The gear: Notification Settings. */
  onSettings: () => unknown;
  /** Something above the list, such as turning notifications on for this device. */
  notice?: ReactNode;
  /** Today, for the day groups (tests). */
  now?: Date;
  /** Where it mounts; document.body by default (the gallery passes its themed frame). */
  container?: HTMLElement | null;
}

type DayGroup = "Today" | "Yesterday" | "Earlier";

function groupsOf(items: NotificationItem[], now: Date): Array<[DayGroup, NotificationItem[]]> {
  const out = new Map<DayGroup, NotificationItem[]>();
  for (const item of items) {
    const when = formatWhen(item.at, now);
    const day: DayGroup = /^\d{2}:\d{2}$/.test(when) ? "Today" : when === "Yesterday" ? "Yesterday" : "Earlier";
    if (!out.has(day)) out.set(day, []);
    out.get(day)!.push(item);
  }
  return [...out.entries()];
}

/** How close to the end of the list the next page is asked for. */
const NEAR_END_PX = 240;

function List({ items, loading, view, now, onOpenItem, onMarkRead }: Pick<NotificationCenterProps, "items" | "loading" | "view" | "onOpenItem" | "onMarkRead"> & { now: Date }) {
  if (loading && items.length === 0) {
    return (
      <div className="p-4">
        <Skeleton lines={5} />
      </div>
    );
  }
  if (items.length === 0) {
    return view === "unread" ? (
      <EmptyState bare icon="ticks" title="All Caught Up" text="Nothing unread." className="py-10" />
    ) : (
      <EmptyState bare icon="bell" title="Nothing Yet" text="New notifications appear here." className="py-10" />
    );
  }
  return (
    <>
      {groupsOf(items, now).map(([day, rows]) => (
        <section key={day} aria-label={day}>
          <h3 className="sticky top-0 z-10 bg-background px-4 pt-3 pb-1.5 text-2xs font-strong tracking-wide text-subtle-foreground uppercase">{day}</h3>
          <ul className="divide-y divide-border">
            {rows.map((n) => (
              <li key={n.id}>
                <NotificationRow
                  title={n.title}
                  body={n.body ?? undefined}
                  when={formatWhen(n.at, now)}
                  avatar={n.avatar}
                  icon={n.icon}
                  tone={n.tone}
                  unread={n.unread}
                  onOpen={() => onOpenItem(n)}
                  onMarkRead={() => onMarkRead(n)}
                />
              </li>
            ))}
          </ul>
        </section>
      ))}
      {loading && (
        <div className="flex justify-center py-4 text-subtle-foreground">
          <Icon name="refresh" className="animate-spin" />
        </div>
      )}
    </>
  );
}

export function NotificationCenter(props: NotificationCenterProps) {
  const { open, onOpenChange, trigger, view, onView, unread, items, loading, more, onMore, onRefresh, onMarkAllRead, onSettings, notice, now = new Date(), container } = props;
  const phone = useIsPhone();
  const asked = useRef(0);
  const [body, setBody] = useState<HTMLDivElement | null>(null);

  // Near the end of what is loaded: the next page of 25, asked once per length.
  const nearEnd = (el: HTMLElement) => {
    if (!more || loading || !onMore || asked.current === items.length) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - NEAR_END_PX) {
      asked.current = items.length;
      void onMore();
    }
  };
  const latest = useRef(nearEnd);
  useEffect(() => {
    latest.current = nearEnd;
  });
  useEffect(() => {
    if (!body) return;
    const onScroll = () => latest.current(body);
    body.addEventListener("scroll", onScroll, { passive: true });
    return () => body.removeEventListener("scroll", onScroll);
  }, [body]);

  const choices = (
    <SegmentedControl<NotificationView>
      label="Show"
      value={view}
      onChange={onView}
      options={[
        { value: "all", label: "All" },
        { value: "unread", label: "Unread", count: unread },
      ]}
    />
  );
  const actions = (
    <>
      <IconButton icon="ticks" label="Mark All Read" onClick={() => onMarkAllRead()} />
      <IconButton icon="cog" label="Notification Settings" onClick={() => onSettings()} />
    </>
  );
  const list = <List {...props} now={now} />;

  if (phone) {
    return (
      <>
        <Slot aria-haspopup="dialog" aria-expanded={open} onClick={() => onOpenChange(!open)}>
          {trigger}
        </Slot>
        <PhonePage open={open} onClose={() => onOpenChange(false)} title="Notifications" actions={actions} bar={choices} bodyRef={setBody} onRefresh={onRefresh} container={container}>
          {notice}
          {list}
        </PhonePage>
      </>
    );
  }

  return (
    <Radix.Root open={open} onOpenChange={onOpenChange}>
      <Radix.Trigger asChild>{trigger}</Radix.Trigger>
      <Radix.Portal container={container ?? undefined}>
        <Radix.Content
          aria-label="Notifications"
          side="bottom"
          align="end"
          sideOffset={8}
          collisionPadding={12}
          className="z-50 flex max-h-card-pane w-105 animate-rise flex-col overflow-hidden rounded-card border border-border bg-background text-foreground shadow-3 outline-none"
        >
          <div className="flex flex-none items-center gap-1 border-b border-border bg-card py-2 pr-2 pl-4">
            <h2 className="min-w-0 flex-1 text-md font-strong">Notifications</h2>
            <ActionGroup>{actions}</ActionGroup>
          </div>
          <div className="flex-none border-b border-border bg-card px-3 py-2">{choices}</div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain" onScroll={(e) => nearEnd(e.currentTarget)}>
            {notice}
            {list}
          </div>
        </Radix.Content>
      </Radix.Portal>
    </Radix.Root>
  );
}
