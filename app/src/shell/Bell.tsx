import { useState } from "react";
import { useMutation, usePaged, invalidate } from "@/api/hooks";
import type { Notification } from "@/api/types/identity";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/data";
import { Seg } from "@/components/ui/form";
import { Icon, type IconName } from "@/components/ui/Icon";
import { useModal } from "@/components/ui/Modal";
import { Pager } from "@/components/ui/Table";
import { cn } from "@/lib/cn";
import { formatDateTime } from "@/lib/format";
import { useRouter } from "@/lib/router";

/**
 * The bell: things that happened to you. Read once and gone. Unresolved
 * conditions (alerts) live on Home · Alerts, where someone acts on them.
 */
export function useBell() {
  const modal = useModal();
  return () =>
    modal.open({
      title: "Notifications and Alerts",
      wide: true,
      body: (close) => <BellBody close={close} />,
      footer: (close) => <BellFoot close={close} />,
    });
}

const ICONS: Record<string, IconName> = { approvals: "check", attendance: "clock", recruitment: "brief", community: "msg", leave: "check", partnerships: "link", payroll: "wallet", policy: "doc", device: "lock" };

function BellBody({ close }: { close: () => void }) {
  const [view, setView] = useState<"all" | "unread">("all");
  const list = usePaged("GET /api/v1/notifications", { filters: view === "unread" ? { unread: true } : {} });
  const { navigate } = useRouter();
  return (
    <>
      <div className="mb-2.5">
        <Seg value={view} onChange={setView} options={[["all", "All"], ["unread", "Unread"]]} />
      </div>
      {list.rows.length === 0 && !list.loading ? (
        <EmptyState bare icon="bell" title="Nothing yet" text="New notifications appear here." />
      ) : (
        list.rows.map((n: Notification) => (
          <div key={n.notification_id} className="flex flex-wrap items-center gap-2.5 border-b border-border py-[9px] last:border-b-0">
            <span className={cn("flex size-[30px] flex-none items-center justify-center rounded-ctl", n.tone === "err" ? "bg-destructive-soft text-destructive" : n.tone === "ok" ? "bg-success-soft text-success" : "bg-accent text-accent-foreground")}>
              <Icon name={ICONS[n.category] ?? "bell"} />
            </span>
            <span className="flex min-w-[180px] flex-1 flex-col gap-0.5">
              <b className="text-[12.5px] font-semibold">
                {!n.read_at && <i className="mr-1.5 inline-block size-[7px] rounded-full bg-primary align-middle" />}
                {n.title}
                {!n.read_at && <span className="sr-only"> unread</span>}
              </b>
              <span className="text-[11.5px] text-subtle-foreground">{n.body}</span>
              <span className="text-[11.5px] text-subtle-foreground">{formatDateTime(n.created_at)}</span>
            </span>
            {n.link && (
              <Button onClick={() => (close(), navigate(n.link!.path))}>Open</Button>
            )}
          </div>
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
      <Button disabled={read.pending} onClick={() => read.run({ body: {} }).then(() => invalidate("/api/v1/notifications"))}>
        Mark All as Read
      </Button>
      <Button variant="primary" onClick={close}>
        Done
      </Button>
    </>
  );
}
