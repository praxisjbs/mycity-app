import { useState } from "react";
import { toast, UrgentBar } from "@mycity/ui";
import type { Notification } from "@mycity/contract/contract.gen.ts";
import { api, ApiError } from "@/api/client";
import { invalidate, useApi } from "@/api/hooks";
import { useRouter } from "@/lib/router";
import { markRead } from "./arrivals";
import { setPaneOpen } from "./state";

/**
 * The urgent bar (docs/guides/notifications.md §6): the person's open urgent notices, newest
 * first, under the top bar on every screen of both shells. Acknowledge closes one that only
 * Acknowledge closes (an urgent announcement); Open reads and opens anything else. A new urgent
 * notice, a repeat, or a read mark made anywhere reloads it, with the bell (useArrivals).
 */
export function useUrgentNotices(): Notification[] {
  const { data } = useApi("GET /api/v1/notifications/urgent");
  return data?.data ?? [];
}

/** The modules an open urgent notice is about: their nav badges show red. */
export function urgentModules(rows: Notification[]): Set<string> {
  return new Set(rows.flatMap((n) => (n.link ? [n.link.module] : [])));
}

/** The tabs an open urgent notice opens on, as `module/tab`: their counts show red. */
export function urgentTabs(rows: Notification[]): Set<string> {
  return new Set(rows.flatMap((n) => (n.link ? [`${n.link.module}/${n.link.tab}`] : [])));
}

export function UrgentNotices({ rows }: { rows: Notification[] }) {
  const [index, setIndex] = useState(0);
  const { navigate } = useRouter();
  if (rows.length === 0) return null;
  const i = Math.min(index, rows.length - 1);
  const n = rows[i];
  const open = () => {
    const read = markRead([n.notification_id]);
    if (n.link) navigate(n.link.path);
    else setPaneOpen(true);
    return read;
  };
  const acknowledge = () =>
    api
      .call("POST /api/v1/notifications/:id/acknowledge", { params: { id: n.notification_id }, body: {} })
      .then(() => invalidate("/api/v1/notifications", "/api/v1/community"))
      .catch((e) => {
        // Withdrawn meanwhile, or offline: say why, and show the bar as it is now.
        toast.error(e instanceof ApiError && e.status !== 0 ? e.message : "Not acknowledged. Try again.");
        invalidate("/api/v1/notifications");
      });
  return (
    <UrgentBar
      title={n.title}
      position={i + 1}
      count={rows.length}
      actionLabel={n.acknowledge_required ? "Acknowledge" : "Open"}
      onAction={n.acknowledge_required ? acknowledge : open}
      onOpen={open}
      onPrevious={i > 0 ? () => setIndex(i - 1) : undefined}
      onNext={i < rows.length - 1 ? () => setIndex(i + 1) : undefined}
    />
  );
}
