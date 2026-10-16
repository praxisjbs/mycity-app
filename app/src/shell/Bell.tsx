import { useCallback, useState } from "react";
import { invalidate, useApi, useMutation, usePaged } from "@/api/hooks";
import { useRealtime } from "@/api/realtime";
import type { Notification } from "@/api/types/identity";
import { useRouter } from "@/lib/router";
import { Button, ChoiceField, EmptyState, formatWhen, IconButton, NotificationRow, Pager, useModal, type IconName } from "@mycity/ui";

/**
 * The bell: things that happened to you. Read once and gone. Unresolved
 * conditions (alerts) live on Home · Alerts, where someone acts on them. A new
 * notification arrives over realtime (`notification`), which reloads the dot,
 * the list and the badge counts; without a socket they reload when opened.
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

/** The top bar's bell, with a dot while anything is unread. */
export function BellButton() {
  const { data } = useApi("GET /api/v1/notifications", { query: { unread: true } });
  const open = useBell();
  useRealtime("notification", () => invalidate("/api/v1/notifications"));
  return <IconButton icon="bell" label="Notifications" dot={!!data?.page.total} onClick={open} />;
}

const ICONS: Record<string, IconName> = { approvals: "check", attendance: "clock", recruitment: "brief", community: "msg", leave: "check", partnerships: "link", payroll: "wallet", policy: "doc", device: "lock" };

function BellBody({ close }: { close: () => void }) {
  const [view, setView] = useState<"all" | "unread">("all");
  const list = usePaged("GET /api/v1/notifications", { filters: view === "unread" ? { unread: true } : {} });
  const { navigate } = useRouter();
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
            body={n.body}
            when={formatWhen(n.created_at)}
            icon={ICONS[n.category] ?? "bell"}
            tone={n.tone}
            unread={!n.read_at}
            action={n.link ? <Button size="sm" onClick={() => (close(), navigate(n.link!.path))}>Open</Button> : undefined}
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
      <Button busy={read.pending} onClick={() => read.run({ body: {} }).then(() => invalidate("/api/v1/notifications"))}>
        Mark All Read
      </Button>
      <Button variant="primary" onClick={close}>
        Done
      </Button>
    </>
  );
}
