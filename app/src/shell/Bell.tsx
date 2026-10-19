import { useCallback, useState } from "react";
import { invalidate, useApi, useMutation, usePaged } from "@/api/hooks";
import { useRealtime } from "@/api/realtime";
import type { Notification } from "@/api/types/identity";
import { useRouter } from "@/lib/router";
import { Button, ChoiceField, EmptyState, formatWhen, IconButton, NotificationRow, Pager, useModal, type IconName } from "@mycity/ui";

/**
 * The bell: things that happened to you. Read once and gone. Unresolved
 * conditions (alerts) live on Home · Alerts, where someone acts on them. A new
 * notification arrives over realtime (`notification`), and a read mark made in
 * another tab or on another device as `notification_read`; either reloads the
 * dot, the list and the badge counts. Without a socket they reload when opened.
 */
export function useBell() {
  const modal = useModal();
  return useCallback(
    () =>
      modal.open({
        title: "Notifications",
        wide: true,
        body: (close) => <BellBody close={close} />,
        footer: (close) => <BellFoot close={close} />,
      }),
    [modal],
  );
}

const reload = () => invalidate("/api/v1/notifications");

/** The top bar's bell, with a dot while anything is unread. */
export function BellButton() {
  const { data } = useApi("GET /api/v1/notifications/unread-count");
  const open = useBell();
  useRealtime("notification", reload);
  useRealtime("notification_read", reload);
  return <IconButton icon="bell" label="Notifications" dot={!!data?.unread} onClick={open} />;
}

/** A glyph per notification category (src/shared/notifications/categories.js). */
const ICONS: Record<string, IconName> = {
  security: "lock",
  approvals: "check",
  tasks: "ticks",
  alerts: "alert",
  comms: "msg",
  people: "clock",
  performance: "target",
  queries: "flag",
  recruitment: "brief",
  payroll: "wallet",
  partnerships: "link",
  expenses: "wallet",
  knowledge: "book",
  system: "cog",
};

function BellBody({ close }: { close: () => void }) {
  const [view, setView] = useState<"all" | "unread">("all");
  const list = usePaged("GET /api/v1/notifications", { filters: view === "unread" ? { status: "unread" } : {} });
  const read = useMutation("POST /api/v1/notifications/:id/read");
  const { navigate } = useRouter();
  const markRead = (n: Notification) => read.run({ params: { id: n.notification_id }, body: {} }).then(reload);
  const open = (n: Notification) => {
    const marked = n.read_at ? undefined : markRead(n).catch(() => undefined);
    close();
    navigate(n.link!.path);
    return marked;
  };
  return (
    <>
      <div className="mb-2.5">
        <ChoiceField value={view} onChange={setView} options={[["all", "All"], ["unread", "Unread"]]} />
      </div>
      {list.rows.length === 0 && !list.loading ? (
        <EmptyState bare icon="bell" title="Nothing Yet" text="New notifications appear here." />
      ) : (
        list.rows.map((n: Notification) => (
          <NotificationRow
            key={n.notification_id}
            title={n.title}
            body={n.body ?? undefined}
            when={formatWhen(n.created_at)}
            icon={ICONS[n.category] ?? "bell"}
            tone={n.priority === "high" ? "warn" : "info"}
            unread={!n.read_at}
            onOpen={() => (n.link ? open(n) : n.read_at ? undefined : markRead(n))}
            onMarkRead={() => markRead(n)}
          />
        ))
      )}
      <Pager page={list.page} onPage={list.setPage} noun="notification" className="px-0" />
    </>
  );
}

function BellFoot({ close }: { close: () => void }) {
  const read = useMutation("POST /api/v1/notifications/read-all");
  return (
    <>
      <Button busy={read.pending} onClick={() => read.run({ body: {} }).then(reload)}>
        Mark All Read
      </Button>
      <Button variant="primary" onClick={close}>
        Done
      </Button>
    </>
  );
}
