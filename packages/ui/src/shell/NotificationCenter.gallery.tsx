import { useState } from "react";
import type { GalleryEntry } from "../testing/gallery";
import { Button, IconButton } from "../actions/Button";
import { useGalleryFrame } from "../overlay/gallery-frame";
import { NotificationCenter, type NotificationItem, type NotificationView } from "./NotificationCenter";

const NOW = new Date("2026-10-19T09:30:00+01:00");

const ROWS: NotificationItem[] = [
  { id: "1", title: "Tom-Blake Asaah", body: "Re: Confirm attachments work\nThe signed copy is attached.", at: "2026-10-19T05:33:00+01:00", unread: true, avatar: "Tom-Blake Asaah" },
  { id: "2", title: "Tom-Blake Asaah", body: "Re: Test mail", at: "2026-10-19T04:57:00+01:00", unread: false, avatar: "Tom-Blake Asaah" },
  { id: "3", title: "New sign-in to your account", body: "Edge on Windows, 105.127.11.59. If this was not you, reset your password now.", at: "2026-10-18T19:10:00+01:00", unread: false, icon: "lock", tone: "warn" },
  { id: "4", title: "cPanel on mycityapp.io", body: "[mycityapp.io] Client configuration settings for jbspraxis@mycityapp.io.", at: "2026-10-18T08:00:00+01:00", unread: false, avatar: "cPanel" },
  { id: "5", title: "Approval needed: Leave request", body: "Line manager is waiting on you.", at: "2026-10-15T10:00:00+01:00", unread: true, icon: "check", tone: "warn" },
];

function Pane({ items, notice }: { items: NotificationItem[]; notice?: boolean }) {
  const [ref, frame] = useGalleryFrame();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<NotificationView>("all");
  const [rows, setRows] = useState(items);
  const shown = view === "unread" ? rows.filter((r) => r.unread) : rows;
  const read = (id: string) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, unread: false } : r)));
  return (
    <div ref={ref} className="flex justify-end">
      <NotificationCenter
        open={open}
        onOpenChange={setOpen}
        trigger={<IconButton icon="bell" label="Notifications" dot={rows.some((r) => r.unread)} />}
        view={view}
        onView={setView}
        unread={rows.filter((r) => r.unread).length}
        items={shown}
        now={NOW}
        onOpenItem={(n) => read(n.id)}
        onMarkRead={(n) => read(n.id)}
        onMarkAllRead={() => setRows((rs) => rs.map((r) => ({ ...r, unread: false })))}
        onSettings={() => undefined}
        onRefresh={() => new Promise((r) => setTimeout(r, 600))}
        notice={
          notice ? (
            <div className="m-3 flex items-center gap-3 rounded-box bg-accent p-3 text-sm text-accent-foreground">
              <span className="flex-1">Notifications are off on this device</span>
              <Button size="sm" variant="primary">
                Turn On
              </Button>
            </div>
          ) : undefined
        }
        container={frame}
      />
    </div>
  );
}

export default {
  component: "NotificationCenter",
  states: {
    "With Notifications": () => <Pane items={ROWS} />,
    "Push Off Here": () => <Pane items={ROWS} notice />,
    Empty: () => <Pane items={[]} />,
  },
} satisfies GalleryEntry;
