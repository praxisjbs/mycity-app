import { useCallback, useEffect, useRef } from "react";
import { notify, type IconName } from "@mycity/ui";
import type { Notification, PushPayload } from "@mycity/contract/contract.gen.ts";
import { api } from "@/api/client";
import { invalidate } from "@/api/hooks";
import { useRealtime } from "@/api/realtime";
import { useAuth } from "@/auth/AuthProvider";
import { useRouter } from "@/lib/router";
import { alertArrival, unlockAudio } from "./sound";
import { setPaneOpen } from "./state";

/**
 * What happens when a notice arrives while the app is open, and the links that bring a person
 * back from one (docs/guides/notifications.md §3, §6):
 *
 *   arrival   over the socket (`notification`) or from the service worker (`mycity:push`, when
 *             a push reaches a device whose app is on screen): the banner at the top for 3 s, the
 *             chime or the buzz, the bell and the urgent bar reloaded. Each notice once, whichever
 *             way it came, and again on each urgent repeat; none for the record already on screen.
 *             Red for urgent, amber for important. The device shows its own notification too
 *             (TB, 19/10/2026); the worker's question is still answered, for an older worker.
 *   open      a tap on a notification while the app runs (`mycity:open`): the app goes there
 *   n=        a link from a notification marks its notices read, then leaves the address
 *   pane=     `pane=notifications` opens the pane (a notice with no screen of its own)
 *   shade     when the app comes to the front, notifications it still shows that are read are
 *             closed, and the app icon's count follows the unread count
 */
/** `repeat` counts the urgent repeats: each shows the banner again. */
type Arrival = Pick<Notification, "notification_id" | "title" | "body" | "category" | "priority" | "urgency" | "entity_type"> & { path: string | null; repeat: number };

