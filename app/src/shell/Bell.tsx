import { useEffect, useState } from "react";
import { Button, IconButton, NotificationCenter, type NotificationItem, type NotificationView } from "@mycity/ui";
import type { Notification } from "@mycity/contract/contract.gen.ts";
import { invalidate, useApi, useInfinite, useMutation } from "@/api/hooks";
import { useRouter } from "@/lib/router";
import { CATEGORY_ICONS, markRead, personOf, toneOf, useArrivals } from "@/features/notifications/arrivals";
import { enablePush, syncPush, usePushState } from "@/features/notifications/push";
import { NotificationSettings } from "@/features/notifications/Settings";
import { openNotificationSettings, setPaneOpen, setSettingsOpen, useNotificationsUi } from "@/features/notifications/state";

/**
 * The bell: things that happened to you, read once (docs/guides/notifications.md). Unresolved
 * conditions (alerts) live on Home · Alerts, where someone acts on them.
 *
 * The pane (NotificationCenter) is a page from the right on a phone and a panel under the bell
 * on desktop: All and Unread, the day groups, a row that opens its record and marks it read,
 * swipe or hover to mark read, Mark All Read, and the gear for Notification Settings. A new
 * notice reloads the dot, the pane and the badges, and shows the banner (useArrivals); so does a
 * read mark made in another tab or on another device (`notification_read`).
 */
const reload = () => invalidate("/api/v1/notifications");

function itemOf(n: Notification): NotificationItem {
  return {
    id: n.notification_id,
    title: n.title,
    body: n.body,
    at: n.created_at,
    unread: !n.read_at,
    avatar: personOf(n.entity_type, n.title),
    icon: CATEGORY_ICONS[n.category] ?? "bell",
    tone: toneOf(n),
  };
}

/** The top bar's bell, with a dot while anything is unread, and its pane. */
export function BellButton() {
  const { data } = useApi("GET /api/v1/notifications/unread-count");
  const { pane, settings } = useNotificationsUi();
  const [view, setView] = useState<NotificationView>("all");
  const list = useInfinite("GET /api/v1/notifications", { filters: view === "unread" ? { status: "unread" } : {}, enabled: pane });
  const readAll = useMutation("POST /api/v1/notifications/read-all");
  const { navigate } = useRouter();
  useArrivals(data?.unread);
  // Every signed-in start: keep this device's push saved for whoever is signed in. Never asks.
  useEffect(() => {
    void syncPush();
  }, []);

  const byId = new Map(list.rows.map((n: Notification) => [n.notification_id, n]));
  const open = (item: NotificationItem) => {
    const n = byId.get(item.id);
    const read = item.unread ? markRead([item.id]) : Promise.resolve();
    if (n?.link) {
      setPaneOpen(false);
      navigate(n.link.path);
    }
    return read;
  };

  return (
    <>
      <NotificationCenter
        open={pane}
        onOpenChange={setPaneOpen}
        trigger={<IconButton icon="bell" label="Notifications" dot={!!data?.unread} />}
        view={view}
        onView={setView}
        unread={data?.unread ?? 0}
        items={list.rows.map(itemOf)}
        loading={list.loading}
        more={!!list.page?.has_next}
        onMore={list.more}
        onRefresh={list.reload}
        onOpenItem={open}
        onMarkRead={(item) => markRead([item.id])}
        onMarkAllRead={() => readAll.run({ body: {} }).then(reload)}
        onSettings={openNotificationSettings}
        notice={<TurnOnHere />}
      />
      <NotificationSettings open={settings} onClose={() => setSettingsOpen(false)} />
    </>
  );
}

/** At the top of the pane while push is off on this device and can be turned on. */
function TurnOnHere() {
  const push = usePushState();
  if (push !== "ask" && push !== "off") return null;
  return (
    <div className="m-3 flex items-center gap-3 rounded-box bg-accent px-3.5 py-3 text-sm text-accent-foreground">
      <span className="min-w-0 flex-1">Notifications are off on this device</span>
      <Button size="sm" variant="primary" onClick={() => enablePush()}>
        Turn On
      </Button>
    </div>
  );
}