/** A category's glyph (src/shared/notifications/categories.js). */
export const CATEGORY_ICONS: Record<string, IconName> = {
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

/** A notice from a person shows their initials (mail, a direct message). */
export const personOf = (entityType: string | null | undefined, title: string) =>
  entityType === "mail_thread" || entityType === "direct_message" ? title : null;

const fromSocket = (n: Notification): Arrival => ({ ...n, path: n.link?.path ?? null, repeat: n.repeat_count });
const fromWorker = (p: PushPayload): Arrival => ({
  notification_id: p.id ?? `push-${p.ts}`,
  title: p.title,
  body: p.body || null,
  category: p.category,
  priority: p.priority,
  urgency: p.urgency,
  entity_type: p.tag.split(":")[0] || null,
  path: p.path,
  repeat: p.round,
});

/** A banner's tone: red for urgent, amber for important or high priority. */
export const toneOf = (n: Pick<Notification, "urgency" | "priority">) =>
  n.urgency === "urgent" ? ("err" as const) : n.urgency === "important" || n.priority === "high" ? ("warn" as const) : ("info" as const);

/** Is this link the screen and record already showing? */
function showing(path: string | null, here: { path: string; id: string | null }): boolean {
  if (!path) return false;
  const url = new URL(path, "http://app.local");
  return url.pathname === here.path && !!here.id && url.searchParams.get("id") === here.id;
}

const reloadBell = () => invalidate("/api/v1/notifications");

/** Marks notices read, quietly: a failure leaves them unread in the bell. */
export function markRead(ids: string[]): Promise<unknown> {
  return Promise.all(ids.map((id) => api.call("POST /api/v1/notifications/:id/read", { params: { id }, body: {} }).catch(() => undefined))).then(reloadBell);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The banner and sound for arrivals, the worker's messages, and the links from notifications. */
export function useArrivals(unread: number | undefined): void {
  const { status } = useAuth();
  const { location, navigate } = useRouter();
  const seen = useRef<Set<string>>(new Set());
  const here = useRef({ path: location.path, id: location.id });
  useEffect(() => {
    here.current = { path: location.path, id: location.id };
  }, [location.path, location.id]);
  const live = useRef(status === "signed-in");
  useEffect(() => {
    live.current = status === "signed-in";
  }, [status]);

  const open = useCallback(
    (a: Arrival) => {
      const read = markRead([a.notification_id].filter((id) => UUID.test(id)));
      if (a.path) navigate(a.path);
      else setPaneOpen(true);
      return read;
    },
    [navigate],
  );

  /** One arrival: true when it was shown (or already had been). */
  const arrive = useCallback(
    (a: Arrival): boolean => {
      if (!live.current) return false;
      const key = `${a.notification_id}:${a.repeat}`;
      if (seen.current.has(key)) return true;
      // A window behind other windows or tabs only reloads its bell: the device's own
      // notification is the one that shows and sounds (docs/guides/notifications.md §11).
      if (document.visibilityState !== "visible") {
        reloadBell();
        return false;
      }
      seen.current.add(key);
      if (seen.current.size > 200) seen.current = new Set([...seen.current].slice(-100));
      reloadBell();
      if (showing(a.path, here.current)) return true;
      notify({
        id: a.notification_id,
        title: a.title,
        body: a.body,
        avatar: personOf(a.entity_type, a.title),
        icon: CATEGORY_ICONS[a.category] ?? "bell",
        tone: toneOf(a),
        onOpen: () => open(a),
      });
      alertArrival(a.category, a.urgency);
      return true;
    },
    [open],
  );

  useRealtime("notification", (payload) => {
    if (payload && typeof payload === "object" && "notification_id" in payload) arrive(fromSocket(payload as Notification));
  });
  // A read mark or Acknowledge on another tab or device: the bell and the urgent bar follow.
  useRealtime("notification_read", () => {
    reloadBell();
    void closeRead();
  });

  // The service worker: a push for an app on screen, and a tap while the app runs.
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const onMessage = (e: MessageEvent) => {
      const port = e.ports[0];
      const data = e.data as { type?: string; payload?: PushPayload; url?: string } | null;
      if (data?.type === "mycity:push" && data.payload) port?.postMessage({ ok: arrive(fromWorker(data.payload)) });
      else if (data?.type === "mycity:open" && typeof data.url === "string") {
        navigate(data.url);
        port?.postMessage({ ok: true });
      }
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [arrive, navigate]);

  // A link from a notification: n= marks it read, pane= opens the pane; both then leave the address.
  useEffect(() => {
    const n = location.params.get("n");
    const pane = location.params.get("pane");
    if (!n && !pane) return;
    const ids = (n ?? "").split(",").filter((id) => UUID.test(id)).slice(0, 25);
    if (ids.length) void markRead(ids);
    if (pane === "notifications") setPaneOpen(true);
    const rest = new URLSearchParams(location.params);
    rest.delete("n");
    rest.delete("pane");
    const qs = rest.toString();
    navigate(`${location.path}${qs ? `?${qs}` : ""}`, { replace: true });
  }, [location, navigate]);

  // The first press lets the chime play later; the shade is tidied whenever the app comes to the front.
  useEffect(() => {
    const unlock = () => unlockAudio();
    const front = () => document.visibilityState === "visible" && void closeRead();
    window.addEventListener("pointerdown", unlock, { once: true });
    document.addEventListener("visibilitychange", front);
    void closeRead();
    return () => {
      window.removeEventListener("pointerdown", unlock);
      document.removeEventListener("visibilitychange", front);
    };
  }, []);

  // The app icon's count, where the platform shows one.
  useEffect(() => {
    if (unread === undefined) return;
    const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
    void (unread > 0 ? nav.setAppBadge?.(unread) : nav.clearAppBadge?.())?.catch(() => undefined);
  }, [unread]);
}

/** Closes the notifications this device still shows once every notice in them is read. */
async function closeRead(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  const reg = await navigator.serviceWorker.getRegistration().catch(() => undefined);
  if (!reg) return;
  const shown = await reg.getNotifications().catch(() => [] as Notification_[]);
  const items = shown
    .map((n) => ({ n, ids: ((n.data as { ids?: string[] } | null)?.ids ?? []).filter((x) => UUID.test(x)) }))
    .filter((x) => x.ids.length > 0);
  const ids = [...new Set(items.flatMap((x) => x.ids))].slice(0, 25);
  if (ids.length === 0) return;
  const { read } = await api.call("GET /api/v1/notifications/read-state", { query: { ids: ids.join(",") } }).catch(() => ({ read: [] as string[] }));
  const done = new Set(read);
  for (const x of items) if (x.ids.every((id) => done.has(id))) x.n.close();
}

/** The DOM's Notification, not the contract's. */
type Notification_ = globalThis.Notification;
